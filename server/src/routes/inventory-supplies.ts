import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma, textSearch } from "../lib/prisma.js";
import { currentUser } from "../lib/auth.js";
import { badRequest, forbidden, notFound } from "../lib/http.js";
import { hasAction, requireAction } from "../lib/module-access.js";
import { audit } from "../lib/audit.js";
import { NO_SITE, access, actor, assertNotOwn, assertOwnSite, optText, userSelect } from "../inventory/shared.js";
import { notify, usersWithAction } from "../lib/notifications.js";

/** Insumos: catálogo, stock por sede, kardex, traslados entre sedes y entregas a colaboradores (montado en /api/inventory/supplies) */
export const suppliesRouter = Router();

type Tx = Prisma.TransactionClient;

/**
 * Aplica un movimiento de kardex: ajusta el stock de la sede (sin dejarlo negativo) y registra el saldo.
 * delta con signo (+ entra, − sale).
 */
export async function applyMovement(
  tx: Tx,
  m: { supplyId: string; siteId: string; kind: string; delta: number; reason?: string | null; note?: string | null; otherSiteId?: string | null },
  who: { id: string; name: string },
) {
  const supply = await tx.supply.findUniqueOrThrow({ where: { id: m.supplyId }, select: { name: true, defaultMin: true } });
  const stock = await tx.supplyStock.upsert({
    where: { supplyId_siteId: { supplyId: m.supplyId, siteId: m.siteId } },
    update: {},
    create: { supplyId: m.supplyId, siteId: m.siteId, quantity: 0, minStock: supply.defaultMin },
  });
  const balance = stock.quantity + m.delta;
  if (balance < 0) throw badRequest(`Stock insuficiente de ${supply.name}: hay ${stock.quantity}`);
  // Actualización condicionada: si otro movimiento cambió el stock entre medio, se rechaza en vez de descuadrar
  const done = await tx.supplyStock.updateMany({
    where: { supplyId: m.supplyId, siteId: m.siteId, quantity: stock.quantity },
    data: { quantity: balance },
  });
  if (!done.count) throw badRequest("El stock cambió mientras registrabas el movimiento. Vuelve a intentarlo.");
  return tx.supplyMovement.create({
    data: {
      supplyId: m.supplyId,
      siteId: m.siteId,
      kind: m.kind,
      quantity: m.delta,
      balance,
      reason: m.reason ?? null,
      note: m.note ?? null,
      otherSiteId: m.otherSiteId ?? null,
      actorId: who.id,
      actorName: who.name,
    },
  });
}

/** Avisa a quien gestiona el stock cuando un movimiento deja al insumo bajo el mínimo (solo al cruzarlo, no en cada salida) */
async function alertIfLow(mv: { supplyId: string; siteId: string; quantity: number; balance: number }, except: string) {
  const row = await prisma.supplyStock.findUnique({ where: { supplyId_siteId: { supplyId: mv.supplyId, siteId: mv.siteId } }, select: { minStock: true, site: { select: { name: true } }, supply: { select: { name: true } } } });
  if (!row || row.minStock <= 0 || mv.balance >= row.minStock || mv.balance - mv.quantity < row.minStock) return;
  await notify(await usersWithAction("inventario", "stock", mv.siteId), { kind: "inv.stock", title: `Stock bajo: ${row.supply.name}`, body: `${row.site.name}: quedan ${mv.balance} (mínimo ${row.minStock})`, link: "inventario?tab=almacen" }, { except });
}

/** Sede sobre la que opera el usuario (alcance "su sede" fuerza la suya) */
const stockSiteWhere = (a: ReturnType<typeof access>): Prisma.SupplyStockWhereInput => (a.scope === "ALL" ? {} : { siteId: a.siteId ?? NO_SITE });

// ── Catálogo y almacén ──

