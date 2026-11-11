import { prisma } from "./prisma.js";
import { DEFAULT_MODULES, DEFAULT_ROLES } from "./defaults.js";
import { BASE_ROLE_KEYS, ROLE_MATRIX, type Grant } from "./role-matrix.js";
import { normalizeAccess } from "./module-access.js";
import { syncInventory } from "./inventory-migrate.js";

const LATER_MODULE_KEYS = ["inventario", "dreamzone"];

/**
 * Deja la base alineada con la matriz fija de roles. Idempotente: se ejecuta en cada arranque del API.
 *  - Crea los roles base que falten y los marca como de sistema (no se pueden borrar).
 *  - En cada módulo de la matriz, los roles base quedan exactamente con lo que dice la matriz
 *    (los roles creados a mano y los usuarios concedidos uno a uno no se tocan).
 */
export async function syncRoleMatrix() {
  const roles = new Map<string, string>();
  for (const r of DEFAULT_ROLES) {
    const { permissions, ...data } = r;
    const row = await prisma.role.upsert({
      where: { key: r.key },
      update: { system: true },
      create: { ...data, system: true, permissions: JSON.stringify(permissions) },
    });
    roles.set(r.key, row.id);
  }
  const baseIds = BASE_ROLE_KEYS.map((k) => roles.get(k)).filter((x): x is string => !!x);
  // El rol Administrador pasa a llamarse "Admin / TI" (solo si conserva el nombre original)
  const admin = DEFAULT_ROLES.find((r) => r.key === "admin")!;
  await prisma.role.updateMany({ where: { key: "admin", name: "Administrador" }, data: { name: admin.name, description: admin.description } });

  // Módulos que llegaron después de instalar el portal (Inventario): se crean una vez en bases que ya existían.
  // Los demás módulos por defecto no se recrean, por si el administrador borró alguno a propósito.
  const maxOrder = (await prisma.module.aggregate({ _max: { order: true } }))._max.order ?? 0;
  let order = maxOrder + 10;
  for (const m of DEFAULT_MODULES.filter((x) => LATER_MODULE_KEYS.includes(x.key))) {
    if (await prisma.module.findUnique({ where: { key: m.key }, select: { id: true } })) continue;
    const { roles: _roleKeys, ...data } = m;
    await prisma.module.create({ data: { ...data, order } });
    order += 10;
  }

  for (const [moduleKey, grants] of Object.entries(ROLE_MATRIX)) {
    const mod = await prisma.module.findUnique({ where: { key: moduleKey }, select: { id: true, internalKey: true, type: true } });
    if (!mod) continue;
    const ik = mod.type === "INTERNAL" ? mod.internalKey : null;
    const wanted = Object.entries(grants as Record<string, Grant>).map(([roleKey, g]) => {
      const n = normalizeAccess(ik, g.actions, g.scope);
      return { roleId: roles.get(roleKey)!, moduleId: mod.id, actions: JSON.stringify(n.actions), scope: n.scope };
    });
    const current = await prisma.roleModule.findMany({ where: { moduleId: mod.id, roleId: { in: baseIds } } });
    const same =
      current.length === wanted.length &&
      wanted.every((w) => current.some((c) => c.roleId === w.roleId && c.actions === w.actions && c.scope === w.scope));
    if (same) continue;
    await prisma.$transaction([
      prisma.roleModule.deleteMany({ where: { moduleId: mod.id, roleId: { in: baseIds } } }),
      prisma.roleModule.createMany({ data: wanted }),
    ]);
  }
  return roles;
}

/** Todo lo que el API alinea al arrancar */
export async function startupSync() {
  try {
    await syncRoleMatrix();
    await syncInventory();
  } catch (err) {
    console.error("No se pudo sincronizar la matriz de roles / inventario:", err);
  }
}
