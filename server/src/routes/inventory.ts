import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma, textSearch } from "../lib/prisma.js";
import { currentUser } from "../lib/auth.js";
import { badRequest, forbidden, notFound } from "../lib/http.js";
import { hasAction, requireAction, requireModule } from "../lib/module-access.js";
import { audit } from "../lib/audit.js";
import {
  DAY,
  MANUAL_STATUSES,
  MACHINE_STATUSES,
  STATUS_LABEL,
  NO_SITE,
  access,
  actor,
  assertGlobal,
  assertNotOwn,
  assertOwnSite,
  isOwn,
  isTeam,
  assertTeamMember,
  teamMachines,
  logEvent,
  logEvents,
  formerOwnerNote,
  machineScope,
  optDate,
  optText,
  pageQuery,
  siteScope,
  transferScope,
  userSelect,
} from "../inventory/shared.js";
import { suppliesRouter } from "./inventory-supplies.js";
import { inventoryExcelRouter } from "./inventory-excel.js";
import { notify, supervisorsOf, usersWithAction } from "../lib/notifications.js";

/**
 * Inventario: sedes, plano de sala por puestos, equipos (con kit, asignación, specs, garantía e incidencias),
 * insumos con kardex y entregas. Cada acción exige su permiso dentro del módulo "inventario" (lib/module-access.ts).
 */
export const inventoryRouter = Router();
inventoryRouter.use(requireModule("inventario"));

/** Campanita: avisa a una persona que cambió lo que tiene a su cargo */
const tellOwner = (userId: string | null | undefined, except: string, title: string, body: string) =>
  notify([userId], { kind: "inv.equipment", title, body, link: "inventario?tab=mio" }, { except });
/** Campanita: un equipo cambió de dueño (avisa a quien lo deja y a quien lo recibe) */
async function tellOwnerChange(before: string | null | undefined, after: string | null | undefined, except: string, assetTag: string) {
  if ((before ?? null) === (after ?? null)) return;
  await tellOwner(before, except, "Ya no tienes este equipo a tu cargo", assetTag);
  await tellOwner(after, except, "Tienes un equipo a tu cargo", assetTag);
}

// ── Meta y resumen ──

inventoryRouter.get("/meta", async (req, res) => {
  const a = access(req);
  const [categories, sites] = await Promise.all([
    prisma.inventoryCategory.findMany({ orderBy: [{ kind: "asc" }, { order: "asc" }, { name: "asc" }] }),
    prisma.site.findMany({ where: siteScope(a), orderBy: { name: "asc" }, select: { id: true, code: true, name: true, active: true } }),
  ]);
  res.json({ categories, sites, statuses: MACHINE_STATUSES });
});

/**
 * Colaboradores para reubicar, asignar equipos o entregar insumos.
 * Su sede: solo los de su sede · Su equipo (supervisor): solo sus asesores · Todas las sedes: `all=1` busca en todas.
 * `role=supervisor` lista a los supervisores (para cambiar el supervisor de alguien).
 */
inventoryRouter.get("/people", async (req, res) => {
  const a = access(req);
  if (!hasAction(req, "assign") && !hasAction(req, "deliver") && !hasAction(req, "seat")) throw forbidden("Tu rol no reubica, asigna ni entrega");
  const { q, siteId, all, role } = z
    .object({ q: z.string().trim().max(60).optional(), siteId: z.string().optional(), all: z.coerce.boolean().optional(), role: z.literal("supervisor").optional() })
    .parse(req.query);
  const me = currentUser(req).id;
  const and: Prisma.UserWhereInput[] = [{ active: true }];
  if (role) and.push({ role: { key: "supervisor" } });
  if (isTeam(a)) and.push({ OR: [{ id: me }, { supervisorId: me }] });
  else if (a.scope !== "ALL") and.push({ siteId: a.siteId ?? NO_SITE });
  else if (siteId && !all) and.push({ OR: [{ siteId }, { siteId: null }] });
  if (q) and.push({ OR: [{ name: textSearch(q) }, { email: textSearch(q) }, { area: textSearch(q) }] });
  res.json(
    await prisma.user.findMany({
      where: { AND: and },
      select: { ...userSelect, siteId: true, site: { select: { name: true } }, supervisor: { select: { id: true, name: true } }, stations: { select: { code: true, siteId: true } } },
      orderBy: { name: "asc" },
      take: 40,
    }),
  );
});

inventoryRouter.get("/overview", async (req, res) => {
  const a = access(req);
  const me = currentUser(req).id;
  const mScope = machineScope(a, me);
  const stockWhere: Prisma.SupplyStockWhereInput = a.scope === "ALL" ? {} : { siteId: a.siteId ?? NO_SITE };
  const soon = new Date(Date.now() + 30 * DAY);
  const [byStatus, byCategory, pendingTransfers, openIncidents, stock, pendingDeliveries, warrantySoon] = await Promise.all([
    prisma.machine.groupBy({ by: ["status"], where: mScope, _count: true }),
    prisma.machine.groupBy({ by: ["categoryId"], where: { ...mScope, status: { not: "RETIRED" } }, _count: true }),
    isOwn(a) ? 0 : prisma.machineTransfer.count({ where: { status: "PENDING", ...transferScope(a) } }),
    prisma.incident.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] }, machine: mScope } }),
    isOwn(a) ? [] : prisma.supplyStock.findMany({ where: { ...stockWhere, supply: { active: true } }, select: { quantity: true, minStock: true } }),
    isOwn(a)
      ? prisma.supplyDelivery.count({ where: { userId: me, status: "PENDING" } })
      : prisma.supplyDelivery.count({ where: { status: "PENDING", ...(a.scope === "ALL" ? {} : { siteId: a.siteId ?? NO_SITE }) } }),
    prisma.machine.count({ where: { ...mScope, status: { not: "RETIRED" }, warrantyUntil: { gte: new Date(), lte: soon } } }),
  ]);
  const counts = Object.fromEntries(MACHINE_STATUSES.map((s) => [s, 0])) as Record<string, number>;
  let total = 0;
  for (const g of byStatus) {
    counts[g.status] = (counts[g.status] ?? 0) + g._count;
    total += g._count;
  }
  res.json({
    equipment: { total, ...counts },
    byCategory: byCategory.map((g) => ({ categoryId: g.categoryId, count: g._count })),
    pendingTransfers,
    openIncidents,
    lowStock: stock.filter((s) => s.minStock > 0 && s.quantity < s.minStock).length,
    pendingDeliveries,
    warrantySoon,
  });
});

// ── Sedes ──

