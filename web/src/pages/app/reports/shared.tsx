import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleDashed, CircleSlash, Loader2, TriangleAlert, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/auth";
import { Badge } from "@/components/ui/misc";

// ── Tipos del Centro de Reportes ──

export type Condition = { fields: string[]; op: string; value?: string; days?: number; orEmpty?: boolean };
export type Column = { field: string; label: string; format: string };
export type Metric = {
  label: string;
  kind: "count" | "groups" | "where" | "management";
  condition?: Condition;
  field?: string;
  category?: "ok" | "pending" | "none";
  section?: string;
  tone: "default" | "good" | "warn" | "muted" | "brand";
};
export type Definition = {
  campaignId: number | null;
  title: string;
  filters: Condition[];
  transforms: string[];
  sort: { field: string; dir: "asc" | "desc" } | null;
  groupBy: string | null;
  emptyGroupLabel: string;
  groupStats: { label: string; field: string }[];
  columns: Column[];
  metrics: Metric[];
  output: { email: boolean; image: boolean; excel: "none" | "per_group" | "single" };
};

export type Target = {
  url: string;
  loginUrl?: string | null;
  username?: string | null;
  password?: string;
  hasPassword?: boolean;
  usernameSelector?: string | null;
  passwordSelector?: string | null;
  submitSelector?: string | null;
};

export type Report = {
  id: string;
  name: string;
  description: string | null;
  kind: "CRM" | "SCREENSHOT";
  template: string | null;
  config: Definition;
  active: boolean;
  times: string;
  daysOfWeek: number[];
  retryCount: number;
  subtitle: string | null;
  caption: string | null;
  emailSubject: string | null;
  skipIfEmpty: boolean;
  targets: Target[];
  recipientIds: string[];
  lastRunAt: string | null;
  nextRunAt: string | null;
};

export type RecipientKind = "EMAIL" | "WHATSAPP" | "WHATSAPP_GROUP";
export type Recipient = {
  id: string;
  name: string;
  description: string | null;
  kind: RecipientKind;
  value: string;
  active: boolean;
  windowStart: string | null;
  windowEnd: string | null;
  lastDeliveryAt: string | null;
  reportIds: string[];
};

export type RunStatus = "QUEUED" | "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED" | "SKIPPED";
export type RunType = "AUTOMATIC" | "MANUAL" | "TEST" | "PREVIEW";
export type RunSummary = {
  id: string;
  type: RunType;
  status: RunStatus;
  attempt: number;
  records: number | null;
  images: number;
  attachment: string | null;
  sentTo: string[];
  errorMessage: string | null;
  requestedBy: string | null;
  createdAt: string;
  durationMs: number | null;
  report: { id: string; name: string; kind: string };
};
export type RunLog = { id: string; at: string; level: "INFO" | "SUCCESS" | "WARNING" | "ERROR"; step: string; message: string };
export type RunDetail = RunSummary & { html: string | null; imageFiles: string[]; logs: RunLog[] };

export type Preset = { key: string; name: string; description: string; times: string; emailSubject: string; definition: Definition };
export type Meta = {
  ops: { key: string; label: string; needsValue: boolean; date: boolean }[];
  formats: { key: string; label: string }[];
  transforms: { key: string; label: string; description: string }[];
  presets: Preset[];
  blank: Definition;
  knownFields: Record<string, string>;
};

export function useReportsMeta() {
  return useQuery({ queryKey: ["reports", "meta"], queryFn: () => api.get<Meta>("/reports/meta"), staleTime: Infinity });
}

export const useCanManageReports = () => useAuth().can("reports.manage");

export const RUN_TYPE_LABEL: Record<RunType, string> = { AUTOMATIC: "Programado", MANUAL: "Manual", TEST: "Prueba", PREVIEW: "Vista previa" };

const STATUS: Record<RunStatus, { label: string; variant: "default" | "success" | "warning" | "danger" | "outline" | "brand"; icon: typeof CheckCircle2 }> = {
  QUEUED: { label: "En cola", variant: "outline", icon: CircleDashed },
  RUNNING: { label: "Ejecutando", variant: "brand", icon: Loader2 },
  SUCCESS: { label: "Enviado", variant: "success", icon: CheckCircle2 },
  PARTIAL: { label: "Parcial", variant: "warning", icon: TriangleAlert },
  FAILED: { label: "Falló", variant: "danger", icon: XCircle },
  SKIPPED: { label: "Sin registros", variant: "default", icon: CircleSlash },
};

export function RunStatusBadge({ status, preview }: { status: RunStatus; preview?: boolean }) {
  const s = STATUS[status];
  return (
    <Badge variant={s.variant}>
      <s.icon className={status === "RUNNING" ? "animate-spin" : undefined} />
      {preview && status === "SUCCESS" ? "Lista" : s.label}
    </Badge>
  );
}

export const RECIPIENT_KIND_LABEL: Record<RecipientKind, string> = { EMAIL: "Correo", WHATSAPP: "WhatsApp", WHATSAPP_GROUP: "Grupo de WhatsApp" };

export const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

/** "Lun a Vie · 08:00, 18:30" */
export function scheduleText(times: string, days: number[]) {
  const d = [...days].sort();
  let daysText = d.length === 7 ? "Todos los días" : d.map((x) => DAYS[x]).join(", ");
  if (d.join() === "1,2,3,4,5") daysText = "Lun a Vie";
  if (d.join() === "1,2,3,4,5,6") daysText = "Lun a Sáb";
  return `${daysText} · ${times.split(",").join(", ")}`;
}

const limaFmt = new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
export const formatLima = (d: string | null) => (d ? limaFmt.format(new Date(d)) : "—");

export const formatDuration = (ms: number | null) => (ms == null ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
