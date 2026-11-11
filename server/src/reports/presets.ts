import type { Definition } from "./definition.js";

/**
 * Plantillas de partida: los reportes que ya funcionaban en el Apps Script y en el Report Center.
 * Al crear un reporte se copia la definición y desde ahí se edita libremente.
 */

const SALES_COLUMNS: Definition["columns"] = [
  { field: "cliente_nombre_del_cliente", label: "Cliente", format: "strong" },
  { field: "cliente_nro_de_documento", label: "DNI/NIE", format: "mono" },
  { field: "cliente_provincia", label: "Provincia", format: "text" },
  { field: "producto_compania", label: "Compañía", format: "text" },
  { field: "cabecera_f_instalacion", label: "Fecha instalación", format: "date_accent" },
  { field: "agent", label: "Asesor", format: "text" },
];

const BO_COLUMNS: Definition["columns"] = [
  { field: "agent", label: "Asesor", format: "strong" },
  { field: "cliente_nombre_del_cliente", label: "Cliente", format: "text" },
  { field: "cliente_nro_de_documento", label: "DNI/NIE", format: "mono" },
  { field: "status", label: "Estado", format: "status" },
  { field: "contraoferta_estado", label: "Contraoferta", format: "management" },
  { field: "contraoferta_bo", label: "BO contra", format: "text" },
  { field: "fidelizacion_estado", label: "Fidelización", format: "management" },
  { field: "fidelizacion_bo", label: "BO fide", format: "text" },
];

const BO_METRICS = (totalLabel: string): Definition["metrics"] => [
  { label: totalLabel, kind: "count", tone: "brand" },
  ...(["contraoferta_estado", "fidelizacion_estado"] as const).flatMap((field) => {
    const section = field === "contraoferta_estado" ? "Contraofertas" : "Fidelizaciones";
    return [
      { label: "Gestionado OK", kind: "management" as const, field, category: "ok" as const, section, tone: "good" as const },
      { label: "Pendientes", kind: "management" as const, field, category: "pending" as const, section, tone: "warn" as const },
      { label: "Sin seguimiento", kind: "management" as const, field, category: "none" as const, section, tone: "muted" as const },
    ];
  }),
];

const BO_GROUP_STATS = [
  { label: "Contraoferta", field: "contraoferta_estado" },
  { label: "Fidelización", field: "fidelizacion_estado" },
];

const statusToday = (status: string, title: string, metric: string, sortField: string): Definition => ({
  campaignId: 4,
  title,
  filters: [
    { fields: ["status"], op: "eq", value: status },
    { fields: ["updated_at", "sale_date"], op: "today" },
  ],
  transforms: [],
  sort: { field: sortField, dir: "asc" },
  groupBy: "supervisor",
  emptyGroupLabel: "Sin supervisor",
  groupStats: [],
  columns: SALES_COLUMNS,
  metrics: [
    { label: metric, kind: "count", tone: "brand" },
    { label: "Supervisores", kind: "groups", tone: "default" },
  ],
  output: { email: true, image: true, excel: "per_group" },
});

export type Preset = {
  key: string;
  name: string;
  description: string;
  times: string;
  emailSubject: string;
  definition: Definition;
};