inventoryRouter.get("/sites", async (req, res) => {
  const a = access(req);
  assertNotOwn(a);
  const [sites, grouped, incoming, stations, stock] = await Promise.all([
    prisma.site.findMany({ where: siteScope(a), orderBy: { name: "asc" } }),
    prisma.machine.groupBy({ by: ["siteId", "status"], where: machineScope(a, ""), _count: true }),
    prisma.machineTransfer.groupBy({ by: ["toSiteId"], where: { status: "PENDING", ...transferScope(a) }, _count: true }),
    prisma.workstation.groupBy({ by: ["siteId"], where: { active: true }, _count: true }),
    prisma.supplyStock.findMany({ where: { supply: { active: true } }, select: { siteId: true, quantity: true, minStock: true } }),
  ]);
  const counts = new Map<string, Record<string, number>>();
  for (const g of grouped) {
    const c = counts.get(g.siteId) ?? { total: 0 };
    c[g.status] = (c[g.status] ?? 0) + g._count;
    c.total = (c.total ?? 0) + g._count;
    counts.set(g.siteId, c);
  }
  const pending = new Map(incoming.map((i) => [i.toSiteId, i._count]));
  const st = new Map(stations.map((s) => [s.siteId, s._count]));
  const low = new Map<string, number>();
  for (const s of stock) if (s.minStock > 0 && s.quantity < s.minStock) low.set(s.siteId, (low.get(s.siteId) ?? 0) + 1);
  res.json(
    sites.map((s) => ({ ...s, counts: counts.get(s.id) ?? { total: 0 }, incoming: pending.get(s.id) ?? 0, stations: st.get(s.id) ?? 0, lowStock: low.get(s.id) ?? 0 })),
  );
});

const siteInput = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(6)
    .transform((v) => v.toUpperCase()),
  name: z.string().trim().min(2).max(60),
  address: optText(120),
  city: optText(60),
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
  active: z.boolean().default(true),
});

inventoryRouter.post("/sites", requireAction("sites"), async (req, res) => {
  assertGlobal(access(req));
  const site = await prisma.site.create({ data: siteInput.parse(req.body) });
  await audit(req, "site.created", "site", { entityId: site.id, detail: site.name });
  res.status(201).json(site);
});

inventoryRouter.put("/sites/:id", requireAction("sites"), async (req, res) => {
  assertGlobal(access(req));
  const data = siteInput.partial().parse(req.body);
  if (data.active === false) {
    const incoming = await prisma.machineTransfer.count({ where: { toSiteId: req.params.id, status: "PENDING" } });
    if (incoming) throw badRequest(`La sede tiene ${incoming} equipo(s) en camino. Recíbelos o cancela el traslado antes de desactivarla.`);
  }
  const site = await prisma.site.update({ where: { id: req.params.id }, data });
  await audit(req, "site.updated", "site", { entityId: site.id, detail: site.name });
  res.json(site);
});

// ── Categorías ──

