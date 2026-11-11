import { useQuery } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2, CircleSlash, Cpu, FileText, MessageCircle, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import { Kpi } from "@/components/charts";
import { Switch } from "@/components/ui/form";
import { Card, CardHeader, CardTitle, Skeleton } from "@/components/ui/misc";
import { cn, timeAgo } from "@/lib/utils";
import { RunStatusBadge, formatLima, useCanManageReports, type RunStatus, type RunType } from "./shared";

type Overview = {
  sentToday: number;
  failedToday: number;
  skippedToday: number;
  activeReports: number;
  upcoming: { reportId: string; name: string; kind: string; at: string }[];
  recent: { id: string; type: RunType; status: RunStatus; createdAt: string; records: number | null; errorMessage: string | null; report: { name: string } }[];
  worker: { lastSeen: string | null; online: boolean };
  whatsapp: { state: string; at?: string; error?: string };
  schedulerEnabled: boolean;
};

const WA_LABEL: Record<string, string> = {
  connected: "Conectado",
  connecting: "Esperando escaneo del QR",
  disconnected: "Desconectado",
  not_configured: "Sin configurar",
  error: "Sin respuesta",
  unknown: "Sin datos aún",
};

function StatusRow({ icon: Icon, title, ok, detail, action }: { icon: typeof Cpu; title: string; ok: boolean; detail: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icon className="size-4" />
      </span>
      <div className="grid min-w-0 flex-1">
        <span className="flex items-center gap-2 text-13 font-medium">
          <span className={cn("size-2 rounded-full", ok ? "bg-success" : "bg-destructive")} />
          {title}
        </span>
        <span className="truncate text-xs text-muted-foreground">{detail}</span>
      </div>
      {action}
    </div>
  );
}

export function OverviewTab({ onOpenRun }: { onOpenRun: (id: string) => void }) {
  const manage = useCanManageReports();
  const { run } = useAction();
  const { data } = useQuery({ queryKey: ["reports", "overview"], queryFn: () => api.get<Overview>("/reports/overview"), refetchInterval: 15_000 });

  if (!data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Enviados hoy" value={data.sentToday} icon={CheckCircle2} />
        <Kpi label="Fallidos hoy" value={data.failedToday} icon={XCircle} />
        <Kpi label="Omitidos por no tener datos" value={data.skippedToday} icon={CircleSlash} />
        <Kpi label="Reportes activos" value={data.activeReports} icon={FileText} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle>Estado del servicio</CardTitle>
          </CardHeader>
          <div className="divide-y px-5 pb-2">
            <StatusRow
              icon={Cpu}
              title="Worker de reportes"
              ok={data.worker.online}
              detail={data.worker.online ? `Activo · último latido ${timeAgo(data.worker.lastSeen)}` : data.worker.lastSeen ? `Sin respuesta desde ${timeAgo(data.worker.lastSeen).toLowerCase()}` : "No se ha iniciado nunca (servicio portal-worker)"}
            />
            <StatusRow
              icon={CalendarClock}
              title="Envíos programados"
              ok={data.schedulerEnabled}
              detail={data.schedulerEnabled ? "Se envían en sus horarios" : "En pausa: solo se envía a mano"}
              action={
                manage && (
                  <Switch
                    checked={data.schedulerEnabled}
                    onCheckedChange={(enabled) =>
                      run(() => api.post("/reports/scheduler", { enabled }), { success: enabled ? "Envíos programados reanudados" : "Envíos programados en pausa", invalidate: [["reports", "overview"]] })
                    }
                    aria-label="Envíos programados"
                  />
                )
              }
            />
            <StatusRow
              icon={MessageCircle}
              title="WhatsApp"
              ok={data.whatsapp.state === "connected"}
              detail={`${WA_LABEL[data.whatsapp.state] ?? data.whatsapp.state}${data.whatsapp.at ? ` · revisado ${timeAgo(data.whatsapp.at).toLowerCase()}` : ""}`}
            />
          </div>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle>Próximos envíos</CardTitle>
          </CardHeader>
          <ul className="divide-y px-5 pb-2">
            {data.upcoming.map((u) => (
              <li key={`${u.reportId}-${u.at}`} className="flex items-center justify-between gap-3 py-2.5 text-13">
                <span className="font-medium">{u.name}</span>
                <span className="text-muted-foreground tabular-nums first-letter:uppercase">{formatLima(u.at)}</span>
              </li>
            ))}
            {!data.upcoming.length && <li className="py-8 text-center text-13 text-muted-foreground">No hay reportes activos con horario.</li>}
          </ul>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-1">
          <CardTitle>Últimos envíos</CardTitle>
        </CardHeader>
        <ul className="divide-y px-5 pb-2">
          {data.recent.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => onOpenRun(r.id)} className="flex w-full items-center gap-3 py-2.5 text-left text-13 hover:bg-surface/60">
                <RunStatusBadge status={r.status} />
                <span className="font-medium">{r.report.name}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{r.errorMessage ?? (r.records != null ? `${r.records} registros` : "")}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(r.createdAt)}</span>
              </button>
            </li>
          ))}
          {!data.recent.length && <li className="py-8 text-center text-13 text-muted-foreground">Todavía no se envió ningún reporte.</li>}
        </ul>
      </Card>
    </div>
  );
}