suppliesRouter.get("/", async (req, res) => {
  const a = access(req);
  assertNotOwn(a);
  const f = z
    .object({ siteId: z.string().optional(), categoryId: z.string().optional(), q: z.string().trim().max(80).optional(), alert: z.coerce.boolean().optional(), all: z.coerce.boolean().optional() })
    .parse(req.query);
  if (f.siteId) assertOwnSite(a, f.siteId);
  const where: Prisma.SupplyWhereInput = { ...(f.all ? {} : { active: true }), ...(f.categoryId ? { categoryId: f.categoryId } : {}) };
  if (f.q) where.OR = [{ name: textSearch(f.q) }, { sku: textSearch(f.q) }, { description: textSearch(f.q) }];
  const stockWhere: Prisma.SupplyStockWhereInput = { ...stockSiteWhere(a), ...(f.siteId ? { siteId: f.siteId } : {}) };
  const items = await prisma.supply.findMany({
    where,
    include: { stock: { where: stockWhere, include: { site: { select: { id: true, code: true, name: true } } } } },
    orderBy: [{ name: "asc" }],
    take: 1000,
  });
  const out = items.map((s) => {
    const quantity = s.stock.reduce((n, x) => n + x.quantity, 0);
    const minStock = s.stock.reduce((n, x) => n + x.minStock, 0);
    const low = s.stock.some((x) => x.minStock > 0 && x.quantity < x.minStock);
    return { ...s, quantity, minStock, low };
  });
  res.json(f.alert ? out.filter((s) => s.low) : out);
});

const supplyInput = z.object({
  sku: z
    .string()
    .trim()
    .min(2)
    .max(30)
    .transform((v) => v.toUpperCase()),
  name: z.string().trim().min(2).max(80),
  unit: z.string().trim().min(1).max(16).default("unid."),
  description: optText(300),
  categoryId: z.string().nullish(),
  defaultMin: z.number().int().min(0).max(100000).default(0),
  active: z.boolean().default(true),
  /** Stock inicial por sede (solo al crear) */
  initial: z.array(z.object({ siteId: z.string(), quantity: z.number().int().min(0).max(1_000_000), minStock: z.number().int().min(0).max(100000) })).max(50).default([]),
});

async function assertSupplyCategory(categoryId?: string | null) {
  if (!categoryId) return;
  const c = await prisma.inventoryCategory.findUnique({ where: { id: categoryId } });
  if (!c || c.kind !== "SUPPLY") throw badRequest("Categoría de insumo inválida");
}

suppliesRouter.post("/", requireAction("create"), async (req, res) => {
  const a = access(req);
  const { initial, ...data } = supplyInput.parse(req.body);
  await assertSupplyCategory(data.categoryId);
  for (const i of initial) assertOwnSite(a, i.siteId);
  const who = actor(req);
  const supply = await prisma.$transaction(async (tx) => {
    const s = await tx.supply.create({ data });
    for (const i of initial) {
      await tx.supplyStock.create({ data: { supplyId: s.id, siteId: i.siteId, quantity: 0, minStock: i.minStock } });
      if (i.quantity > 0) await applyMovement(tx, { supplyId: s.id, siteId: i.siteId, kind: "IN", delta: i.quantity, reason: "Stock inicial" }, who);
    }
    return s;
  });
  await audit(req, "supply.created", "supply", { entityId: supply.id, detail: `${supply.sku} ${supply.name}` });
  res.status(201).json(supply);
});

suppliesRouter.put("/:id", requireAction("edit"), async (req, res) => {
  const { initial: _i, ...data } = supplyInput.partial().parse(req.body);
  await assertSupplyCategory(data.categoryId);
  const s = await prisma.supply.update({ where: { id: req.params.id }, data });
  await audit(req, "supply.updated", "supply", { entityId: s.id, detail: s.name });
  res.json(s);
});

/** Mínimo de una sede (la alerta salta por debajo de este número) */
suppliesRouter.put("/:id/stock/:siteId", requireAction("stock"), async (req, res) => {
  const a = access(req);
  assertOwnSite(a, req.params.siteId);
  const { minStock } = z.object({ minStock: z.number().int().min(0).max(100000) }).parse(req.body);
  const row = await prisma.supplyStock.upsert({
    where: { supplyId_siteId: { supplyId: req.params.id, siteId: req.params.siteId } },
    update: { minStock },
    create: { supplyId: req.params.id, siteId: req.params.siteId, minStock },
  });
  res.json(row);
});

