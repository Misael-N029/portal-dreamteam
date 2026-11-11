import { z } from "zod";
import type { Sale } from "./crm.js";
import { limaDay, limaTime, limaToday } from "./time.js";

/**
 * Definición dinámica de un reporte del CRM. El administrador la arma desde el portal:
 * qué ventas entran (filtros), cómo se agrupan, qué columnas y qué indicadores se muestran y por dónde sale.
 * El diseño visual es fijo (plantilla en html.ts / excel.ts); el contenido sale de aquí.
 */

export const CONDITION_OPS = [
  { key: "eq", label: "es igual a", needsValue: true, date: false },
  { key: "neq", label: "es distinto de", needsValue: true, date: false },
  { key: "in", label: "es alguno de (separados por coma)", needsValue: true, date: false },
  { key: "not_in", label: "no es ninguno de", needsValue: true, date: false },
  { key: "contains", label: "contiene", needsValue: true, date: false },
  { key: "not_empty", label: "tiene valor", needsValue: false, date: false },
  { key: "empty", label: "está vacío", needsValue: false, date: false },
  { key: "today", label: "es hoy", needsValue: false, date: true },
  { key: "from_today", label: "es hoy o después", needsValue: false, date: true },
  { key: "before_today", label: "es antes de hoy", needsValue: false, date: true },
  { key: "this_month", label: "es de este mes", needsValue: false, date: true },
  { key: "last_days", label: "es de los últimos N días", needsValue: false, date: true },
] as const;

export const COLUMN_FORMATS = [
  { key: "text", label: "Texto" },
  { key: "strong", label: "Texto destacado" },
  { key: "mono", label: "Código (DNI, teléfono)" },
  { key: "status", label: "Etiqueta de estado" },
  { key: "management", label: "Estado de gestión (OK / pendiente / sin seguimiento)" },
  { key: "date", label: "Fecha (dd/mm/aaaa)" },
  { key: "date_accent", label: "Fecha en rojo" },
  { key: "time", label: "Hora (hh:mm)" },
  { key: "datetime", label: "Fecha y hora" },
  { key: "check", label: "Hora de gestión o PTE" },
] as const;

export const TRANSFORMS = [
  {
    key: "management_same_day",
    label: "Gestiones solo del día de la venta",
    description: "Si la venta no se actualizó el mismo día, su contraoferta y fidelización cuentan como “Sin seguimiento” (Seguimiento BO).",
  },
  {
    key: "management_month_times",
    label: "Hora de cada gestión (mensual)",
    description: "Calcula las columnas virtuales _gestion_contra y _gestion_fide con la hora de la gestión o PTE (Ventas del mes BO).",
  },
] as const;

const opKeys = CONDITION_OPS.map((o) => o.key) as [string, ...string[]];
const formatKeys = COLUMN_FORMATS.map((f) => f.key) as [string, ...string[]];
const transformKeys = TRANSFORMS.map((t) => t.key) as [string, ...string[]];

const condition = z.object({
  /** Si hay varios campos, basta con que se cumpla en uno (ej. actualizada hoy o vendida hoy) */
  fields: z.array(z.string().trim().min(1)).min(1).max(4),
  op: z.enum(opKeys),
  value: z.string().max(500).optional(),
  days: z.number().int().min(1).max(366).optional(),
  /** En filtros de fecha: también entran las ventas sin fecha */
  orEmpty: z.boolean().optional(),
});

const column = z.object({
  field: z.string().trim().min(1),
  label: z.string().trim().min(1).max(40),
  format: z.enum(formatKeys).default("text"),
});

const metric = z.object({
  label: z.string().trim().min(1).max(40),
  /** count: total de registros · groups: cantidad de grupos · where: registros que cumplen una condición · management: estado de gestión */
  kind: z.enum(["count", "groups", "where", "management"]),
  condition: condition.optional(),
  field: z.string().optional(),
  category: z.enum(["ok", "pending", "none"]).optional(),
  /** Agrupa indicadores en una fila con título (ej. "Contraofertas") */
  section: z.string().max(40).optional(),
  tone: z.enum(["default", "good", "warn", "muted", "brand"]).default("default"),
});

