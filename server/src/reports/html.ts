import { cellText, type Column, type ReportData, type Row } from "./definition.js";
import { formatDateTime } from "./time.js";

/**
 * HTML del reporte. El mismo documento se usa como cuerpo del correo y como base de la imagen de WhatsApp,
 * así que todo va maquetado con tablas y estilos en línea (lo que respetan Gmail y Outlook).
 * Todos los datos del CRM se escapan.
 */

export const esc = (v: unknown) =>
  String(v ?? "-")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const RED = "#DC2626";
const FONT = "font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
const TH = "padding:9px 10px;font-weight:600;text-transform:uppercase;font-size:10px;letter-spacing:.04em;text-align:left;white-space:nowrap;background:#171717;color:#ffffff;";
const TD = "padding:8px 10px;border-bottom:1px solid #f0f0f0;vertical-align:top;";

function management(value?: string) {
  const base = "padding:2px 7px;border-radius:4px;font-weight:600;font-size:11px;white-space:nowrap;";
  if (!value || value === "Sin seguimiento") return `<span style="${base}color:#71717a;background:#f4f4f5;">Sin seguimiento</span>`;
  const u = value.toUpperCase();
  if (u.includes("OK") || u.includes("RECUPERADO")) return `<span style="${base}color:#15803d;background:#dcfce7;">${esc(value)}</span>`;
  if (u.includes("CANCELADO") || u.includes("BAJA") || u.includes("RECHAZADO")) return `<span style="${base}color:#b91c1c;background:#fee2e2;">${esc(value)}</span>`;
  return `<span style="${base}color:#b45309;background:#fef3c7;">${esc(value)}</span>`;
}

const TONES: Record<string, [string, string]> = {
  default: ["#fafafa", "#0a0a0a"],
  good: ["#f0fdf4", "#15803d"],
  warn: ["#fffbeb", "#b45309"],
  muted: ["#fafafa", "#52525b"],
  brand: ["#fef2f2", RED],
};

const cellBox = (label: string, value: number, tone: string) => {
  const [bg, color] = TONES[tone] ?? TONES.default!;
  return `<td style="background:${bg};border-radius:8px;padding:12px 14px;">
    <div style="color:#71717a;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">${esc(label)}</div>
    <div style="color:${color};font-size:24px;font-weight:700;margin-top:2px;">${value}</div></td>`;
};

/** Indicadores: los que no tienen sección van en la primera fila; cada sección en su propia fila con título */
function metricsBlock(data: ReportData) {
  if (!data.metrics.length) return "";
  const sections = new Map<string, ReportData["metrics"]>();
  for (const m of data.metrics) sections.set(m.section ?? "", [...(sections.get(m.section ?? "") ?? []), m]);
  const spacer = `<td style="width:10px;"></td>`;
  return [...sections.entries()]
    .map(
      ([title, items]) => `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:14px;">
      ${title ? `<tr><td colspan="${items.length * 2}" style="padding:4px 0 8px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:${RED};font-size:11px;">${esc(title)}</td></tr>` : ""}
      <tr>${items.map((m) => cellBox(m.label, m.value, m.tone)).join(spacer)}</tr></table>`,
    )
    .join("") + `<div style="height:8px;"></div>`;
}

function cell(row: Row, col: Column) {
  const t = cellText(row, col);
  switch (col.format) {
    case "strong":
      return `<td style="${TD}font-weight:600;">${esc(t)}</td>`;
    case "mono":
      return `<td style="${TD}font-family:monospace;color:#525252;white-space:nowrap;">${esc(t)}</td>`;
    case "status":
      return `<td style="${TD}"><span style="background:#f4f4f5;padding:2px 6px;border-radius:4px;font-weight:600;font-size:10px;white-space:nowrap;">${esc(t)}</span></td>`;
    case "management":
      return `<td style="${TD}">${management(t)}</td>`;
    case "date_accent":
      return `<td style="${TD}font-weight:600;color:${RED};white-space:nowrap;">${esc(t)}</td>`;
    case "date":
    case "time":
    case "datetime":
      return `<td style="${TD}font-family:monospace;white-space:nowrap;">${esc(t)}</td>`;
    case "check":
      return `<td style="${TD}font-family:monospace;font-weight:600;color:${t === "PTE" || t === "-" ? "#a3a3a3" : "#15803d"};">${esc(t)}</td>`;
    default:
      return `<td style="${TD}color:#404040;">${esc(t)}</td>`;
  }
}

