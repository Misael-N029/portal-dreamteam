import ExcelJS from "exceljs";
import { cellText, managementCategory, type Column, type ReportData, type Row } from "./definition.js";
import { formatDateTime } from "./time.js";

/** Excel del reporte (plantilla fija; columnas y filas según la definición) */

const HEADER_BG = "FF2E2E2E";
const ZEBRA = "FFF9F9F9";
const TONE = { ok: "FF16A34A", pending: "FFD97706", none: "FF71717A" };

function styleHeader(row: ExcelJS.Row) {
  row.height = 24;
  row.eachCell((c) => {
    c.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    c.alignment = { vertical: "middle", horizontal: "center" };
  });
}

function styleRow(row: ExcelJS.Row, rowData: Row, columns: Column[], zebra: boolean, offset = 0) {
  row.eachCell({ includeEmpty: true }, (c, n) => {
    c.font = { name: "Arial", size: 10 };
    if (zebra) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
    const col = columns[n - 1 - offset];
    if (!col) return;
    if (col.format === "strong" || col.format === "status") c.font = { name: "Arial", size: 10, bold: true };
    if (col.format === "date_accent") c.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFDC2626" } };
    if (col.format === "check") {
      const pte = String(c.value) === "PTE";
      c.font = { name: "Arial", size: 10, bold: !pte, italic: pte, color: { argb: pte ? TONE.none : TONE.ok } };
      c.alignment = { horizontal: "center" };
    }
    if (col.format === "management") {
      const cat = managementCategory(rowData[col.field]);
      c.font = { name: "Arial", size: 10, bold: cat !== "none", italic: cat === "none", color: { argb: TONE[cat] } };
    }
  });
}

function autoWidth(ws: ExcelJS.Worksheet, fromRow = 1) {
  ws.columns.forEach((col) => {
    let max = 8;
    col.eachCell?.({ includeEmpty: false }, (c) => {
      if (Number(c.row) >= fromRow) max = Math.max(max, String(c.value ?? "").length);
    });
    col.width = Math.min(max + 3, 45);
  });
}

/** Nombre de hoja válido (máx. 31 caracteres, sin caracteres prohibidos) y sin repetir */
function sheetName(name: string, used: Set<string>) {
  const base = name.replace(/[\\/:*?[\]]/g, "_").slice(0, 31) || "Hoja";
  let out = base;
  for (let i = 2; used.has(out.toLowerCase()); i++) out = `${base.slice(0, 27)} (${i})`;
  used.add(out.toLowerCase());
  return out;
}

/** Una hoja por grupo, como el Apps Script de PDT de Instalar */
async function perGroup(data: ReportData) {
  const wb = new ExcelJS.Workbook();
  const used = new Set<string>();
  const groups = data.groups.length ? data.groups : [{ label: data.title, rows: [], stats: [] }];
  for (const g of groups) {
    const ws = wb.addWorksheet(sheetName(g.label || data.title, used), { views: [{ state: "frozen", ySplit: 1 }] });
    styleHeader(ws.addRow(data.columns.map((c) => c.label)));
    g.rows.forEach((r, i) => styleRow(ws.addRow(data.columns.map((c) => cellText(r, c))), r, data.columns, i % 2 === 1));
    autoWidth(ws);
  }
  return wb;
}

/** Una sola hoja con título, subtítulo y la columna del grupo al inicio (como Ventas del mes BO) */
async function single(data: ReportData) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName(data.title, new Set()), { views: [{ state: "frozen", ySplit: 4 }] });
  const withGroup = !!data.groupLabel;
  const width = data.columns.length + (withGroup ? 1 : 0);
  const last = ws.getColumn(width).letter;

  ws.mergeCells(`A1:${last}1`);
  const title = ws.getCell("A1");
  title.value = data.title;
  title.font = { name: "Arial", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0A0A0A" } };
  title.alignment = { vertical: "middle", horizontal: "center" };
  ws.getRow(1).height = 32;

  ws.mergeCells(`A2:${last}2`);
  const sub = ws.getCell("A2");
  sub.value = `${data.subtitle ? `${data.subtitle} · ` : ""}Generado el ${formatDateTime(data.generatedAt)} (hora de Lima) · ${data.records} registros`;
  sub.font = { name: "Arial", size: 10, italic: true, color: { argb: "FFFFFFFF" } };
  sub.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDC2626" } };
  sub.alignment = { vertical: "middle", horizontal: "center" };

  ws.addRow([]);
  styleHeader(ws.addRow([...(withGroup ? ["Grupo"] : []), ...data.columns.map((c) => c.label)]));
  let i = 0;
  for (const g of data.groups) {
    for (const r of g.rows) {
      styleRow(ws.addRow([...(withGroup ? [g.label] : []), ...data.columns.map((c) => cellText(r, c))]), r, data.columns, i++ % 2 === 1, withGroup ? 1 : 0);
    }
  }
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: width } };
  autoWidth(ws, 4);
  return wb;
}

export async function buildExcel(data: ReportData, mode: "per_group" | "single"): Promise<Buffer> {
  const wb = mode === "single" ? await single(data) : await perGroup(data);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
