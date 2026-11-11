import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { badRequest, forbidden } from "../lib/http.js";
import { ADMIN_ROLE_KEY, PERMISSIONS, PERMISSION_KEYS, parsePermissions } from "../lib/permissions.js";
import { audit } from "../lib/audit.js";
import { BASE_ROLE_KEYS, ROLE_MATRIX, isBaseRole, isMatrixModule, matrixGrant } from "../lib/role-matrix.js";
import { MODULE_CATALOG, catalogFor, normalizeAccess } from "../lib/module-access.js";

/** Roles y permisos (requiere roles.manage) */
export const rolesRouter = Router();

const roleInput = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(30)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Solo minúsculas, números y guiones"),
  name: z.string().trim().min(2).max(40),
  description: z.string().trim().max(200).nullish(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color hexadecimal inválido"),
  bypassIp: z.boolean(),
  moduleIds: z.array(z.string()),
});

async function list(ids?: string[]) {
  const roles = await prisma.role.findMany({
    where: ids ? { id: { in: ids } } : undefined,
    include: { _count: { select: { users: true } }, modules: { select: { moduleId: true } } },
    orderBy: [{ system: "desc" }, { name: "asc" }],
  });
  return roles.map(({ _count, modules, permissions, ...r }) => ({
    ...r,
    permissions: parsePermissions(r.key, permissions),
    users: _count.users,
    moduleIds: modules.map((m) => m.moduleId),
  }));
}

/**
 * Filas RoleModule de un rol.
 *  - Rol base: en los módulos de la matriz manda la matriz (lo que llegue del navegador se ignora);
 *    en el resto, los módulos marcados con la acción "ver".
 *  - Rol creado a mano: "ver" en cada módulo marcado; en los módulos con alcance "lo suyo" (Inventario), solo lo suyo.
 */
async function accessRows(roleId: string, roleKey: string, moduleIds: string[]) {
  const mods = await prisma.module.findMany({ select: { id: true, key: true, type: true, internalKey: true } });
  const base = isBaseRole(roleKey) && roleKey !== ADMIN_ROLE_KEY;
  const wanted = new Set(moduleIds);
  const rows: { roleId: string; moduleId: string; actions: string; scope: string }[] = [];
  for (const m of mods) {
    const ik = m.type === "INTERNAL" ? m.internalKey : null;
    if (base && isMatrixModule(m.key)) {
      const g = matrixGrant(m.key, roleKey);
      if (!g) continue;
      const n = normalizeAccess(ik, g.actions, g.scope);
      rows.push({ roleId, moduleId: m.id, actions: JSON.stringify(n.actions), scope: n.scope });
      continue;
    }
    if (!wanted.has(m.id)) continue;
    const scope = catalogFor(ik).scopes.includes("OWN") ? "OWN" : "ALL";
    const n = normalizeAccess(ik, ["view"], scope);
    rows.push({ roleId, moduleId: m.id, actions: JSON.stringify(n.actions), scope: n.scope });
  }
  return rows;
}

rolesRouter.get("/", async (_req, res) => {
  res.json(await list());
});

rolesRouter.get("/meta", (_req, res) => {
  res.json({
    permissions: PERMISSIONS,
    /** Roles cuyos módulos de la matriz no se editan a mano */
    baseRoles: BASE_ROLE_KEYS,
    /** Matriz fija: módulo → rol → acciones y alcance (con las etiquetas del catálogo) */
    matrix: ROLE_MATRIX,
    catalog: MODULE_CATALOG,
  });
});

rolesRouter.post("/", async (req, res) => {
  const data = roleInput.parse(req.body);
  const created = await prisma.role.create({
    data: {
      key: data.key,
      name: data.name,
      description: data.description || null,
      color: data.color,
      bypassIp: data.bypassIp,
      permissions: "[]",
    },
  });
  const rows = await accessRows(created.id, created.key, data.moduleIds);
  if (rows.length) await prisma.roleModule.createMany({ data: rows });
  await audit(req, "role.created", "role", { entityId: created.id, detail: created.name });
  res.status(201).json((await list([created.id]))[0]);
});

rolesRouter.put("/:id", async (req, res) => {
  const data = roleInput.parse(req.body);
  const role = await prisma.role.findUniqueOrThrow({ where: { id: req.params.id } });
  // La clave de un rol de sistema la usa el código; el administrador conserva siempre todos los permisos
  const key = role.system ? role.key : data.key;
  const permissions = key === ADMIN_ROLE_KEY ? PERMISSION_KEYS : [];
  const rows = await accessRows(role.id, key, data.moduleIds);
  await prisma.$transaction([
    prisma.role.update({
      where: { id: role.id },
      data: {
        key,
        name: data.name,
        description: data.description || null,
        color: data.color,
        bypassIp: key === ADMIN_ROLE_KEY ? true : data.bypassIp,
        permissions: JSON.stringify(permissions),
      },
    }),
    prisma.roleModule.deleteMany({ where: { roleId: role.id } }),
    prisma.roleModule.createMany({ data: rows }),
  ]);
  await audit(req, "role.updated", "role", { entityId: role.id, detail: `${data.name}: ${rows.length} módulos` });
  res.json((await list([role.id]))[0]);
});

rolesRouter.delete("/:id", async (req, res) => {
  const role = await prisma.role.findUniqueOrThrow({ where: { id: req.params.id }, include: { _count: { select: { users: true } } } });
  if (role.system) throw forbidden("Los roles de sistema no se pueden eliminar");
  if (role._count.users > 0) throw badRequest(`Hay ${role._count.users} usuario(s) con este rol. Cámbialos de rol antes de eliminarlo.`);
  await prisma.role.delete({ where: { id: role.id } });
  await audit(req, "role.deleted", "role", { entityId: role.id, detail: role.name });
  res.json({ ok: true });
});