const groupStat = z.object({
  label: z.string().trim().min(1).max(30),
  /** Cuenta los registros del grupo con gestión (distinto de "Sin seguimiento") */
  field: z.string().trim().min(1),
});

export const definitionSchema = z.object({
  campaignId: z.number().int().positive().nullable().default(null),
  title: z.string().trim().min(2).max(80),
  filters: z.array(condition).max(12).default([]),
  transforms: z.array(z.enum(transformKeys)).default([]),
  sort: z.object({ field: z.string().trim().min(1), dir: z.enum(["asc", "desc"]) }).nullable().default(null),
  groupBy: z.string().trim().min(1).nullable().default("supervisor"),
  emptyGroupLabel: z.string().max(40).default("Sin supervisor"),
  groupStats: z.array(groupStat).max(4).default([]),
  columns: z.array(column).min(1, "Agrega al menos una columna").max(14),
  metrics: z.array(metric).max(10).default([]),
  output: z
    .object({
      /** Cuerpo del correo con el reporte */
      email: z.boolean().default(true),
      /** Imagen del reporte para WhatsApp */
      image: z.boolean().default(true),
      /** Excel adjunto: una hoja por grupo o una sola hoja */
      excel: z.enum(["none", "per_group", "single"]).default("per_group"),
    })
    .default({}),
});

export type Definition = z.infer<typeof definitionSchema>;
export type Condition = z.infer<typeof condition>;
export type Column = z.infer<typeof column>;

export type Row = Record<string, unknown>;

export type ReportData = {
  title: string;
  subtitle: string;
  generatedAt: Date;
  columns: Column[];
  metrics: { label: string; value: number; section?: string; tone: string }[];
  groupLabel: string | null;
  groups: { label: string; rows: Row[]; stats: { label: string; value: number }[] }[];
  records: number;
};

export function parseDefinition(raw: string | object): Definition {
  return definitionSchema.parse(typeof raw === "string" ? JSON.parse(raw || "{}") : raw);
}

// ── Evaluación ──

const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const norm = (v: unknown) => text(v).trim().toUpperCase();

export type ManagementCategory = "ok" | "pending" | "none";
export function managementCategory(v: unknown): ManagementCategory {
  const s = text(v);
  if (!s || s === "Sin seguimiento") return "none";
  const u = s.toUpperCase();
  return u.includes("OK") || u.includes("RECUPERADO") ? "ok" : "pending";
}

function matchOne(value: unknown, c: Condition): boolean {
  const today = limaToday();
  const isEmpty = text(value).trim() === "";
  switch (c.op) {
    case "eq":
      return norm(value) === norm(c.value);
    case "neq":
      return norm(value) !== norm(c.value);
    case "in":
    case "not_in": {
      const list = text(c.value).split(",").map(norm).filter(Boolean);
      return c.op === "in" ? list.includes(norm(value)) : !list.includes(norm(value));
    }
    case "contains":
      return norm(value).includes(norm(c.value));
    case "empty":
      return isEmpty;
    case "not_empty":
      return !isEmpty;
  }
  // Operadores de fecha
  if (isEmpty) return !!c.orEmpty;
  const day = limaDay(text(value));
  if (!day) return false;
  switch (c.op) {
    case "today":
      return day === today;
    case "from_today":
      return day >= today;
    case "before_today":
      return day < today;
    case "this_month":
      return day.slice(0, 7) === today.slice(0, 7);
    case "last_days": {
      const from = new Date(Date.parse(`${today}T00:00:00Z`) - ((c.days ?? 7) - 1) * 86_400_000).toISOString().slice(0, 10);
      return day >= from && day <= today;
    }
  }
  return false;
}

export const matches = (row: Row, c: Condition) => c.fields.some((f) => matchOne(row[f], c));

