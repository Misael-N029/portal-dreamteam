import * as React from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowRightLeft, Check, ChevronLeft, ChevronRight, CircleAlert, History, MoreHorizontal, Pencil, Plus, Search, ShieldCheck, Truck, UserRound, Wrench, X } from "lucide-react";
import { api, qs } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import type { Machine, MachineDetail, MachineStatus, MachineTransfer, PersonRef } from "@/lib/types";
import { EmptyState } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, NativeSelect, Textarea } from "@/components/ui/form";
import { Badge, Card, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/misc";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  useConfirm,
} from "@/components/ui/overlay";
import { cn, formatDate, formatDateTime, timeAgo } from "@/lib/utils";
import { CategoryIcon, KIND_LABEL, PersonPicker, STATUS_COLOR, STATUS_LABEL, StatusBadge, invalidate, useInvAccess, useInvActions, useInventoryMeta } from "./shared";

const PAGE = 25;
const DAY = 86400_000;

export function warrantyInfo(until: string | null) {
  if (!until) return null;
  const days = Math.ceil((new Date(until).getTime() - Date.now()) / DAY);
  if (days < 0) return { label: "Garantía vencida", variant: "outline" as const };
  if (days <= 30) return { label: `Garantía: ${days} días`, variant: "warning" as const };
  return { label: `Garantía hasta ${formatDate(until)}`, variant: "success" as const };
}