const categoryInput = z.object({
  kind: z.enum(["EQUIPMENT", "SUPPLY"]),
  key: z
    .string()
    .trim()
    .min(2)
    .max(20)
    .transform((v) => v.toUpperCase().replace(/[^A-Z0-9_-]/g, "")),
  name: z.string().trim().min(2).max(40),
  icon: z.string().trim().min(2).max(40).default("Box"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color hexadecimal inválido"),
  slot: z.enum(["PC", "MONITOR", "HEADSET", "PERIPHERAL", "PHONE", "OTHER"]).nullish(),
  unit: optText(16),
  active: z.boolean().default(true),
});

inventoryRouter.post("/categories", requireAction("sites"), async (req, res) => {
  assertGlobal(access(req));
  const data = categoryInput.parse(req.body);
  const last = await prisma.inventoryCategory.aggregate({ _max: { order: true } });
  const cat = await prisma.inventoryCategory.create({
    data: { ...data, slot: data.kind === "EQUIPMENT" ? (data.slot ?? "OTHER") : null, order: (last._max.order ?? 0) + 10 },
  });
  await audit(req, "inventory.category.created", "inventoryCategory", { entityId: cat.id, detail: cat.name });
  res.status(201).json(cat);
});

inventoryRouter.put("/categories/:id", requireAction("sites"), async (req, res) => {
  assertGlobal(access(req));
  const { kind: _kind, key: _key, ...data } = categoryInput.partial().parse(req.body);
  const cat = await prisma.inventoryCategory.update({ where: { id: req.params.id }, data });
  await audit(req, "inventory.category.updated", "inventoryCategory", { entityId: cat.id, detail: cat.name });
  res.json(cat);
});

inventoryRouter.delete("/categories/:id", requireAction("sites"), async (req, res) => {
  assertGlobal(access(req));
  const cat = await prisma.inventoryCategory.findUniqueOrThrow({ where: { id: req.params.id }, include: { _count: { select: { machines: true, supplies: true } } } });
  const used = cat._count.machines + cat._count.supplies;
  if (used) throw badRequest(`La categoría tiene ${used} registro(s). Desactívala en lugar de eliminarla.`);
  await prisma.inventoryCategory.delete({ where: { id: cat.id } });
  await audit(req, "inventory.category.deleted", "inventoryCategory", { entityId: cat.id, detail: cat.name });
  res.json({ ok: true });
});

// ── Plano de sala ──

const machineCard = {
  id: true,
  assetTag: true,
  status: true,
  brand: true,
  model: true,
  hostname: true,
  categoryId: true,
  workstationId: true,
  assignedUserId: true,
  warrantyUntil: true,
  _count: { select: { incidents: { where: { status: { in: ["OPEN", "IN_PROGRESS"] } } } } },
} satisfies Prisma.MachineSelect;

inventoryRouter.get("/sites/:id/plan", async (req, res) => {
  const a = access(req);
  assertNotOwn(a);
  assertOwnSite(a, req.params.id);
  const site = await prisma.site.findUnique({ where: { id: req.params.id } });
  if (!site) throw notFound("Sede no encontrada");
  const [zones, stations, loose] = await Promise.all([
    prisma.floorZone.findMany({ where: { siteId: site.id }, orderBy: { name: "asc" } }),
    prisma.workstation.findMany({
      where: { siteId: site.id },
      include: { user: { select: userSelect }, machines: { select: machineCard, orderBy: { assetTag: "asc" } } },
      orderBy: { code: "asc" },
    }),
    prisma.machine.findMany({
      where: { siteId: site.id, workstationId: null, status: { not: "RETIRED" } },
      select: { ...machineCard, assignedUser: { select: userSelect } },
      orderBy: { assetTag: "asc" },
    }),
  ]);
  res.json({ site, zones, stations, loose });
});

const planInput = z.object({
  cols: z.number().int().min(6).max(60),
  rows: z.number().int().min(4).max(40),
  zones: z
    .array(
      z.object({
        ref: z.string().min(1).max(40),
        id: z.string().optional(),
        name: z.string().trim().min(1).max(40),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        x: z.number().int().min(0),
        y: z.number().int().min(0),
        w: z.number().int().min(1),
        h: z.number().int().min(1),
      }),
    )
    .max(40),
  stations: z
    .array(
      z.object({
        id: z.string().optional(),
        code: z
          .string()
          .trim()
          .min(1)
          .max(12)
          .transform((v) => v.toUpperCase()),
        x: z.number().int().min(0),
        y: z.number().int().min(0),
        zoneRef: z.string().nullish(),
        active: z.boolean().default(true),
      }),
    )
    .max(600),
});

/** Guarda el plano completo: tamaño, zonas y puestos. Los puestos quitados liberan sus equipos (quedan sin puesto). */
inventoryRouter.put("/sites/:id/plan", requireAction("layout"), async (req, res) => {
  const a = access(req);
  assertOwnSite(a, req.params.id);
  const data = planInput.parse(req.body);
  const site = await prisma.site.findUniqueOrThrow({ where: { id: req.params.id } });
  const cells = new Set<string>();
  const codes = new Set<string>();
  for (const s of data.stations) {
    if (s.x >= data.cols || s.y >= data.rows) throw badRequest(`El puesto ${s.code} queda fuera de la cuadrícula`);
    const cell = `${s.x}:${s.y}`;
    if (cells.has(cell)) throw badRequest(`Hay dos puestos en la misma celda (${s.code})`);
    if (codes.has(s.code)) throw badRequest(`El código ${s.code} está repetido`);
    cells.add(cell);
    codes.add(s.code);
  }
  for (const z_ of data.zones) if (z_.x + z_.w > data.cols || z_.y + z_.h > data.rows) throw badRequest(`La zona ${z_.name} se sale de la cuadrícula`);

  const [oldZones, oldStations] = await Promise.all([
    prisma.floorZone.findMany({ where: { siteId: site.id }, select: { id: true } }),
    prisma.workstation.findMany({ where: { siteId: site.id }, select: { id: true, code: true, x: true, y: true, active: true, zoneId: true, userId: true } }),
  ]);
  const keepZones = new Set(data.zones.map((z_) => z_.id).filter(Boolean));
  const keepStations = new Set(data.stations.map((s) => s.id).filter(Boolean));
  const validZone = new Set(oldZones.map((z_) => z_.id));
  const before = new Map(oldStations.map((s) => [s.id, s]));
  const previous = (id?: string) => (id ? before.get(id) : undefined);

  const who = actor(req);
  // Persona afectada → puesto quitado (un solo aviso por persona, no uno por equipo)
  const affected = new Map<string, string>();
  await prisma.$transaction(async (tx) => {
    await tx.site.update({ where: { id: site.id }, data: { planCols: data.cols, planRows: data.rows } });
    const removed = oldStations.filter((s) => !keepStations.has(s.id)).map((s) => s.id);
    if (removed.length) {
      // Los equipos de un puesto eliminado vuelven al almacén, sin persona a cargo
      const kit = await tx.machine.findMany({ where: { workstationId: { in: removed } }, select: { id: true, workstationId: true, assignedUserId: true, assignedUser: { select: { name: true } } } });
      for (const s of oldStations) if (s.userId && !keepStations.has(s.id)) affected.set(s.userId, s.code);
      for (const m of kit) if (m.assignedUserId) affected.set(m.assignedUserId, before.get(m.workstationId!)?.code ?? "");
      await tx.machine.updateMany({ where: { workstationId: { in: removed }, status: "ACTIVE" }, data: { status: "STORAGE" } });
      await tx.machine.updateMany({ where: { workstationId: { in: removed } }, data: { workstationId: null, location: "Almacén", assignedUserId: null, lastMovedAt: new Date() } });
      for (const m of kit) {
        const owner = m.assignedUser ? ` · antes a cargo de ${m.assignedUser.name}` : "";
        await logEvent(tx, m.id, "MOVED", `Puesto ${before.get(m.workstationId!)?.code ?? "eliminado"} eliminado del plano → almacén${owner}`, who);
      }
      await tx.workstation.deleteMany({ where: { id: { in: removed } } });
    }
    await tx.floorZone.deleteMany({ where: { siteId: site.id, id: { notIn: [...keepZones] as string[] } } });
    const zoneIds = new Map<string, string>();
    for (const z_ of data.zones) {
      const fields = { name: z_.name, color: z_.color, x: z_.x, y: z_.y, w: z_.w, h: z_.h };
      const row = z_.id && validZone.has(z_.id) ? await tx.floorZone.update({ where: { id: z_.id }, data: fields }) : await tx.floorZone.create({ data: { ...fields, siteId: site.id } });
      zoneIds.set(z_.ref, row.id);
    }
    // Códigos temporales para no chocar con el índice único (sede, código) al renombrar
    for (const s of data.stations) {
      const old = previous(s.id);
      if (old && old.code !== s.code) await tx.workstation.update({ where: { id: old.id }, data: { code: `~${old.id}` } });
    }
    // Solo se escribe lo que cambió: una sala con cientos de puestos se guarda en pocas consultas
    for (const s of data.stations) {
      const fields = { code: s.code, x: s.x, y: s.y, active: s.active, zoneId: s.zoneRef ? (zoneIds.get(s.zoneRef) ?? null) : null };
      const old = previous(s.id);
      if (!old) {
        await tx.workstation.create({ data: { ...fields, siteId: site.id } });
        continue;
      }
      if (old.code !== fields.code || old.x !== fields.x || old.y !== fields.y || old.active !== fields.active || old.zoneId !== fields.zoneId) {
        await tx.workstation.update({ where: { id: old.id }, data: fields });
      }
      if (old.code !== fields.code) await tx.machine.updateMany({ where: { workstationId: old.id }, data: { location: fields.code } });
    }
  }, { timeout: 30_000 });
  await audit(req, "inventory.plan.updated", "site", { entityId: site.id, detail: `${site.name}: ${data.stations.length} puestos, ${data.zones.length} zonas` });
  for (const [userId, code] of affected) await tellOwner(userId, who.id, `Tu puesto ${code} se quitó del plano`, "Sus equipos volvieron al almacén.");
  res.json({ ok: true });
});

/**
 * Reubicar a una persona: se mueve SOLO la persona. Los equipos se quedan en su puesto y pasan a cargo de quien lo ocupe.
 *  - userId = null libera el puesto.
 *  - Si el puesto de destino estaba ocupado, esa persona pasa al puesto que deja la otra (intercambio); si no tenía puesto, queda sin puesto.
 *  - `carry`: excepción (asesores antiguos con información en su PC). Solo Admin/TI (acción "Mover equipos") puede
 *    hacer que la persona se lleve equipos de su puesto anterior; queda en la bitácora de cada equipo.
 * Supervisor (alcance "su equipo"): solo en su sede y solo con los asesores que tiene a cargo.
 * RRHH (todas las sedes): si reubica a alguien en otra sede, la sede de la persona pasa a ser la del puesto.
 */
inventoryRouter.post("/stations/:id/occupant", requireAction("seat"), async (req, res) => {
  const a = access(req);
  const me = currentUser(req).id;
  const { userId, carry } = z.object({ userId: z.string().nullable(), carry: z.array(z.string()).max(10).default([]) }).parse(req.body);
  if (carry.length && !hasAction(req, "assign")) throw forbidden("Solo Admin/TI puede mover equipos junto con la persona");
  const st = await prisma.workstation.findUniqueOrThrow({ where: { id: req.params.id } });
  assertOwnSite(a, st.siteId);
  if (st.userId === userId) return void res.json({ ok: true });
  const user = userId ? await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, name: true, active: true } }) : null;
  if (user && !user.active) throw badRequest("El colaborador está desactivado");
  // Quién entra y quién sale del puesto deben ser de su equipo (supervisor)
  await assertTeamMember(a, me, userId);
  await assertTeamMember(a, me, st.userId);
  const prev = userId ? await prisma.workstation.findFirst({ where: { userId, id: { not: st.id } } }) : null;
  if (carry.length) {
    if (!prev) throw badRequest("Esta persona no tiene un puesto anterior del cual llevarse equipos");
    const own = await prisma.machine.count({ where: { id: { in: carry }, workstationId: prev.id } });
    if (own !== carry.length) throw badRequest("Solo se pueden llevar equipos del puesto anterior de la persona");
  }
  const displaced = st.userId ? await prisma.user.findUnique({ where: { id: st.userId }, select: { id: true, name: true } }) : null;
  const who = actor(req);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    // 1. La persona deja su puesto anterior; quien estaba en el destino pasa a ese puesto (intercambio)
    if (prev) {
      await tx.workstation.update({ where: { id: prev.id }, data: { userId: displaced?.id ?? null } });
      const left = await tx.machine.findMany({ where: { workstationId: prev.id, id: { notIn: carry } }, select: { id: true } });
      await tx.machine.updateMany({ where: { id: { in: left.map((m) => m.id) } }, data: { assignedUserId: displaced?.id ?? null } });
      await logEvents(tx, left.map((m) => m.id), "ASSIGNED", displaced ? `Puesto ${prev.code}: ahora a cargo de ${displaced.name}` : `Puesto ${prev.code} liberado (${user!.name} pasó a ${st.code})`, who);
    }
    await tx.workstation.update({ where: { id: st.id }, data: { userId } });
    // 2. Los equipos del destino pasan a cargo de quien llega
    const stay = await tx.machine.findMany({ where: { workstationId: st.id }, select: { id: true } });
    await tx.machine.updateMany({ where: { workstationId: st.id }, data: { assignedUserId: userId } });
    await logEvents(tx, stay.map((m) => m.id), "ASSIGNED", user ? `Puesto ${st.code}: ahora a cargo de ${user.name}` : `Puesto ${st.code} liberado`, who);
    // 3. Excepción: equipos que la persona se lleva consigo
    if (carry.length) {
      await tx.machine.updateMany({ where: { id: { in: carry } }, data: { workstationId: st.id, location: st.code, assignedUserId: userId, lastMovedAt: now } });
      await logEvents(tx, carry, "MOVED", `Se fue con ${user!.name}: ${prev!.code} → ${st.code} (excepción autorizada por TI)`, who);
    }
    // 4. Cambio de sede (RRHH reubica entre sedes)
    if (userId) await tx.user.update({ where: { id: userId }, data: { siteId: st.siteId } });
    if (displaced && prev) await tx.user.update({ where: { id: displaced.id }, data: { siteId: prev.siteId } });
  });
  await audit(req, "inventory.person.seated", "workstation", {
    entityId: st.id,
    detail: user ? `${user.name} → ${st.code}${prev ? ` (antes ${prev.code})` : ""}${displaced ? ` · ${displaced.name} → ${prev?.code ?? "sin puesto"}` : ""}${carry.length ? ` · llevó ${carry.length} equipo(s)` : ""}` : `${st.code} liberado`,
  });
  // Avisa a cada persona que cambió de puesto y a su supervisor (si no fue quien hizo el cambio)
  const moves = [
    user && { id: user.id, name: user.name, title: "Cambiaste de puesto", place: st.code, from: prev?.code },
    displaced && { id: displaced.id, name: displaced.name, title: prev ? "Cambiaste de puesto" : "Quedaste sin puesto", place: prev?.code, from: st.code },
  ].filter((x): x is NonNullable<typeof x> => !!x);
  for (const p of moves) {
    const route = `${p.from ?? "Sin puesto"} → ${p.place ?? "sin puesto"}`;
    await notify([p.id], { kind: "inv.seat", title: p.title, body: route, link: "inventario?tab=mio" }, { except: me });
    await notify(await supervisorsOf([p.id]), { kind: "inv.seat", title: `${p.name} cambió de puesto`, body: route, link: "inventario" }, { except: me });
  }
  res.json({ ok: true });
});

