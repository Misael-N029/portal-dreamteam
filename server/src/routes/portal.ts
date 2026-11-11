import { Router } from "express";
import { z } from "zod";
import { prisma, textSearch } from "../lib/prisma.js";
import { currentUser } from "../lib/auth.js";
import { notFound } from "../lib/http.js";
import { findVisibleModule, visibleModulesWhere } from "../lib/modules.js";
import { audit } from "../lib/audit.js";
import { parseStringArray } from "../lib/json.js";

/** Lo que usa cualquier colaborador con sesión: sus módulos, favoritos, comunicados y directorio */
export const portalRouter = Router();

const moduleSelect = {
  id: true,
  key: true,
  name: true,
  description: true,
  icon: true,
  color: true,
  type: true,
  url: true,
  internalKey: true,
  section: true,
  order: true,
  newTab: true,
  badge: true,
  imageUrl: true,
} as const;

portalRouter.get("/modules", async (req, res) => {
  const user = currentUser(req);
  const since = new Date(Date.now() - 30 * 86400_000);
  const [modules, favorites, recent] = await Promise.all([
    prisma.module.findMany({ where: visibleModulesWhere(user), select: moduleSelect, orderBy: [{ order: "asc" }, { name: "asc" }] }),
    prisma.favorite.findMany({ where: { userId: user.id }, select: { moduleId: true } }),
    prisma.moduleOpen.groupBy({ by: ["moduleId"], where: { userId: user.id, at: { gte: since } }, _count: true }),
  ]);
  const fav = new Set(favorites.map((f) => f.moduleId));
  const uses = new Map(recent.map((r) => [r.moduleId, r._count]));
  res.json(modules.map((m) => ({ ...m, favorite: fav.has(m.id), uses30d: uses.get(m.id) ?? 0 })));
});

/** Registra la apertura y devuelve el módulo (el panel lo usa antes de abrir el enlace o el iframe) */
portalRouter.post("/modules/:key/open", async (req, res) => {
  const user = currentUser(req);
  const mod = await findVisibleModule(user, req.params.key);
  if (!mod) throw notFound("Este módulo no existe o no está habilitado para tu usuario");
  await prisma.moduleOpen.create({ data: { userId: user.id, moduleId: mod.id } });
  res.json(mod);
});

portalRouter.put("/modules/:key/favorite", async (req, res) => {
  const user = currentUser(req);
  const { favorite } = z.object({ favorite: z.boolean() }).parse(req.body);
  const mod = await findVisibleModule(user, req.params.key);
  if (!mod) throw notFound();
  if (favorite) {
    await prisma.favorite.upsert({
      where: { userId_moduleId: { userId: user.id, moduleId: mod.id } },
      create: { userId: user.id, moduleId: mod.id },
      update: {},
    });
  } else {
    await prisma.favorite.deleteMany({ where: { userId: user.id, moduleId: mod.id } });
  }
  res.json({ ok: true });
});

/** Comunicados vigentes para el rol del usuario (fijados primero) */
portalRouter.get("/announcements", async (req, res) => {
  const user = currentUser(req);
  const now = new Date();
  const rows = await prisma.announcement.findMany({
    where: { active: true, publishedAt: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    include: { author: { select: { name: true } } },
    orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
    take: 100,
  });
  const visible = rows
    .map((a) => ({ ...a, roleKeys: parseStringArray(a.roleKeys) }))
    .filter((a) => a.roleKeys.length === 0 || a.roleKeys.includes(user.roleKey));
  res.json(visible.map(({ authorId, ...a }) => ({ ...a, author: a.author?.name ?? null })));
});

/** Pantalla interna "directorio": requiere tener habilitado algún módulo que la muestre */
portalRouter.get("/directory", async (req, res) => {
  const user = currentUser(req);
  const allowed = await prisma.module.findFirst({ where: { internalKey: "directorio", type: "INTERNAL", ...visibleModulesWhere(user) } });
  if (!allowed) throw notFound("El directorio no está habilitado para tu usuario");
  const q = z.object({ q: z.string().optional() }).parse(req.query);
  const users = await prisma.user.findMany({
    where: {
      active: true,
      ...(q.q ? { OR: [{ name: textSearch(q.q) }, { area: textSearch(q.q) }, { position: textSearch(q.q) }] } : {}),
    },
    select: { id: true, name: true, email: true, phone: true, area: true, position: true, role: { select: { name: true, color: true } } },
    orderBy: { name: "asc" },
  });
  res.json(users);
});

/** El token vive en el navegador; aquí solo se deja constancia del cierre de sesión */
portalRouter.post("/logout", async (req, res) => {
  await audit(req, "auth.logout", "user", { entityId: currentUser(req).id });
  res.json({ ok: true });
});
