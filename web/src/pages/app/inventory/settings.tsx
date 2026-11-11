import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, Download, FileSpreadsheet, MapPin, Pencil, Plus, Tags, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import type { ImportPreview, InventoryCategory, Site } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect, SwitchRow } from "@/components/ui/form";
import { Badge } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogHeader, Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, useConfirm } from "@/components/ui/overlay";
import { cn } from "@/lib/utils";
import { CATEGORY_ICON_NAMES, CategoryIcon, SLOT_LABEL, invalidate, useInventoryMeta } from "./shared";

const COLORS = ["#DC2626", "#B91C1C", "#0A0A0A", "#374151", "#6B7280", "#15803D", "#B45309", "#0369A1", "#7C3AED"];

// ── Categorías ──

export function CategoriesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const meta = useInventoryMeta();
  const { run } = useAction();
  const confirm = useConfirm();
  const [editing, setEditing] = React.useState<InventoryCategory | { kind: "EQUIPMENT" | "SUPPLY" } | null>(null);
  const group = (kind: "EQUIPMENT" | "SUPPLY") => (
    <section className="grid gap-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">{kind === "EQUIPMENT" ? "Equipos" : "Insumos"}</h3>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEditing({ kind })}>
          <Plus /> Agregar
        </Button>
      </div>
      {(kind === "EQUIPMENT" ? meta.equipmentCats : meta.supplyCats).map((c) => (
        <div key={c.id} className={cn("flex items-center gap-3 border px-3 py-2", !c.active && "opacity-50")}>
          <CategoryIcon name={c.icon} className="size-4" style={{ color: c.color }} />
          <span className="flex-1 text-13 font-medium">{c.name}</span>
          <span className="text-xs text-muted-foreground">{kind === "EQUIPMENT" ? SLOT_LABEL[c.slot ?? "OTHER"] : c.unit}</span>
          {!c.active && <Badge variant="outline">Inactiva</Badge>}
          <Button size="icon-sm" variant="ghost" onClick={() => setEditing(c)} aria-label={`Editar ${c.name}`}>
            <Pencil />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Eliminar ${c.name}`}
            onClick={async () => {
              if (await confirm({ title: `¿Eliminar la categoría ${c.name}?`, description: "Solo se puede si no tiene registros; si los tiene, desactívala.", confirmText: "Eliminar", destructive: true }))
                run(() => api.del(`/inventory/categories/${c.id}`), { success: "Categoría eliminada", invalidate });
            }}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
    </section>
  );
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader title="Categorías" description="Los tipos de equipo y de insumo que maneja la empresa. El lugar en el kit define dónde aparece el equipo en el puesto." />
        <SheetBody className="grid content-start gap-6">
          {group("EQUIPMENT")}
          {group("SUPPLY")}
        </SheetBody>
      </SheetContent>
      <CategoryDialog target={editing} onClose={() => setEditing(null)} />
    </Sheet>
  );
}

function CategoryDialog({ target, onClose }: { target: InventoryCategory | { kind: "EQUIPMENT" | "SUPPLY" } | null; onClose: () => void }) {
  const { run, pending } = useAction();
  const isNew = !!target && !("id" in target);
  const [f, setF] = React.useState({ kind: "EQUIPMENT" as "EQUIPMENT" | "SUPPLY", key: "", name: "", icon: "Box", color: "#374151", slot: "OTHER", unit: "unid.", active: true });
  React.useEffect(() => {
    if (!target) return;
    if ("id" in target) setF({ kind: target.kind, key: target.key, name: target.name, icon: target.icon, color: target.color, slot: target.slot ?? "OTHER", unit: target.unit ?? "unid.", active: target.active });
    else setF({ kind: target.kind, key: "", name: "", icon: target.kind === "EQUIPMENT" ? "Box" : "Package", color: "#374151", slot: "OTHER", unit: "unid.", active: true });
  }, [target]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = { ...f, slot: f.kind === "EQUIPMENT" ? f.slot : null, unit: f.kind === "SUPPLY" ? f.unit : null, key: f.key || f.name.normalize("NFD").replace(/[^A-Za-z0-9]/g, "").slice(0, 20) };
    const ok = await run(() => (isNew ? api.post("/inventory/categories", body) : api.put(`/inventory/categories/${(target as InventoryCategory).id}`, body)), { success: isNew ? "Categoría creada" : "Categoría actualizada", invalidate });
    if (ok) onClose();
  };
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader title={isNew ? "Nueva categoría" : "Editar categoría"} description={f.kind === "EQUIPMENT" ? "Equipo con código propio" : "Insumo con stock"} />
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre">
              <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={40} autoFocus />
            </Field>
            {f.kind === "EQUIPMENT" ? (
              <Field label="Lugar en el kit del puesto">
                <NativeSelect value={f.slot} onChange={(e) => setF({ ...f, slot: e.target.value })}>
                  {Object.entries(SLOT_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : (
              <Field label="Unidad por defecto">
                <Input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} maxLength={16} />
              </Field>
            )}
          </div>
          <Field label="Icono">
            <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto border p-2">
              {CATEGORY_ICON_NAMES.map((n) => (
                <button key={n} type="button" title={n} onClick={() => setF({ ...f, icon: n })} className={cn("flex size-8 items-center justify-center", f.icon === n ? "bg-foreground text-background" : "hover:bg-accent")}>
                  <CategoryIcon name={n} className="size-4" />
                </button>
              ))}
            </div>
          </Field>
          <Field label="Color">
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button key={c} type="button" aria-label={`Color ${c}`} onClick={() => setF({ ...f, color: c })} className={cn("size-7 rounded-full ring-offset-2 ring-offset-background", f.color === c && "ring-2 ring-foreground")} style={{ background: c }} />
              ))}
            </div>
          </Field>
          {!isNew && <SwitchRow title="Activa" description="Una categoría inactiva no se ofrece al registrar." checked={f.active} onCheckedChange={(v) => setF({ ...f, active: v })} />}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Guardar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Sedes ──

export function SitesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data } = useQuery({ queryKey: ["inventory", "sites"], queryFn: () => api.get<Site[]>("/inventory/sites"), enabled: open });
  const [editing, setEditing] = React.useState<Site | "new" | null>(null);
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader title="Sedes" description="Cada sede tiene su plano de sala, su almacén y su stock." />
        <SheetBody className="grid content-start gap-2">
          <Button className="w-fit" onClick={() => setEditing("new")}>
            <Building2 /> Nueva sede
          </Button>
          {data?.map((s) => (
            <button key={s.id} type="button" onClick={() => setEditing(s)} className={cn("flex items-center gap-3 border px-3 py-2.5 text-left hover:bg-accent", !s.active && "opacity-50")}>
              <MapPin className="size-4 text-brand" />
              <span className="grid flex-1">
                <span className="text-13 font-semibold">
                  {s.code} · {s.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {s.counts.total} equipos · {s.stations} puestos{s.address && ` · ${s.address}`}
                </span>
              </span>
              {!s.active && <Badge variant="outline">Inactiva</Badge>}
              <Pencil className="size-4 text-muted-foreground" />
            </button>
          ))}
        </SheetBody>
      </SheetContent>
      <SiteSheet target={editing} onClose={() => setEditing(null)} />
    </Sheet>
  );
}

function SiteSheet({ target, onClose }: { target: Site | "new" | null; onClose: () => void }) {
  const isNew = target === "new";
  const { run, pending } = useAction();
  const blank = { code: "", name: "", address: "", city: "Lima", active: true };
  const [form, setForm] = React.useState(blank);
  React.useEffect(() => {
    if (!target) return;
    setForm(target === "new" ? blank : { code: target.code, name: target.name, address: target.address ?? "", city: target.city ?? "", active: target.active });
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = { ...form, address: form.address || null, city: form.city || null };
    const ok = await run(() => (isNew ? api.post("/inventory/sites", body) : api.put(`/inventory/sites/${(target as Site).id}`, body)), { success: isNew ? "Sede creada" : "Sede actualizada", invalidate });
    if (ok) onClose();
  };
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader title={isNew ? "Nueva sede" : `Sede ${(target as Site | null)?.name ?? ""}`} />
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-[110px_1fr]">
            <Field label="Código" hint="2 a 6 letras">
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} required maxLength={6} />
            </Field>
            <Field label="Nombre">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Dirección">
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
            <Field label="Ciudad">
              <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </Field>
          </div>
          <SwitchRow title="Sede activa" description="Una sede inactiva no recibe equipos nuevos ni traslados." checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              {isNew ? "Crear sede" : "Guardar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Importar / exportar Excel ──

export function ImportExportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { run, pending } = useAction();
  const [kind, setKind] = React.useState<"equipment" | "supplies">("equipment");
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const input = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    setFile(null);
    setPreview(null);
  }, [kind, open]);
  const send = async (apply: boolean) => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    const res = await run(() => api.post<ImportPreview>(`/inventory/import/${kind}${apply ? "?apply=1" : ""}`, fd), apply ? { success: "Importación completa", invalidate } : {});
    if (res) setPreview(res);
  };
  const download = (path: string, name: string) => api.download(path, name).catch((e: Error) => toast.error(e.message));
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="lg">
        <SheetHeader title="Importar y exportar" description="Carga masiva desde Excel con vista previa antes de guardar, y descargas del inventario." />
        <SheetBody className="grid content-start gap-6">
          <div className="grid grid-cols-2 gap-1">
            {(["equipment", "supplies"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)} className={cn("rounded-md py-2 text-13 font-medium", kind === k ? "bg-brand text-white" : "bg-muted text-muted-foreground")}>
                {k === "equipment" ? "Equipos" : "Insumos"}
              </button>
            ))}
          </div>

          <section className="grid gap-3">
            <h3 className="text-sm font-semibold">1. Descarga la plantilla</h3>
            <p className="text-13 text-muted-foreground">Incluye una hoja de ayuda con las categorías y sedes válidas. Si el código o SKU ya existe, la fila lo actualiza.</p>
            <Button variant="outline" className="w-fit" onClick={() => download(`/inventory/import/template/${kind}`, `plantilla-${kind === "equipment" ? "equipos" : "insumos"}.xlsx`)}>
              <FileSpreadsheet /> Plantilla de {kind === "equipment" ? "equipos" : "insumos"}
            </Button>
          </section>

          <section className="grid gap-3">
            <h3 className="text-sm font-semibold">2. Sube el archivo y revisa</h3>
            <input ref={input} type="file" accept=".xlsx" className="hidden" onChange={(e) => (setFile(e.target.files?.[0] ?? null), setPreview(null))} />
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={() => input.current?.click()}>
                <Upload /> {file ? file.name : "Elegir Excel (.xlsx)"}
              </Button>
              <Button onClick={() => send(false)} disabled={!file} loading={pending && !preview}>
                Revisar
              </Button>
            </div>
            {preview && (
              <div className="grid gap-3">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="success">{preview.summary.create} nuevos</Badge>
                  <Badge variant="default">{preview.summary.update} actualizados</Badge>
                  <Badge variant={preview.summary.error ? "danger" : "outline"}>{preview.summary.error} con error</Badge>
                  {preview.applied && <Badge variant="solid">Guardado</Badge>}
                </div>
                <div className="max-h-72 overflow-y-auto border">
                  <table className="w-full text-left text-13">
                    <thead>
                      <tr className="border-b text-xs font-medium text-muted-foreground">
                        <th className="px-3 py-2">Fila</th>
                        <th className="px-3 py-2">Código</th>
                        <th className="px-3 py-2">Resultado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {preview.rows.map((r) => (
                        <tr key={r.row} className={cn(r.action === "error" && "bg-destructive/5")}>
                          <td className="px-3 py-1.5 tabular-nums">{r.row}</td>
                          <td className="px-3 py-1.5 font-medium">{r.key}</td>
                          <td className="px-3 py-1.5">{r.action === "error" ? <span className="text-destructive">{r.message}</span> : r.action === "create" ? "Se crea" : "Se actualiza"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          <section className="grid gap-3">
            <h3 className="text-sm font-semibold">Exportar</h3>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => download("/inventory/export/equipment", `equipos-${new Date().toISOString().slice(0, 10)}.xlsx`)}>
                <Download /> Equipos
              </Button>
              <Button variant="outline" onClick={() => download("/inventory/export/supplies", `insumos-${new Date().toISOString().slice(0, 10)}.xlsx`)}>
                <Download /> Insumos y stock
              </Button>
            </div>
          </section>
        </SheetBody>
        <SheetFooter>
          <Button variant="outline" onClick={onClose}>
            Cerrar
          </Button>
          <Button onClick={() => send(true)} disabled={!preview || preview.applied || preview.summary.create + preview.summary.update === 0} loading={pending && !!preview}>
            <Tags /> Importar {preview ? preview.summary.create + preview.summary.update : ""} filas válidas
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