/** RRHH (o Admin/TI): cambia el supervisor de un colaborador, p. ej. cuando pasa a otra campaña */
inventoryRouter.post("/people/:id/supervisor", requireAction("seat"), async (req, res) => {
  const a = access(req);
  if (a.scope !== "ALL") throw forbidden("Solo RRHH o Admin/TI cambian el supervisor de un colaborador");
  const { supervisorId, area } = z.object({ supervisorId: z.string().nullable(), area: optText(80).optional() }).parse(req.body);
  const person = await prisma.user.findUniqueOrThrow({ where: { id: req.params.id }, select: { id: true, name: true, supervisorId: true } });
  if (supervisorId === person.id) throw badRequest("Una persona no puede ser su propio supervisor");
  const sup = supervisorId ? await prisma.user.findUniqueOrThrow({ where: { id: supervisorId }, select: { id: true, name: true } }) : null;
  await prisma.user.update({ where: { id: person.id }, data: { supervisorId, ...(area !== undefined ? { area } : {}) } });
  await audit(req, "user.supervisor.changed", "user", { entityId: person.id, detail: `${person.name} → ${sup?.name ?? "sin supervisor"}${area ? ` · ${area}` : ""}` });
  if (person.supervisorId !== supervisorId) {
    const except = currentUser(req).id;
    const base = { kind: "inv.supervisor", link: "inventario" };
    await notify([person.id], { ...base, title: "Cambió tu supervisor", body: sup ? `Ahora estás con ${sup.name}` : "Por ahora no tienes supervisor asignado", link: null }, { except });
    await notify([supervisorId], { ...base, title: `${person.name} se unió a tu equipo`, body: area ?? null }, { except });
    await notify([person.supervisorId], { ...base, title: `${person.name} dejó tu equipo`, body: sup ? `Ahora está con ${sup.name}` : null }, { except });
  }
  res.json({ ok: true });
});

/** Mueve el kit completo de un puesto a otro. Si el destino tiene kit, se intercambian. */
inventoryRouter.post("/stations/:id/move-kit", requireAction("assign"), async (req, res) => {
  const a = access(req);
  const { toStationId } = z.object({ toStationId: z.string() }).parse(req.body);
  const [from, to] = await Promise.all([
    prisma.workstation.findUniqueOrThrow({ where: { id: req.params.id } }),
    prisma.workstation.findUniqueOrThrow({ where: { id: toStationId } }),
  ]);
  if (from.id === to.id) throw badRequest("Elige otro puesto");
  if (from.siteId !== to.siteId) throw badRequest("Para llevar equipos a otra sede usa un traslado");
  assertOwnSite(a, from.siteId);
  const who = actor(req);
  const moved = await prisma.$transaction(async (tx) => {
    const [mf, mt] = await Promise.all([
      tx.machine.findMany({ where: { workstationId: from.id }, select: { id: true } }),
      tx.machine.findMany({ where: { workstationId: to.id }, select: { id: true } }),
    ]);
    await tx.machine.updateMany({ where: { id: { in: mf.map((m) => m.id) } }, data: { workstationId: to.id, location: to.code, assignedUserId: to.userId, lastMovedAt: new Date() } });
    await tx.machine.updateMany({ where: { id: { in: mt.map((m) => m.id) } }, data: { workstationId: from.id, location: from.code, assignedUserId: from.userId, lastMovedAt: new Date() } });
    await logEvents(tx, mf.map((m) => m.id), "MOVED", `Kit ${from.code} → ${to.code}`, who);
    await logEvents(tx, mt.map((m) => m.id), "MOVED", `Kit ${to.code} → ${from.code} (intercambio)`, who);
    return mf.length + mt.length;
  });
  await audit(req, "inventory.kit.moved", "workstation", { entityId: from.id, detail: `${from.code} → ${to.code}` });
  if (moved) for (const userId of [from.userId, to.userId]) await tellOwner(userId, who.id, "Cambiaron los equipos de tu puesto", `${from.code} ↔ ${to.code}`);
  res.json({ ok: true });
});

