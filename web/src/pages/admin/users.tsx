import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Copy, Eye, EyeOff, FileSpreadsheet, KeyRound, Lock, Pencil, Plus, Power, RefreshCw, Trash2, Unlock } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import { useAuth } from "@/providers/auth";
import { useDocumentTitle } from "@/providers/branding";
import type { AdminUser, Lookups } from "@/lib/types";
import { ModuleIcon } from "@/lib/icons";
import { DataTable, RowActions } from "@/components/data-table";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, NativeSelect, Textarea } from "@/components/ui/form";
import { Avatar, Badge } from "@/components/ui/misc";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  useConfirm,
} from "@/components/ui/overlay";
import { generatePassword, timeAgo } from "@/lib/utils";

const invalidate = [["admin", "users"], ["admin", "dashboard"]];

export function UsersPage() {
  useDocumentTitle("Usuarios");
  const { user: me } = useAuth();
  const [roleId, setRoleId] = React.useState("");
  const { data, isLoading } = useQuery({ queryKey: ["admin", "users"], queryFn: () => api.get<AdminUser[]>("/users") });
  const { data: lookups } = useQuery({ queryKey: ["admin", "lookups"], queryFn: () => api.get<Lookups>("/admin/lookups") });
  const { run } = useAction();
  const confirm = useConfirm();
  const [editing, setEditing] = React.useState<AdminUser | "new" | null>(null);
  const [bulkOpen, setBulkOpen] = React.useState(false);
  const [shown, setShown] = React.useState<{ user: AdminUser; password: string | null } | null>(null);

  const rows = (data ?? []).filter((u) => !roleId || u.role.id === roleId);
  const active = (data ?? []).filter((u) => u.active).length;

  const showPassword = async (u: AdminUser) => {
    const res = await run(() => api.get<{ password: string | null }>(`/users/${u.id}/password`));
    if (res) setShown({ user: u, password: res.password });
  };

  const columns: ColumnDef<AdminUser>[] = [
    {
      accessorKey: "name",
      header: "Usuario",
      cell: ({ row: { original: u } }) => (
        <div className="flex items-center gap-3">
          <Avatar name={u.name} />
          <div className="grid min-w-0">
            <span className="flex items-center gap-1.5 truncate font-medium">
              {u.name}
              {u.locked && <Lock className="size-3.5 text-destructive" aria-label="Bloqueado" />}
            </span>
            <span className="truncate text-xs text-muted-foreground">{u.email}</span>
          </div>
        </div>
      ),
    },
    {
      id: "role",
      accessorFn: (u) => u.role.name,
      header: "Rol",
      cell: ({ row: { original: u } }) => (
        <Badge variant="outline">
          <span className="size-1.5 rounded-full" style={{ background: u.role.color }} />
          {u.role.name}
        </Badge>
      ),
    },
    {
      id: "area",
      accessorFn: (u) => `${u.area ?? ""} ${u.position ?? ""}`,
      header: "Área y cargo",
      cell: ({ row: { original: u } }) => (
        <div className="grid text-13">
          <span>{u.area ?? "—"}</span>
          {u.position && <span className="text-xs text-muted-foreground">{u.position}</span>}
        </div>
      ),
    },
    {
      accessorKey: "lastLoginAt",
      header: "Último acceso",
      sortingFn: "datetime",
      cell: ({ getValue }) => <span className="text-13 text-muted-foreground">{timeAgo(getValue() as string | null)}</span>,
    },
    {
      accessorKey: "active",
      header: "Estado",
      cell: ({ row: { original: u } }) =>
        u.locked ? (
          <Badge variant="danger" dot>
            Bloqueado
          </Badge>
        ) : u.active ? (
          <Badge variant="success" dot>
            Activo
          </Badge>
        ) : (
          <Badge dot>Inactivo</Badge>
        ),
    },
    {
      id: "actions",
      header: "",
      meta: { className: "w-12" },
      cell: ({ row: { original: u } }) => (
        <RowActions>
          <DropdownMenuItem onSelect={() => setEditing(u)}>
            <Pencil /> Editar
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => showPassword(u)}>
            <KeyRound /> Ver contraseña asignada
          </DropdownMenuItem>
          {u.locked && (
            <DropdownMenuItem onSelect={() => run(() => api.post(`/users/${u.id}/unlock`), { success: "Usuario desbloqueado", invalidate })}>
              <Unlock /> Desbloquear
            </DropdownMenuItem>
          )}
          {u.id !== me?.id && (
            <>
              <DropdownMenuItem
                onSelect={() =>
                  run(() => api.patch(`/users/${u.id}/active`, { active: !u.active }), {
                    success: u.active ? "Usuario desactivado" : "Usuario activado",
                    invalidate,
                  })
                }
              >
                <Power /> {u.active ? "Desactivar" : "Activar"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                destructive
                onSelect={async () => {
                  const ok = await confirm({
                    title: `¿Eliminar a ${u.name}?`,
                    description: "Se borra la cuenta y sus favoritos. La auditoría conserva su nombre. Si solo deja la empresa, mejor desactívalo.",
                    confirmText: "Eliminar",
                    destructive: true,
                  });
                  if (ok) run(() => api.del(`/users/${u.id}`), { success: "Usuario eliminado", invalidate });
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
      <PageHeader
        title="Usuarios"
        description={`${data?.length ?? 0} cuentas · ${active} activas`}
        actions={
          <>
            <Button variant="outline" onClick={() => setBulkOpen(true)}>
              <FileSpreadsheet /> Importar
            </Button>
            <Button onClick={() => setEditing("new")}>
              <Plus /> Nuevo usuario
            </Button>
          </>
        }
      />
      <DataTable
        columns={columns}
        data={rows}
        loading={isLoading}
        searchPlaceholder="Nombre, correo o área…"
        onRowClick={(u) => setEditing(u)}
        toolbar={
          <NativeSelect value={roleId} onChange={(e) => setRoleId(e.target.value)} className="w-auto" aria-label="Filtrar por rol">
            <option value="">Todos los roles</option>
            {lookups?.roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
        }
      />
      <UserSheet user={editing} onClose={() => setEditing(null)} lookups={lookups} />
      <BulkDialog open={bulkOpen} onOpenChange={setBulkOpen} lookups={lookups} />
      <Dialog open={!!shown} onOpenChange={(o) => !o && setShown(null)}>
        <DialogContent>
          <DialogHeader title="Contraseña asignada" description={shown?.user.email} />
          {shown?.password ? (
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md bg-muted px-3 py-2 font-mono text-sm">{shown.password}</code>
              <Button
                variant="outline"
                size="icon"
                aria-label="Copiar"
                onClick={() => navigator.clipboard.writeText(shown.password!).then(() => toast.success("Copiada"))}
              >
                <Copy />
              </Button>
            </div>
          ) : (
            <p className="text-13 text-muted-foreground">
              El usuario ya cambió su contraseña por una personal, así que no se puede mostrar. Si la olvidó, edítalo y asígnale una nueva.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

type Form = { name: string; email: string; password: string; roleId: string; area: string; position: string; phone: string; documentId: string; siteId: string; supervisorId: string; moduleIds: string[] };

function UserSheet({ user, onClose, lookups }: { user: AdminUser | "new" | null; onClose: () => void; lookups?: Lookups }) {
  const isNew = user === "new";
  const { user: me } = useAuth();
  const { run, pending } = useAction();
  const [form, setForm] = React.useState<Form>({ name: "", email: "", password: "", roleId: "", area: "", position: "", phone: "", documentId: "", siteId: "", supervisorId: "", moduleIds: [] });
  const [showPwd, setShowPwd] = React.useState(false);
  const isAdmin = me?.role.key === "admin";

  React.useEffect(() => {
    if (!user) return;
    setShowPwd(isNew);
    setForm(
      user === "new"
        ? { name: "", email: "", password: generatePassword(), roleId: lookups?.roles.find((r) => r.key === "asesor")?.id ?? "", area: "", position: "", phone: "", documentId: "", siteId: "", supervisorId: "", moduleIds: [] }
        : {
            name: user.name,
            email: user.email,
            password: "",
            roleId: user.role.id,
            area: user.area ?? "",
            position: user.position ?? "",
            phone: user.phone ?? "",
            documentId: user.documentId ?? "",
            siteId: user.siteId ?? "",
            supervisorId: user.supervisorId ?? "",
            moduleIds: user.moduleIds,
          },
    );
  }, [user, isNew, lookups]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = {
      ...form,
      password: form.password || undefined,
      area: form.area || null,
      position: form.position || null,
      phone: form.phone || null,
      documentId: form.documentId || null,
      siteId: form.siteId || null,
      supervisorId: form.supervisorId || null,
    };
    const ok = await run(() => (isNew ? api.post("/users", body) : api.put(`/users/${(user as AdminUser).id}`, body)), {
      success: isNew ? "Usuario creado" : form.password ? "Usuario actualizado con nueva contraseña" : "Cambios guardados",
      invalidate,
    });
    if (ok) onClose();
  };

  const roles = (lookups?.roles ?? []).filter((r) => isAdmin || r.key !== "admin");
  const modules = (lookups?.modules ?? []).filter((m) => m.active);

  return (
    <Sheet open={!!user} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader title={isNew ? "Nuevo usuario" : "Editar usuario"} description={isNew ? "Podrá ingresar con su correo y la contraseña que asignes." : (user as AdminUser | null)?.email} />
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <SheetBody className="grid content-start gap-6">
            <section className="grid gap-4">
              <Field label="Nombre y apellido">
                <Input value={form.name} onChange={(e) => set("name", e.target.value)} required autoFocus />
              </Field>
              <Field label="Correo corporativo">
                <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required placeholder="nombre.apellido@dreamteam.com.pe" />
              </Field>
              <Field label={isNew ? "Contraseña inicial" : "Nueva contraseña"} hint={isNew ? "Se le pedirá cambiarla al ingresar." : "Déjala vacía para no cambiarla."}>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input type={showPwd ? "text" : "password"} value={form.password} onChange={(e) => set("password", e.target.value)} required={isNew} className="pr-10 font-mono" />
                    <button
                      type="button"
                      onClick={() => setShowPwd((s) => !s)}
                      className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                      aria-label={showPwd ? "Ocultar" : "Mostrar"}
                    >
                      {showPwd ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => {
                      set("password", generatePassword());
                      setShowPwd(true);
                    }}
                    aria-label="Generar contraseña"
                    title="Generar contraseña"
                  >
                    <RefreshCw />
                  </Button>
                </div>
              </Field>
              <Field label="Rol">
                <NativeSelect value={form.roleId} onChange={(e) => set("roleId", e.target.value)} required disabled={!isNew && (user as AdminUser | null)?.id === me?.id}>
                  <option value="">Elige un rol…</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </section>
            <section className="grid gap-4 sm:grid-cols-2">
              <Field label="Área o campaña">
                <Input value={form.area} onChange={(e) => set("area", e.target.value)} placeholder="Vodafone Portabilidad" />
              </Field>
              <Field label="Cargo">
                <Input value={form.position} onChange={(e) => set("position", e.target.value)} placeholder="Asesor comercial" />
              </Field>
              <Field label="Teléfono">
                <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
              </Field>
              <Field label="DNI / CE">
                <Input value={form.documentId} onChange={(e) => set("documentId", e.target.value)} />
              </Field>
              <Field label="Sede" hint="Sede donde trabaja (plano de sala del Inventario).">
                <NativeSelect value={form.siteId} onChange={(e) => set("siteId", e.target.value)}>
                  <option value="">Sin sede</option>
                  {(lookups?.sites ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Supervisor" hint="El supervisor solo puede reubicar a su equipo.">
                <NativeSelect value={form.supervisorId} onChange={(e) => set("supervisorId", e.target.value)}>
                  <option value="">Sin supervisor</option>
                  {(lookups?.supervisors ?? [])
                    .filter((s) => isNew || s.id !== (user as AdminUser | null)?.id)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {s.area ? ` · ${s.area}` : ""}
                      </option>
                    ))}
                </NativeSelect>
              </Field>
            </section>
            <section className="grid gap-3">
              <div className="grid gap-1">
                <h3 className="text-sm font-semibold">Módulos adicionales</h3>
                <p className="text-13 text-muted-foreground">Además de los de su rol. Úsalo para excepciones puntuales.</p>
              </div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {modules.map((m) => (
                  <label key={m.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 hover:bg-accent/60">
                    <Checkbox
                      checked={form.moduleIds.includes(m.id)}
                      onCheckedChange={() =>
                        set("moduleIds", form.moduleIds.includes(m.id) ? form.moduleIds.filter((x) => x !== m.id) : [...form.moduleIds, m.id])
                      }
                    />
                    <ModuleIcon name={m.icon} className="size-4 text-muted-foreground" />
                    <span className="truncate text-13">{m.name}</span>
                  </label>
                ))}
              </div>
            </section>
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              {isNew ? "Crear usuario" : "Guardar cambios"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/** Pegar desde Excel: Nombre, Correo, Área, Cargo (una persona por fila, columnas separadas por tabulación o coma) */
function BulkDialog({ open, onOpenChange, lookups }: { open: boolean; onOpenChange: (o: boolean) => void; lookups?: Lookups }) {
  const { run, pending } = useAction();
  const { user: me } = useAuth();
  const [text, setText] = React.useState("");
  const [roleId, setRoleId] = React.useState("");
  const [password, setPassword] = React.useState(generatePassword());
  const [result, setResult] = React.useState<{ created: number; errors: { row: number; email: string; error: string }[] } | null>(null);

  const rows = text
    .split(/\r?\n/)
    .map((l) => l.split(/\t|;|,/).map((c) => c.trim()))
    .filter((c) => c[0] && c[1] && c[1].includes("@"))
    .map(([name, email, area, position]) => ({ name: name!, email: email!, area, position }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await run(() => api.post<{ created: number; errors: { row: number; email: string; error: string }[] }>("/users/bulk", { roleId, password, rows }), {
      invalidate,
    });
    if (res) {
      setResult(res);
      if (res.created) toast.success(`${res.created} usuarios creados`);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setText("");
          setResult(null);
        }
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader title="Importar usuarios" description="Copia desde Excel las columnas Nombre, Correo, Área y Cargo (en ese orden) y pégalas aquí." />
        <form onSubmit={submit} className="grid gap-4">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-40 font-mono text-xs" placeholder={"Ana Torres\tana.torres@dreamteam.com.pe\tYoigo Fibra\tAsesora comercial"} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Rol para todos">
              <NativeSelect value={roleId} onChange={(e) => setRoleId(e.target.value)} required>
                <option value="">Elige un rol…</option>
                {lookups?.roles
                  .filter((r) => me?.role.key === "admin" || r.key !== "admin")
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
            <Field label="Contraseña inicial común">
              <Input value={password} onChange={(e) => setPassword(e.target.value)} className="font-mono" required />
            </Field>
          </div>
          {result && result.errors.length > 0 && (
            <div className="max-h-32 overflow-y-auto rounded-md bg-destructive/10 p-3 text-xs text-destructive">
              {result.errors.map((er) => (
                <p key={er.row}>
                  Fila {er.row} ({er.email}): {er.error}
                </p>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-13 text-muted-foreground tabular-nums">{rows.length} filas válidas</span>
            <Button type="submit" loading={pending} disabled={!rows.length}>
              Importar {rows.length || ""}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
