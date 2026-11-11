import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Mail, MessageCircle, Pencil, Plus, Power, Trash2, Users } from "lucide-react";
import { api } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import { DataTable, RowActions } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, SwitchRow } from "@/components/ui/form";
import { Badge } from "@/components/ui/misc";
import { DropdownMenuItem, DropdownMenuSeparator, Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, useConfirm } from "@/components/ui/overlay";
import { timeAgo } from "@/lib/utils";
import { RECIPIENT_KIND_LABEL, useCanManageReports, type Recipient, type RecipientKind, type Report } from "./shared";

const invalidate = [["reports", "recipients"], ["reports", "list"]];
const KIND_ICON = { EMAIL: Mail, WHATSAPP: MessageCircle, WHATSAPP_GROUP: Users } as const;

type Form = { name: string; description: string; kind: RecipientKind; value: string; active: boolean; windowStart: string; windowEnd: string; reportIds: string[] };
const EMPTY: Form = { name: "", description: "", kind: "EMAIL", value: "", active: true, windowStart: "", windowEnd: "", reportIds: [] };

function RecipientSheet({ value, onClose, reports }: { value: Recipient | "new" | null; onClose: () => void; reports: Report[] }) {
  const isNew = value === "new";
  const { run, pending } = useAction();
  const [form, setForm] = React.useState<Form>(EMPTY);
  React.useEffect(() => {
    if (!value) return;
    setForm(
      value === "new"
        ? EMPTY
        : { name: value.name, description: value.description ?? "", kind: value.kind, value: value.value, active: value.active, windowStart: value.windowStart ?? "", windowEnd: value.windowEnd ?? "", reportIds: value.reportIds },
    );
  }, [value]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = { ...form, description: form.description || null, windowStart: form.windowStart || null, windowEnd: form.windowEnd || null };
    const ok = await run(() => (isNew ? api.post("/reports/recipients", body) : api.put(`/reports/recipients/${(value as Recipient).id}`, body)), {
      success: isNew ? "Destinatario creado" : "Cambios guardados",
      invalidate,
    });
    if (ok) onClose();
  };

  const placeholder = { EMAIL: "nombre@dreamteam.com.pe", WHATSAPP: "51987654321", WHATSAPP_GROUP: "120363…@g.us" }[form.kind];
  const hint = {
    EMAIL: "Recibe el reporte en el cuerpo del correo, con el Excel adjunto si corresponde.",
    WHATSAPP: "Con código de país y sin espacios: 51 para Perú, 34 para España.",
    WHATSAPP_GROUP: "El id del grupo que muestra Evolution API (termina en @g.us).",
  }[form.kind];

  return (
    <Sheet open={!!value} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader title={isNew ? "Nuevo destinatario" : "Editar destinatario"} description="Una persona, una lista o un grupo que recibe reportes." />
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <SheetBody className="grid content-start gap-5">
            <Field label="Nombre">
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} required autoFocus placeholder="Gerencia comercial" />
            </Field>
            <Field label="Canal">
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(RECIPIENT_KIND_LABEL) as RecipientKind[]).map((k) => {
                  const Icon = KIND_ICON[k];
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => set("kind", k)}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-13 font-medium hover:bg-accent ${form.kind === k ? "border-foreground bg-accent" : ""}`}
                      aria-pressed={form.kind === k}
                    >
                      <Icon className="size-4" /> {RECIPIENT_KIND_LABEL[k]}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label={form.kind === "EMAIL" ? "Correo" : form.kind === "WHATSAPP" ? "Número" : "Id del grupo"} hint={hint}>
              <Input value={form.value} onChange={(e) => set("value", e.target.value)} placeholder={placeholder} required type={form.kind === "EMAIL" ? "email" : "text"} />
            </Field>
            <Field label="Nota (opcional)">
              <Input value={form.description} onChange={(e) => set("description", e.target.value)} />
            </Field>
            <Field label="Horario permitido (opcional)" hint="Los envíos programados fuera de este horario (hora de Lima) se omiten. Los manuales siempre llegan.">
              <div className="flex items-center gap-2">
                <Input type="time" value={form.windowStart} onChange={(e) => set("windowStart", e.target.value)} className="w-32" />
                <span className="text-13 text-muted-foreground">a</span>
                <Input type="time" value={form.windowEnd} onChange={(e) => set("windowEnd", e.target.value)} className="w-32" />
              </div>
            </Field>
            <Field label="Reportes que recibe">
              <div className="grid gap-1.5">
                {reports.map((r) => (
                  <label key={r.id} className="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 hover:bg-accent/60">
                    <Checkbox checked={form.reportIds.includes(r.id)} onCheckedChange={() => set("reportIds", form.reportIds.includes(r.id) ? form.reportIds.filter((x) => x !== r.id) : [...form.reportIds, r.id])} />
                    <span className="text-13">{r.name}</span>
                    {!r.active && <Badge className="ml-auto">Pausado</Badge>}
                  </label>
                ))}
              </div>
            </Field>
            <SwitchRow title="Activo" description="Si lo desactivas deja de recibir todos los reportes." checked={form.active} onCheckedChange={(v) => set("active", v)} />
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              {isNew ? "Crear destinatario" : "Guardar cambios"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function RecipientsTab() {
  const manage = useCanManageReports();
  const { data, isLoading } = useQuery({ queryKey: ["reports", "recipients"], queryFn: () => api.get<Recipient[]>("/reports/recipients") });
  const { data: reports } = useQuery({ queryKey: ["reports", "list"], queryFn: () => api.get<Report[]>("/reports/reports") });
  const { run } = useAction();
  const confirm = useConfirm();
  const [editing, setEditing] = React.useState<Recipient | "new" | null>(null);

  const columns: ColumnDef<Recipient>[] = [
    {
      accessorKey: "name",
      header: "Destinatario",
      cell: ({ row: { original: r } }) => {
        const Icon = KIND_ICON[r.kind];
        return (
          <div className="flex items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
              <Icon className="size-4" />
            </span>
            <div className="grid min-w-0">
              <span className="font-medium">{r.name}</span>
              <span className="truncate text-xs text-muted-foreground">{r.value}</span>
            </div>
          </div>
        );
      },
    },
    { accessorKey: "kind", header: "Canal", cell: ({ row }) => <Badge variant="outline">{RECIPIENT_KIND_LABEL[row.original.kind]}</Badge> },
    {
      id: "reports",
      header: "Recibe",
      enableSorting: false,
      cell: ({ row: { original: r } }) => {
        const names = (reports ?? []).filter((x) => r.reportIds.includes(x.id)).map((x) => x.name);
        return names.length ? <span className="text-13">{names.join(", ")}</span> : <span className="text-xs text-muted-foreground">Ningún reporte</span>;
      },
    },
    {
      id: "window",
      header: "Horario",
      enableSorting: false,
      cell: ({ row: { original: r } }) => <span className="text-13 tabular-nums text-muted-foreground">{r.windowStart && r.windowEnd ? `${r.windowStart}–${r.windowEnd}` : "Siempre"}</span>,
    },
    { accessorKey: "lastDeliveryAt", header: "Último envío", cell: ({ getValue }) => <span className="text-13 text-muted-foreground">{timeAgo(getValue() as string | null)}</span> },
    { accessorKey: "active", header: "Estado", cell: ({ getValue }) => (getValue() ? <Badge variant="success" dot>Activo</Badge> : <Badge dot>Inactivo</Badge>) },
    {
      id: "actions",
      header: "",
      meta: { className: "w-12" },
      cell: ({ row: { original: r } }) =>
        manage && (
          <RowActions>
            <DropdownMenuItem onSelect={() => setEditing(r)}>
              <Pencil /> Editar
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run(() => api.put(`/reports/recipients/${r.id}`, { ...r, active: !r.active }), { success: r.active ? "Desactivado" : "Activado", invalidate })}>
              <Power /> {r.active ? "Desactivar" : "Activar"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              destructive
              onSelect={async () => {
                if (await confirm({ title: `¿Eliminar a ${r.name}?`, description: "Dejará de recibir todos los reportes.", confirmText: "Eliminar", destructive: true }))
                  run(() => api.del(`/reports/recipients/${r.id}`), { success: "Destinatario eliminado", invalidate });
              }}
            >
              <Trash2 /> Eliminar
            </DropdownMenuItem>
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
        searchPlaceholder="Nombre, correo o número…"
        onRowClick={manage ? (r) => setEditing(r) : undefined}
        toolbar={
          manage && (
            <Button className="sm:ml-auto" onClick={() => setEditing("new")}>
              <Plus /> Nuevo destinatario
            </Button>
          )
        }
        empty="Aún no hay destinatarios."
      />
      <RecipientSheet value={editing} onClose={() => setEditing(null)} reports={reports ?? []} />
    </>
  );
}