// ── Equipos ──

const listQuery = pageQuery.extend({
  siteId: z.string().optional(),
  status: z.enum(MACHINE_STATUSES).optional(),
  categoryId: z.string().optional(),
  q: z.string().trim().max(80).optional(),
  workstationId: z.string().optional(),
  loose: z.coerce.boolean().optional(),
  warranty: z.coerce.boolean().optional(),
  sort: z.enum(["assetTag", "updatedAt", "warrantyUntil"]).default("assetTag"),
});

inventoryRouter.get("/machines", async (req, res) => {
  const a = access(req);
  const f = listQuery.parse(req.query);
  const and: Prisma.MachineWhereInput[] = [machineScope(a, currentUser(req).id)];
  if (f.siteId) and.push({ siteId: f.siteId });
  if (f.status) and.push({ status: f.status });
  if (f.categoryId) and.push({ categoryId: f.categoryId });
  if (f.workstationId) and.push({ workstationId: f.workstationId });
  if (f.loose) and.push({ workstationId: null, status: { not: "RETIRED" } });
  if (f.warranty) and.push({ status: { not: "RETIRED" }, warrantyUntil: { gte: new Date(), lte: new Date(Date.now() + 30 * DAY) } });
  if (f.q) {
    const t = textSearch(f.q);
    and.push({ OR: [{ assetTag: t }, { serial: t }, { hostname: t }, { model: t }, { brand: t }, { location: t }, { assignedUser: { name: t } }] });
  }
  const where: Prisma.MachineWhereInput = { AND: and };
  const [items, total] = await Promise.all([
    prisma.machine.findMany({
      where,
      include: {
        site: { select: { id: true, name: true, code: true } },
        workstation: { select: { id: true, code: true } },
        assignedUser: { select: userSelect },
        _count: { select: { incidents: { where: { status: { in: ["OPEN", "IN_PROGRESS"] } } } } },
      },
      orderBy: f.sort === "warrantyUntil" ? { warrantyUntil: "asc" } : f.sort === "updatedAt" ? { updatedAt: "desc" } : { assetTag: "asc" },
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
    }),
    prisma.machine.count({ where }),
  ]);
  res.json({ items, total, page: f.page, pageSize: f.pageSize });
});

async function loadVisibleMachine(req: Parameters<typeof access>[0], id: string) {
  const a = access(req);
  const m = await prisma.machine.findFirst({ where: { AND: [{ id }, machineScope(a, currentUser(req).id)] } });
  if (!m) throw notFound("Equipo no encontrado");
  return m;
}

inventoryRouter.get("/machines/:id", async (req, res) => {
  await loadVisibleMachine(req, req.params.id);
  const [machine, events, incidents, transfers] = await Promise.all([
    prisma.machine.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        site: { select: { id: true, name: true, code: true } },
        category: true,
        workstation: { select: { id: true, code: true, user: { select: userSelect } } },
        assignedUser: { select: userSelect },
      },
    }),
    prisma.assetEvent.findMany({ where: { machineId: req.params.id }, orderBy: { at: "desc" }, take: 80 }),
    prisma.incident.findMany({ where: { machineId: req.params.id }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.machineTransfer.findMany({
      where: { machineId: req.params.id },
      include: { from: { select: { id: true, name: true, code: true } }, to: { select: { id: true, name: true, code: true } } },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);
  res.json({ machine, events, incidents, transfers });
});

const machineInput = z.object({
  assetTag: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .transform((v) => v.toUpperCase()),
  categoryId: z.string().min(1, "Elige la categoría"),
  brand: optText(40),
  model: optText(60),
  serial: optText(60),
  hostname: optText(60),
  notes: optText(500),
  cpu: optText(60),
  ram: optText(30),
  storage: optText(40),
  os: optText(40),
  supplier: optText(80),
  purchaseDate: optDate,
  warrantyUntil: optDate,
  siteId: z.string().min(1, "Elige la sede"),
  status: z.enum(["ACTIVE", "STORAGE", "REPAIR"]).default("ACTIVE"),
  workstationId: z.string().nullish(),
  assignedUserId: z.string().nullish(),
});

async function categoryKey(categoryId: string) {
  const cat = await prisma.inventoryCategory.findUnique({ where: { id: categoryId } });
  if (!cat || cat.kind !== "EQUIPMENT") throw badRequest("Categoría de equipo inválida");
  return cat.key;
}

inventoryRouter.post("/machines", requireAction("create"), async (req, res) => {
  const a = access(req);
  const data = machineInput.parse(req.body);
  assertOwnSite(a, data.siteId);
  const site = await prisma.site.findUnique({ where: { id: data.siteId } });
  if (!site?.active) throw badRequest("La sede no existe o está inactiva");
  let station: { id: string; code: string; userId: string | null } | null = null;
  if (data.workstationId) {
    station = await prisma.workstation.findFirst({ where: { id: data.workstationId, siteId: site.id }, select: { id: true, code: true, userId: true } });
    if (!station) throw badRequest("El puesto no pertenece a la sede");
  }
  const type = await categoryKey(data.categoryId);
  const who = actor(req);
  const m = await prisma.$transaction(async (tx) => {
    const created = await tx.machine.create({
      data: {
        ...data,
        type,
        workstationId: station?.id ?? null,
        location: station?.code ?? null,
        assignedUserId: data.assignedUserId ?? station?.userId ?? null,
        // Con puesto o con persona a cargo ya no está en el almacén
        status: (station || data.assignedUserId) && data.status === "STORAGE" ? "ACTIVE" : data.status,
      },
    });
    const assignedFromStorage = !station && !!data.assignedUserId && data.status === "STORAGE";
    await logEvent(tx, created.id, "CREATED", `Alta en ${site.name}${station ? ` · puesto ${station.code}` : ""}${assignedFromStorage ? " · almacén → en uso (asignado al registrarlo)" : ""}`, who);
    return created;
  });
  await audit(req, "machine.created", "machine", { entityId: m.id, detail: m.assetTag });
  await tellOwner(m.assignedUserId, who.id, "Tienes un equipo a tu cargo", m.assetTag);
  res.status(201).json(m);
});

const FIELD_LABEL: Record<string, string> = {
  assetTag: "código",
  brand: "marca",
  model: "modelo",
  serial: "serie",
  hostname: "hostname",
  notes: "notas",
  cpu: "CPU",
  ram: "RAM",
  storage: "disco",
  os: "SO",
  supplier: "proveedor",
  purchaseDate: "fecha de compra",
  warrantyUntil: "garantía",
  categoryId: "categoría",
};

inventoryRouter.put("/machines/:id", requireAction("edit"), async (req, res) => {
  const a = access(req);
  const { siteId: _s, status: _st, workstationId: _w, assignedUserId: _u, ...data } = machineInput.partial().parse(req.body);
  const m = await loadVisibleMachine(req, req.params.id);
  assertOwnSite(a, m.siteId);
  if (m.status === "TRANSIT") throw badRequest("El equipo está en traslado; espera a que lo reciban");
  if (m.status === "RETIRED" && !hasAction(req, "retire")) throw forbidden("El equipo está de baja");
  const type = data.categoryId ? await categoryKey(data.categoryId) : undefined;
  const changed = Object.keys(data).filter((k) => {
    const before = (m as Record<string, unknown>)[k];
    const after = (data as Record<string, unknown>)[k];
    const norm = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v ?? null));
    return after !== undefined && norm(before) !== norm(after);
  });
  const who = actor(req);
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.machine.update({ where: { id: m.id }, data: { ...data, ...(type ? { type } : {}) } });
    if (changed.length) await logEvent(tx, m.id, "UPDATED", `Cambió ${changed.map((k) => FIELD_LABEL[k] ?? k).join(", ")}`, who);
    return u;
  });
  await audit(req, "machine.updated", "machine", { entityId: m.id, detail: m.assetTag });
  res.json(updated);
});

