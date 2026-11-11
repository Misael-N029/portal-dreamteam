import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpRight, LayoutGrid, Loader2, Upload, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import { useAuth } from "@/providers/auth";
import { useDocumentTitle } from "@/providers/branding";
import type { AdminModule, AdminUser, InternalScreen, Lookups, ModuleType } from "@/lib/types";
import { ICON_NAMES, ModuleIcon, moduleTint } from "@/lib/icons";
import { MODULE_TYPE_LABEL } from "@/lib/modules";
import { DataTable, RowActions } from "@/components/data-table";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, NativeSelect, SwitchRow, Textarea } from "@/components/ui/form";
import { Badge } from "@/components/ui/misc";
import { DropdownMenuItem, DropdownMenuSeparator, Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, useConfirm } from "@/components/ui/overlay";
import { cn, pluralize } from "@/lib/utils";

const COLORS = ["#DC2626", "#E11D48", "#0A0A0A", "#374151", "#6B7280", "#15803D", "#B45309", "#0369A1"];

const TYPE_HELP: Record<ModuleType, string> = {
  IFRAME: "Se muestra dentro del portal, con el menú a la vista. Ideal para apps propias de la empresa.",
  LINK: "Abre otra web (CRM, correo, Google). Úsalo cuando el sitio no permite mostrarse dentro del portal.",
  INTERNAL: "Una pantalla del propio portal, como el Directorio o los Comunicados.",
};

const slugify = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

type FormState = {
  key: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  type: ModuleType;
  url: string;
  internalKey: string;
  section: string;
  active: boolean;
  newTab: boolean;
  badge: string;
  imageUrl: string | null;
  roleIds: string[];
  userIds: string[];
};

const EMPTY: FormState = {
  key: "",
  name: "",
  description: "",
  icon: "LayoutGrid",
  color: "#DC2626",
  type: "LINK",
  url: "",
  internalKey: "",
  section: "Herramientas",
  active: true,
  newTab: true,
  badge: "",
  imageUrl: null,
  roleIds: [],
  userIds: [],
};

