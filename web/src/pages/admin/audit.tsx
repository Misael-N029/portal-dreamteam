import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { api, qs } from "@/lib/api";
import { useDocumentTitle } from "@/providers/branding";
import type { AuditEntry } from "@/lib/types";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page";
import { Input, NativeSelect } from "@/components/ui/form";
import { Badge } from "@/components/ui/misc";
import { formatDateTime } from "@/lib/utils";

/** Texto legible de cada acción registrada */
export const ACTION_LABEL: Record<string, string> = {
  "auth.login": "Inició sesión",
  "auth.logout": "Cerró sesión",
  "auth.password_changed": "Cambió su contraseña",
  "user.locked": "Usuario bloqueado por intentos fallidos",
  "user.unlocked": "Desbloqueó un usuario",
  "user.created": "Creó un usuario",
  "user.bulk_created": "Importó usuarios",
  "user.updated": "Editó un usuario",
  "user.password_reset": "Asignó nueva contraseña",
  "user.password_viewed": "Vio la contraseña asignada",
  "user.activated": "Activó un usuario",
  "user.deactivated": "Desactivó un usuario",
  "user.deleted": "Eliminó un usuario",
  "role.created": "Creó un rol",
  "role.updated": "Editó un rol",
  "role.deleted": "Eliminó un rol",
  "module.created": "Creó un módulo",
  "module.updated": "Editó un módulo",
  "module.activated": "Activó un módulo",
  "module.deactivated": "Desactivó un módulo",
  "module.reordered": "Reordenó los módulos",
  "module.deleted": "Eliminó un módulo",
  "announcement.created": "Publicó un comunicado",
  "announcement.updated": "Editó un comunicado",
  "announcement.deleted": "Eliminó un comunicado",
  "settings.updated": "Cambió la configuración",
  "report.created": "Creó un reporte",
  "report.updated": "Editó un reporte",
  "report.deleted": "Eliminó un reporte",
  "report.activated": "Activó un reporte",
  "report.deactivated": "Pausó un reporte",
  "report.sent": "Envió un reporte a mano",
  "report.test_sent": "Envió un reporte de prueba",
  "recipient.created": "Creó un destinatario",
  "recipient.updated": "Editó un destinatario",
  "recipient.deleted": "Eliminó un destinatario",
  "reports.scheduler_on": "Reanudó los envíos programados",
  "reports.scheduler_off": "Pausó los envíos programados",
  "reports.integrations_updated": "Cambió las conexiones de reportes",
  "reports.test_email": "Envió un correo de prueba",
  "reports.whatsapp_reset": "Reinició la sesión de WhatsApp",
  "job.created": "Publicó una vacante",
  "job.updated": "Editó una vacante",
  "job.deleted": "Eliminó una vacante",
  "application.status": "Cambió el estado de una postulación",
  "application.deleted": "Eliminó una postulación",
  "application.cv_downloaded": "Descargó un CV",
  "application.exported": "Exportó las postulaciones",
};

const ENTITIES: Record<string, string> = {
  user: "Usuarios y accesos",
  role: "Roles",
  module: "Módulos",
  announcement: "Comunicados",
  settings: "Configuración",
  report: "Centro de Reportes",
  recruitment: "Postulaciones",
};

const tone = (action: string) =>
  action.endsWith("deleted") || action === "user.locked" || action === "user.password_viewed"
    ? "danger"
    : action.startsWith("auth.")
      ? "default"
      : "outline";

export function AuditPage() {
  useDocumentTitle("Auditoría");
  const [entity, setEntity] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "audit", entity, from, to],
    queryFn: () => api.get<AuditEntry[]>(`/admin/audit${qs({ entity, from, to })}`),
  });

  const columns: ColumnDef<AuditEntry>[] = [
    {
      accessorKey: "at",
      header: "Fecha",
      sortingFn: "datetime",
      cell: ({ getValue }) => <span className="text-13 whitespace-nowrap tabular-nums">{formatDateTime(getValue() as string)}</span>,
    },
    { accessorKey: "actorName", header: "Quién", cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span> },
    {
      accessorKey: "action",
      header: "Acción",
      cell: ({ getValue }) => {
        const a = getValue() as string;
        return <Badge variant={tone(a)}>{ACTION_LABEL[a] ?? a}</Badge>;
      },
    },
    { accessorKey: "detail", header: "Detalle", cell: ({ getValue }) => <span className="text-13 text-muted-foreground">{(getValue() as string) ?? "—"}</span> },
    { accessorKey: "ip", header: "IP", cell: ({ getValue }) => <span className="font-mono text-xs text-muted-foreground">{(getValue() as string) ?? "—"}</span> },
  ];

  return (
    <>
      <PageHeader title="Auditoría" description="Accesos y cambios de administración. Se muestran los 1000 registros más recientes del filtro." />
      <DataTable
        columns={columns}
        data={data}
        loading={isLoading}
        pageSize={25}
        searchPlaceholder="Persona, acción, detalle o IP…"
        toolbar={
          <>
            <NativeSelect value={entity} onChange={(e) => setEntity(e.target.value)} className="w-auto" aria-label="Tipo">
              <option value="">Todo</option>
              {Object.entries(ENTITIES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" aria-label="Desde" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" aria-label="Hasta" />
          </>
        }
      />
    </>
  );
}