inventoryRouter.patch("/machines/:id/status", async (req, res) => {
  const a = access(req);
  const { status, note } = z.object({ status: z.enum(MANUAL_STATUSES), note: optText(300) }).parse(req.body);
  const m = await loadVisibleMachine(req, req.params.id);
  assertOwnSite(a, m.siteId);
  // Dar de baja y reactivar exigen "retire"; el resto, "edit"
  const needs = status === "RETIRED" || m.status === "RETIRED" ? "retire" : "edit";
  if (!hasAction(req, needs)) throw forbidden(needs === "retire" ? "Tu rol no puede dar de baja ni reactivar equipos" : "Tu rol no puede editar equipos");
  if (m.status === "TRANSIT") throw badRequest("El equipo está en traslado; recíbelo o cancela el envío");
  if (m.status === status) return res.json(m);
  const who = actor(req);
  const off = status === "RETIRED" || status === "STORAGE";
  const updated = await prisma.$transaction(async (tx) => {
    const owner = off ? await formerOwnerNote(tx, m.assignedUserId) : "";
    const u = await tx.machine.update({
      where: { id: m.id },
      data: { status, ...(off ? { workstationId: null, location: status === "STORAGE" ? "Almacén" : null, assignedUserId: null } : {}) },
    });
    const kind = status === "RETIRED" ? "RETIRED" : m.status === "RETIRED" ? "REACTIVATED" : "STATUS";
    await logEvent(tx, m.id, kind, `${STATUS_LABEL[m.status] ?? m.status} → ${STATUS_LABEL[status]}${owner}${note ? ` · ${note}` : ""}`, who);
    return u;
  });
  await audit(req, "machine.status", "machine", { entityId: m.id, detail: `${m.assetTag}: ${m.status} → ${status}` });
  if (off) await tellOwner(m.assignedUserId, who.id, "Ya no tienes este equipo a tu cargo", `${m.assetTag}: ${STATUS_LABEL[status]}`);
  res.json(updated);
});

/** Arrastrar y soltar: lleva un equipo a un puesto (de su misma sede) o al almacén (workstationId null) */
inventoryRouter.post("/machines/:id/move", requireAction("assign"), async (req, res) => {
  const a = access(req);
  const { workstationId } = z.object({ workstationId: z.string().nullable() }).parse(req.body);
  const m = await loadVisibleMachine(req, req.params.id);
  assertOwnSite(a, m.siteId);
  if (m.status === "TRANSIT" || m.status === "RETIRED") throw badRequest(`El equipo está ${STATUS_LABEL[m.status]}`);
  const st = workstationId ? await prisma.workstation.findFirst({ where: { id: workstationId, siteId: m.siteId } }) : null;
  if (workstationId && !st) throw badRequest("El puesto no pertenece a la sede del equipo. Para otra sede usa un traslado.");
  if (m.workstationId === (st?.id ?? null)) return res.json(m);
  const who = actor(req);
  const prev = m.workstationId ? await prisma.workstation.findUnique({ where: { id: m.workstationId }, select: { code: true } }) : null;
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.machine.update({
      where: { id: m.id },
      data: st
        ? { workstationId: st.id, location: st.code, assignedUserId: st.userId, status: m.status === "STORAGE" ? "ACTIVE" : m.status, lastMovedAt: new Date() }
        : { workstationId: null, location: "Almacén", assignedUserId: null, status: m.status === "ACTIVE" ? "STORAGE" : m.status, lastMovedAt: new Date() },
    });
    await logEvent(tx, m.id, "MOVED", `${prev ? `Puesto ${prev.code}` : "Sin puesto"} → ${st ? `puesto ${st.code}` : "almacén"}`, who);
    return u;
  });
  await tellOwnerChange(m.assignedUserId, updated.assignedUserId, who.id, m.assetTag);
  res.json(updated);
});

inventoryRouter.post("/machines/:id/assign", requireAction("assign"), async (req, res) => {
  const a = access(req);
  const { userId } = z.object({ userId: z.string().nullable() }).parse(req.body);
  const m = await loadVisibleMachine(req, req.params.id);
  assertOwnSite(a, m.siteId);
  if (m.status === "RETIRED") throw badRequest("El equipo está de baja");
  const user = userId ? await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, name: true } }) : null;
  const who = actor(req);
  // Si ya tiene dueño, dejó de estar en el almacén
  const leavesStorage = !!user && m.status === "STORAGE";
  await prisma.$transaction(async (tx) => {
    await tx.machine.update({ where: { id: m.id }, data: { assignedUserId: userId, ...(leavesStorage ? { status: "ACTIVE", location: null } : {}) } });
    await logEvent(tx, m.id, "ASSIGNED", user ? `Asignado a ${user.name}${leavesStorage ? " · almacén → en uso" : ""}` : "Sin asignar", who);
  });
  await audit(req, "machine.assigned", "machine", { entityId: m.id, detail: `${m.assetTag}: ${user?.name ?? "sin asignar"}` });
  await tellOwnerChange(m.assignedUserId, userId, who.id, m.assetTag);
  res.json({ ok: true });
});

// ── Traslados entre sedes ──

