import { Router } from "express";
import multer from "multer";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "../lib/env.js";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { badRequest } from "../lib/http.js";
import { INTERNAL_KEYS, INTERNAL_SCREENS, MODULE_TYPES } from "../lib/modules.js";
import { audit } from "../lib/audit.js";
import { catalogFor, normalizeAccess } from "../lib/module-access.js";
import { isMatrixModule } from "../lib/role-matrix.js";
import { syncRoleMatrix } from "../lib/startup-sync.js";

/** Fotos reales del equipo incluidas en el portal (web/public/modules) */
const GALLERY = ["operacion", "formacion", "metas", "bonos", "logros", "integracion", "equipo", "asesora", "celebracion", "cumpleanos", "deporte", "sala", "venta"].map(
  (n) => `/modules/${n}.jpg`,
);

/** Administración de módulos (requiere modules.manage) */
export const modulesRouter = Router();

const slug = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Solo minúsculas, números y guiones (ej. wiki-ventas)");

const moduleInput = z
  .object({
    key: slug,
    name: z.string().trim().min(2).max(60),
    description: z.string().trim().max(200).nullish(),
    icon: z.string().trim().min(2).max(40),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color hexadecimal inválido"),
    type: z.enum(MODULE_TYPES),
    url: z.string().trim().max(1000).nullish(),
    internalKey: z.string().nullish(),
    section: z.string().trim().min(2).max(40),
    active: z.boolean(),
    newTab: z.boolean(),
    badge: z.string().trim().max(16).nullish(),
    /** Ruta propia (/modules/…, /api/files/…) o URL https; null = diseño de marca */
    imageUrl: z
      .string()
      .trim()
      .max(500)
      .refine((v) => /^\/(modules|api\/files)\/[\w./-]+$/.test(v) || /^https:\/\//.test(v), "Imagen inválida: usa una de la galería, sube una o pega una URL https")
      .nullish(),
    roleIds: z.array(z.string()),
    userIds: z.array(z.string()),
  })
  .superRefine((m, ctx) => {
    if (m.type === "INTERNAL") {
      if (!m.internalKey || !INTERNAL_KEYS.includes(m.internalKey)) {
        ctx.addIssue({ code: "custom", path: ["internalKey"], message: "Elige la pantalla interna que mostrará" });
      }
    } else if (!m.url || !/^https?:\/\//.test(m.url)) {
      ctx.addIssue({ code: "custom", path: ["url"], message: "Ingresa una URL que empiece con https://" });
    }
  });

const include = {
  roles: { select: { roleId: true } },
  users: { select: { user: { select: { id: true, name: true, email: true } } } },
  _count: { select: { favorites: true } },
} as const;

async function present(ids?: string[]) {
  const since = new Date(Date.now() - 30 * 86400_000);
  const [modules, opens] = await Promise.all([
    prisma.module.findMany({
      where: ids ? { id: { in: ids } } : undefined,
      include,
      orderBy: [{ order: "asc" }, { name: "asc" }],
    }),
    prisma.moduleOpen.groupBy({ by: ["moduleId"], where: { at: { gte: since } }, _count: true }),
  ]);
  const uses = new Map(opens.map((o) => [o.moduleId, o._count]));
  return modules.map(({ roles, users, _count, ...m }) => ({
    ...m,
    roleIds: roles.map((r) => r.roleId),
    users: users.map((u) => u.user),
    favorites: _count.favorites,
    opens30d: uses.get(m.id) ?? 0,
  }));
}

modulesRouter.get("/", async (_req, res) => {
  res.json(await present());
});

/** Fotos de los bloques subidas desde el portal (se sirven públicas en /api/files/module-images) */
export const MODULE_IMAGES_DIR = () => path.resolve(env.storageDir, "module-images");

const IMAGE_TYPES = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);

const upload = multer({
  dest: path.join(MODULE_IMAGES_DIR(), "tmp"),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => (IMAGE_TYPES.has(file.mimetype) ? cb(null, true) : cb(badRequest("La foto debe ser JPG, PNG o WebP"))),
});

modulesRouter.post("/image", upload.single("image"), async (req, res) => {
  if (!req.file) throw badRequest("Elige una foto");
  const name = `${randomUUID()}${IMAGE_TYPES.get(req.file.mimetype)}`;
  try {
    await mkdir(MODULE_IMAGES_DIR(), { recursive: true });
    await rename(req.file.path, path.join(MODULE_IMAGES_DIR(), name));
  } catch (err) {
    await rm(req.file.path, { force: true });
    throw err;
  }
  res.status(201).json({ url: `/api/files/module-images/${name}` });
});