function applyTransforms(rows: Row[], transforms: string[]) {
  for (const r of rows) {
    const sameDay = !!r.updated_at && !!r.sale_date && limaDay(text(r.updated_at)) === limaDay(text(r.sale_date));
    if (transforms.includes("management_month_times")) {
      const hasContra = managementCategory(r.contraoferta_estado) !== "none";
      const hasFide = managementCategory(r.fidelizacion_estado) !== "none";
      const time = limaTime(text(r.updated_at));
      // updated_at es la última gestión: si hubo las dos, la contraoferta se hizo antes ese mismo día
      r._gestion_contra = sameDay && hasContra ? (hasFide ? "✓" : time) : "PTE";
      r._gestion_fide = sameDay && hasFide ? time : "PTE";
      if (!sameDay || !hasContra) r.contraoferta_estado = "Sin seguimiento";
      if (!sameDay || !hasFide) r.fidelizacion_estado = "Sin seguimiento";
    } else if (transforms.includes("management_same_day") && !sameDay) {
      r.contraoferta_estado = "Sin seguimiento";
      r.fidelizacion_estado = "Sin seguimiento";
    }
  }
}

function compare(a: unknown, b: unknown) {
  const ta = text(a);
  const tb = text(b);
  const da = Date.parse(ta);
  const db = Date.parse(tb);
  if (!Number.isNaN(da) && !Number.isNaN(db) && /\d{4}-\d{2}-\d{2}/.test(ta)) return da - db;
  if (!ta) return -1;
  if (!tb) return 1;
  return ta.localeCompare(tb, "es", { numeric: true });
}

export function runDefinition(def: Definition, sales: Sale[], subtitle: string): ReportData {
  let rows: Row[] = sales.filter((s) => def.filters.every((c) => matches(s, c))).map((s) => ({ ...s }));
  applyTransforms(rows, def.transforms);
  if (def.sort) {
    const { field, dir } = def.sort;
    rows = rows.sort((a, b) => compare(a[field], b[field]) * (dir === "asc" ? 1 : -1));
  }

  const groupsMap = new Map<string, Row[]>();
  for (const r of rows) {
    const key = def.groupBy ? text(r[def.groupBy]).trim() || def.emptyGroupLabel : "";
    groupsMap.set(key, [...(groupsMap.get(key) ?? []), r]);
  }
  const groups = [...groupsMap.entries()].map(([label, groupRows]) => ({
    label,
    rows: groupRows,
    stats: def.groupStats.map((s) => ({ label: s.label, value: groupRows.filter((r) => managementCategory(r[s.field]) !== "none").length })),
  }));

  const metrics = def.metrics.map((m) => {
    let value = rows.length;
    if (m.kind === "groups") value = def.groupBy ? groups.length : 0;
    if (m.kind === "where" && m.condition) value = rows.filter((r) => matches(r, m.condition!)).length;
    if (m.kind === "management" && m.field) value = rows.filter((r) => managementCategory(r[m.field!]) === (m.category ?? "ok")).length;
    return { label: m.label, value, section: m.section || undefined, tone: m.tone };
  });

  return {
    title: def.title,
    subtitle,
    generatedAt: new Date(),
    columns: def.columns,
    metrics,
    groupLabel: def.groupBy,
    groups,
    records: rows.length,
  };
}

/** Valor de una celda ya formateado como texto (Excel y vista simple) */
export function cellText(row: Row, col: Column): string {
  const v = row[col.field];
  const t = text(v);
  if (!t) return col.format === "management" ? "Sin seguimiento" : "-";
  switch (col.format) {
    case "date":
    case "date_accent": {
      const d = limaDay(t);
      if (!d) return t;
      const [y, m, day] = d.split("-");
      return `${day}/${m}/${y}`;
    }
    case "time":
      return limaTime(t);
    case "datetime": {
      if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t.split("-").reverse().join("/");
      const d = limaDay(t);
      return d ? `${d.split("-").reverse().join("/")} ${limaTime(t)}` : t;
    }
    default:
      return t;
  }
}
