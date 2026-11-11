import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck, CircleDot, CircleX, Flame, Hammer, Wrench } from "lucide-react";
import { api, qs } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import type { Incident, IncidentStatus } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect, SwitchRow, Textarea } from "@/components/ui/form";
import { Badge, Card, Skeleton } from "@/components/ui/misc";
import { Dialog, DialogClose, DialogContent, DialogHeader, Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader } from "@/components/ui/overlay";
import { cn, formatDateTime, timeAgo } from "@/lib/utils";
import { DND_INCIDENT, dragProps, invalidate, useDrop, useInvAccess, useInvActions } from "./shared";

const COLUMNS: { status: IncidentStatus; label: string; icon: typeof CircleDot; tone: string }[] = [
  { status: "OPEN", label: "Abiertas", icon: CircleDot, tone: "text-brand" },
  { status: "IN_PROGRESS", label: "En atención", icon: Hammer, tone: "text-warning" },
  { status: "RESOLVED", label: "Resueltas", icon: CircleCheck, tone: "text-success" },
  { status: "CANCELLED", label: "Canceladas", icon: CircleX, tone: "text-muted-foreground" },
];
const PRIORITY: Record<Incident["priority"], { label: string; variant: "danger" | "warning" | "default" }> = {
  HIGH: { label: "Alta", variant: "danger" },
  MEDIUM: { label: "Media", variant: "warning" },
  LOW: { label: "Baja", variant: "default" },
};

