import { prisma } from "../src/lib/prisma.js";
import { DEFAULT_SETTINGS } from "../src/lib/settings.js";
import { DEFAULT_MODULES, DEFAULT_ROLES } from "../src/lib/defaults.js";
import { PRESETS } from "../src/reports/presets.js";
import { syncRoleMatrix } from "../src/lib/startup-sync.js";
import { syncInventory } from "../src/lib/inventory-migrate.js";

/** Crea ajustes, roles y módulos por defecto que falten. No pisa lo que ya existe. */
export async function bootstrap(settingsOverride: Partial<typeof DEFAULT_SETTINGS> = {}) {
  for (const [key, value] of Object.entries({ ...DEFAULT_SETTINGS, ...settingsOverride })) {
    await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value: JSON.stringify(value) } });
  }
  const roles = new Map<string, string>();
  for (const r of DEFAULT_ROLES) {
    const { permissions, ...data } = r;
    const row = await prisma.role.upsert({
      where: { key: r.key },
      update: {},
      create: { ...data, permissions: JSON.stringify(permissions) },
    });
    roles.set(r.key, row.id);
  }
  let order = 10;
  for (const m of DEFAULT_MODULES) {
    const { roles: roleKeys, ...data } = m;
    const exists = await prisma.module.findUnique({ where: { key: m.key } });
    if (!exists) {
      await prisma.module.create({
        data: {
          ...data,
          order,
          roles: { create: roleKeys.filter((k) => roles.has(k)).map((k) => ({ roleId: roles.get(k)! })) },
        },
      });
    }
    order += 10;
  }
  // Reportes de partida (los del Apps Script y el Report Center), desactivados hasta asignarles destinatarios
  if ((await prisma.report.count()) === 0) {
    for (const p of PRESETS) {
      await prisma.report.create({
        data: {
          name: p.name,
          description: p.description,
          kind: "CRM",
          template: p.key,
          config: JSON.stringify(p.definition),
          active: false,
          times: p.times,
          subtitle: "Telefonía Izaguirre",
          emailSubject: p.emailSubject,
        },
      });
    }
  }
  // Matriz fija de roles (acciones y alcance por módulo), sedes y categorías del inventario
  await syncRoleMatrix();
  await syncInventory();
  return roles;
}