inventoryRouter.get("/transfers", async (req, res) => {
  const a = access(req);
  assertNotOwn(a);
  const { status, siteId, limit } = z
    .object({ status: z.enum(["PENDING", "RECEIVED", "CANCELLED"]).optional(), siteId: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(60) })
    .parse(req.query);
  const where: Prisma.MachineTransferWhereInput = { ...transferScope(a), ...(status ? { status } : {}) };
  if (siteId) where.AND = [{ OR: [{ fromSiteId: siteId }, { toSiteId: siteId }] }];
  res.json(
    await prisma.machineTransfer.findMany({
      where,
      include: {
        machine: { select: { id: true, assetTag: true, type: true, brand: true, model: true, categoryId: true } },
        from: { select: { id: true, name: true, code: true } },
        to: { select: { id: true, name: true, code: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
  );
});

const loadTransfer = (id: string) =>
  prisma.machineTransfer.findUniqueOrThrow({ where: { id }, include: { to: { select: { name: true } } } });

const transferInput = z.object({
  machineIds: z.array(z.string()).min(1).max(200),
  toSiteId: z.string(),
  reason: optText(80),
  note: optText(300),
});

inventoryRouter.post("/transfers", requireAction("transfer"), async (req, res) => {
  const a = access(req);
  const data = transferInput.parse(req.body);
  const to = await prisma.site.findUnique({ where: { id: data.toSiteId } });
  if (!to?.active) throw badRequest("La sede destino no existe o está inactiva");
  const machines = await prisma.machine.findMany({ where: { id: { in: data.machineIds }, ...machineScope(a, "") } });
  if (machines.length !== data.machineIds.length) throw badRequest("Algunos equipos no existen o no son de tu sede");
  for (const m of machines) {
    if (m.status === "TRANSIT") throw badRequest(`${m.assetTag} ya está en traslado`);
    if (m.status === "RETIRED") throw badRequest(`${m.assetTag} está de baja`);
    if (m.siteId === to.id) throw badRequest(`${m.assetTag} ya está en ${to.name}`);
  }
  const u = currentUser(req);
  const who = actor(req);
  const ids = machines.map((m) => m.id);
  await prisma.$transaction(async (tx) => {
    await tx.machineTransfer.createMany({
      data: machines.map((m) => ({ machineId: m.id, fromSiteId: m.siteId, toSiteId: to.id, reason: data.reason, note: data.note, prevStatus: m.status, createdById: u.id, createdByName: u.name })),
    });
    await tx.machine.updateMany({ where: { id: { in: ids } }, data: { status: "TRANSIT", workstationId: null, lastMovedAt: new Date() } });
    await logEvents(tx, ids, "TRANSFER", `Enviado a ${to.name}${data.reason ? ` · ${data.reason}` : ""}`, who);
  });
  await audit(req, "machine.transfer", "machine", { detail: `${machines.map((m) => m.assetTag).join(", ")} → ${to.name}` });
  const tags = (list: typeof machines) => list.slice(0, 5).map((m) => m.assetTag).join(", ") + (list.length > 5 ? ` y ${list.length - 5} más` : "");
  await notify(await usersWithAction("inventario", "receive", to.id), { kind: "inv.transfer", title: `${machines.length === 1 ? "1 equipo" : `${machines.length} equipos`} en camino a ${to.name}`, body: tags(machines), link: "inventario?tab=equipos" }, { except: u.id });
  for (const ownerId of new Set(machines.map((m) => m.assignedUserId))) await tellOwner(ownerId, u.id, `Tu equipo se envió a ${to.name}`, tags(machines.filter((m) => m.assignedUserId === ownerId)));
  res.status(201).json({ created: machines.length });
});

inventoryRouter.post("/transfers/:id/receive", requireAction("receive"), async (req, res) => {
  const a = access(req);
  const { location } = z.object({ location: optText(80) }).parse(req.body ?? {});
  const t = await loadTransfer(req.params.id);
  if (t.status !== "PENDING") throw badRequest("Este traslado ya no está pendiente");
  if (a.scope !== "ALL" && a.siteId !== t.toSiteId) throw forbidden("Solo la sede destino puede recibir este equipo");
  const machine = await prisma.machine.findUniqueOrThrow({ where: { id: t.machineId } });
  if (machine.status !== "TRANSIT") throw badRequest("El equipo ya no figura en traslado");
  const u = currentUser(req);
  await prisma.$transaction(async (tx) => {
    await tx.machineTransfer.update({ where: { id: t.id }, data: { status: "RECEIVED", receivedAt: new Date(), receivedById: u.id, receivedByName: u.name } });
    await tx.machine.update({
      where: { id: t.machineId },
      data: {
        siteId: t.toSiteId,
        status: t.prevStatus === "TRANSIT" ? "STORAGE" : t.prevStatus === "ACTIVE" ? "STORAGE" : t.prevStatus,
        lastMovedAt: new Date(),
        // Llega sin puesto: se acomoda en el plano de la sede destino
        location: location ?? "Almacén",
        workstationId: null,
        assignedUserId: null,
      },
    });
    await logEvent(tx, t.machineId, "RECEIVED", `Recibido en ${t.to.name}`, { id: u.id, name: u.name });
  });
  await audit(req, "machine.received", "machine", { entityId: t.machineId, detail: `${machine.assetTag} en ${t.to.name}` });
  await tellOwner(machine.assignedUserId, u.id, "Ya no tienes este equipo a tu cargo", `${machine.assetTag}: recibido en ${t.to.name}`);
  res.json({ ok: true });
});

inventoryRouter.post("/transfers/:id/cancel", requireAction("transfer"), async (req, res) => {
  const a = access(req);
  const t = await loadTransfer(req.params.id);
  if (t.status !== "PENDING") throw badRequest("Este traslado ya no está pendiente");
  if (a.scope !== "ALL" && a.siteId !== t.fromSiteId) throw forbidden("Solo la sede de origen puede cancelar el envío");
  const me = currentUser(req).id;
  const { assignedUserId, assetTag } = await prisma.machine.findUniqueOrThrow({ where: { id: t.machineId }, select: { assignedUserId: true, assetTag: true } });
  await prisma.$transaction(async (tx) => {
    await tx.machineTransfer.update({ where: { id: t.id }, data: { status: "CANCELLED" } });
    // Al enviarlo perdió su puesto: igual que al recibirlo, queda en el almacén y sin persona
    const owner = await formerOwnerNote(tx, assignedUserId);
    await tx.machine.update({ where: { id: t.machineId }, data: { status: t.prevStatus === "ACTIVE" ? "STORAGE" : t.prevStatus, location: "Almacén", assignedUserId: null } });
    await logEvent(tx, t.machineId, "TRANSFER_CANCELLED", `Traslado a ${t.to.name} cancelado · vuelve al almacén${owner}`, actor(req));
  });
  await audit(req, "machine.transfer.cancelled", "machine", { entityId: t.machineId });
  await notify(await usersWithAction("inventario", "receive", t.toSiteId), { kind: "inv.transfer", title: `Traslado cancelado`, body: `${assetTag} ya no va a ${t.to.name}`, link: "inventario?tab=equipos" }, { except: me });
  await tellOwner(assignedUserId, me, "Ya no tienes este equipo a tu cargo", `${assetTag}: volvió al almacén`);
  res.json({ ok: true });
});

// ── Incidencias y mantenimiento ──

const INCIDENT_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CANCELLED"] as const;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;
const INCIDENT_LABEL: Record<string, string> = { OPEN: "abierta", IN_PROGRESS: "en atención", RESOLVED: "resuelta", CANCELLED: "cancelada" };

inventoryRouter.get("/incidents", async (req, res) => {
  const a = access(req);
  const u = currentUser(req);
  const { status, siteId, open } = z
    .object({ status: z.enum(INCIDENT_STATUSES).optional(), siteId: z.string().optional(), open: z.coerce.boolean().optional() })
    .parse(req.query);
  const where: Prisma.IncidentWhereInput = {
    // Con alcance "lo suyo", quien reportó una falla la sigue viendo aunque ya no tenga ese equipo
    ...(isOwn(a)
      ? { machine: siteId ? { siteId } : {}, OR: [{ reportedById: u.id }, { machine: machineScope(a, u.id) }] }
      : { machine: { AND: [machineScope(a, u.id), siteId ? { siteId } : {}] } }),
    ...(status ? { status } : open ? { status: { in: ["OPEN", "IN_PROGRESS"] } } : {}),
  };
  res.json(
    await prisma.incident.findMany({
      where,
      include: {
        machine: { select: { id: true, assetTag: true, brand: true, model: true, status: true, categoryId: true, site: { select: { id: true, name: true, code: true } }, workstation: { select: { code: true } } } },
      },
      orderBy: [{ createdAt: "desc" }],
      take: 300,
    }),
  );
});

inventoryRouter.post("/machines/:id/incidents", requireAction("incident"), async (req, res) => {
  const data = z
    .object({ title: z.string().trim().min(3).max(100), description: optText(1000), priority: z.enum(PRIORITIES).default("MEDIUM") })
    .parse(req.body);
  const m = await loadVisibleMachine(req, req.params.id);
  if (m.status === "RETIRED") throw badRequest("El equipo está de baja");
  const u = currentUser(req);
  // El supervisor reporta fallas de las computadoras de su equipo (y de la suya)
  if (isTeam(access(req)) && !(await prisma.machine.count({ where: { AND: [{ id: m.id }, teamMachines(u.id)] } })))
    throw forbidden("Solo puedes reportar fallas de los equipos de tu equipo de trabajo");
  const inc = await prisma.$transaction(async (tx) => {
    const created = await tx.incident.create({ data: { ...data, machineId: m.id, reportedById: u.id, reportedByName: u.name } });
    await logEvent(tx, m.id, "INCIDENT", `Falla reportada: ${data.title}`, { id: u.id, name: u.name });
    return created;
  });
  await audit(req, "incident.created", "incident", { entityId: inc.id, detail: `${m.assetTag}: ${data.title}` });
  // Avisa a quien atiende incidencias en esa sede y al supervisor de quien tiene el equipo
  const station = m.workstationId ? await prisma.workstation.findUnique({ where: { id: m.workstationId }, select: { userId: true } }) : null;
  await notify(
    [...(await usersWithAction("inventario", "repair", m.siteId)), ...(await supervisorsOf([m.assignedUserId ?? station?.userId]))],
    { kind: "inv.incident", title: `Falla reportada: ${data.title}`, body: `${m.assetTag} · ${u.name}`, link: "inventario?tab=incidencias" },
    { except: u.id },
  );
  res.status(201).json(inc);
});

inventoryRouter.patch("/incidents/:id", requireAction("repair"), async (req, res) => {
  const a = access(req);
  const data = z
    .object({
      status: z.enum(INCIDENT_STATUSES).optional(),
      priority: z.enum(PRIORITIES).optional(),
      technician: optText(80),
      resolution: optText(1000),
      /** Al pasar a "en atención", lleva el equipo a reparación */
      toRepair: z.boolean().optional(),
    })
    .parse(req.body);
  const inc = await prisma.incident.findUniqueOrThrow({ where: { id: req.params.id }, include: { machine: true } });
  assertOwnSite(a, inc.machine.siteId);
  const m = inc.machine;
  const who = actor(req);
  const closing = (data.status === "RESOLVED" || data.status === "CANCELLED") && inc.status !== data.status;
  const repairing = data.toRepair && m.status !== "REPAIR" && m.status !== "TRANSIT" && m.status !== "RETIRED";
  let released = false;
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.incident.update({
      where: { id: inc.id },
      data: {
        ...(data.status ? { status: data.status } : {}),
        ...(data.priority ? { priority: data.priority } : {}),
        ...("technician" in req.body ? { technician: data.technician } : {}),
        ...("resolution" in req.body ? { resolution: data.resolution } : {}),
        ...(repairing ? { prevStatus: m.status } : {}),
        ...(closing ? { resolvedAt: new Date() } : {}),
      },
    });
    if (repairing) {
      await tx.machine.update({ where: { id: m.id }, data: { status: "REPAIR" } });
      await logEvent(tx, m.id, "STATUS", `${STATUS_LABEL[m.status]} → reparación (incidencia)`, who);
    }
    // Al cerrar, si el equipo entró a reparación por esta incidencia, vuelve a su estado previo
    if (closing && m.status === "REPAIR") {
      const others = await tx.incident.count({ where: { machineId: m.id, id: { not: inc.id }, status: "IN_PROGRESS" } });
      if (!others) {
        const back = (inc.prevStatus && inc.prevStatus !== "REPAIR" ? inc.prevStatus : "ACTIVE") as string;
        // Sin puesto vuelve al almacén, sin persona a cargo
        const toStorage = !m.workstationId && (back === "ACTIVE" || back === "STORAGE");
        released = toStorage;
        const owner = toStorage ? await formerOwnerNote(tx, m.assignedUserId) : "";
        await tx.machine.update({ where: { id: m.id }, data: toStorage ? { status: "STORAGE", location: "Almacén", assignedUserId: null } : { status: back } });
        await logEvent(tx, m.id, "STATUS", `reparación → ${STATUS_LABEL[toStorage ? "STORAGE" : back]}${owner}`, who);
      }
    }
    const parts = [
      data.status && data.status !== inc.status ? `Incidencia ${INCIDENT_LABEL[data.status]}` : null,
      data.technician ? `técnico: ${data.technician}` : null,
      data.resolution && closing ? data.resolution : null,
    ].filter(Boolean);
    if (parts.length) await logEvent(tx, m.id, "INCIDENT_UPDATE", `${inc.title}: ${parts.join(" · ")}`, who);
    return u;
  });
  await audit(req, "incident.updated", "incident", { entityId: inc.id, detail: `${m.assetTag}: ${data.status ?? "editada"}` });
  if (data.status && data.status !== inc.status) {
    await notify([inc.reportedById], { kind: "inv.incident.update", title: `Tu reporte está ${INCIDENT_LABEL[data.status]}`, body: `${inc.title} · ${m.assetTag}`, link: "inventario?tab=incidencias" }, { except: who.id });
  }
  if (released) await tellOwner(m.assignedUserId, who.id, "Ya no tienes este equipo a tu cargo", `${m.assetTag}: volvió al almacén tras la reparación`);
  res.json(updated);
});

// ── Mi equipo (cualquier alcance) ──

inventoryRouter.get("/mine", async (req, res) => {
  const u = currentUser(req);
  const [machines, stations, deliveries, incidents] = await Promise.all([
    prisma.machine.findMany({
      where: { status: { not: "RETIRED" }, OR: [{ assignedUserId: u.id }, { workstation: { userId: u.id } }] },
      include: { category: true, site: { select: { id: true, name: true, code: true } }, workstation: { select: { id: true, code: true } } },
      orderBy: { assetTag: "asc" },
    }),
    prisma.workstation.findMany({ where: { userId: u.id }, include: { site: { select: { id: true, name: true, code: true } }, zone: { select: { name: true, color: true } } } }),
    prisma.supplyDelivery.findMany({
      where: { userId: u.id, OR: [{ status: "PENDING" }, { createdAt: { gte: new Date(Date.now() - 60 * DAY) } }] },
      include: { supply: { select: { id: true, name: true, unit: true, categoryId: true } }, site: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.incident.findMany({
      where: { OR: [{ reportedById: u.id }, { machine: { OR: [{ assignedUserId: u.id }, { workstation: { userId: u.id } }] } }] },
      include: { machine: { select: { id: true, assetTag: true, brand: true, model: true } } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);
  res.json({ machines, stations, deliveries, incidents });
});

inventoryRouter.use("/supplies", suppliesRouter);
inventoryRouter.use("/", inventoryExcelRouter);
