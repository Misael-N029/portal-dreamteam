import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, HandHelping, MapPin, PackageOpen, Wrench, X } from "lucide-react";
import { api } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import type { MyEquipment, SupplyDelivery } from "@/lib/types";
import { EmptyState } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/form";
import { Badge, Card, Skeleton } from "@/components/ui/misc";
import { Dialog, DialogClose, DialogContent, DialogHeader } from "@/components/ui/overlay";
import { cn, timeAgo } from "@/lib/utils";
import { CategoryIcon, StatusBadge, invalidate, useInvAccess, useInvActions } from "./shared";
import { warrantyInfo } from "./equipment";

export function MyEquipmentTab() {
  const { can } = useInvAccess();
  const actions = useInvActions();
  const { run } = useAction();
  const [rejecting, setRejecting] = React.useState<SupplyDelivery | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["inventory", "mine"], queryFn: () => api.get<MyEquipment>("/inventory/mine") });

  if (isLoading || !data) return <Skeleton className="h-80" />;
  const pending = data.deliveries.filter((d) => d.status === "PENDING");
  const history = data.deliveries.filter((d) => d.status !== "PENDING");

  return (
    <div className="grid gap-6">
      {pending.length > 0 && (
        <Card className="grid gap-3 border-l-4 border-brand p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <HandHelping className="size-4 text-brand" /> Te entregaron insumos: confirma que los recibiste
          </h3>
          <ul className="grid gap-2">
            {pending.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 border bg-card px-4 py-3">
                <span className="font-semibold text-3xl tabular-nums">{d.quantity}</span>
                <div className="grid min-w-0 flex-1">
                  <span className="text-sm font-semibold">
                    {d.supply.unit} · {d.supply.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {d.deliveredByName} · {timeAgo(d.createdAt)}
                    {d.note && ` · ${d.note}`}
                  </span>
                </div>
                <Button size="sm" onClick={() => run(() => api.post(`/inventory/supplies/deliveries/${d.id}/confirm`, {}), { success: "¡Gracias! Entrega confirmada", invalidate })}>
                  <Check /> Lo recibí
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRejecting(d)}>
                  <X /> No lo recibí
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <section className="grid gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold">Mi puesto y mis equipos</h2>
          {data.stations.map((s) => (
            <Badge key={s.id} variant="solid">
              <MapPin /> Puesto {s.code} · {s.site.name}
              {s.zone && ` · ${s.zone.name}`}
            </Badge>
          ))}
        </div>
        {data.machines.length === 0 ? (
          <EmptyState icon={PackageOpen} title="No tienes equipos asignados" description="Cuando TI o tu supervisor te asigne un puesto o un equipo, aparecerá aquí." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.machines.map((m) => {
              const w = warrantyInfo(m.warrantyUntil);
              const hasIssue = data.incidents.some((i) => i.machineId === m.id && (i.status === "OPEN" || i.status === "IN_PROGRESS"));
              return (
                <Card key={m.id} className={cn("grid gap-3 p-5 transition-all hover:-translate-y-0.5 hover:shadow-md", hasIssue && "shadow-[inset_0_0_0_1px_var(--brand)]")}>
                  <div className="flex items-start gap-3 pl-2">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <CategoryIcon name={m.category?.icon} className="size-5" style={{ color: m.category?.color }} />
                    </span>
                    <div className="grid min-w-0 flex-1 gap-0.5">
                      <span className="text-sm font-semibold">{m.category?.name ?? m.type}</span>
                      <span className="truncate text-13 text-muted-foreground">{[m.brand, m.model].filter(Boolean).join(" ") || "—"}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{m.assetTag}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <StatusBadge status={m.status} />
                    {hasIssue && <Badge variant="danger">Falla reportada</Badge>}
                    {w && w.variant === "warning" && <Badge variant="warning">{w.label}</Badge>}
                  </div>
                  {can("incident") && (
                    <Button size="sm" variant="outline" onClick={() => actions.reportIssue(m)} disabled={hasIssue}>
                      <Wrench /> {hasIssue ? "Ya reportaste una falla" : "Reportar una falla"}
                    </Button>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {data.incidents.length > 0 && (
        <section className="grid gap-3">
          <h2 className="text-sm font-semibold">Mis reportes</h2>
          <Card className="divide-y">
            {data.incidents.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-13">
                <span className="min-w-0 flex-1">
                  <b>{i.title}</b> <span className="text-muted-foreground">· {i.machine?.assetTag} · {timeAgo(i.createdAt)}</span>
                  {i.resolution && <span className="block text-xs text-muted-foreground">Solución: {i.resolution}</span>}
                </span>
                <Badge variant={i.status === "RESOLVED" ? "success" : i.status === "CANCELLED" ? "outline" : i.status === "IN_PROGRESS" ? "warning" : "danger"}>
                  {{ OPEN: "Recibida", IN_PROGRESS: "En atención", RESOLVED: "Resuelta", CANCELLED: "Cancelada" }[i.status]}
                </Badge>
              </div>
            ))}
          </Card>
        </section>
      )}

      {history.length > 0 && (
        <section className="grid gap-3">
          <h2 className="text-sm font-semibold">Insumos recibidos</h2>
          <Card className="divide-y">
            {history.map((d) => (
              <div key={d.id} className="flex items-center gap-3 px-5 py-2.5 text-13">
                <span className="font-semibold text-lg tabular-nums">{d.quantity}</span>
                <span className="min-w-0 flex-1 truncate">
                  {d.supply.unit} · {d.supply.name}
                </span>
                <span className="text-xs text-muted-foreground">{timeAgo(d.createdAt)}</span>
                <Badge variant={d.status === "CONFIRMED" ? "success" : "outline"}>{d.status === "CONFIRMED" ? "Confirmada" : "Rechazada"}</Badge>
              </div>
            ))}
          </Card>
        </section>
      )}

      <RejectDialog delivery={rejecting} onClose={() => setRejecting(null)} />
    </div>
  );
}

function RejectDialog({ delivery, onClose }: { delivery: SupplyDelivery | null; onClose: () => void }) {
  const { run, pending } = useAction();
  const [note, setNote] = React.useState("");
  React.useEffect(() => setNote(""), [delivery]);
  return (
    <Dialog open={!!delivery} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader title="No recibí esta entrega" description={delivery ? `${delivery.quantity} ${delivery.supply.unit} de ${delivery.supply.name}` : undefined} />
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await run(() => api.post(`/inventory/supplies/deliveries/${delivery!.id}/reject`, { note }), { success: "Avisamos que no la recibiste", invalidate });
            if (ok) onClose();
          }}
          className="grid gap-4"
        >
          <Field label="Cuéntanos qué pasó">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} required minLength={3} maxLength={300} className="min-h-20" autoFocus />
          </Field>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancelar
              </Button>
            </DialogClose>
            <Button type="submit" variant="destructive" loading={pending} disabled={note.trim().length < 3}>
              Enviar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
