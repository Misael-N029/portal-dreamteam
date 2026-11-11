import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Pencil, Pin, Plus, Power, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import { useDocumentTitle } from "@/providers/branding";
import type { Announcement, AnnouncementLevel, Lookups } from "@/lib/types";
import { DataTable, RowActions } from "@/components/data-table";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, SwitchRow, Textarea } from "@/components/ui/form";
import { Badge } from "@/components/ui/misc";
import { DropdownMenuItem, DropdownMenuSeparator, Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, useConfirm } from "@/components/ui/overlay";
import { cn, formatDate, formatDateTime, toLocalInput } from "@/lib/utils";
import { AnnouncementCard, LEVEL } from "../app/announcement-card";

const invalidate = [["admin", "announcements"], ["portal", "announcements"]];

function status(a: Announcement) {
  const now = Date.now();
  if (!a.active) return <Badge dot>Oculto</Badge>;
  if (a.expiresAt && new Date(a.expiresAt).getTime() <= now) return <Badge dot>Vencido</Badge>;
  if (new Date(a.publishedAt).getTime() > now) return <Badge variant="warning" dot>Programado</Badge>;
  return <Badge variant="success" dot>Publicado</Badge>;
}

export function AnnouncementsAdminPage() {
  useDocumentTitle("Comunicados");
  const { data, isLoading } = useQuery({ queryKey: ["admin", "announcements"], queryFn: () => api.get<Announcement[]>("/announcements") });
  const { data: lookups } = useQuery({ queryKey: ["admin", "lookups"], queryFn: () => api.get<Lookups>("/admin/lookups") });
  const { run } = useAction();
  const confirm = useConfirm();
  const [editing, setEditing] = React.useState<Announcement | "new" | null>(null);

  const columns: ColumnDef<Announcement>[] = [
    {
      accessorKey: "title",
      header: "Comunicado",
      cell: ({ row: { original: a } }) => (
        <div className="grid max-w-md gap-0.5">
          <span className="flex items-center gap-1.5 font-medium">
            {a.pinned && <Pin className="size-3.5 text-brand" />}
            {a.title}
          </span>
          <span className="truncate text-xs text-muted-foreground">{a.body}</span>
        </div>
      ),
    },
    {
      accessorKey: "level",
      header: "Nivel",
      cell: ({ row: { original: a } }) => <Badge variant={LEVEL[a.level].variant}>{LEVEL[a.level].label}</Badge>,
    },
    {
      id: "audience",
      header: "Para",
      enableSorting: false,
      cell: ({ row: { original: a } }) =>
        a.roleKeys.length === 0 ? (
          <span className="text-13">Todos</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {a.roleKeys.map((k) => (
              <Badge key={k} variant="outline">
                {lookups?.roles.find((r) => r.key === k)?.name ?? k}
              </Badge>
            ))}
          </div>
        ),
    },
    {
      accessorKey: "publishedAt",
      header: "Publicación",
      sortingFn: "datetime",
      cell: ({ row: { original: a } }) => (
        <div className="grid text-13 tabular-nums">
          <span>{formatDateTime(a.publishedAt)}</span>
          {a.expiresAt && <span className="text-xs text-muted-foreground">Vence {formatDate(a.expiresAt)}</span>}
        </div>
      ),
    },
    { id: "status", header: "Estado", enableSorting: false, cell: ({ row }) => status(row.original) },
    {
      id: "actions",
      header: "",
      meta: { className: "w-12" },
      cell: ({ row: { original: a } }) => (
        <RowActions>
          <DropdownMenuItem onSelect={() => setEditing(a)}>
            <Pencil /> Editar
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => run(() => api.put(`/announcements/${a.id}`, { ...a, active: !a.active }), { success: a.active ? "Comunicado oculto" : "Comunicado visible", invalidate })}>
            <Power /> {a.active ? "Ocultar" : "Mostrar"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            destructive
            onSelect={async () => {
              if (await confirm({ title: `¿Eliminar “${a.title}”?`, confirmText: "Eliminar", destructive: true }))
                run(() => api.del(`/announcements/${a.id}`), { success: "Comunicado eliminado", invalidate });
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
      <PageHeader
        title="Comunicados"
        description="Avisos que aparecen en el inicio del panel de colaboradores"
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus /> Nuevo comunicado
          </Button>
        }
      />
      <DataTable columns={columns} data={data} loading={isLoading} onRowClick={(a) => setEditing(a)} searchPlaceholder="Buscar comunicado…" />
      <AnnouncementSheet value={editing} onClose={() => setEditing(null)} lookups={lookups} />
    </>
  );
}

type Form = { title: string; body: string; level: AnnouncementLevel; pinned: boolean; active: boolean; roleKeys: string[]; publishedAt: string; expiresAt: string };

function AnnouncementSheet({ value, onClose, lookups }: { value: Announcement | "new" | null; onClose: () => void; lookups?: Lookups }) {
  const isNew = value === "new";
  const { run, pending } = useAction();
  const [form, setForm] = React.useState<Form>({ title: "", body: "", level: "INFO", pinned: false, active: true, roleKeys: [], publishedAt: toLocalInput(new Date()), expiresAt: "" });

  React.useEffect(() => {
    if (!value) return;
    setForm(
      value === "new"
        ? { title: "", body: "", level: "INFO", pinned: false, active: true, roleKeys: [], publishedAt: toLocalInput(new Date()), expiresAt: "" }
        : {
            title: value.title,
            body: value.body,
            level: value.level,
            pinned: value.pinned,
            active: value.active,
            roleKeys: value.roleKeys,
            publishedAt: toLocalInput(value.publishedAt),
            expiresAt: value.expiresAt ? toLocalInput(value.expiresAt) : "",
          },
    );
  }, [value]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = {
      ...form,
      publishedAt: new Date(form.publishedAt).toISOString(),
      expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
    };
    const ok = await run(() => (isNew ? api.post("/announcements", body) : api.put(`/announcements/${(value as Announcement).id}`, body)), {
      success: isNew ? "Comunicado publicado" : "Comunicado actualizado",
      invalidate,
    });
    if (ok) onClose();
  };

  return (
    <Sheet open={!!value} onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="lg">
        <SheetHeader title={isNew ? "Nuevo comunicado" : "Editar comunicado"} description="Escríbelo como lo leería un asesor en medio del turno: corto y claro." />
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <SheetBody className="grid content-start gap-6">
            <Field label="Título">
              <Input value={form.title} onChange={(e) => set("title", e.target.value)} required maxLength={120} autoFocus />
            </Field>
            <Field label="Mensaje">
              <Textarea value={form.body} onChange={(e) => set("body", e.target.value)} required className="min-h-32" maxLength={5000} />
            </Field>
            <Field label="Nivel">
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(LEVEL) as AnnouncementLevel[]).map((l) => {
                  const L = LEVEL[l];
                  return (
                    <button
                      key={l}
                      type="button"
                      onClick={() => set("level", l)}
                      className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-13 font-medium hover:bg-accent", form.level === l && "border-foreground bg-accent")}
                      aria-pressed={form.level === l}
                    >
                      <L.icon className="size-4" /> {L.label}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label="Para quién" hint="Sin selección, lo ve todo el personal.">
              <div className="grid gap-1.5 sm:grid-cols-2">
                {lookups?.roles.map((r) => (
                  <label key={r.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 hover:bg-accent/60">
                    <Checkbox
                      checked={form.roleKeys.includes(r.key)}
                      onCheckedChange={() => set("roleKeys", form.roleKeys.includes(r.key) ? form.roleKeys.filter((k) => k !== r.key) : [...form.roleKeys, r.key])}
                    />
                    <span className="size-2 rounded-full" style={{ background: r.color }} />
                    <span className="text-13">{r.name}</span>
                  </label>
                ))}
              </div>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Publicar desde">
                <Input type="datetime-local" value={form.publishedAt} onChange={(e) => set("publishedAt", e.target.value)} required />
              </Field>
              <Field label="Vence (opcional)">
                <Input type="datetime-local" value={form.expiresAt} onChange={(e) => set("expiresAt", e.target.value)} />
              </Field>
            </div>
            <div className="divide-y">
              <SwitchRow title="Fijar arriba" description="Se muestra primero aunque haya comunicados más recientes." checked={form.pinned} onCheckedChange={(v) => set("pinned", v)} />
              <SwitchRow title="Visible" description="Desactívalo para guardarlo como borrador." checked={form.active} onCheckedChange={(v) => set("active", v)} />
            </div>
            {form.title && (
              <div className="grid gap-2">
                <p className="text-xs font-medium text-muted-foreground">Vista previa</p>
                <AnnouncementCard
                  a={{ id: "preview", ...form, publishedAt: new Date(form.publishedAt).toISOString(), expiresAt: null, author: null }}
                />
              </div>
            )}
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              {isNew ? "Publicar" : "Guardar cambios"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
