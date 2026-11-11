import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { currentUser } from "../lib/auth.js";
import { audit } from "../lib/audit.js";
import { notifyDueAnnouncements } from "../lib/notifications.js";

/** Comunicados (requiere announcements.manage). Los colaboradores los leen en /api/portal/announcements */
export const announcementsRouter = Router();

const input = z.object({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(3).max(5000),
  level: z.enum(["INFO", "IMPORTANT", "URGENT"]),
  pinned: z.boolean(),
  active: z.boolean(),
  roleKeys: z.array(z.string()),
  publishedAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().nullish(),
});

const columns = (d: z.infer<typeof input>) => ({
  title: d.title,
  body: d.body,
  level: d.level,
  pinned: d.pinned,
  active: d.active,
  roleKeys: JSON.stringify(d.roleKeys),
  publishedAt: d.publishedAt ?? new Date(),
  expiresAt: d.expiresAt ?? null,
});

const present = <T extends { roleKeys: string; author: { name: string } | null }>({ roleKeys, author, ...a }: T) => ({
  ...a,
  roleKeys: JSON.parse(roleKeys) as string[],
  author: author?.name ?? null,
});

const include = { author: { select: { name: true } } } as const;

announcementsRouter.get("/", async (_req, res) => {
  const rows = await prisma.announcement.findMany({ include, orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }] });
  res.json(rows.map(present));
});

announcementsRouter.post("/", async (req, res) => {
  const data = input.parse(req.body);
  const created = await prisma.announcement.create({ data: { ...columns(data), authorId: currentUser(req).id }, include });
  await audit(req, "announcement.created", "announcement", { entityId: created.id, detail: created.title });
  await notifyDueAnnouncements();
  res.status(201).json(present(created));
});

announcementsRouter.put("/:id", async (req, res) => {
  const data = input.parse(req.body);
  const updated = await prisma.announcement.update({ where: { id: req.params.id }, data: columns(data), include });
  await audit(req, "announcement.updated", "announcement", { entityId: updated.id, detail: updated.title });
  res.json(present(updated));
});

announcementsRouter.delete("/:id", async (req, res) => {
  const row = await prisma.announcement.delete({ where: { id: req.params.id } });
  await audit(req, "announcement.deleted", "announcement", { entityId: row.id, detail: row.title });
  res.json({ ok: true });
});
