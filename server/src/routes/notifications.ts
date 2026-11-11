import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { currentUser } from "../lib/auth.js";
import { notFound } from "../lib/http.js";

/** La campanita de cada persona: historial reciente y qué ya leyó */
export const notificationsRouter = Router();

const HISTORY_DAYS = 30;

notificationsRouter.get("/", async (req, res) => {
  const user = currentUser(req);
  const where = { userId: user.id, createdAt: { gte: new Date(Date.now() - HISTORY_DAYS * 86_400_000) } };
  const [unread, rows] = await Promise.all([
    prisma.notification.count({ where: { ...where, readAt: null } }),
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  res.json({ unread, items: rows.map(({ userId: _u, readAt, ...n }) => ({ ...n, read: !!readAt })) });
});

notificationsRouter.post("/read-all", async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: currentUser(req).id, readAt: null }, data: { readAt: new Date() } });
  res.json({ ok: true });
});

notificationsRouter.post("/:id/read", async (req, res) => {
  const userId = currentUser(req).id;
  const row = await prisma.notification.findFirst({ where: { id: req.params.id, userId }, select: { id: true, readAt: true } });
  if (!row) throw notFound("Notificación no encontrada");
  if (!row.readAt) await prisma.notification.update({ where: { id: row.id }, data: { readAt: new Date() } });
  res.json({ ok: true });
});
