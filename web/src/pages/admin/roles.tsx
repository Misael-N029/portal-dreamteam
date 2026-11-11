import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Globe, LayoutGrid, Lock, MoreHorizontal, Pencil, Plus, ShieldCheck, Table2, Trash2, Users } from "lucide-react";
import { api } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import { useDocumentTitle } from "@/providers/branding";
import type { Lookups, ModuleScope, Role, RolesMeta } from "@/lib/types";
import { ModuleIcon } from "@/lib/icons";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, SwitchRow, Textarea } from "@/components/ui/form";
import { Badge, Card, Skeleton } from "@/components/ui/misc";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  useConfirm,
} from "@/components/ui/overlay";
import { cn, pluralize } from "@/lib/utils";

const COLORS = ["#DC2626", "#E11D48", "#0A0A0A", "#374151", "#6B7280", "#15803D", "#B45309", "#0369A1"];
const invalidate = [["admin", "roles"], ["admin", "lookups"], ["portal", "modules"], ["me"]];

export function RolesPage() {
  useDocumentTitle("Roles");
  const { data, isLoading } = useQuery({ queryKey: ["admin", "roles"], queryFn: () => api.get<Role[]>("/roles") });
  const { data: lookups } = useQuery({ queryKey: ["admin", "lookups"], queryFn: () => api.get<Lookups>("/admin/lookups") });
  const { run } = useAction();
  const confirm = useConfirm();
  const [editing, setEditing] = React.useState<Role | "new" | null>(null);
  const [matrixOpen, setMatrixOpen] = React.useState(false);

  return (
    <>
      <PageHeader
        title="Roles"
        description="Qué módulos ve cada rol en su panel. Solo el Administrador puede crear, editar o borrar."
        actions={
          <>
            <Button variant="outline" onClick={() => setMatrixOpen(true)}>
              <Table2 /> Matriz de roles
            </Button>
            <Button onClick={() => setEditing("new")}>
              <Plus /> Nuevo rol
            </Button>
          </>
        }
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {isLoading &&
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-52 rounded-xl" />)}
        {data?.map((r) => (
          <Card key={r.id} className="flex flex-col">
            <div className="flex items-start gap-3 p-5">
              <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
              <div className="grid min-w-0 flex-1 gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold">{r.name}</h3>
                  {r.system && (
                    <Badge variant="outline">
                      <Lock /> Sistema
                    </Badge>
                  )}
                </div>
                <p className="line-clamp-2 text-13 text-muted-foreground">{r.description || "Sin descripción"}</p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" className="-mt-1 -mr-2" aria-label="Acciones">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onSelect={() => setEditing(r)}>
                    <Pencil /> Editar
                  </DropdownMenuItem>
                  {!r.system && (
                    <DropdownMenuItem
                      destructive
                      onSelect={async () => {
                        const ok = await confirm({ title: `¿Eliminar el rol ${r.name}?`, confirmText: "Eliminar", destructive: true });
                        if (ok) run(() => api.del(`/roles/${r.id}`), { success: "Rol eliminado", invalidate });
                      }}
                    >
                      <Trash2 /> Eliminar
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="grid grid-cols-2 border-t text-center">
              {[
                { icon: Users, value: r.users, label: "usuarios" },
                { icon: LayoutGrid, value: r.key === "admin" ? "Todos" : r.moduleIds.length, label: "módulos" },
              ].map((s, i) => (
                <div key={s.label} className={cn("grid gap-0.5 px-2 py-3", i > 0 && "border-l")}>
                  <span className="text-base font-semibold tabular-nums">{s.value}</span>
                  <span className="text-xs text-muted-foreground">{s.label}</span>
                </div>
              ))}
            </div>
            <div className="mt-auto flex items-center justify-between gap-2 border-t px-5 py-3">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Globe className="size-3.5" />
                {r.bypassIp ? "Entra desde cualquier red" : "Solo desde IPs autorizadas"}
              </span>
              <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>
                Configurar
              </Button>
            </div>
          </Card>
        ))}
      </div>
      <RoleSheet role={editing} onClose={() => setEditing(null)} lookups={lookups} />
      <MatrixSheet open={matrixOpen} onClose={() => setMatrixOpen(false)} roles={data ?? []} lookups={lookups} />
    </>
  );
}

const useRolesMeta = (enabled = true) =>
  useQuery({ queryKey: ["admin", "roles", "meta"], queryFn: () => api.get<RolesMeta>("/roles/meta"), staleTime: 5 * 60_000, enabled });

type LookupModule = NonNullable<Lookups>["modules"][number];

const SCOPE_SHORT: Record<ModuleScope, string> = { ALL: "Todas las sedes", SITE: "Su sede", TEAM: "Su equipo", OWN: "Solo lo suyo" };

/** Matriz de solo lectura: qué ve y qué puede hacer cada rol en cada módulo */
function MatrixSheet({ open, onClose, roles, lookups }: { open: boolean; onClose: () => void; roles: Role[]; lookups?: Lookups }) {
  const { data: meta } = useRolesMeta(open);
  const isBase = (key: string) => !!meta?.baseRoles.includes(key);
  const ordered = [...roles].sort((a, b) => Number(b.key === "admin") - Number(a.key === "admin") || Number(isBase(b.key)) - Number(isBase(a.key)));
  const sections = new Map<string, LookupModule[]>();
  for (const m of lookups?.modules ?? []) sections.set(m.section, [...(sections.get(m.section) ?? []), m]);
  const cell = (role: Role, m: LookupModule): { actions: string[]; scope: ModuleScope } | null => {
    if (role.key === "admin") return { actions: ["todo"], scope: "ALL" };
    if (isBase(role.key) && meta && m.key in meta.matrix) return meta.matrix[m.key]?.[role.key] ?? null;
    if (!role.moduleIds.includes(m.id)) return null;
    // Rol creado a mano: "ver"; en módulos con alcance "lo suyo" (Inventario), solo lo suyo
    const scopes = (m.internalKey && meta?.catalog[m.internalKey]?.scopes) || [];
    return { actions: ["view"], scope: scopes.includes("OWN") ? "OWN" : "ALL" };
  };
  const label = (m: LookupModule, a: string) =>
    a === "todo" ? "Todo" : ((m.internalKey && meta?.catalog[m.internalKey]?.actions.find((x) => x.key === a)?.label) ?? (a === "view" ? "Ver" : a));
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="xl">
        <SheetHeader title="Matriz de roles" description="Qué ve y qué puede hacer cada rol. Los roles base (candado) son fijos; los creados a mano se editan desde su tarjeta." />
        <SheetBody>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-13">
              <thead>
                <tr className="border-b">
                  <th className="sticky left-0 z-10 min-w-48 bg-background px-3 py-2 text-xs font-medium text-muted-foreground">Módulo</th>
                  {ordered.map((r) => (
                    <th key={r.id} className="px-3 py-2">
                      <span className="flex items-center gap-1.5 text-13 font-semibold">
                        <span className="size-2 rounded-full" style={{ background: r.color }} /> {r.name}
                        {isBase(r.key) && <Lock className="size-3 text-muted-foreground" />}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...sections.entries()].map(([section, mods]) => (
                  <React.Fragment key={section}>
                    <tr>
                      <td colSpan={ordered.length + 1} className="px-3 pt-4 pb-1 text-xs font-medium text-muted-foreground">
                        {section}
                      </td>
                    </tr>
                    {mods.map((m) => (
                      <tr key={m.id} className="border-b">
                        <td className="sticky left-0 z-10 min-w-48 bg-background px-3 py-2 whitespace-nowrap">
                          <span className="flex items-center gap-2">
                            <ModuleIcon name={m.icon} className="size-4 text-muted-foreground" /> {m.name}
                          </span>
                        </td>
                        {ordered.map((r) => {
                          const g = cell(r, m);
                          return (
                            <td key={r.id} className="px-3 py-2 align-top">
                              {g ? (
                                <span className="flex flex-wrap gap-1">
                                  {g.actions.map((a) => (
                                    <Badge key={a} variant={a === "view" || a === "todo" ? "solid" : "brand"}>
                                      {label(m, a)}
                                    </Badge>
                                  ))}
                                  {g.scope !== "ALL" && <Badge variant="outline">{SCOPE_SHORT[g.scope]}</Badge>}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

type Form = { key: string; name: string; description: string; color: string; bypassIp: boolean; moduleIds: string[] };

function RoleSheet({ role, onClose, lookups }: { role: Role | "new" | null; onClose: () => void; lookups?: Lookups }) {
  const isNew = role === "new";
  const isAdminRole = !isNew && role?.key === "admin";
  const { run, pending } = useAction();
  const { data: meta } = useRolesMeta(!!role);
  // Rol base: los módulos de la matriz fija no se marcan a mano
  const lockedKey = !isNew && role && meta?.baseRoles.includes(role.key) ? role.key : null;
  const locked = (m: LookupModule) => !!lockedKey && !!meta && m.key in meta.matrix;
  const lockedOn = (m: LookupModule) => !!lockedKey && !!meta?.matrix[m.key]?.[lockedKey];
  const [form, setForm] = React.useState<Form>({ key: "", name: "", description: "", color: "#6B7280", bypassIp: false, moduleIds: [] });

  React.useEffect(() => {
    if (!role) return;
    setForm(
      role === "new"
        ? { key: "", name: "", description: "", color: "#6B7280", bypassIp: false, moduleIds: [] }
        : { key: role.key, name: role.name, description: role.description ?? "", color: role.color, bypassIp: role.bypassIp, moduleIds: role.moduleIds },
    );
  }, [role]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggleModule = (id: string) => set("moduleIds", form.moduleIds.includes(id) ? form.moduleIds.filter((x) => x !== id) : [...form.moduleIds, id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = { ...form, description: form.description || null };
    const ok = await run(() => (isNew ? api.post("/roles", body) : api.put(`/roles/${(role as Role).id}`, body)), {
      success: isNew ? "Rol creado" : "Rol actualizado",
      invalidate,
    });
    if (ok) onClose();
  };

  const sections = new Map<string, NonNullable<Lookups>["modules"]>();
  for (const m of lookups?.modules ?? []) sections.set(m.section, [...(sections.get(m.section) ?? []), m]);

  return (
    <Sheet open={!!role} onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="lg">
        <SheetHeader title={isNew ? "Nuevo rol" : `Rol ${(role as Role | null)?.name ?? ""}`} description="Qué módulos ve en su panel y desde qué red puede entrar." />
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <SheetBody className="grid content-start gap-8">
            <section className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nombre">
                  <Input value={form.name} onChange={(e) => set("name", e.target.value)} required autoFocus />
                </Field>
                <Field label="Clave" hint={!isNew && !!(role as Role | null)?.system ? "Los roles de sistema conservan su clave." : "Minúsculas y guiones."}>
                  <Input
                    value={form.key}
                    onChange={(e) => set("key", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                    required
                    disabled={!isNew && !!(role as Role | null)?.system}
                    placeholder="calidad"
                  />
                </Field>
              </div>
              <Field label="Descripción">
                <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} className="min-h-16" maxLength={200} />
              </Field>
              <Field label="Color">
                <div className="flex flex-wrap items-center gap-2">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => set("color", c)}
                      className={cn("size-7 rounded-full ring-offset-2 ring-offset-background", form.color.toUpperCase() === c && "ring-2 ring-foreground")}
                      style={{ background: c }}
                      aria-label={`Color ${c}`}
                    />
                  ))}
                </div>
              </Field>
            </section>

            <section className="grid gap-2 rounded-lg border bg-surface/60 p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="size-4 text-brand" /> {isAdminRole ? "Administra todo el portal" : "Solo usa su panel"}
              </h3>
              <p className="text-13 text-muted-foreground">
                {isAdminRole
                  ? "Módulos, usuarios, roles, Centro de Reportes, comunicados, configuración y auditoría."
                  : "Abre los módulos que marques abajo. Crear, editar, enviar o borrar está reservado al rol Administrador."}
              </p>
            </section>

            <section className="grid gap-1">
              <h3 className="text-sm font-semibold">Red</h3>
              <SwitchRow
                title="Entrar desde cualquier red"
                description="Si la restricción por IP está activa en Configuración, este rol no queda limitado a la oficina."
                checked={isAdminRole || form.bypassIp}
                disabled={isAdminRole}
                onCheckedChange={(v) => set("bypassIp", v)}
              />
            </section>

            <section className="grid gap-3">
              <div className="grid gap-1">
                <h3 className="text-sm font-semibold">Módulos del panel</h3>
                <p className="text-13 text-muted-foreground">
                  {isAdminRole ? "El administrador ve todos los módulos activos." : `${pluralize(form.moduleIds.length, "módulo seleccionado", "módulos seleccionados")}`}
                </p>
              </div>
              {lockedKey && !isAdminRole && (
                <p className="flex items-start gap-2 rounded-lg border bg-surface/60 px-3 py-2 text-13 text-muted-foreground">
                  <Lock className="mt-0.5 size-3.5 shrink-0" />
                  Los módulos con candado siguen la matriz fija de roles (botón "Matriz de roles"): qué ve y qué puede hacer este rol ahí no se cambia a mano.
                </p>
              )}
              {!isAdminRole &&
                [...sections.entries()].map(([section, mods]) => (
                  <div key={section} className="grid gap-1.5">
                    <p className="text-xs font-medium text-muted-foreground">{section}</p>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {mods.map((m) => {
                        const isLocked = locked(m);
                        return (
                          <label
                            key={m.id}
                            className={cn("flex items-center gap-2.5 rounded-lg border px-3 py-2", isLocked ? "cursor-not-allowed bg-surface/60" : "cursor-pointer hover:bg-accent/60")}
                            title={isLocked ? "Definido por la matriz fija de roles" : undefined}
                          >
                            <Checkbox checked={isLocked ? lockedOn(m) : form.moduleIds.includes(m.id)} disabled={isLocked} onCheckedChange={() => toggleModule(m.id)} />
                            <ModuleIcon name={m.icon} className="size-4 text-muted-foreground" />
                            <span className={cn("truncate text-13", !m.active && "text-muted-foreground line-through")}>{m.name}</span>
                            {isLocked && <Lock className="ml-auto size-3.5 shrink-0 text-muted-foreground" />}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
            </section>
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              {isNew ? "Crear rol" : "Guardar cambios"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
