import { Router, type Response } from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { currentUser } from "../lib/auth.js";
import { badRequest } from "../lib/http.js";
import { requireAction } from "../lib/module-access.js";
import { audit } from "../lib/audit.js";
import { MANUAL_STATUSES, NO_SITE, access, actor, logEvent, machineScope } from "../inventory/shared.js";
import { applyMovement } from "./inventory-supplies.js";

/** Importación masiva (con vista previa) y exportación a Excel del inventario */
export const inventoryExcelRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) =>
    /\.xlsx$/i.test(file.originalname) ? cb(null, true) : cb(badRequest("Sube un archivo Excel (.xlsx). Usa la plantilla.")),
});

const MAX_ROWS = 2000;

const EQUIPMENT_COLUMNS = [
  { key: "assetTag", header: "Código*", width: 16 },
  { key: "category", header: "Categoría*", width: 18 },
  { key: "site", header: "Sede (código)*", width: 14 },
  { key: "brand", header: "Marca", width: 14 },
  { key: "model", header: "Modelo", width: 20 },
  { key: "serial", header: "Serie", width: 18 },
  { key: "hostname", header: "Hostname", width: 16 },
  { key: "status", header: "Estado", width: 12 },
  { key: "station", header: "Puesto", width: 10 },
  { key: "assignee", header: "Asignado a (correo)", width: 30 },
  { key: "cpu", header: "CPU", width: 18 },
  { key: "ram", header: "RAM", width: 10 },
  { key: "storage", header: "Disco", width: 12 },
  { key: "os", header: "SO", width: 14 },
  { key: "purchaseDate", header: "Fecha compra", width: 14 },
  { key: "supplier", header: "Proveedor", width: 18 },
  { key: "warrantyUntil", header: "Garantía hasta", width: 14 },
  { key: "notes", header: "Observaciones", width: 30 },
] as const;

const SUPPLY_COLUMNS = [
  { key: "sku", header: "SKU*", width: 14 },
  { key: "name", header: "Nombre*", width: 30 },
  { key: "category", header: "Categoría", width: 18 },
  { key: "unit", header: "Unidad", width: 10 },
  { key: "site", header: "Sede (código)", width: 14 },
  { key: "quantity", header: "Stock", width: 10 },
  { key: "minStock", header: "Mínimo", width: 10 },
  { key: "description", header: "Descripción", width: 30 },
] as const;

const STATUS_ES: Record<string, string> = { ACTIVE: "En uso", STORAGE: "Almacén", REPAIR: "Reparación", TRANSIT: "En traslado", RETIRED: "De baja" };
const STATUS_FROM_ES: Record<string, string> = {
  "en uso": "ACTIVE",
  uso: "ACTIVE",
  active: "ACTIVE",
  almacen: "STORAGE",
  "almacén": "STORAGE",
  storage: "STORAGE",
  reparacion: "REPAIR",
  "reparación": "REPAIR",
  repair: "REPAIR",
  "de baja": "RETIRED",
  baja: "RETIRED",
  retired: "RETIRED",
};

const sheet = (wb: ExcelJS.Workbook, name: string, columns: readonly { key: string; header: string; width: number }[]) => {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ key: c.key, header: c.header, width: c.width }));
  const head = ws.getRow(1);
  head.height = 22;
  head.eachCell((c) => {
    c.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0A0A0A" } };
    c.alignment = { vertical: "middle" };
  });
  return ws;
};

async function send(res: Response, wb: ExcelJS.Workbook, filename: string) {
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}

const dateCell = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

/** Texto de una celda (texto enriquecido, fórmulas, fechas, hipervínculos) */
function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((r) => r.text).join("").trim();
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue);
    if ("text" in v) return String(v.text).trim();
    return "";
  }
  return String(v).trim();
}