export function ModulesPage() {
  useDocumentTitle("Módulos");
  const { data, isLoading } = useQuery({ queryKey: ["admin", "modules"], queryFn: () => api.get<AdminModule[]>("/modules") });
  const { data: lookups } = useQuery({ queryKey: ["admin", "lookups"], queryFn: () => api.get<Lookups>("/admin/lookups") });
  const { run } = useAction();
  const confirm = useConfirm();
  const [editing, setEditing] = React.useState<AdminModule | "new" | null>(null);
  const invalidate = [["admin", "modules"], ["portal", "modules"], ["admin", "lookups"]];

  const move = (id: string, dir: -1 | 1) => {
    const ids = (data ?? []).map((m) => m.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    run(() => api.post("/modules/reorder", { ids }), { invalidate });
  };

  const roleName = (id: string) => lookups?.roles.find((r) => r.id === id);

  const columns: ColumnDef<AdminModule>[] = [
    {
      id: "order",
      header: "",
      enableSorting: false,
      meta: { className: "w-16" },
      cell: ({ row, table }) => {
        const rows = table.getCoreRowModel().rows;
        const idx = rows.findIndex((r) => r.id === row.id);
        return (
          <div className="flex gap-0.5" onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon-sm" className="size-7" disabled={idx === 0} onClick={() => move(row.original.id, -1)} aria-label="Subir">
              <ArrowUp />
            </Button>
            <Button variant="ghost" size="icon-sm" className="size-7" disabled={idx === rows.length - 1} onClick={() => move(row.original.id, 1)} aria-label="Bajar">
              <ArrowDown />
            </Button>
          </div>
        );
      },
    },
    {
      accessorKey: "name",
      header: "Módulo",
      cell: ({ row: { original: m } }) => (
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted" style={{ color: moduleTint(m.color) }}>
            <ModuleIcon name={m.icon} className="size-4" />
          </span>
          <div className="grid min-w-0">
            <span className="flex items-center gap-2 font-medium">
              {m.name}
              {m.badge && <Badge variant="brand">{m.badge}</Badge>}
            </span>
            <span className="truncate text-xs text-muted-foreground">/{m.key}</span>
          </div>
        </div>
      ),
    },
    { accessorKey: "section", header: "Sección" },
    {
      accessorKey: "type",
      header: "Tipo",
      cell: ({ row: { original: m } }) => (
        <span className="flex items-center gap-1.5 text-13">
          {MODULE_TYPE_LABEL[m.type]}
          {m.type === "LINK" && <ArrowUpRight className="size-3.5 text-muted-foreground" />}
        </span>
      ),
    },
    {
      id: "access",
      header: "Acceso",
      enableSorting: false,
      cell: ({ row: { original: m } }) => (
        <div className="flex max-w-64 flex-wrap gap-1">
          {m.roleIds.map((id) => {
            const r = roleName(id);
            return r ? (
              <Badge key={id} variant="outline">
                <span className="size-1.5 rounded-full" style={{ background: r.color }} />
                {r.name}
              </Badge>
            ) : null;
          })}
          {m.users.length > 0 && <Badge variant="outline">+{pluralize(m.users.length, "usuario", "usuarios")}</Badge>}
          {m.roleIds.length === 0 && m.users.length === 0 && <span className="text-xs text-muted-foreground">Solo administradores</span>}
        </div>
      ),
    },
    { accessorKey: "opens30d", header: "Usos 30 d", meta: { align: "right" } },
    {
      accessorKey: "active",
      header: "Estado",
      cell: ({ getValue }) => (getValue() ? <Badge variant="success" dot>Activo</Badge> : <Badge dot>Inactivo</Badge>),
    },
    {
      id: "actions",
      header: "",
      meta: { className: "w-12" },
      cell: ({ row: { original: m } }) => (
        <RowActions>
          <DropdownMenuItem onSelect={() => setEditing(m)}>
            <Pencil /> Editar
          </DropdownMenuItem>
          {m.url && (
            <DropdownMenuItem onSelect={() => window.open(m.url!, "_blank", "noopener")}>
              <ArrowUpRight /> Probar enlace
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => run(() => api.patch(`/modules/${m.id}/active`, { active: !m.active }), { success: m.active ? "Módulo desactivado" : "Módulo activado", invalidate })}>
            <Power /> {m.active ? "Desactivar" : "Activar"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            destructive
            onSelect={async () => {
              const ok = await confirm({
                title: `¿Eliminar “${m.name}”?`,
                description: "Desaparecerá del panel de todos los usuarios y se borrará su historial de uso. Si solo quieres ocultarlo, desactívalo.",
                confirmText: "Eliminar",
                destructive: true,
              });
              if (ok) run(() => api.del(`/modules/${m.id}`), { success: "Módulo eliminado", invalidate });
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
        title="Módulos"
        description="Las herramientas que aparecen en el panel de colaboradores, en el orden en que se muestran"
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus /> Nuevo módulo
          </Button>
        }
      />
      <DataTable
        columns={columns}
        data={data}
        loading={isLoading}
        searchPlaceholder="Buscar módulo…"
        onRowClick={(m) => setEditing(m)}
        pageSize={50}
        empty="Aún no hay módulos. Crea el primero con «Nuevo módulo»."
      />
      <ModuleSheet
        module={editing}
        onClose={() => setEditing(null)}
        sections={[...new Set((data ?? []).map((m) => m.section))]}
        lookups={lookups}
      />
    </>
  );
}

function ModuleSheet({
  module,
  onClose,
  sections,
  lookups,
}: {
  module: AdminModule | "new" | null;
  onClose: () => void;
  sections: string[];
  lookups?: Lookups;
}) {
  const isNew = module === "new";
  const { can } = useAuth();
  const { run, pending } = useAction();
  const [form, setForm] = React.useState<FormState>(EMPTY);
  const [keyTouched, setKeyTouched] = React.useState(false);
  const [userQuery, setUserQuery] = React.useState("");
  const { data: meta } = useQuery({ queryKey: ["admin", "modules", "meta"], queryFn: () => api.get<{ internalScreens: InternalScreen[]; gallery: string[] }>("/modules/meta") });
  const { data: users } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => api.get<AdminUser[]>("/users"),
    enabled: !!module && can("users.manage"),
  });

  React.useEffect(() => {
    if (!module) return;
    setKeyTouched(!isNew);
    setUserQuery("");
    setForm(
      module === "new"
        ? EMPTY
        : {
            key: module.key,
            name: module.name,
            description: module.description ?? "",
            icon: module.icon,
            color: module.color,
            type: module.type,
            url: module.url ?? "",
            internalKey: module.internalKey ?? "",
            section: module.section,
            active: module.active,
            newTab: module.newTab,
            badge: module.badge ?? "",
            imageUrl: module.imageUrl ?? null,
            roleIds: module.roleIds,
            userIds: module.users.map((u) => u.id),
          },
    );
  }, [module, isNew]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggle = (k: "roleIds" | "userIds", id: string) =>
    setForm((f) => ({ ...f, [k]: f[k].includes(id) ? f[k].filter((x) => x !== id) : [...f[k], id] }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = { ...form, description: form.description || null, badge: form.badge || null, url: form.url || null, internalKey: form.internalKey || null };
    const ok = await run(() => (isNew ? api.post("/modules", body) : api.put(`/modules/${(module as AdminModule).id}`, body)), {
      success: isNew ? "Módulo creado" : "Cambios guardados",
      invalidate: [["admin", "modules"], ["portal", "modules"], ["admin", "lookups"]],
    });
    if (ok) onClose();
  };

  const extraUsers = (users ?? []).filter(
    (u) => form.userIds.includes(u.id) || (userQuery.length > 1 && `${u.name} ${u.email}`.toLowerCase().includes(userQuery.toLowerCase())),
  );
  const staffRoles = lookups?.roles ?? [];

  return (
    <Sheet open={!!module} onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="lg">
        <SheetHeader title={isNew ? "Nuevo módulo" : `Editar ${(module as AdminModule | null)?.name ?? ""}`} description="Define qué es, cómo se abre y quién lo ve." />
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <SheetBody className="grid gap-8">
            {/* Vista previa en vivo: el bloque tal como lo ve el colaborador */}
            <div className="grid gap-2">
              <p className="text-xs font-medium text-muted-foreground">Vista previa en el panel</p>
              <div className="relative isolate flex aspect-[16/7] flex-col justify-end overflow-hidden rounded-2xl bg-[#0A0A0A] text-white">
                {form.imageUrl ? (
                  <>
                    <img src={form.imageUrl} alt="" className="absolute inset-0 -z-10 size-full object-cover" />
                    <span aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-black/85 via-black/35 to-black/5" />
                  </>
                ) : (
                  <>
                    <img src="/isotipo-dark.png" alt="" aria-hidden className="absolute -top-8 -right-10 -z-10 size-48 opacity-[0.07]" />
                    <span className="absolute top-1/2 right-8 -z-10 -translate-y-1/2" style={{ color: moduleTint(form.color) ?? "#ffffff" }}>
                      <ModuleIcon name={form.icon} className="size-16 stroke-[1.25]" />
                    </span>
                  </>
                )}
                <span className="absolute top-3 left-3 flex size-9 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm">
                  <ModuleIcon name={form.icon} className="size-4" />
                </span>
                {form.badge && <Badge className="absolute top-3 right-3 bg-brand text-white">{form.badge}</Badge>}
                <div className="grid gap-1 p-5">
                  <span className="text-lg leading-tight font-semibold">{form.name || "Nombre del módulo"}</span>
                  <span className="line-clamp-2 text-13 text-white/75">{form.description || "Descripción corta para el colaborador."}</span>
                </div>
              </div>
            </div>

            <section className="grid gap-4">
              <h3 className="text-sm font-semibold">Información</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nombre">
                  <Input
                    value={form.name}
                    onChange={(e) => {
                      const name = e.target.value;
                      setForm((f) => ({ ...f, name, key: keyTouched ? f.key : slugify(name) }));
                    }}
                    placeholder="Centro de Reportes"
                    required
                    autoFocus
                  />
                </Field>
                <Field label="Identificador" hint="Aparece en la dirección: /app/m/identificador">
                  <Input
                    value={form.key}
                    onChange={(e) => {
                      setKeyTouched(true);
                      set("key", slugify(e.target.value));
                    }}
                    placeholder="reportes"
                    required
                  />
                </Field>
              </div>
              <Field label="Descripción" hint="Una línea: para qué sirve.">
                <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} className="min-h-16" maxLength={200} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Sección del menú" hint="Agrupa los módulos en el panel.">
                  <Input value={form.section} onChange={(e) => set("section", e.target.value)} list="module-sections" required />
                  <datalist id="module-sections">
                    {sections.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </Field>
                <Field label="Etiqueta (opcional)" hint="Ej.: Nuevo, Beta. Máximo 16 caracteres.">
                  <Input value={form.badge} onChange={(e) => set("badge", e.target.value)} maxLength={16} />
                </Field>
              </div>
            </section>

            <section className="grid gap-4">
              <h3 className="text-sm font-semibold">Apariencia</h3>
              <PhotoPicker value={form.imageUrl} onChange={(v) => set("imageUrl", v)} gallery={meta?.gallery ?? []} />
              <Field label="Icono">
                <div className="flex max-h-36 flex-wrap gap-1 overflow-y-auto rounded-lg border p-2">
                  {ICON_NAMES.map((name) => (
                    <button
                      key={name}
                      type="button"
                      title={name}
                      onClick={() => set("icon", name)}
                      className={cn(
                        "flex size-9 items-center justify-center rounded-md transition-colors hover:bg-accent",
                        form.icon === name && "bg-foreground text-background hover:bg-foreground",
                      )}
                      aria-pressed={form.icon === name}
                    >
                      <ModuleIcon name={name} className="size-4" />
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Color">
                <div className="flex flex-wrap items-center gap-2">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => set("color", c)}
                      className={cn("size-7 rounded-full ring-offset-2 ring-offset-background transition-shadow", form.color.toUpperCase() === c && "ring-2 ring-foreground")}
                      style={{ background: c }}
                      aria-label={`Color ${c}`}
                    />
                  ))}
                  <Input type="color" value={form.color} onChange={(e) => set("color", e.target.value.toUpperCase())} className="h-8 w-12 cursor-pointer p-1" aria-label="Otro color" />
                </div>
              </Field>
            </section>

            <section className="grid gap-4">
              <h3 className="text-sm font-semibold">Cómo se abre</h3>
              <div className="grid gap-2 sm:grid-cols-3">
                {(["IFRAME", "LINK", "INTERNAL"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => set("type", t)}
                    className={cn("rounded-lg border p-3 text-left transition-colors hover:bg-accent", form.type === t && "border-foreground bg-accent")}
                    aria-pressed={form.type === t}
                  >
                    <span className="flex items-center gap-2 text-13 font-medium">
                      <span className={cn("size-2 rounded-full border", form.type === t ? "border-brand bg-brand" : "border-muted-foreground")} />
                      {MODULE_TYPE_LABEL[t]}
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-13 text-muted-foreground">{TYPE_HELP[form.type]}</p>
              {form.type === "INTERNAL" ? (
                <Field label="Pantalla">
                  <NativeSelect value={form.internalKey} onChange={(e) => set("internalKey", e.target.value)} required>
                    <option value="">Elige una pantalla…</option>
                    {meta?.internalScreens.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label} — {s.description}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              ) : (
                <Field
                  label="URL"
                  hint={form.type === "IFRAME" ? "El sitio debe permitir mostrarse dentro de otra página. Si sale en blanco, cámbialo a Enlace externo." : undefined}
                >
                  <Input type="url" value={form.url} onChange={(e) => set("url", e.target.value)} placeholder="https://" required />
                </Field>
              )}
              {form.type === "LINK" && (
                <SwitchRow title="Abrir en una pestaña nueva" description="El portal queda abierto detrás." checked={form.newTab} onCheckedChange={(v) => set("newTab", v)} />
              )}
            </section>

            <section className="grid gap-4">
              <div className="grid gap-1">
                <h3 className="text-sm font-semibold">Quién lo ve</h3>
                <p className="text-13 text-muted-foreground">Los administradores ven todos los módulos activos.</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {staffRoles.map((r) => (
                  <label key={r.id} className="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 hover:bg-accent/60">
                    <Checkbox checked={form.roleIds.includes(r.id)} onCheckedChange={() => toggle("roleIds", r.id)} />
                    <span className="size-2 rounded-full" style={{ background: r.color }} />
                    <span className="text-13 font-medium">{r.name}</span>
                  </label>
                ))}
              </div>
              {can("users.manage") && (
                <Field label="Usuarios adicionales" hint="Para dar acceso a alguien sin cambiar su rol.">
                  <Input value={userQuery} onChange={(e) => setUserQuery(e.target.value)} placeholder="Busca por nombre o correo…" />
                  {extraUsers.length > 0 && (
                    <div className="grid max-h-48 gap-1 overflow-y-auto rounded-lg border p-1">
                      {extraUsers.map((u) => (
                        <label key={u.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent">
                          <Checkbox checked={form.userIds.includes(u.id)} onCheckedChange={() => toggle("userIds", u.id)} />
                          <span className="grid min-w-0">
                            <span className="truncate text-13 font-medium">{u.name}</span>
                            <span className="truncate text-xs text-muted-foreground">
                              {u.email} · {u.role.name}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </Field>
              )}
              <SwitchRow
                title="Módulo activo"
                description="Si lo desactivas desaparece del panel, pero conserva su configuración."
                checked={form.active}
                onCheckedChange={(v) => set("active", v)}
              />
            </section>
          </SheetBody>
          <SheetFooter>
            {form.type !== "INTERNAL" && /^https?:\/\//.test(form.url) && (
              <Button type="button" variant="ghost" className="mr-auto" onClick={() => window.open(form.url, "_blank", "noopener")}>
                <ArrowUpRight /> Probar URL
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              <LayoutGrid /> {isNew ? "Crear módulo" : "Guardar cambios"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/** Foto del bloque: galería del equipo, foto propia (JPG/PNG/WebP hasta 3 MB), URL https o sin foto */
function PhotoPicker({ value, onChange, gallery }: { value: string | null; onChange: (v: string | null) => void; gallery: string[] }) {
  const [uploading, setUploading] = React.useState(false);
  const [url, setUrl] = React.useState("");
  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) return toast.error("La foto pesa más de 3 MB");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await api.post<{ url: string }>("/modules/image", fd);
      onChange(res.url);
      toast.success("Foto subida");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };
  const tile = "relative aspect-[4/3] overflow-hidden rounded-lg border-2 transition-colors";
  return (
    <Field label="Foto del bloque" hint="Se muestra en el panel de cada colaborador. Elige una del equipo, sube la tuya o deja el diseño de marca.">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        <button type="button" onClick={() => onChange(null)} className={cn(tile, "flex items-center justify-center bg-[#0A0A0A] text-xs font-medium text-white", !value ? "border-brand" : "border-transparent hover:border-foreground/30")} aria-pressed={!value}>
          Sin foto
        </button>
        {gallery.map((g) => (
          <button key={g} type="button" onClick={() => onChange(g)} className={cn(tile, value === g ? "border-brand" : "border-transparent hover:border-foreground/30")} aria-pressed={value === g} aria-label="Usar esta foto">
            <img src={g} alt="" loading="lazy" className="size-full object-cover" />
          </button>
        ))}
        {value && !gallery.includes(value) && (
          <span className={cn(tile, "border-brand")}>
            <img src={value} alt="Foto actual" className="size-full object-cover" />
          </span>
        )}
        <label className={cn(tile, "flex cursor-pointer flex-col items-center justify-center gap-1 border-dashed border-input text-xs text-muted-foreground hover:bg-accent")}>
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          Subir foto
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} disabled={uploading} />
        </label>
      </div>
      <div className="flex gap-2">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="O pega la URL de una foto (https://…)" />
        <Button type="button" variant="outline" disabled={!/^https:\/\/.+/.test(url)} onClick={() => (onChange(url.trim()), setUrl(""))}>
          Usar URL
        </Button>
      </div>
    </Field>
  );
}