modulesRouter.get("/meta", (_req, res) => {
  res.json({ types: MODULE_TYPES, internalScreens: INTERNAL_SCREENS, gallery: GALLERY });
});

function columns(data: z.infer<typeof moduleInput>) {
  return {
    key: data.key,
    name: data.name,
    description: data.description || null,
    icon: data.icon,
    color: data.color,
    type: data.type,
    url: data.type === "INTERNAL" ? null : data.url,
    internalKey: data.type === "INTERNAL" ? data.internalKey : null,
    section: data.section,
    active: data.active,
    newTab: data.type === "LINK" ? data.newTab : false,
    badge: data.badge || null,
    imageUrl: data.imageUrl || null,
  };
}

/**
 * Filas RoleModule de los roles marcados en el módulo. Un rol que ya lo tenía conserva sus acciones y alcance;
 * uno nuevo entra con "ver" (y en módulos con alcance "lo suyo", como Inventario, solo lo suyo).
 */
async function roleRows(moduleId: string, data: z.infer<typeof moduleInput>) {
  const current = new Map((await prisma.roleModule.findMany({ where: { moduleId } })).map((r) => [r.roleId, r]));
  const ik = data.type === "INTERNAL" ? (data.internalKey ?? null) : null;
  const scope = catalogFor(ik).scopes.includes("OWN") ? "OWN" : "ALL";
  const fresh = normalizeAccess(ik, ["view"], scope);
  return data.roleIds.map((roleId) => {
    const prev = current.get(roleId);
    return prev
      ? { roleId, moduleId, actions: prev.actions, scope: prev.scope }
      : { roleId, moduleId, actions: JSON.stringify(fresh.actions), scope: fresh.scope };
  });
}

modulesRouter.post("/", async (req, res) => {
  const data = moduleInput.parse(req.body);
  const last = await prisma.module.aggregate({ _max: { order: true } });
  const created = await prisma.module.create({
    data: {
      ...columns(data),
      order: (last._max.order ?? 0) + 10,
      users: { create: data.userIds.map((userId) => ({ userId })) },
    },
  });
  const rows = await roleRows(created.id, data);
  if (rows.length) await prisma.roleModule.createMany({ data: rows });
  // Si el módulo está en la matriz fija, los roles base quedan como dice la matriz
  if (isMatrixModule(created.key)) await syncRoleMatrix();
  await audit(req, "module.created", "module", { entityId: created.id, detail: created.name });
  res.status(201).json((await present([created.id]))[0]);
});

modulesRouter.put("/:id", async (req, res) => {
  const data = moduleInput.parse(req.body);
  const rows = await roleRows(req.params.id, data);
  const [mod] = await prisma.$transaction([
    prisma.module.update({ where: { id: req.params.id }, data: columns(data) }),
    prisma.roleModule.deleteMany({ where: { moduleId: req.params.id } }),
    prisma.roleModule.createMany({ data: rows }),
    prisma.userModule.deleteMany({ where: { moduleId: req.params.id } }),
    prisma.userModule.createMany({ data: data.userIds.map((userId) => ({ userId, moduleId: req.params.id })) }),
  ]);
  if (isMatrixModule(mod.key)) await syncRoleMatrix();
  await audit(req, "module.updated", "module", { entityId: req.params.id, detail: data.name });
  res.json((await present([req.params.id]))[0]);
});

modulesRouter.patch("/:id/active", async (req, res) => {
  const { active } = z.object({ active: z.boolean() }).parse(req.body);
  const mod = await prisma.module.update({ where: { id: req.params.id }, data: { active } });
  await audit(req, active ? "module.activated" : "module.deactivated", "module", { entityId: mod.id, detail: mod.name });
  res.json({ ok: true });
});

/** Nuevo orden: lista completa de ids en el orden deseado */
modulesRouter.post("/reorder", async (req, res) => {
  const { ids } = z.object({ ids: z.array(z.string()).min(1) }).parse(req.body);
  if (new Set(ids).size !== ids.length) throw badRequest("La lista tiene módulos repetidos");
  await prisma.$transaction(ids.map((id, i) => prisma.module.update({ where: { id }, data: { order: (i + 1) * 10 } })));
  await audit(req, "module.reordered", "module");
  res.json({ ok: true });
});

modulesRouter.delete("/:id", async (req, res) => {
  const mod = await prisma.module.delete({ where: { id: req.params.id } });
  await audit(req, "module.deleted", "module", { entityId: mod.id, detail: mod.name });
  res.json({ ok: true });
});