export const PRESETS: Preset[] = [
  {
    key: "pdt_instalar",
    name: "PDT de instalar",
    description: "Ventas en PDT DE INSTALAR con instalación de hoy en adelante, por supervisor, con Excel adjunto.",
    times: "08:00",
    emailSubject: "📦 PDT de Instalar — {subtitulo} — {fecha} ({total} registros)",
    definition: {
      campaignId: 4,
      title: "PDT de instalar",
      filters: [
        { fields: ["status"], op: "eq", value: "PDT DE INSTALAR" },
        { fields: ["cabecera_f_instalacion"], op: "from_today", orEmpty: true },
      ],
      transforms: [],
      sort: { field: "cabecera_f_instalacion", dir: "asc" },
      groupBy: "supervisor",
      emptyGroupLabel: "Sin supervisor",
      groupStats: [],
      columns: SALES_COLUMNS,
      metrics: [
        { label: "Total pendientes", kind: "count", tone: "brand" },
        { label: "Supervisores activos", kind: "groups", tone: "default" },
      ],
      output: { email: true, image: true, excel: "per_group" },
    },
  },
  {
    key: "seguimiento_bo",
    name: "Seguimiento BO",
    description: "Ventas del día con su contraoferta y fidelización (solo cuentan las gestiones del mismo día).",
    times: "18:00",
    emailSubject: "🔍 Seguimiento BO — {subtitulo} — {fecha} ({total} ventas)",
    definition: {
      campaignId: 4,
      title: "Seguimiento BO",
      filters: [{ fields: ["sale_date"], op: "today" }],
      transforms: ["management_same_day"],
      sort: { field: "sale_date", dir: "asc" },
      groupBy: "supervisor",
      emptyGroupLabel: "Sin supervisor",
      groupStats: BO_GROUP_STATS,
      columns: [{ field: "sale_date", label: "Hora", format: "time" }, ...BO_COLUMNS],
      metrics: BO_METRICS("Ventas del día"),
      output: { email: true, image: true, excel: "none" },
    },
  },
  {
    key: "instaladas_hoy",
    name: "Instaladas hoy",
    description: "Ventas que pasaron a INSTALADO hoy.",
    times: "18:30",
    emailSubject: "✅ Instaladas hoy — {subtitulo} — {fecha} ({total} registros)",
    definition: statusToday("INSTALADO", "Instaladas hoy", "Total instaladas", "updated_at"),
  },
  {
    key: "canceladas_hoy",
    name: "Canceladas hoy",
    description: "Bajas y cancelaciones registradas hoy.",
    times: "19:00",
    emailSubject: "❌ Canceladas hoy — {subtitulo} — {fecha} ({total} registros)",
    definition: statusToday("CANCELADO", "Canceladas hoy", "Total canceladas", "updated_at"),
  },
  {
    key: "proceso_hoy",
    name: "En proceso hoy",
    description: "Ventas del día que siguen EN PROCESO.",
    times: "21:00",
    emailSubject: "⏳ En proceso hoy — {subtitulo} — {fecha} ({total} registros)",
    definition: statusToday("EN PROCESO", "En proceso hoy", "Total en proceso", "sale_date"),
  },
  {
    key: "ventas_mes_bo",
    name: "Ventas del mes BO",
    description: "Consolidado mensual de contraofertas y fidelizaciones en un Excel de una hoja.",
    times: "20:00",
    emailSubject: "📊 Ventas del mes BO — {subtitulo} — {fecha} ({total} ventas)",
    definition: {
      campaignId: 4,
      title: "Ventas del mes BO",
      filters: [{ fields: ["sale_date"], op: "this_month" }],
      transforms: ["management_month_times"],
      sort: { field: "sale_date", dir: "asc" },
      groupBy: "supervisor",
      emptyGroupLabel: "Sin supervisor",
      groupStats: BO_GROUP_STATS,
      columns: [
        { field: "_gestion_contra", label: "Gestión contra", format: "check" },
        { field: "_gestion_fide", label: "Gestión fide", format: "check" },
        ...BO_COLUMNS,
        { field: "sale_date", label: "Fecha venta", format: "date" },
      ],
      metrics: BO_METRICS("Ventas del mes"),
      output: { email: true, image: false, excel: "single" },
    },
  },
];

/** Definición en blanco para "Nuevo reporte desde cero" */
export const BLANK_DEFINITION: Definition = {
  campaignId: 4,
  title: "Nuevo reporte",
  filters: [],
  transforms: [],
  sort: null,
  groupBy: "supervisor",
  emptyGroupLabel: "Sin supervisor",
  groupStats: [],
  columns: [
    { field: "cliente_nombre_del_cliente", label: "Cliente", format: "strong" },
    { field: "status", label: "Estado", format: "status" },
    { field: "agent", label: "Asesor", format: "text" },
  ],
  metrics: [{ label: "Total", kind: "count", tone: "brand" }],
  output: { email: true, image: true, excel: "none" },
};

/** Campos conocidos del export de ventas del CRM, con su nombre en español para el editor */
export const KNOWN_FIELDS: Record<string, string> = {
  status: "Estado de la venta",
  sale_date: "Fecha de venta",
  updated_at: "Última actualización",
  cabecera_f_instalacion: "Fecha de instalación",
  supervisor: "Supervisor",
  agent: "Asesor",
  cliente_nombre_del_cliente: "Nombre del cliente",
  cliente_nro_de_documento: "Documento del cliente",
  cliente_provincia: "Provincia",
  producto_compania: "Compañía",
  contraoferta_estado: "Estado de contraoferta",
  contraoferta_bo: "BO de contraoferta",
  fidelizacion_estado: "Estado de fidelización",
  fidelizacion_bo: "BO de fidelización",
  _gestion_contra: "Hora de gestión de contraoferta (calculada)",
  _gestion_fide: "Hora de gestión de fidelización (calculada)",
};
