import { Router } from "express";
import { z } from "zod";
import { prisma, textSearch } from "../lib/prisma.js";
import { currentUser } from "../lib/auth.js";
import { forbidden } from "../lib/http.js";
import { requirePermission } from "../lib/permissions.js";

/** Datos de apoyo de la administración: catálogos para formularios, dashboard y auditoría */
export const adminRouter = Router();

/** Roles y módulos para los selectores. Basta con tener algún permiso de administración. */
adminRouter.get("/lookups", async (req, res) => {
  if (currentUser(req).permissions.length === 0) throw forbidden();
  const [roles, modules, sites] = await Promise.all([
    prisma.role.findMany({ select: { id: true, key: true, name: true, color: true }, orderBy: [{ system: "desc" }, { name: "asc" }] }),
    prisma.module.findMany({
      select: { id: true, key: true, name: true, icon: true, color: true, section: true, active: true, type: true, internalKey: true },
      orderBy: [{ order: "asc" }, { name: "asc" }],
    }),
    prisma.site.findMany({ select: { id: true, code: true, name: true, active: true }, orderBy: { name: "asc" } }),
  ]);
  const supervisors = await prisma.user.findMany({
    where: { active: true, role: { key: "supervisor" } },
    select: { id: true, name: true, area: true },
    orderBy: { name: "asc" },
  });
  res.json({ roles, modules, sites, supervisors });
});

const DAY = 86400_000;

/** Inicio del día en Lima (UTC-5, sin horario de verano) */
const limaDayStart = (d: Date) => new Date(Math.floor((d.getTime() - 5 * 3600_000) / DAY) * DAY + 5 * 3600_000);

adminRouter.get("/dashboard", requirePermission("dashboard.view"), async (_req, res) => {
  const now = new Date();
  const today = limaDayStart(now);
  const from14 = new Date(today.getTime() - 13 * DAY);
  const from30 = new Date(today.getTime() - 29 * DAY);

  const [users, activeUsers, modules, activeModules, loginsToday, logins14, opens30, recent, roles, never] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { active: true } }),
    prisma.module.count(),
    prisma.module.count({ where: { active: true } }),
    prisma.auditLog.count({ where: { action: "auth.login", at: { gte: today } } }),
    prisma.auditLog.findMany({ where: { action: "auth.login", at: { gte: from14 } }, select: { at: true, actorId: true } }),
    prisma.moduleOpen.groupBy({ by: ["moduleId"], where: { at: { gte: from30 } }, _count: true }),
    prisma.auditLog.findMany({ orderBy: { at: "desc" }, take: 8 }),
    prisma.role.findMany({ select: { id: true, name: true, color: true, _count: { select: { users: true } } }, orderBy: { name: "asc" } }),
    prisma.user.count({ where: { active: true, lastLoginAt: null } }),
  ]);

  const perDay = Array.from({ length: 14 }, (_, i) => {
    const start = from14.getTime() + i * DAY;
    const rows = logins14.filter((l) => l.at.getTime() >= start && l.at.getTime() < start + DAY);
    return { date: new Date(start).toISOString(), logins: rows.length, people: new Set(rows.map((r) => r.actorId)).size };
  });

  const moduleRows = await prisma.module.findMany({
    where: { id: { in: opens30.map((o) => o.moduleId) } },
    select: { id: true, name: true, icon: true, color: true },
  });
  const topModules = opens30
    .map((o) => ({ ...moduleRows.find((m) => m.id === o.moduleId)!, opens: o._count }))
    .filter((m) => m.name)
    .sort((a, b) => b.opens - a.opens)
    .slice(0, 6);

  res.json({
    users,
    activeUsers,
    neverLoggedIn: never,
    modules,
    activeModules,
    loginsToday,
    peopleToday: new Set(logins14.filter((l) => l.at >= today).map((l) => l.actorId)).size,
    perDay,
    topModules,
    roles: roles.map((r) => ({ id: r.id, name: r.name, color: r.color, users: r._count.users })),
    recent,
  });
});

adminRouter.get("/audit", requirePermission("audit.view"), async (req, res) => {
  const q = z
    .object({ q: z.string().optional(), entity: z.string().optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional() })
    .parse(req.query);
  const rows = await prisma.auditLog.findMany({
    where: {
      ...(q.entity ? { entity: q.entity } : {}),
      ...(q.from || q.to ? { at: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: new Date(q.to.getTime() + DAY) } : {}) } } : {}),
      ...(q.q ? { OR: [{ actorName: textSearch(q.q) }, { detail: textSearch(q.q) }, { action: textSearch(q.q) }, { ip: textSearch(q.q) }] } : {}),
    },
    orderBy: { at: "desc" },
    take: 1000,
  });
  res.json(rows);
});