function parseDate(s: string): Date | null | "invalid" {
  if (!s) return null;
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  const d = m ? new Date(`${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}T12:00:00Z`) : new Date(s.length === 10 ? `${s}T12:00:00Z` : s);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

async function readRows(buf: Buffer, columns: readonly { key: string }[]) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw badRequest("No se pudo leer el Excel. Guárdalo como .xlsx e inténtalo de nuevo.");
  }
  const ws = wb.worksheets[0];
  if (!ws) throw badRequest("El Excel no tiene hojas");
  const rows: { row: number; v: Record<string, string> }[] = [];
  ws.eachRow((r, n) => {
    if (n === 1) return;
    const v: Record<string, string> = {};
    columns.forEach((c, i) => (v[c.key] = cellText(r.getCell(i + 1).value)));
    if (Object.values(v).some(Boolean)) rows.push({ row: n, v });
  });
  if (rows.length > MAX_ROWS) throw badRequest(`Máximo ${MAX_ROWS} filas por archivo`);
  return rows;
}

// ── Plantillas ──

inventoryExcelRouter.get("/import/template/:kind", requireAction("import"), async (req, res) => {
  const { kind } = z.object({ kind: z.enum(["equipment", "supplies"]) }).parse(req.params);
  const wb = new ExcelJS.Workbook();
  const cats = await prisma.inventoryCategory.findMany({ where: { kind: kind === "equipment" ? "EQUIPMENT" : "SUPPLY", active: true }, orderBy: { order: "asc" } });
  const sites = await prisma.site.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  if (kind === "equipment") {
    const ws = sheet(wb, "Equipos", EQUIPMENT_COLUMNS);
    ws.addRow({ assetTag: "DT-PC-0100", category: cats[0]?.key ?? "PC", site: sites[0]?.code ?? "IZA", brand: "Dell", model: "OptiPlex 3080", serial: "SN123456", status: "Almacén", cpu: "Core i5-10500", ram: "8 GB", storage: "256 GB SSD", os: "Windows 11", purchaseDate: "2025-03-15", warrantyUntil: "2028-03-15" });
  } else {
    const ws = sheet(wb, "Insumos", SUPPLY_COLUMNS);
    ws.addRow({ sku: "INS-0001", name: "Papel bond A4 (millar)", category: cats[0]?.key ?? "OFICINA", unit: "paquete", site: sites[0]?.code ?? "IZA", quantity: 20, minStock: 5 });
  }
  const help = wb.addWorksheet("Ayuda");
  help.addRow(["Categorías válidas (clave · nombre)"]).font = { bold: true };
  for (const c of cats) help.addRow([c.key, c.name]);
  help.addRow([]);
  help.addRow(["Sedes válidas (código · nombre)"]).font = { bold: true };
  for (const s of sites) help.addRow([s.code, s.name]);
  if (kind === "equipment") {
    help.addRow([]);
    help.addRow(["Estados: En uso, Almacén, Reparación, De baja. Fechas: AAAA-MM-DD o DD/MM/AAAA."]);
    help.addRow(["Si el código ya existe, la fila actualiza ese equipo (no cambia su sede: para eso usa un traslado)."]);
  } else help.addRow(["Si el SKU ya existe, se actualiza. El stock indicado se registra como ajuste por conteo en el kardex."]);
  help.getColumn(1).width = 22;
  help.getColumn(2).width = 40;
  await send(res, wb, kind === "equipment" ? "plantilla-equipos.xlsx" : "plantilla-insumos.xlsx");
});

// ── Importación con vista previa ──

type Preview = { row: number; key: string; action: "create" | "update" | "error"; message?: string };