function table(rows: Row[], columns: Column[]) {
  return `<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:${columns.length > 8 ? 11 : 12}px;">
    <tr>${columns.map((c) => `<th style="${TH}">${esc(c.label)}</th>`).join("")}</tr>
    ${rows.map((r, i) => `<tr style="background:${i % 2 ? "#fafafa" : "#ffffff"};">${columns.map((c) => cell(r, c)).join("")}</tr>`).join("")}</table>`;
}

function body(data: ReportData, brand: string) {
  const groups = !data.records
    ? `<div style="text-align:center;padding:36px;color:#737373;border:1px dashed #e5e5e5;border-radius:10px;font-size:13px;">No hay registros para este reporte en el período.</div>`
    : data.groups
        .map((g) => {
          const right = g.stats.length
            ? g.stats.map((s) => `${esc(s.label)} ${s.value}/${g.rows.length}`).join(" · ")
            : `${g.rows.length} ${g.rows.length === 1 ? "registro" : "registros"}`;
          const header = data.groupLabel
            ? `<tr><td style="background:#f5f5f5;padding:10px 14px;border-bottom:1px solid #e5e5e5;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
                <td style="font-weight:700;font-size:13px;">${esc(g.label)}${g.stats.length ? ` — ${g.rows.length} registros` : ""}</td>
                <td align="right" style="font-size:11px;font-weight:700;color:${g.stats.length ? "#525252" : RED};">${right}</td>
              </tr></table></td></tr>`
            : "";
          return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:20px;border:1px solid #e5e5e5;border-radius:10px;overflow:hidden;border-collapse:separate;">
            ${header}<tr><td>${table(g.rows, data.columns)}</td></tr></table>`;
        })
        .join("");

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0a0a0a;border-radius:12px;margin-bottom:20px;">
      <tr><td style="padding:20px 24px;color:#ffffff;">
        <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${RED};">${esc(brand)} · Centro de Reportes</div>
        <div style="font-size:22px;font-weight:700;margin-top:4px;color:#ffffff;">${esc(data.title)}</div>
        ${data.subtitle ? `<div style="font-size:13px;color:#a3a3a3;margin-top:2px;">${esc(data.subtitle)}</div>` : ""}
      </td><td align="right" style="padding:20px 24px;font-size:12px;color:#d4d4d4;white-space:nowrap;">
        ${esc(formatDateTime(data.generatedAt))}<div style="color:#737373;font-size:11px;margin-top:2px;">Hora de Lima</div>
      </td></tr>
    </table>
    ${metricsBlock(data)}
    ${groups}
    <div style="margin-top:16px;text-align:center;font-size:11px;color:#a3a3a3;">Generado automáticamente por el Portal ${esc(brand)}.</div>`;
}

/** Documento para convertir en imagen (ancho fijo de 900 px) */
export function renderReportHtml(data: ReportData, brand = "DreamTeam"): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>body{margin:0;background:#fff;}</style></head><body>
  <div id="report" style="${FONT}width:900px;box-sizing:border-box;padding:24px;background:#ffffff;color:#171717;">${body(data, brand)}</div></body></html>`;
}

/** Cuerpo del correo (ancho fluido hasta 960 px, fondo gris como los correos del Apps Script) */
export function renderReportEmail(data: ReportData, brand = "DreamTeam"): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
  <body style="margin:0;padding:16px;background:#f0f0f0;">
  <div style="${FONT}max-width:960px;margin:0 auto;padding:20px;background:#ffffff;border-radius:10px;color:#171717;">${body(data, brand)}</div></body></html>`;
}

/** Correo para un reporte de capturas: las imágenes van incrustadas (cid) */
export function renderScreenshotEmail(title: string, captures: { url: string; cid: string }[], brand = "DreamTeam"): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"></head><body style="margin:0;padding:16px;background:#f0f0f0;">
  <div style="${FONT}max-width:960px;margin:0 auto;padding:20px;background:#ffffff;border-radius:10px;color:#171717;">
    <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${RED};">${esc(brand)} · Centro de Reportes</div>
    <div style="font-size:20px;font-weight:700;margin:4px 0 16px;">${esc(title)}</div>
    ${captures
      .map((c) => `<p style="font-size:12px;color:#525252;margin:0 0 6px;">${esc(c.url)}</p><img src="cid:${c.cid}" alt="" style="width:100%;border:1px solid #e5e5e5;border-radius:8px;margin-bottom:18px;">`)
      .join("")}
  </div></body></html>`;
}
