import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Camera, Copy, Eye, FileText, Pencil, Plus, Power, Send, SendHorizonal, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import { DataTable, RowActions } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Field, NativeSelect } from "@/components/ui/form";
import { Badge } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogHeader, DropdownMenuItem, DropdownMenuSeparator, useConfirm } from "@/components/ui/overlay";
import { cn, timeAgo } from "@/lib/utils";
import { ReportEditor, type EditorTarget } from "./report-editor";
import { RECIPIENT_KIND_LABEL, formatLima, scheduleText, useCanManageReports, useReportsMeta, type Recipient, type Report } from "./shared";

const invalidate = [["reports", "list"], ["reports", "overview"]];

/** Selector de plantilla al crear un reporte */
function TemplatePicker({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (t: EditorTarget) => void }) {
  const { data: meta } = useReportsMeta();
  if (!meta) return null;
  const base = {
    description: null,
    active: false,
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    retryCount: 2,
    subtitle: "Telefonía Izaguirre",
    caption: null,
    skipIfEmpty: true,
    targets: [],
    recipientIds: [],
  };
  const options = [
    ...meta.presets.map((p) => ({
      key: p.key,
      name: p.name,
      description: p.description,
      icon: FileText,
      draft: { ...base, name: p.name, kind: "CRM" as const, template: p.key, config: p.definition, times: p.times, emailSubject: p.emailSubject },
    })),
    {
      key: "blank",
      name: "En blanco",
      description: "Empieza con tres columnas y arma tus propios filtros e indicadores.",
      icon: Plus,
      draft: { ...base, name: "Nuevo reporte", kind: "CRM" as const, template: null, config: meta.blank, times: "08:00", emailSubject: "{reporte} — {subtitulo} — {fecha} ({total} registros)" },
    },
    {
      key: "screenshot",
      name: "Captura de pantalla",
      description: "Entra a una web (por ejemplo una vista del CRM) y envía la captura.",
      icon: Camera,
      draft: {
        ...base,
        name: "Captura del CRM",
        subtitle: null,
        kind: "SCREENSHOT" as const,
        template: "screenshot",
        config: meta.blank,
        times: "08:00",
        emailSubject: "📸 {reporte} — {fecha}",
        skipIfEmpty: false,
        targets: [{ url: "", loginUrl: "", username: "", password: "" }],
      },
    },
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader title="Nuevo reporte" description="Elige una plantilla para empezar. Todo se puede cambiar después." />
        <div className="grid max-h-[60vh] gap-2 overflow-y-auto sm:grid-cols-2">
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => {
                onOpenChange(false);
                onPick({ mode: "new", draft: structuredClone(o.draft) });
              }}
              className="flex items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:border-foreground/20 hover:bg-accent"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                <o.icon className="size-4" />
              </span>
              <span className="grid gap-0.5">
                <span className="text-13 font-semibold">{o.name}</span>
                <span className="text-xs text-muted-foreground">{o.description}</span>
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TestDialog({ report, onClose, onStarted }: { report: Report | null; onClose: () => void; onStarted: (id: string) => void }) {
  const { data: recipients } = useQuery({ queryKey: ["reports", "recipients"], queryFn: () => api.get<Recipient[]>("/reports/recipients"), enabled: !!report });
  const [recipientId, setRecipientId] = React.useState("");
  const { run, pending } = useAction();
  return (
    <Dialog open={!!report} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader title="Enviar prueba" description={`Se envía “${report?.name}” solo a la persona que elijas, marcado como prueba.`} />
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await run(() => api.post<{ id: string }>(`/reports/reports/${report!.id}/run`, { type: "TEST", recipientId }));
            if (res) {
              onClose();
              onStarted(res.id);
            }
          }}
        >
          <Field label="Destinatario">
            <NativeSelect value={recipientId} onChange={(e) => setRecipientId(e.target.value)} required>
              <option value="">Elige…</option>
              {recipients?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} — {RECIPIENT_KIND_LABEL[r.kind]} ({r.value})
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              <SendHorizonal /> Enviar prueba
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ReportsTab({ onOpenRun }: { onOpenRun: (id: string) => void }) {
  const manage = useCanManageReports();
  const { data, isLoading } = useQuery({ queryKey: ["reports", "list"], queryFn: () => api.get<Report[]>("/reports/reports") });
  const { data: recipients } = useQuery({ queryKey: ["reports", "recipients"], queryFn: () => api.get<Recipient[]>("/reports/recipients") });
  const { run } = useAction();
  const confirm = useConfirm();
  const [editing, setEditing] = React.useState<EditorTarget | null>(null);
  const [picking, setPicking] = React.useState(false);
  const [testing, setTesting] = React.useState<Report | null>(null);

  const start = async (r: Report, type: "MANUAL" | "PREVIEW") => {
    if (type === "MANUAL") {
      const n = r.recipientIds.length;
      const ok = await confirm({
        title: `¿Enviar “${r.name}” ahora?`,
        description: `Se enviará a ${n} destinatario${n === 1 ? "" : "s"} con los datos de este momento.`,
        confirmText: "Enviar ahora",
      });
      if (!ok) return;
    }
    const res = await run(() => api.post<{ id: string }>(`/reports/reports/${r.id}/run`, { type }));
    if (res) onOpenRun(res.id);
  };

  const columns: ColumnDef<Report>[] = [
    {
      accessorKey: "name",
      header: "Reporte",
      cell: ({ row: { original: r } }) => (
        <div className="grid min-w-0 gap-0.5">
          <span className="flex items-center gap-2 font-medium">
            {r.kind === "SCREENSHOT" && <Camera className="size-3.5 text-muted-foreground" />}
            {r.name}
          </span>
          <span className="truncate text-xs text-muted-foreground">{r.subtitle || r.description || (r.kind === "SCREENSHOT" ? "Captura de pantalla" : "Ventas del CRM")}</span>
        </div>
      ),
    },
    {
      id: "schedule",
      header: "Horario",
      enableSorting: false,
      cell: ({ row: { original: r } }) => <span className="text-13 tabular-nums">{scheduleText(r.times, r.daysOfWeek)}</span>,
    },
    {
      id: "output",
      header: "Sale por",
      enableSorting: false,
      cell: ({ row: { original: r } }) => {
        const list = (recipients ?? []).filter((x) => r.recipientIds.includes(x.id));
        const emails = list.filter((x) => x.kind === "EMAIL").length;
        const wa = list.length - emails;
        return (
          <div className="flex flex-wrap gap-1">
            {emails > 0 && <Badge variant="outline">{emails} correo{emails === 1 ? "" : "s"}</Badge>}
            {wa > 0 && <Badge variant="outline">{wa} WhatsApp</Badge>}
            {r.kind === "CRM" && r.config.output?.excel !== "none" && <Badge variant="outline">Excel</Badge>}
            {!list.length && <span className="text-xs text-warning">Sin destinatarios</span>}
          </div>
        );
      },
    },
    {
      accessorKey: "nextRunAt",
      header: "Próximo envío",
      cell: ({ row: { original: r } }) => (
        <div className="grid text-13">
          <span className="tabular-nums">{r.active ? formatLima(r.nextRunAt) : "—"}</span>
          <span className="text-xs text-muted-foreground">Último: {timeAgo(r.lastRunAt)}</span>
        </div>
      ),
    },
    {
      accessorKey: "active",
      header: "Estado",
      cell: ({ getValue }) => (getValue() ? <Badge variant="success" dot>Activo</Badge> : <Badge dot>Pausado</Badge>),
    },
    {
      id: "actions",
      header: "",
      meta: { className: "w-12" },
      cell: ({ row: { original: r } }) => (
        <RowActions>
          <DropdownMenuItem onSelect={() => start(r, "PREVIEW")}>
            <Eye /> Vista previa
          </DropdownMenuItem>
          {manage && (
            <>
              <DropdownMenuItem onSelect={() => start(r, "MANUAL")}>
                <Send /> Enviar ahora
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setTesting(r)}>
                <SendHorizonal /> Enviar prueba
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setEditing({ mode: "edit", report: r })}>
                <Pencil /> Editar
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => run(() => api.post(`/reports/reports/${r.id}/duplicate`), { success: "Reporte duplicado (queda pausado)", invalidate })}>
                <Copy /> Duplicar
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => run(() => api.patch(`/reports/reports/${r.id}/active`, { active: !r.active }), { success: r.active ? "Reporte pausado" : "Reporte activado", invalidate })}>
                <Power /> {r.active ? "Pausar" : "Activar"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                destructive
                onSelect={async () => {
                  if (await confirm({ title: `¿Eliminar “${r.name}”?`, description: "Se borra también su historial de envíos.", confirmText: "Eliminar", destructive: true }))
                    run(() => api.del(`/reports/reports/${r.id}`), { success: "Reporte eliminado", invalidate });
                }}
              >
                <Trash2 /> Eliminar
              </DropdownMenuItem>
            </>
          )}
        </RowActions>
      ),
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        loading={isLoading}
        searchPlaceholder="Buscar reporte…"
        onRowClick={manage ? (r) => setEditing({ mode: "edit", report: r }) : undefined}
        toolbar={
          manage && (
            <Button className={cn("sm:ml-auto")} onClick={() => setPicking(true)}>
              <Plus /> Nuevo reporte
            </Button>
          )
        }
        empty="Aún no hay reportes. Crea el primero desde una plantilla."
      />
      <TemplatePicker open={picking} onOpenChange={setPicking} onPick={setEditing} />
      <ReportEditor target={editing} onClose={() => setEditing(null)} onPreview={onOpenRun} />
      <TestDialog report={testing} onClose={() => setTesting(null)} onStarted={onOpenRun} />
    </>
  );
}