export function IncidentsTab({ siteId }: { siteId: string }) {
  const { can } = useInvAccess();
  const { run } = useAction();
  const [open, setOpen] = React.useState<Incident | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["inventory", "incidents", siteId], queryFn: () => api.get<Incident[]>(`/inventory/incidents${qs({ siteId })}`) });
  const canRepair = can("repair");

  const moveTo = (id: string, status: IncidentStatus) => {
    const inc = data?.find((i) => i.id === id);
    if (!inc || inc.status === status) return;
    // Al pasar a "en atención" el equipo entra a reparación
    run(() => api.patch(`/inventory/incidents/${id}`, { status, toRepair: status === "IN_PROGRESS" }), { success: `${inc.title}: ${COLUMNS.find((c) => c.status === status)!.label.toLowerCase()}`, invalidate });
  };

  if (isLoading) return <Skeleton className="h-96" />;
  const recentCutoff = Date.now() - 30 * 86400_000;
  return (
    <div className="grid gap-3">
      <p className="text-13 text-muted-foreground">
        {canRepair ? "Arrastra cada tarjeta a la columna de su estado. Al pasar a “En atención”, el equipo queda en reparación; al resolverla, vuelve a su estado anterior." : "Fallas reportadas en los equipos de la sede."}
      </p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const items = (data ?? []).filter((i) => i.status === col.status && (col.status === "OPEN" || col.status === "IN_PROGRESS" || new Date(i.createdAt).getTime() > recentCutoff));
          return <Column key={col.status} col={col} items={items} canMove={canRepair} onDrop={(id) => moveTo(id, col.status)} onOpen={setOpen} />;
        })}
      </div>
      <IncidentSheet incident={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function Column({ col, items, canMove, onDrop, onOpen }: { col: (typeof COLUMNS)[number]; items: Incident[]; canMove: boolean; onDrop: (id: string) => void; onOpen: (i: Incident) => void }) {
  const { props, over } = useDrop([DND_INCIDENT], (_t, id) => onDrop(id), canMove);
  return (
    <Card {...props} className={cn("flex min-h-64 flex-col transition-colors", over && "bg-brand/5 ring-2 ring-brand")}>
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <col.icon className={cn("size-4", col.tone)} />
        <h3 className="text-sm font-semibold">{col.label}</h3>
        <span className="ml-auto font-semibold text-sm text-muted-foreground tabular-nums">{items.length}</span>
      </div>
      <div className="grid content-start gap-2 p-3">
        {items.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">{canMove ? "Suelta aquí" : "Nada por aquí"}</p>}
        {items.map((i) => (
          <button
            key={i.id}
            type="button"
            {...dragProps(DND_INCIDENT, i.id, canMove)}
            onClick={() => onOpen(i)}
            className={cn("grid gap-1.5 border bg-card p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-md", canMove && "cursor-grab active:cursor-grabbing", i.priority === "HIGH" && "border-l-4 border-l-brand")}
          >
            <span className="flex items-start gap-2">
              <span className="min-w-0 flex-1 text-13 font-semibold">{i.title}</span>
              <Badge variant={PRIORITY[i.priority].variant}>
                {i.priority === "HIGH" && <Flame />} {PRIORITY[i.priority].label}
              </Badge>
            </span>
            <span className="text-xs text-muted-foreground">
              {i.machine?.assetTag}
              {i.machine?.workstation && ` · puesto ${i.machine.workstation.code}`}
            </span>
            <span className="text-xs text-muted-foreground">
              {timeAgo(i.createdAt)} · {i.reportedByName}
              {i.technician && ` · ${i.technician}`}
            </span>
          </button>
        ))}
      </div>
    </Card>
  );
}

function IncidentSheet({ incident, onClose }: { incident: Incident | null; onClose: () => void }) {
  const { can } = useInvAccess();
  const actions = useInvActions();
  const { run, pending } = useAction();
  const [f, setF] = React.useState({ status: "OPEN" as IncidentStatus, priority: "MEDIUM" as Incident["priority"], technician: "", resolution: "", toRepair: true });
  React.useEffect(() => {
    if (incident) setF({ status: incident.status, priority: incident.priority, technician: incident.technician ?? "", resolution: incident.resolution ?? "", toRepair: true });
  }, [incident]);
  if (!incident) return <Sheet open={false} />;
  const editable = can("repair");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(
      () => api.patch(`/inventory/incidents/${incident.id}`, { status: f.status, priority: f.priority, technician: f.technician || null, resolution: f.resolution || null, toRepair: f.status === "IN_PROGRESS" && f.toRepair }),
      { success: "Incidencia actualizada", invalidate },
    );
    if (ok) onClose();
  };
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader title={incident.title} description={`${incident.machine?.assetTag ?? ""} · reportada ${formatDateTime(incident.createdAt)} por ${incident.reportedByName ?? "—"}`} />
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <SheetBody className="grid content-start gap-4">
            {incident.description && <p className="border-l-4 border-brand pl-3 text-13">{incident.description}</p>}
            <Button type="button" variant="outline" className="w-fit" onClick={() => incident.machine && actions.openMachine(incident.machine.id)}>
              <Wrench /> Ver ficha del equipo
            </Button>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Estado">
                <NativeSelect value={f.status} disabled={!editable} onChange={(e) => setF({ ...f, status: e.target.value as IncidentStatus })}>
                  {COLUMNS.map((c) => (
                    <option key={c.status} value={c.status}>
                      {c.label.replace(/s$/, "")}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Prioridad">
                <NativeSelect value={f.priority} disabled={!editable} onChange={(e) => setF({ ...f, priority: e.target.value as Incident["priority"] })}>
                  <option value="HIGH">Alta</option>
                  <option value="MEDIUM">Media</option>
                  <option value="LOW">Baja</option>
                </NativeSelect>
              </Field>
            </div>
            {editable && f.status === "IN_PROGRESS" && incident.status !== "IN_PROGRESS" && (
              <SwitchRow title="Llevar el equipo a reparación" description="El equipo queda en reparación hasta que se resuelva la incidencia." checked={f.toRepair} onCheckedChange={(v) => setF({ ...f, toRepair: v })} />
            )}
            <Field label="Técnico o proveedor">
              <Input value={f.technician} disabled={!editable} onChange={(e) => setF({ ...f, technician: e.target.value })} maxLength={80} />
            </Field>
            <Field label="Solución / diagnóstico">
              <Textarea value={f.resolution} disabled={!editable} onChange={(e) => setF({ ...f, resolution: e.target.value })} className="min-h-24" maxLength={1000} />
            </Field>
          </SheetBody>
          {editable && (
            <SheetFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button type="submit" loading={pending}>
                Guardar
              </Button>
            </SheetFooter>
          )}
        </form>
      </SheetContent>
    </Sheet>
  );
}

const QUICK_ISSUES = ["No enciende", "Pantalla sin imagen", "No se escucha / micrófono no funciona", "Teclado o mouse fallan", "Sin internet / red", "Lento o se cuelga", "Otro"];

export function ReportIssueDialog({ machine, onClose }: { machine: { id: string; assetTag: string } | null; onClose: () => void }) {
  const { run, pending } = useAction();
  const [title, setTitle] = React.useState(QUICK_ISSUES[0]!);
  const [custom, setCustom] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [priority, setPriority] = React.useState<Incident["priority"]>("MEDIUM");
  React.useEffect(() => {
    if (machine) (setTitle(QUICK_ISSUES[0]!), setCustom(""), setDescription(""), setPriority("MEDIUM"));
  }, [machine]);
  const finalTitle = title === "Otro" ? custom.trim() : title;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!machine) return;
    const ok = await run(() => api.post(`/inventory/machines/${machine.id}/incidents`, { title: finalTitle, description: description || null, priority }), { success: "Falla reportada: TI ya la ve en su tablero", invalidate });
    if (ok) onClose();
  };
  return (
    <Dialog open={!!machine} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader title="Reportar una falla" description={machine ? `Equipo ${machine.assetTag}` : undefined} />
        <form onSubmit={submit} className="grid gap-4">
          <div className="flex flex-wrap gap-1.5">
            {QUICK_ISSUES.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setTitle(q)}
                className={cn("rounded-full px-3 py-1 text-13 transition-colors", title === q ? "bg-brand text-white" : "bg-muted text-muted-foreground hover:text-foreground")}
              >
                {q}
              </button>
            ))}
          </div>
          {title === "Otro" && (
            <Field label="¿Qué pasa?">
              <Input value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={100} required autoFocus />
            </Field>
          )}
          <Field label="Detalle (opcional)">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-20" maxLength={1000} placeholder="Desde cuándo, qué estabas haciendo, si sale algún mensaje…" />
          </Field>
          <Field label="¿Te impide trabajar?">
            <NativeSelect value={priority} onChange={(e) => setPriority(e.target.value as Incident["priority"])}>
              <option value="HIGH">Sí, no puedo trabajar (alta)</option>
              <option value="MEDIUM">Puedo trabajar con dificultad (media)</option>
              <option value="LOW">Es un detalle (baja)</option>
            </NativeSelect>
          </Field>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancelar
              </Button>
            </DialogClose>
            <Button type="submit" loading={pending} disabled={finalTitle.length < 3}>
              <Wrench /> Reportar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