inventoryExcelRouter.post("/import/:kind", requireAction("import"), upload.single("file"), async (req, res) => {
  const { kind } = z.object({ kind: z.enum(["equipment", "supplies"]) }).parse(req.params);
  const apply = req.query.apply === "1";
  if (!req.file) throw badRequest("Elige el archivo de Excel");
  const a = access(req);
  const who = actor(req);
  const [cats, sites] = await Promise.all([
    prisma.inventoryCategory.findMany({ where: { kind: kind === "equipment" ? "EQUIPMENT" : "SUPPLY" } }),
    prisma.site.findMany({ where: a.scope === "ALL" ? {} : { id: a.siteId ?? NO_SITE } }),
  ]);
  const catBy = (s: string) => cats.find((c) => c.key === s.toUpperCase() || c.name.toLowerCase() === s.toLowerCase());
  const siteBy = (s: string) => sites.find((x) => x.code === s.toUpperCase() || x.name.toLowerCase() === s.toLowerCase());
  const preview: Preview[] = [];

  if (kind === "equipment") {
    const rows = await readRows(req.file.buffer, EQUIPMENT_COLUMNS);
    const tags = rows.map((r) => r.v.assetTag!.toUpperCase()).filter(Boolean);
    const existing = new Map((await prisma.machine.findMany({ where: { assetTag: { in: tags } } })).map((m) => [m.assetTag, m]));
    const emails = [...new Set(rows.map((r) => r.v.assignee!.toLowerCase()).filter(Boolean))];
    const users = new Map((await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true, email: true } })).map((u) => [u.email, u.id]));
    const stations = await prisma.workstation.findMany({ where: { siteId: { in: sites.map((s) => s.id) } }, select: { id: true, code: true, siteId: true, userId: true } });
    const seen = new Set<string>();
    const valid: { row: number; data: Record<string, unknown>; existingId?: string }[] = [];
    for (const { row, v } of rows) {
      const tag = v.assetTag!.toUpperCase();
      const err = (message: string) => preview.push({ row, key: tag || "—", action: "error", message });
      if (tag.length < 2) {
        err("Falta el código");
        continue;
      }
      if (seen.has(tag)) {
        err("Código repetido en el archivo");
        continue;
      }
      seen.add(tag);
      const cat = catBy(v.category!);
      if (!cat) {
        err(`Categoría "${v.category}" no existe`);
        continue;
      }
      const prev = existing.get(tag);
      const site = siteBy(v.site!);
      if (!prev && !site) {
        err(`Sede "${v.site}" no existe o no es tuya`);
        continue;
      }
      if (prev && a.scope !== "ALL" && prev.siteId !== a.siteId) {
        err("El equipo es de otra sede");
        continue;
      }
      const status = v.status ? STATUS_FROM_ES[v.status.toLowerCase()] : undefined;
      if (v.status && !status) {
        err(`Estado "${v.status}" no válido`);
        continue;
      }
      if (prev && (prev.status === "TRANSIT" || prev.status === "RETIRED") && status) {
        err(`El equipo está ${STATUS_ES[prev.status]?.toLowerCase()}; no se cambia su estado desde Excel`);
        continue;
      }
      const pd = parseDate(v.purchaseDate!);
      const wd = parseDate(v.warrantyUntil!);
      if (pd === "invalid" || wd === "invalid") {
        err("Fecha inválida (usa AAAA-MM-DD o DD/MM/AAAA)");
        continue;
      }
      const siteId = prev?.siteId ?? site!.id;
      const st = v.station ? stations.find((s) => s.siteId === siteId && s.code === v.station!.toUpperCase()) : undefined;
      if (v.station && !st) {
        err(`El puesto ${v.station} no existe en la sede`);
        continue;
      }
      const assignee = v.assignee ? users.get(v.assignee.toLowerCase()) : undefined;
      if (v.assignee && !assignee) {
        err(`No hay un usuario con el correo ${v.assignee}`);
        continue;
      }
      // Con persona a cargo y sin puesto, ya no está en el almacén
      const leavesStorage = !!assignee && !st && (status ?? prev?.status) === "STORAGE";
      const data: Record<string, unknown> = {
        categoryId: cat.id,
        type: cat.key,
        ...(v.brand ? { brand: v.brand } : {}),
        ...(v.model ? { model: v.model } : {}),
        ...(v.serial ? { serial: v.serial } : {}),
        ...(v.hostname ? { hostname: v.hostname } : {}),
        ...(v.cpu ? { cpu: v.cpu } : {}),
        ...(v.ram ? { ram: v.ram } : {}),
        ...(v.storage ? { storage: v.storage } : {}),
        ...(v.os ? { os: v.os } : {}),
        ...(v.supplier ? { supplier: v.supplier } : {}),
        ...(v.notes ? { notes: v.notes.slice(0, 500) } : {}),
        ...(pd ? { purchaseDate: pd } : {}),
        ...(wd ? { warrantyUntil: wd } : {}),
        ...(status && (MANUAL_STATUSES as readonly string[]).includes(status) ? { status } : {}),
        ...(st ? { workstationId: st.id, location: st.code, assignedUserId: assignee ?? st.userId, ...(status ? {} : { status: "ACTIVE" }) } : {}),
        ...(assignee && !st ? { assignedUserId: assignee } : {}),
        ...(leavesStorage ? { status: "ACTIVE", location: null } : {}),
      };
      preview.push({ row, key: tag, action: prev ? "update" : "create" });
      valid.push({ row, data: prev ? data : { ...data, assetTag: tag, siteId }, existingId: prev?.id });
    }
    if (apply && valid.length) {
      for (let i = 0; i < valid.length; i += 200) {
        const batch = valid.slice(i, i + 200);
        await prisma.$transaction(
          async (tx) => {
            for (const r of batch) {
              if (r.existingId) {
                await tx.machine.update({ where: { id: r.existingId }, data: r.data });
                await logEvent(tx, r.existingId, "IMPORTED", "Actualizado desde Excel", who);
              } else {
                const m = await tx.machine.create({ data: r.data as Parameters<typeof tx.machine.create>[0]["data"] });
                await logEvent(tx, m.id, "IMPORTED", "Alta desde Excel", who);
              }
            }
          },
          { timeout: 60_000 },
        );
      }
    }
  } else {
    const rows = await readRows(req.file.buffer, SUPPLY_COLUMNS);
    const skus = rows.map((r) => r.v.sku!.toUpperCase()).filter(Boolean);
    const existing = new Map((await prisma.supply.findMany({ where: { sku: { in: skus } } })).map((s) => [s.sku, s]));
    const valid: { row: number; sku: string; data: Record<string, unknown>; existingId?: string; siteId?: string; quantity?: number; minStock?: number }[] = [];
    for (const { row, v } of rows) {
      const sku = v.sku!.toUpperCase();
      const err = (message: string) => preview.push({ row, key: sku || "—", action: "error", message });
      if (sku.length < 2) {
        err("Falta el SKU");
        continue;
      }
      const prev = existing.get(sku);
      if (!prev && (v.name ?? "").length < 2) {
        err("Falta el nombre");
        continue;
      }
      const cat = v.category ? catBy(v.category) : undefined;
      if (v.category && !cat) {
        err(`Categoría "${v.category}" no existe`);
        continue;
      }
      const site = v.site ? siteBy(v.site) : undefined;
      if (v.site && !site) {
        err(`Sede "${v.site}" no existe o no es tuya`);
        continue;
      }
      const q = v.quantity ? Number(v.quantity) : undefined;
      const mn = v.minStock ? Number(v.minStock) : undefined;
      if ((q !== undefined && (!Number.isInteger(q) || q < 0)) || (mn !== undefined && (!Number.isInteger(mn) || mn < 0))) {
        err("Stock y mínimo deben ser números enteros");
        continue;
      }
      if ((q !== undefined || mn !== undefined) && !site) {
        err("Indica la sede del stock");
        continue;
      }
      preview.push({ row, key: sku, action: prev ? "update" : "create" });
      valid.push({
        row,
        sku,
        existingId: prev?.id,
        siteId: site?.id,
        quantity: q,
        minStock: mn,
        data: { ...(v.name ? { name: v.name.slice(0, 80) } : {}), ...(cat ? { categoryId: cat.id } : {}), ...(v.unit ? { unit: v.unit.slice(0, 16) } : {}), ...(v.description ? { description: v.description.slice(0, 300) } : {}) },
      });
    }
    if (apply && valid.length) {
      for (let i = 0; i < valid.length; i += 200) {
        await prisma.$transaction(
          async (tx) => {
            for (const r of valid.slice(i, i + 200)) {
              const s = r.existingId
                ? await tx.supply.update({ where: { id: r.existingId }, data: r.data })
                : await tx.supply.create({ data: { sku: r.sku, name: String(r.data.name), ...r.data } });
              if (!r.siteId) continue;
              const cur = await tx.supplyStock.upsert({
                where: { supplyId_siteId: { supplyId: s.id, siteId: r.siteId } },
                update: r.minStock !== undefined ? { minStock: r.minStock } : {},
                create: { supplyId: s.id, siteId: r.siteId, quantity: 0, minStock: r.minStock ?? s.defaultMin },
              });
              if (r.quantity !== undefined && r.quantity !== cur.quantity) {
                await applyMovement(tx, { supplyId: s.id, siteId: r.siteId, kind: "ADJUST", delta: r.quantity - cur.quantity, reason: "Importación Excel" }, who);
              }
            }
          },
          { timeout: 60_000 },
        );
      }
    }
  }

  const summary = {
    create: preview.filter((p) => p.action === "create").length,
    update: preview.filter((p) => p.action === "update").length,
    error: preview.filter((p) => p.action === "error").length,
  };
  if (apply) await audit(req, `inventory.import.${kind}`, "inventory", { detail: `${summary.create} nuevos, ${summary.update} actualizados, ${summary.error} con error` });
  res.json({ applied: apply, summary, rows: preview.sort((x, y) => x.row - y.row) });
});

