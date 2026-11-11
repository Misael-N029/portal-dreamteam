import { prisma } from "./prisma.js";

/** Categorías con las que arranca el inventario. El administrador puede renombrarlas, desactivarlas o crear más. */
export const DEFAULT_CATEGORIES: { kind: "EQUIPMENT" | "SUPPLY"; key: string; name: string; icon: string; color: string; slot?: string; unit?: string }[] = [
  { kind: "EQUIPMENT", key: "PC", name: "Computadora", icon: "Monitor", color: "#DC2626", slot: "PC" },
  { kind: "EQUIPMENT", key: "LAPTOP", name: "Laptop", icon: "Laptop", color: "#B91C1C", slot: "PC" },
  { kind: "EQUIPMENT", key: "MONITOR", name: "Monitor", icon: "MonitorSmartphone", color: "#0369A1", slot: "MONITOR" },
  { kind: "EQUIPMENT", key: "HEADSET", name: "Headset / diadema", icon: "Headset", color: "#15803D", slot: "HEADSET" },
  { kind: "EQUIPMENT", key: "KEYBOARD", name: "Teclado", icon: "Keyboard", color: "#374151", slot: "PERIPHERAL" },
  { kind: "EQUIPMENT", key: "MOUSE", name: "Mouse", icon: "Mouse", color: "#6B7280", slot: "PERIPHERAL" },
  { kind: "EQUIPMENT", key: "PHONE", name: "Teléfono", icon: "Phone", color: "#B45309", slot: "PHONE" },
  { kind: "EQUIPMENT", key: "OTHER", name: "Otro equipo", icon: "Box", color: "#525252", slot: "OTHER" },
  { kind: "SUPPLY", key: "OFICINA", name: "Útiles de oficina", icon: "PenLine", color: "#0369A1", unit: "unid." },
  { kind: "SUPPLY", key: "LIMPIEZA", name: "Limpieza", icon: "SprayCan", color: "#15803D", unit: "unid." },
  { kind: "SUPPLY", key: "REPUESTOS", name: "Cables y repuestos", icon: "Cable", color: "#B45309", unit: "unid." },
  { kind: "SUPPLY", key: "IMPRESION", name: "Impresión", icon: "Printer", color: "#374151", unit: "unid." },
];

/** Las 3 sedes con las que arranca el inventario. La 2 y la 3 se renombran desde Inventario → Configurar → Sedes. */
export const DEFAULT_SITES = [
  { code: "IZA", name: "Izaguirre", address: "Av. Izaguirre, Los Olivos", city: "Lima" },
  { code: "S02", name: "Sede 2 (por confirmar)", city: "Lima" },
  { code: "S03", name: "Sede 3 (por confirmar)", city: "Lima" },
];

/**
 * Deja el inventario listo para usarse. Idempotente y no destructiva:
 *  - crea las 3 sedes si todavía no hay ninguna;
 *  - crea las categorías por defecto que falten (por clave);
 *  - enlaza cada máquina sin categoría con la categoría de su `type` (PC, LAPTOP, MONITOR…).
 */
export async function syncInventory() {
  if ((await prisma.site.count()) === 0) {
    for (const s of DEFAULT_SITES) await prisma.site.create({ data: s });
  }
  const existing = new Set((await prisma.inventoryCategory.findMany({ select: { key: true } })).map((c) => c.key));
  let order = 10;
  for (const c of DEFAULT_CATEGORIES) {
    if (!existing.has(c.key)) await prisma.inventoryCategory.create({ data: { ...c, order } });
    order += 10;
  }
  const orphans = await prisma.machine.findMany({ where: { categoryId: null }, select: { type: true }, distinct: ["type"] });
  if (orphans.length === 0) return;
  const cats = await prisma.inventoryCategory.findMany({ where: { kind: "EQUIPMENT" }, select: { id: true, key: true } });
  const byKey = new Map(cats.map((c) => [c.key, c.id]));
  for (const { type } of orphans) {
    const categoryId = byKey.get(type) ?? byKey.get("OTHER");
    if (categoryId) await prisma.machine.updateMany({ where: { categoryId: null, type }, data: { categoryId } });
  }
}
