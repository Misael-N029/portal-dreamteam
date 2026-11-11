import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { LayoutGrid, LogIn, UserCheck, UserX } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/auth";
import { useDocumentTitle } from "@/providers/branding";
import type { Dashboard } from "@/lib/types";
import { ModuleIcon, moduleTint } from "@/lib/icons";
import { BarList, ChartCard, ColumnChart, Kpi, bucketKey } from "@/components/charts";
import { PageHeader } from "@/components/page";
import { Skeleton } from "@/components/ui/misc";
import { timeAgo } from "@/lib/utils";
import { ACTION_LABEL } from "./audit";

export function AdminDashboardPage() {
  useDocumentTitle("Dashboard");
  const { can } = useAuth();
  const { data } = useQuery({ queryKey: ["admin", "dashboard"], queryFn: () => api.get<Dashboard>("/admin/dashboard"), refetchInterval: 60_000 });

  if (!data) {
    return (
      <>
        <PageHeader title="Dashboard" description="Uso del portal" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      </>
    );
  }

  const days = data.perDay.map((d) => ({ key: bucketKey(new Date(d.date), "day"), people: d.people }));
  const maxTop = Math.max(1, ...data.topModules.map((m) => m.opens));

  return (
    <>
      <PageHeader title="Dashboard" description="Cómo se está usando el portal. Se actualiza cada minuto." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Personas que ingresaron hoy" value={data.peopleToday} hint={`${data.loginsToday} inicios de sesión`} icon={LogIn} />
        <Kpi label="Usuarios activos" value={data.activeUsers} hint={`de ${data.users} cuentas`} icon={UserCheck} />
        <Kpi label="Nunca ingresaron" value={data.neverLoggedIn} hint="Cuentas activas sin primer acceso" icon={UserX} />
        <Kpi label="Módulos activos" value={data.activeModules} hint={`de ${data.modules} configurados`} icon={LayoutGrid} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <ChartCard title="Personas que ingresaron por día" description="Últimos 14 días, hora de Lima">
          <ColumnChart data={days} series={[{ key: "people", label: "Personas", color: "var(--viz-ink)" }]} bucket="day" />
        </ChartCard>
        <ChartCard title="Módulos más usados" description="Aperturas en los últimos 30 días">
          {data.topModules.length ? (
            <ul className="grid gap-3">
              {data.topModules.map((m) => (
                <li key={m.id} className="grid grid-cols-[1.75rem_8rem_1fr_auto] items-center gap-3 text-13">
                  <span className="flex size-7 items-center justify-center rounded-md bg-muted" style={{ color: moduleTint(m.color) }}>
                    <ModuleIcon name={m.icon} className="size-3.5" />
                  </span>
                  <span className="truncate">{m.name}</span>
                  <span className="h-2.5 rounded-r" style={{ width: `${Math.max(2, (m.opens / maxTop) * 100)}%`, background: "var(--viz-ink)" }} />
                  <span className="font-medium tabular-nums">{m.opens}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-8 text-center text-13 text-muted-foreground">Aún no se abrió ningún módulo.</p>
          )}
        </ChartCard>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <ChartCard title="Usuarios por rol">
          <BarList rows={data.roles.filter((r) => r.users > 0).map((r) => ({ label: r.name, value: r.users, hint: "Usuarios" }))} />
        </ChartCard>
        <ChartCard
          title="Actividad reciente"
          action={
            can("audit.view") && (
              <Link to="/admin/auditoria" className="text-13 text-brand hover:underline">
                Ver auditoría
              </Link>
            )
          }
        >
          <ul className="grid divide-y">
            {data.recent.map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-2.5 text-13 first:pt-0 last:pb-0">
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{a.actorName}</span> <span className="text-muted-foreground">{(ACTION_LABEL[a.action] ?? a.action).toLowerCase()}</span>
                  {a.detail && <span className="text-muted-foreground"> · {a.detail}</span>}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{timeAgo(a.at)}</span>
              </li>
            ))}
          </ul>
        </ChartCard>
      </div>
    </>
  );
}