suppliesRouter.get("/:id/kardex", async (req, res) => {
  const a = access(req);
  assertNotOwn(a);
  const { siteId, limit } = z.object({ siteId: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
  if (siteId) assertOwnSite(a, siteId);
  const supply = await prisma.supply.findUnique({
    where: { id: req.params.id },
    include: { category: true, stock: { where: stockSiteWhere(a), include: { site: { select: { id: true, code: true, name: true } } } } },
  });
  if (!supply) throw notFound("Insumo no encontrado");
  const movements = await prisma.supplyMovement.findMany({
    where: { supplyId: supply.id, ...(siteId ? { siteId } : a.scope === "ALL" ? {} : { siteId: a.siteId ?? NO_SITE }) },
    include: { site: { select: { code: true, name: true } } },
    orderBy: { at: "desc" },
    take: limit,
  });
  res.json({ supply, movements });
});

/** Entrada, salida (consumo) o ajuste por conteo */
suppliesRouter.post("/:id/movements", requireAction("stock"), async (req, res) => {
  const a = access(req);
  const data = z
    .object({
      siteId: z.string(),
      kind: z.enum(["IN", "OUT", "ADJUST"]),
      /** IN/OUT: cantidad a sumar o restar. ADJUST: cantidad contada (el nuevo stock) */
      quantity: z.number().int().min(0).max(1_000_000),
      reason: optText(80),
      note: optText(300),
    })
    .parse(req.body);
  assertOwnSite(a, data.siteId);
  if (data.kind !== "ADJUST" && data.quantity === 0) throw badRequest("La cantidad debe ser mayor que cero");
  const site = await prisma.site.findUnique({ where: { id: data.siteId } });
  if (!site?.active) throw badRequest("La sede no existe o está inactiva");
  const who = actor(req);
  const mv = await prisma.$transaction(async (tx) => {
    let delta = data.kind === "IN" ? data.quantity : -data.quantity;
    if (data.kind === "ADJUST") {
      const cur = await tx.supplyStock.findUnique({ where: { supplyId_siteId: { supplyId: req.params.id, siteId: data.siteId } } });
      delta = data.quantity - (cur?.quantity ?? 0);
      if (delta === 0) throw badRequest("El conteo coincide con el stock: no hay nada que ajustar");
    }
    return applyMovement(tx, { supplyId: req.params.id, siteId: data.siteId, kind: data.kind, delta, reason: data.reason, note: data.note }, who);
  });
  await audit(req, `supply.${data.kind.toLowerCase()}`, "supply", { entityId: req.params.id, detail: `${mv.quantity > 0 ? "+" : ""}${mv.quantity} en ${site.name} (saldo ${mv.balance})` });
  await alertIfLow(mv, who.id);
  res.status(201).json(mv);
});

/** Traslado de stock entre sedes (sale y entra en el mismo momento) */
suppliesRouter.post("/:id/transfer", requireAction("transfer"), async (req, res) => {
  const a = access(req);
  const data = z.object({ fromSiteId: z.string(), toSiteId: z.string(), quantity: z.number().int().min(1).max(1_000_000), note: optText(300) }).parse(req.body);
  if (data.fromSiteId === data.toSiteId) throw badRequest("Elige otra sede destino");
  assertOwnSite(a, data.fromSiteId);
  const [from, to] = await Promise.all([prisma.site.findUnique({ where: { id: data.fromSiteId } }), prisma.site.findUnique({ where: { id: data.toSiteId } })]);
  if (!from || !to?.active) throw badRequest("Sede inválida o inactiva");
  const who = actor(req);
  const out = await prisma.$transaction(async (tx) => {
    const mv = await applyMovement(tx, { supplyId: req.params.id, siteId: from.id, kind: "TRANSFER_OUT", delta: -data.quantity, note: data.note, reason: `A ${to.name}`, otherSiteId: to.id }, who);
    await applyMovement(tx, { supplyId: req.params.id, siteId: to.id, kind: "TRANSFER_IN", delta: data.quantity, note: data.note, reason: `De ${from.name}`, otherSiteId: from.id }, who);
    return mv;
  });
  await audit(req, "supply.transfer", "supply", { entityId: req.params.id, detail: `${data.quantity} de ${from.name} a ${to.name}` });
  await alertIfLow(out, who.id);
  res.status(201).json({ ok: true });
});

// ── Entregas a colaboradores ──

suppliesRouter.get("/deliveries/list", async (req, res) => {
  const a = access(req);
  assertNotOwn(a);
  const { status, siteId } = z.object({ status: z.enum(["PENDING", "CONFIRMED", "REJECTED"]).optional(), siteId: z.string().optional() }).parse(req.query);
  const where: Prisma.SupplyDeliveryWhereInput = {
    ...(status ? { status } : {}),
    ...(a.scope === "ALL" ? (siteId ? { siteId } : {}) : { siteId: a.siteId ?? NO_SITE }),
  };
  res.json(
    await prisma.supplyDelivery.findMany({
      where,
      include: { supply: { select: { id: true, name: true, unit: true, sku: true } }, user: { select: userSelect }, site: { select: { code: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  );
});

suppliesRouter.post("/deliveries", requireAction("deliver"), async (req, res) => {
  const a = access(req);
  const data = z
    .object({ supplyId: z.string(), siteId: z.string(), userId: z.string(), quantity: z.number().int().min(1).max(10000), note: optText(300) })
    .parse(req.body);
  assertOwnSite(a, data.siteId);
  const user = await prisma.user.findUnique({ where: { id: data.userId }, select: { id: true, name: true, active: true, siteId: true } });
  if (!user?.active) throw badRequest("El colaborador no existe o está inactivo");
  if (a.scope !== "ALL" && user.siteId !== a.siteId) throw forbidden("Solo puedes entregar a colaboradores de tu sede");
  const who = actor(req);
  const { delivery, mv } = await prisma.$transaction(async (tx) => {
    const mv = await applyMovement(tx, { supplyId: data.supplyId, siteId: data.siteId, kind: "DELIVERY", delta: -data.quantity, reason: `Entrega a ${user.name}`, note: data.note }, who);
    const delivery = await tx.supplyDelivery.create({
      data: { supplyId: data.supplyId, siteId: data.siteId, userId: user.id, quantity: data.quantity, note: data.note, deliveredById: who.id, deliveredByName: who.name },
      include: { supply: { select: { name: true } } },
    });
    return { delivery, mv };
  });
  await audit(req, "supply.delivered", "supply", { entityId: data.supplyId, detail: `${data.quantity} a ${user.name}` });
  await notify([user.id], { kind: "inv.delivery", title: "Tienes una entrega por confirmar", body: `${data.quantity} × ${delivery.supply.name}`, link: "inventario?tab=mio" }, { except: who.id });
  await alertIfLow(mv, who.id);
  res.status(201).json(delivery);
});

/** El colaborador confirma que recibió la entrega o la rechaza (el stock vuelve a la sede) */
suppliesRouter.post("/deliveries/:id/:answer", async (req, res) => {
  const { answer } = z.object({ answer: z.enum(["confirm", "reject"]) }).parse(req.params);
  const { note } = z.object({ note: optText(300) }).parse(req.body ?? {});
  const me = currentUser(req);
  const d = await prisma.supplyDelivery.findUnique({ where: { id: req.params.id }, include: { supply: { select: { name: true } } } });
  if (!d) throw notFound("Entrega no encontrada");
  if (d.userId !== me.id) throw forbidden("Solo quien recibe la entrega puede confirmarla");
  if (d.status !== "PENDING") throw badRequest("Esta entrega ya fue respondida");
  if (answer === "reject" && !note) throw badRequest("Cuéntanos por qué no la recibiste");
  await prisma.$transaction(async (tx) => {
    await tx.supplyDelivery.update({ where: { id: d.id }, data: { status: answer === "confirm" ? "CONFIRMED" : "REJECTED", answerNote: note, answeredAt: new Date() } });
    if (answer === "reject") {
      await applyMovement(tx, { supplyId: d.supplyId, siteId: d.siteId, kind: "RETURN", delta: d.quantity, reason: `Entrega rechazada por ${me.name}`, note }, { id: me.id, name: me.name });
    }
  });
  await audit(req, `supply.delivery.${answer}`, "supply", { entityId: d.supplyId, detail: `${d.quantity} ${d.supply.name}` });
  if (answer === "reject") await notify([d.deliveredById], { kind: "inv.delivery.rejected", title: `${me.name} rechazó una entrega`, body: `${d.quantity} × ${d.supply.name}${note ? ` · ${note}` : ""}`, link: "inventario?tab=almacen" }, { except: me.id });
  res.json({ ok: true });
});

/** Alertas del almacén: insumos bajo el mínimo por sede */
suppliesRouter.get("/alerts/low", async (req, res) => {
  const a = access(req);
  assertNotOwn(a);
  if (!hasAction(req, "view")) throw forbidden();
  const rows = await prisma.supplyStock.findMany({
    where: { ...stockSiteWhere(a), minStock: { gt: 0 }, supply: { active: true } },
    include: { supply: { select: { id: true, name: true, unit: true, sku: true, categoryId: true } }, site: { select: { id: true, code: true, name: true } } },
  });
  res.json(rows.filter((r) => r.quantity < r.minStock).sort((x, y) => x.quantity / x.minStock - y.quantity / y.minStock));
});