export function EquipmentTab({ siteId }: { siteId: string }) {
  const { can, global } = useInvAccess();
  const meta = useInventoryMeta();
  const actions = useInvActions();
  const confirm = useConfirm();
  const { run } = useAction();
  const [q, setQ] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [categoryId, setCategoryId] = React.useState("");
  const [warranty, setWarranty] = React.useState(false);
  const [allSites, setAllSites] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [selection, setSelection] = React.useState<Map<string, Machine>>(new Map());
  const [form, setForm] = React.useState<Machine | "new" | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  // Cualquier cambio de filtro vuelve a la primera página y limpia la selección (no se trasladan filas ocultas)
  React.useEffect(() => {
    setPage(1);
    setSelection(new Map());
  }, [debounced, status, categoryId, warranty, allSites, siteId]);

  const params = { siteId: allSites ? undefined : siteId, status: status || undefined, categoryId: categoryId || undefined, q: debounced || undefined, warranty: warranty ? "1" : undefined, page: String(page), pageSize: String(PAGE) };
  const list = useQuery({
    queryKey: ["inventory", "machines", params],
    queryFn: () => api.get<{ items: Machine[]; total: number }>(`/inventory/machines${qs(params)}`),
    placeholderData: keepPreviousData,
  });
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const movable = (m: Machine) => m.status !== "TRANSIT" && m.status !== "RETIRED";

  // Si una fila seleccionada cambió de estado (p. ej. ya está en traslado), sale de la selección
  React.useEffect(() => {
    setSelection((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const m of items) if (next.has(m.id) && !movable(m)) (next.delete(m.id), (changed = true));
      return changed ? next : prev;
    });
  }, [items]);

  const toggle = (m: Machine) =>
    setSelection((prev) => {
      const next = new Map(prev);
      next.has(m.id) ? next.delete(m.id) : next.set(m.id, m);
      return next;
    });

  const setMachineStatus = async (m: Machine, next: Exclude<MachineStatus, "TRANSIT">) => {
    if (next === "RETIRED") {
      const ok = await confirm({ title: `¿Dar de baja ${m.assetTag}?`, description: "Sale del inventario activo y de su puesto. Su historial se conserva y se puede reactivar.", confirmText: "Dar de baja", destructive: true });
      if (!ok) return;
    }
    run(() => api.patch(`/inventory/machines/${m.id}/status`, { status: next }), { success: `${m.assetTag}: ${STATUS_LABEL[next].toLowerCase()}`, invalidate });
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-60">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código, serie, persona…" className="pl-9" />
        </div>
        <NativeSelect value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-44" aria-label="Categoría">
          <option value="">Todas las categorías</option>
          {meta.equipmentCats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} className="w-40" aria-label="Estado">
          <option value="">Todos los estados</option>
          {(Object.keys(STATUS_LABEL) as MachineStatus[]).map((k) => (
            <option key={k} value={k}>
              {STATUS_LABEL[k]}
            </option>
          ))}
        </NativeSelect>
        <label className="flex cursor-pointer items-center gap-2 text-13">
          <input type="checkbox" checked={warranty} onChange={(e) => setWarranty(e.target.checked)} className="accent-[var(--brand)]" /> Garantía por vencer
        </label>
        {global && (
          <label className="flex cursor-pointer items-center gap-2 text-13">
            <input type="checkbox" checked={allSites} onChange={(e) => setAllSites(e.target.checked)} className="accent-[var(--brand)]" /> Todas las sedes
          </label>
        )}
        <div className="ml-auto flex gap-2">
          {can("transfer") && (
            <Button variant="outline" disabled={selection.size === 0} onClick={() => actions.transfer([...selection.values()])}>
              <ArrowRightLeft /> Trasladar{selection.size > 0 && ` (${selection.size})`}
            </Button>
          )}
          {can("create") && (
            <Button onClick={() => setForm("new")}>
              <Plus /> Nuevo equipo
            </Button>
          )}
        </div>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-13">
          <thead>
            <tr className="border-b text-xs font-medium text-muted-foreground">
              {can("transfer") && (
                <th className="w-10 py-3 pl-5">
                  <Checkbox
                    aria-label="Seleccionar la página"
                    checked={items.filter(movable).length > 0 && items.filter(movable).every((m) => selection.has(m.id))}
                    onCheckedChange={(v) =>
                      setSelection((prev) => {
                        const next = new Map(prev);
                        for (const m of items.filter(movable)) v ? next.set(m.id, m) : next.delete(m.id);
                        return next;
                      })
                    }
                  />
                </th>
              )}
              <th className="px-4 py-3">Código</th>
              <th className="px-4 py-3">Equipo</th>
              <th className="px-4 py-3">Puesto y persona</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3">Garantía</th>
              <th className="w-12 py-3 pr-4" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {list.isLoading && (
              <tr>
                <td colSpan={7} className="p-6">
                  <Skeleton className="h-20" />
                </td>
              </tr>
            )}
            {items.map((m) => {
              const cat = meta.category(m.categoryId);
              const w = warrantyInfo(m.warrantyUntil);
              return (
                <tr key={m.id} className={cn("cursor-pointer transition-colors hover:bg-accent/60", m.status === "RETIRED" && "text-muted-foreground")} onClick={() => actions.openMachine(m.id)}>
                  {can("transfer") && (
                    <td className="py-3 pl-5" onClick={(e) => e.stopPropagation()}>
                      <Checkbox aria-label={`Seleccionar ${m.assetTag}`} checked={selection.has(m.id)} disabled={!movable(m)} onCheckedChange={() => toggle(m)} />
                    </td>
                  )}
                  <td className="px-4 py-3 font-semibold tabular-nums">
                    {m.assetTag}
                    {(m._count?.incidents ?? 0) > 0 && <CircleAlert className="ml-1.5 inline size-3.5 text-brand" />}
                  </td>
                  <td className="px-4 py-3">
                    <p className="flex items-center gap-1.5">
                      <CategoryIcon name={cat?.icon} className="size-3.5" style={{ color: cat?.color }} />
                      <span className="font-medium">{cat?.name ?? m.type}</span> {[m.brand, m.model].filter(Boolean).join(" ")}
                    </p>
                    <p className="text-xs text-muted-foreground">{[m.serial && `Serie ${m.serial}`, m.hostname, m.cpu, m.ram].filter(Boolean).join(" · ") || "—"}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium">
                      {m.workstation ? `Puesto ${m.workstation.code}` : m.location || "Sin puesto"}
                      {allSites && <span className="text-muted-foreground"> · {m.site.code}</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">{m.assignedUser?.name ?? (m.assignedTo ? `${m.assignedTo} (texto anterior)` : "Sin asignar")}</p>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={m.status} />
                  </td>
                  <td className="px-4 py-3">{w ? <Badge variant={w.variant}>{w.label}</Badge> : <span className="text-muted-foreground">—</span>}</td>
                  <td className="py-3 pr-4" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Acciones de ${m.assetTag}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onSelect={() => actions.openMachine(m.id)}>
                          <History /> Ficha e historial
                        </DropdownMenuItem>
                        {can("edit") && m.status !== "TRANSIT" && m.status !== "RETIRED" && (
                          <DropdownMenuItem onSelect={() => setForm(m)}>
                            <Pencil /> Editar
                          </DropdownMenuItem>
                        )}
                        {can("incident") && m.status !== "RETIRED" && (
                          <DropdownMenuItem onSelect={() => actions.reportIssue(m)}>
                            <Wrench /> Reportar falla
                          </DropdownMenuItem>
                        )}
                        {can("edit") && m.status !== "TRANSIT" && m.status !== "RETIRED" && (
                          <>
                            <DropdownMenuSeparator />
                            {(["ACTIVE", "STORAGE", "REPAIR"] as const)
                              .filter((k) => k !== m.status)
                              .map((k) => (
                                <DropdownMenuItem key={k} onSelect={() => setMachineStatus(m, k)}>
                                  <span className="size-2 rotate-45" style={{ background: STATUS_COLOR[k] }} /> Marcar: {STATUS_LABEL[k].toLowerCase()}
                                </DropdownMenuItem>
                              ))}
                          </>
                        )}
                        {can("retire") && m.status === "RETIRED" && (
                          <DropdownMenuItem onSelect={() => setMachineStatus(m, "STORAGE")}>
                            <ShieldCheck /> Reactivar (vuelve al almacén)
                          </DropdownMenuItem>
                        )}
                        {can("retire") && m.status !== "TRANSIT" && m.status !== "RETIRED" && (
                          <DropdownMenuItem destructive onSelect={() => setMachineStatus(m, "RETIRED")}>
                            Dar de baja
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!list.isLoading && items.length === 0 && <EmptyState icon={Search} title="Sin equipos" description="No hay equipos que coincidan con los filtros." className="border-0 shadow-none" />}
        <div className="flex items-center justify-between gap-2 border-t px-5 py-3 text-13 text-muted-foreground">
          <span className="tabular-nums">
            {total} equipos{selection.size > 0 && ` · ${selection.size} seleccionados`}
          </span>
          <div className="flex items-center gap-2">
            <Button size="icon-sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Página anterior">
              <ChevronLeft />
            </Button>
            <span className="tabular-nums">
              {page} / {pages}
            </span>
            <Button size="icon-sm" variant="ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Página siguiente">
              <ChevronRight />
            </Button>
          </div>
        </div>
      </Card>

      <PendingTransfers siteId={siteId} />
      <MachineFormSheet target={form} siteId={siteId} onClose={() => setForm(null)} />
    </div>
  );
}

// ── Traslados pendientes ──

function PendingTransfers({ siteId }: { siteId: string }) {
  const { can } = useInvAccess();
  const { run } = useAction();
  const confirm = useConfirm();
  const { data } = useQuery({ queryKey: ["inventory", "transfers", "PENDING", siteId], queryFn: () => api.get<MachineTransfer[]>(`/inventory/transfers${qs({ status: "PENDING", siteId })}`) });
  if (!data?.length) return null;
  const receive = (t: MachineTransfer) => run(() => api.post(`/inventory/transfers/${t.id}/receive`, {}), { success: `${t.machine.assetTag} recibido en ${t.to.name}: quedó en el almacén de la sede`, invalidate });
  const cancel = async (t: MachineTransfer) => {
    if (await confirm({ title: `¿Cancelar el envío de ${t.machine.assetTag}?`, description: "El equipo vuelve a su sede de origen.", confirmText: "Cancelar envío", destructive: true }))
      run(() => api.post(`/inventory/transfers/${t.id}/cancel`, {}), { success: "Envío cancelado", invalidate });
  };
  return (
    <Card>
      <div className="flex items-center gap-2 border-b px-5 py-3">
        <Truck className="size-4 text-brand" />
        <h3 className="text-sm font-semibold">En tránsito</h3>
        <span className="ml-auto font-semibold text-sm text-muted-foreground tabular-nums">{data.length}</span>
      </div>
      <ul className="divide-y">
        {data.map((t) => {
          const incoming = t.toSiteId === siteId;
          return (
            <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
              <Badge variant={incoming ? "brand" : "default"}>{incoming ? "Llega" : "Sale"}</Badge>
              <div className="grid min-w-0 flex-1">
                <span className="truncate text-13 font-semibold">{t.machine.assetTag}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {t.from.name} → {t.to.name} · {timeAgo(t.createdAt)}
                  {t.reason && ` · ${t.reason}`}
                </span>
              </div>
              {can("receive") && incoming && (
                <Button size="sm" onClick={() => receive(t)}>
                  <Check /> Recibir
                </Button>
              )}
              {can("transfer") && !incoming && (
                <Button size="icon-sm" variant="ghost" onClick={() => cancel(t)} aria-label="Cancelar envío">
                  <X />
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ── Alta y edición ──

type Form = {
  assetTag: string;
  categoryId: string;
  brand: string;
  model: string;
  serial: string;
  hostname: string;
  cpu: string;
  ram: string;
  storage: string;
  os: string;
  supplier: string;
  purchaseDate: string;
  warrantyUntil: string;
  notes: string;
  siteId: string;
  status: "ACTIVE" | "STORAGE" | "REPAIR";
};
const day = (d: string | null) => (d ? d.slice(0, 10) : "");

export function MachineFormSheet({ target, siteId, onClose }: { target: Machine | "new" | null; siteId: string; onClose: () => void }) {
  const meta = useInventoryMeta();
  const { run, pending } = useAction();
  const isNew = target === "new";
  const blank = (): Form => ({ assetTag: "", categoryId: meta.equipmentCats[0]?.id ?? "", brand: "", model: "", serial: "", hostname: "", cpu: "", ram: "", storage: "", os: "", supplier: "", purchaseDate: "", warrantyUntil: "", notes: "", siteId, status: "STORAGE" });
  const [f, setF] = React.useState<Form>(blank);
  React.useEffect(() => {
    if (!target) return;
    if (target === "new") setF(blank());
    else
      setF({
        assetTag: target.assetTag,
        categoryId: target.categoryId ?? "",
        brand: target.brand ?? "",
        model: target.model ?? "",
        serial: target.serial ?? "",
        hostname: target.hostname ?? "",
        cpu: target.cpu ?? "",
        ram: target.ram ?? "",
        storage: target.storage ?? "",
        os: target.os ?? "",
        supplier: target.supplier ?? "",
        purchaseDate: day(target.purchaseDate),
        warrantyUntil: day(target.warrantyUntil),
        notes: target.notes ?? "",
        siteId: target.siteId,
        status: "ACTIVE",
      });
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const cat = meta.category(f.categoryId);
  const hasSpecs = cat?.slot === "PC";
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = { ...f, purchaseDate: f.purchaseDate || null, warrantyUntil: f.warrantyUntil || null };
    const ok = await run(() => (isNew ? api.post("/inventory/machines", body) : api.put(`/inventory/machines/${(target as Machine).id}`, body)), { success: isNew ? "Equipo registrado" : "Equipo actualizado", invalidate });
    if (ok) onClose();
  };
  return (
    <Sheet open={!!target} onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="lg">
        <SheetHeader title={isNew ? "Nuevo equipo" : `Editar ${(target as Machine | null)?.assetTag ?? ""}`} description="Datos, especificaciones y garantía. Los cambios quedan en la bitácora del equipo." />
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <SheetBody className="grid content-start gap-6">
            <div className="grid gap-2">
              <span className="text-13 font-medium">Categoría</span>
              <div className="flex flex-wrap gap-1.5">
                {meta.equipmentCats
                  .filter((c) => c.active || c.id === f.categoryId)
                  .map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => set("categoryId", c.id)}
                      className={cn("flex items-center gap-1.5 border px-3 py-1.5 text-13 transition-colors", f.categoryId === c.id ? "border-foreground bg-foreground text-background" : "hover:border-foreground/40")}
                    >
                      <CategoryIcon name={c.icon} className="size-4" style={f.categoryId === c.id ? undefined : { color: c.color }} /> {c.name}
                    </button>
                  ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Código de activo" hint="El de la etiqueta del equipo, p. ej. DT-PC-0001">
                <Input value={f.assetTag} onChange={(e) => set("assetTag", e.target.value.toUpperCase())} required autoFocus={isNew} />
              </Field>
              <Field label="Serie">
                <Input value={f.serial} onChange={(e) => set("serial", e.target.value)} />
              </Field>
              <Field label="Marca">
                <Input value={f.brand} onChange={(e) => set("brand", e.target.value)} placeholder="Dell, HP, Jabra…" />
              </Field>
              <Field label="Modelo">
                <Input value={f.model} onChange={(e) => set("model", e.target.value)} />
              </Field>
            </div>
            {hasSpecs && (
              <section className="grid gap-3">
                <h3 className="text-sm font-semibold">Especificaciones</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Nombre en la red">
                    <Input value={f.hostname} onChange={(e) => set("hostname", e.target.value)} />
                  </Field>
                  <Field label="Procesador">
                    <Input value={f.cpu} onChange={(e) => set("cpu", e.target.value)} placeholder="Intel Core i5-10500" />
                  </Field>
                  <Field label="RAM">
                    <Input value={f.ram} onChange={(e) => set("ram", e.target.value)} placeholder="8 GB" />
                  </Field>
                  <Field label="Disco">
                    <Input value={f.storage} onChange={(e) => set("storage", e.target.value)} placeholder="256 GB SSD" />
                  </Field>
                  <Field label="Sistema operativo">
                    <Input value={f.os} onChange={(e) => set("os", e.target.value)} placeholder="Windows 11 Pro" />
                  </Field>
                </div>
              </section>
            )}
            <section className="grid gap-3">
              <h3 className="text-sm font-semibold">Compra y garantía</h3>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Proveedor">
                  <Input value={f.supplier} onChange={(e) => set("supplier", e.target.value)} />
                </Field>
                <Field label="Fecha de compra">
                  <Input type="date" value={f.purchaseDate} onChange={(e) => set("purchaseDate", e.target.value)} />
                </Field>
                <Field label="Garantía hasta">
                  <Input type="date" value={f.warrantyUntil} onChange={(e) => set("warrantyUntil", e.target.value)} />
                </Field>
              </div>
            </section>
            {isNew && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Sede">
                  <NativeSelect value={f.siteId} onChange={(e) => set("siteId", e.target.value)} required>
                    {meta.sites
                      .filter((s) => s.active)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </NativeSelect>
                </Field>
                <Field label="Estado inicial" hint="Luego lo arrastras a su puesto en el plano">
                  <NativeSelect value={f.status} onChange={(e) => set("status", e.target.value as Form["status"])}>
                    <option value="STORAGE">Almacén</option>
                    <option value="ACTIVE">En uso</option>
                    <option value="REPAIR">Reparación</option>
                  </NativeSelect>
                </Field>
              </div>
            )}
            <Field label="Observaciones">
              <Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} className="min-h-16" maxLength={500} />
            </Field>
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending} disabled={!f.categoryId}>
              {isNew ? "Registrar" : "Guardar cambios"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

// ── Ficha del equipo con bitácora ──

export function MachineDetailSheet({ machineId, onClose }: { machineId: string | null; onClose: () => void }) {
  const { can } = useInvAccess();
  const meta = useInventoryMeta();
  const actions = useInvActions();
  const { run } = useAction();
  const [editing, setEditing] = React.useState<Machine | null>(null);
  const [assigning, setAssigning] = React.useState(false);
  React.useEffect(() => setAssigning(false), [machineId]);
  const { data } = useQuery({ queryKey: ["inventory", "machine", machineId], queryFn: () => api.get<MachineDetail>(`/inventory/machines/${machineId}`), enabled: !!machineId });
  const m = data?.machine;
  const w = m ? warrantyInfo(m.warrantyUntil) : null;
  const assign = (p: PersonRef | null) =>
    m && run(() => api.post(`/inventory/machines/${m.id}/assign`, { userId: p?.id ?? null }), { success: p ? `Asignado a ${p.name}` : "Sin asignar", invalidate }).then(() => setAssigning(false));

  const spec = (label: string, v: string | null | undefined) =>
    v ? (
      <div className="grid gap-0.5">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="text-13 font-medium">{v}</dd>
      </div>
    ) : null;

  return (
    <Sheet open={!!machineId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="lg">
        <SheetHeader title={m?.assetTag ?? "Equipo"} description={m ? `${m.category?.name ?? m.type} ${[m.brand, m.model].filter(Boolean).join(" ")} · ${m.site.name}` : undefined} />
        <SheetBody className="grid content-start gap-5">
          {!m ? (
            <Skeleton className="h-48" />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex size-12 items-center justify-center rounded-lg bg-muted">
                  <CategoryIcon name={m.category?.icon} className="size-6" style={{ color: m.category?.color }} />
                </span>
                <StatusBadge status={m.status} />
                {w && <Badge variant={w.variant}>{w.label}</Badge>}
                {data.incidents.some((i) => i.status === "OPEN" || i.status === "IN_PROGRESS") && <Badge variant="danger">Incidencia abierta</Badge>}
                <div className="ml-auto flex gap-1.5">
                  {can("incident") && m.status !== "RETIRED" && (
                    <Button size="sm" variant="outline" onClick={() => actions.reportIssue(m)}>
                      <Wrench /> Reportar falla
                    </Button>
                  )}
                  {can("edit") && m.status !== "TRANSIT" && m.status !== "RETIRED" && (
                    <Button size="sm" variant="ghost" onClick={() => setEditing(m)}>
                      <Pencil /> Editar
                    </Button>
                  )}
                </div>
              </div>

              <Tabs defaultValue="datos" className="grid gap-4">
                <TabsList>
                  <TabsTrigger value="datos">Datos</TabsTrigger>
                  <TabsTrigger value="historial">Bitácora ({data.events.length})</TabsTrigger>
                  <TabsTrigger value="incidencias">Incidencias ({data.incidents.length})</TabsTrigger>
                </TabsList>

                <TabsContent value="datos" className="grid gap-5">
                  <div className="grid gap-3 border p-4 sm:grid-cols-2">
                    <div className="grid gap-0.5">
                      <dt className="text-xs text-muted-foreground">Ubicación</dt>
                      <dd className="text-13 font-medium">{m.workstation ? `Puesto ${m.workstation.code}` : m.location || "Sin puesto"} · {m.site.name}</dd>
                    </div>
                    <div className="grid gap-1">
                      <dt className="text-xs text-muted-foreground">Asignado a</dt>
                      {assigning ? (
                        <PersonPicker value={null} siteId={m.siteId} onChange={(p) => p && assign(p)} />
                      ) : (
                        <dd className="flex items-center gap-2 text-13 font-medium">
                          <UserRound className="size-3.5 text-muted-foreground" />
                          {m.assignedUser?.name ?? (m.assignedTo ? `${m.assignedTo} (texto anterior)` : "Sin asignar")}
                          {can("assign") && m.status !== "RETIRED" && (
                            <>
                              <button type="button" className="text-xs text-brand hover:underline" onClick={() => setAssigning(true)}>
                                Cambiar
                              </button>
                              {m.assignedUser && (
                                <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => assign(null)}>
                                  Quitar
                                </button>
                              )}
                            </>
                          )}
                        </dd>
                      )}
                    </div>
                  </div>
                  <dl className="grid gap-4 sm:grid-cols-3">
                    {spec("Serie", m.serial)}
                    {spec("Nombre en la red", m.hostname)}
                    {spec("Procesador", m.cpu)}
                    {spec("RAM", m.ram)}
                    {spec("Disco", m.storage)}
                    {spec("Sistema operativo", m.os)}
                    {spec("Proveedor", m.supplier)}
                    {spec("Compra", m.purchaseDate ? formatDate(m.purchaseDate) : null)}
                    {spec("Garantía hasta", m.warrantyUntil ? formatDate(m.warrantyUntil) : null)}
                    {spec("Último movimiento", m.lastMovedAt ? timeAgo(m.lastMovedAt) : null)}
                  </dl>
                  {m.notes && <p className="border-l-4 border-border pl-3 text-13 text-muted-foreground">{m.notes}</p>}
                </TabsContent>

                <TabsContent value="historial">
                  {data.events.length === 0 && data.transfers.length === 0 ? (
                    <p className="py-6 text-center text-13 text-muted-foreground">Sin movimientos registrados.</p>
                  ) : (
                    <ol className="grid border-l-2 border-brand pl-4">
                      {data.events.map((e) => (
                        <li key={e.id} className="relative grid gap-0.5 pb-4">
                          <span className="absolute top-1.5 -left-[21px] size-2 rotate-45 bg-brand" />
                          <p className="text-13">
                            <b>{KIND_LABEL[e.kind] ?? e.kind}</b> {e.detail && <span className="text-muted-foreground">· {e.detail}</span>}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatDateTime(e.at)}
                            {e.actorName && ` · ${e.actorName}`}
                          </p>
                        </li>
                      ))}
                      {data.transfers
                        .filter(() => !data.events.some((e) => e.kind === "TRANSFER"))
                        .map((t) => (
                          <li key={t.id} className="relative grid gap-0.5 pb-4">
                            <span className="absolute top-1.5 -left-[21px] size-2 rotate-45 bg-muted-foreground" />
                            <p className="text-13">
                              <b>Traslado</b> <span className="text-muted-foreground">· {t.from.name} → {t.to.name}</span>
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatDateTime(t.createdAt)}
                              {t.createdByName && ` · ${t.createdByName}`}
                            </p>
                          </li>
                        ))}
                    </ol>
                  )}
                </TabsContent>

                <TabsContent value="incidencias" className="grid gap-2">
                  {data.incidents.length === 0 && <p className="py-6 text-center text-13 text-muted-foreground">Sin incidencias.</p>}
                  {data.incidents.map((i) => (
                    <div key={i.id} className="grid gap-1 border px-3 py-2.5">
                      <p className="flex items-center gap-2 text-13 font-semibold">
                        {i.title}
                        <Badge variant={i.status === "RESOLVED" ? "success" : i.status === "CANCELLED" ? "outline" : i.status === "IN_PROGRESS" ? "warning" : "danger"} className="ml-auto">
                          {{ OPEN: "Abierta", IN_PROGRESS: "En atención", RESOLVED: "Resuelta", CANCELLED: "Cancelada" }[i.status]}
                        </Badge>
                      </p>
                      {i.description && <p className="text-13 text-muted-foreground">{i.description}</p>}
                      {i.resolution && <p className="text-13">Solución: {i.resolution}</p>}
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(i.createdAt)} · {i.reportedByName}
                        {i.technician && ` · técnico: ${i.technician}`}
                      </p>
                    </div>
                  ))}
                </TabsContent>
              </Tabs>
              <p className="text-xs text-muted-foreground">Categoría: {meta.category(m.categoryId)?.name ?? m.type}</p>
            </>
          )}
        </SheetBody>
      </SheetContent>
      <MachineFormSheet target={editing} siteId={m?.siteId ?? ""} onClose={() => setEditing(null)} />
    </Sheet>
  );
}

// ── Traslado entre sedes ──

const REASONS = ["Refuerzo de campaña", "Rotación entre sedes", "Reparación", "Cierre o apertura de sede", "Otro"];

export function TransferDialog({ machines, onClose }: { machines: { id: string; assetTag: string; siteId: string }[] | null; onClose: () => void }) {
  const meta = useInventoryMeta();
  const { run, pending } = useAction();
  const [toSiteId, setTo] = React.useState("");
  const [reason, setReason] = React.useState(REASONS[0]!);
  const [note, setNote] = React.useState("");
  React.useEffect(() => {
    if (machines) (setTo(""), setReason(REASONS[0]!), setNote(""));
  }, [machines]);
  const origins = new Set(machines?.map((m) => m.siteId));
  const options = meta.sites.filter((s) => s.active && !(origins.size === 1 && origins.has(s.id)));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!machines) return;
    const ok = await run(() => api.post("/inventory/transfers", { machineIds: machines.map((m) => m.id), toSiteId, reason, note: note || null }), {
      success: `${machines.length} ${machines.length === 1 ? "equipo en camino" : "equipos en camino"}`,
      invalidate,
    });
    if (ok) onClose();
  };
  return (
    <Dialog open={!!machines} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader title="Trasladar a otra sede" description="Quedan en tránsito hasta que la sede destino confirme que los recibió." />
        <form onSubmit={submit} className="grid gap-4">
          <p className="max-h-20 overflow-y-auto text-13 text-muted-foreground">{machines?.map((m) => m.assetTag).join(" · ")}</p>
          <Field label="Sede destino">
            <NativeSelect value={toSiteId} onChange={(e) => setTo(e.target.value)} required>
              <option value="">Elige una sede…</option>
              {options.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Motivo">
            <NativeSelect value={reason} onChange={(e) => setReason(e.target.value)}>
              {REASONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Nota (opcional)">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-16" maxLength={300} />
          </Field>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancelar
              </Button>
            </DialogClose>
            <Button type="submit" loading={pending} disabled={!toSiteId}>
              <Truck /> Enviar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