// ── Exportación ──

inventoryExcelRouter.get("/export/equipment", requireAction("import"), async (req, res) => {
  const a = access(req);
  const items = await prisma.machine.findMany({
    where: machineScope(a, currentUser(req).id),
    include: { category: true, site: true, workstation: true, assignedUser: { select: { email: true } } },
    orderBy: { assetTag: "asc" },
  });
  const wb = new ExcelJS.Workbook();
  const ws = sheet(wb, "Equipos", EQUIPMENT_COLUMNS);
  for (const m of items) {
    ws.addRow({
      assetTag: m.assetTag,
      category: m.category?.key ?? m.type,
      site: m.site.code,
      brand: m.brand,
      model: m.model,
      serial: m.serial,
      hostname: m.hostname,
      status: STATUS_ES[m.status] ?? m.status,
      station: m.workstation?.code,
      assignee: m.assignedUser?.email,
      cpu: m.cpu,
      ram: m.ram,
      storage: m.storage,
      os: m.os,
      purchaseDate: dateCell(m.purchaseDate),
      supplier: m.supplier,
      warrantyUntil: dateCell(m.warrantyUntil),
      notes: m.notes,
    });
  }
  await send(res, wb, `equipos-${new Date().toISOString().slice(0, 10)}.xlsx`);
});

inventoryExcelRouter.get("/export/supplies", requireAction("import"), async (req, res) => {
  const a = access(req);
  const items = await prisma.supply.findMany({
    include: { category: true, stock: { where: a.scope === "ALL" ? {} : { siteId: a.siteId ?? NO_SITE }, include: { site: true } } },
    orderBy: { name: "asc" },
  });
  const wb = new ExcelJS.Workbook();
  const ws = sheet(wb, "Insumos", SUPPLY_COLUMNS);
  for (const s of items) {
    const base = { sku: s.sku, name: s.name, category: s.category?.key, unit: s.unit, description: s.description };
    if (!s.stock.length) ws.addRow(base);
    for (const st of s.stock) {
      const row = ws.addRow({ ...base, site: st.site.code, quantity: st.quantity, minStock: st.minStock });
      if (st.minStock > 0 && st.quantity < st.minStock) row.getCell(6).font = { bold: true, color: { argb: "FFDC2626" } };
    }
  }
  await send(res, wb, `insumos-${new Date().toISOString().slice(0, 10)}.xlsx`);
});
