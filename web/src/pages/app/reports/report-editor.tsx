import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Database, Eye, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, NativeSelect, SwitchRow, Textarea } from "@/components/ui/form";
import { Badge, Card, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/misc";
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader } from "@/components/ui/overlay";
import { cn } from "@/lib/utils";
import { DAYS, RECIPIENT_KIND_LABEL, useReportsMeta, type Column, type Condition, type Definition, type Metric, type Recipient, type Report, type Target } from "./shared";

type Draft = Omit<Report, "id" | "lastRunAt" | "nextRunAt">;

export type EditorTarget = { mode: "edit"; report: Report } | { mode: "new"; draft: Draft };

type CrmFields = { total: number; fields: { key: string; label: string | null; values: string[] }[] };

const invalidate = [["reports", "list"], ["reports", "overview"], ["reports", "recipients"]];

/** Lista editable con subir, bajar y quitar */
function useListOps<T>(list: T[], onChange: (v: T[]) => void) {
  return {
    update: (i: number, patch: Partial<T>) => onChange(list.map((x, j) => (j === i ? { ...x, ...patch } : x))),
    remove: (i: number) => onChange(list.filter((_, j) => j !== i)),
    move: (i: number, dir: -1 | 1) => {
      const j = i + dir;
      if (j < 0 || j >= list.length) return;
      const next = [...list];
      [next[i], next[j]] = [next[j]!, next[i]!];
      onChange(next);
    },
    add: (item: T) => onChange([...list, item]),
  };
}

function RowTools({ i, total, ops }: { i: number; total: number; ops: { move: (i: number, d: -1 | 1) => void; remove: (i: number) => void } }) {
  return (
    <div className="flex shrink-0 items-center">
      <Button type="button" variant="ghost" size="icon-sm" className="size-7" disabled={i === 0} onClick={() => ops.move(i, -1)} aria-label="Subir">
        <ArrowUp />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" className="size-7" disabled={i === total - 1} onClick={() => ops.move(i, 1)} aria-label="Bajar">
        <ArrowDown />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" className="size-7" onClick={() => ops.remove(i)} aria-label="Quitar">
        <Trash2 />
      </Button>
    </div>
  );
}

function Section({ title, description, children, action }: { title: string; description?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <div className="flex items-end justify-between gap-3">
        <div className="grid gap-0.5">
          <h3 className="text-sm font-semibold">{title}</h3>
          {description && <p className="text-13 text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Editor de una condición (filtros e indicadores "que cumplen") */
function ConditionEditor({ value, onChange, fieldsListId, valuesFor }: { value: Condition; onChange: (c: Condition) => void; fieldsListId: string; valuesFor: (f: string) => string[] }) {
  const { data: meta } = useReportsMeta();
  const op = meta?.ops.find((o) => o.key === value.op);
  const valuesId = React.useId();
  return (
    <div className="grid flex-1 gap-2 sm:grid-cols-[1fr_1fr_1fr]">
      <Input
        value={value.fields.join(", ")}
        onChange={(e) => onChange({ ...value, fields: e.target.value.split(",").map((f) => f.trim()).filter(Boolean) })}
        list={fieldsListId}
        placeholder="campo (ej. status)"
        aria-label="Campo"
        title="Varios campos separados por coma: basta con que se cumpla en uno"
        className="font-mono text-13"
      />
      <NativeSelect value={value.op} onChange={(e) => onChange({ ...value, op: e.target.value })} aria-label="Condición">
        {meta?.ops.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
      {op?.needsValue ? (
        <>
          <Input value={value.value ?? ""} onChange={(e) => onChange({ ...value, value: e.target.value })} list={valuesId} placeholder="valor" aria-label="Valor" />
          <datalist id={valuesId}>
            {valuesFor(value.fields[0] ?? "").map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </>
      ) : value.op === "last_days" ? (
        <Input type="number" min={1} max={366} value={value.days ?? 7} onChange={(e) => onChange({ ...value, days: Number(e.target.value) })} aria-label="Días" />
      ) : op?.date ? (
        <label className="flex items-center gap-2 text-13 text-muted-foreground">
          <Checkbox checked={!!value.orEmpty} onCheckedChange={(v) => onChange({ ...value, orEmpty: !!v })} /> incluir vacíos
        </label>
      ) : (
        <span />
      )}
    </div>
  );
}

function ContentEditor({ def, onChange }: { def: Definition; onChange: (d: Definition) => void }) {
  const { data: meta } = useReportsMeta();
  const fieldsListId = React.useId();
  const [crm, setCrm] = React.useState<CrmFields | null>(null);
  const [loadingFields, setLoadingFields] = React.useState(false);
  const set = <K extends keyof Definition>(k: K, v: Definition[K]) => onChange({ ...def, [k]: v });

  const loadFields = async () => {
    setLoadingFields(true);
    try {
      const res = await api.get<CrmFields>(`/reports/crm-fields${def.campaignId ? `?campaignId=${def.campaignId}` : ""}`);
      setCrm(res);
      toast.success(`${res.total} ventas leídas del CRM: ${res.fields.length} campos disponibles`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoadingFields(false);
    }
  };

  const fieldKeys = [...new Set([...Object.keys(meta?.knownFields ?? {}), ...(crm?.fields.map((f) => f.key) ?? [])])];
  const fieldLabel = (k: string) => meta?.knownFields[k] ?? crm?.fields.find((f) => f.key === k)?.label ?? null;
  const valuesFor = (f: string) => crm?.fields.find((x) => x.key === f)?.values ?? [];

  const filters = useListOps(def.filters, (v) => set("filters", v));
  const columns = useListOps(def.columns, (v) => set("columns", v));
  const metrics = useListOps(def.metrics, (v) => set("metrics", v));
  const stats = useListOps(def.groupStats, (v) => set("groupStats", v));

  return (
    <div className="grid gap-8">
      <datalist id={fieldsListId}>
        {fieldKeys.map((k) => (
          <option key={k} value={k}>
            {fieldLabel(k) ?? k}
          </option>
        ))}
      </datalist>

      <Section
        title="Fuente"
        description="Las ventas que se leen del CRM."
        action={
          <Button type="button" variant="outline" size="sm" onClick={loadFields} loading={loadingFields}>
            <Database /> {crm ? "Recargar campos" : "Leer campos del CRM"}
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Campaña del CRM (id)" hint="4 = Telefonía Izaguirre. Vacío = todas las campañas.">
            <Input type="number" min={1} value={def.campaignId ?? ""} onChange={(e) => set("campaignId", e.target.value ? Number(e.target.value) : null)} />
          </Field>
          <Field label="Título dentro del reporte">
            <Input value={def.title} onChange={(e) => set("title", e.target.value)} required />
          </Field>
        </div>
        {crm && (
          <p className="text-xs text-muted-foreground">
            Se leyeron {crm.total} ventas. Al escribir un campo o un valor verás sugerencias reales.
          </p>
        )}
      </Section>

      <Section
        title="Qué ventas entran"
        description="Deben cumplirse todos los filtros. En un filtro con varios campos separados por coma basta con que se cumpla en uno."
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => filters.add({ fields: ["status"], op: "eq", value: "" })}>
            <Plus /> Filtro
          </Button>
        }
      >
        {def.filters.length === 0 && <p className="text-13 text-muted-foreground">Sin filtros: entran todas las ventas de la campaña.</p>}
        {def.filters.map((c, i) => (
          <div key={i} className="flex items-start gap-2">
            <ConditionEditor value={c} onChange={(v) => filters.update(i, v)} fieldsListId={fieldsListId} valuesFor={valuesFor} />
            <RowTools i={i} total={def.filters.length} ops={filters} />
          </div>
        ))}
        {meta && (
          <div className="grid gap-2 rounded-lg border p-3">
            {meta.transforms.map((t) => (
              <label key={t.key} className="flex cursor-pointer items-start gap-3">
                <Checkbox
                  className="mt-0.5"
                  checked={def.transforms.includes(t.key)}
                  onCheckedChange={(v) => set("transforms", v ? [...def.transforms, t.key] : def.transforms.filter((x) => x !== t.key))}
                />
                <span className="grid gap-0.5">
                  <span className="text-13 font-medium">{t.label}</span>
                  <span className="text-xs text-muted-foreground">{t.description}</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </Section>

      <Section title="Orden y agrupación">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Ordenar por">
            <Input value={def.sort?.field ?? ""} onChange={(e) => set("sort", e.target.value ? { field: e.target.value, dir: def.sort?.dir ?? "asc" } : null)} list={fieldsListId} placeholder="sin orden" className="font-mono text-13" />
          </Field>
          <Field label="Sentido">
            <NativeSelect value={def.sort?.dir ?? "asc"} disabled={!def.sort} onChange={(e) => def.sort && set("sort", { ...def.sort, dir: e.target.value as "asc" | "desc" })}>
              <option value="asc">Ascendente (más antiguo primero)</option>
              <option value="desc">Descendente</option>
            </NativeSelect>
          </Field>
          <Field label="Agrupar por" hint="Una tabla por cada valor (ej. supervisor).">
            <Input value={def.groupBy ?? ""} onChange={(e) => set("groupBy", e.target.value || null)} list={fieldsListId} placeholder="sin agrupar" className="font-mono text-13" />
          </Field>
        </div>
        {def.groupBy && (
          <div className="grid gap-3 rounded-lg border p-3">
            <Field label="Nombre del grupo cuando el campo está vacío">
              <Input value={def.emptyGroupLabel} onChange={(e) => set("emptyGroupLabel", e.target.value)} className="max-w-xs" />
            </Field>
            <div className="flex items-center justify-between">
              <p className="text-13 font-medium">Avance por grupo</p>
              <Button type="button" variant="ghost" size="sm" onClick={() => stats.add({ label: "Contraoferta", field: "contraoferta_estado" })}>
                <Plus /> Agregar
              </Button>
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">En la cabecera de cada grupo: cuántos registros tienen gestión, ej. “Contraoferta 4/5”.</p>
            {def.groupStats.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input value={s.label} onChange={(e) => stats.update(i, { label: e.target.value })} placeholder="Etiqueta" />
                <Input value={s.field} onChange={(e) => stats.update(i, { field: e.target.value })} list={fieldsListId} placeholder="campo" className="font-mono text-13" />
                <RowTools i={i} total={def.groupStats.length} ops={stats} />
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Columnas"
        description="En el orden en que aparecen en la tabla, el correo y el Excel."
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => columns.add({ field: "", label: "", format: "text" })}>
            <Plus /> Columna
          </Button>
        }
      >
        {def.columns.map((c: Column, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="grid flex-1 gap-2 sm:grid-cols-[1fr_1fr_1fr]">
              <Input
                value={c.field}
                onChange={(e) => columns.update(i, { field: e.target.value, label: c.label || fieldLabel(e.target.value) || "" })}
                list={fieldsListId}
                placeholder="campo"
                className="font-mono text-13"
                required
              />
              <Input value={c.label} onChange={(e) => columns.update(i, { label: e.target.value })} placeholder="Título" required />
              <NativeSelect value={c.format} onChange={(e) => columns.update(i, { format: e.target.value })}>
                {meta?.formats.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <RowTools i={i} total={def.columns.length} ops={columns} />
          </div>
        ))}
      </Section>

      <Section
        title="Indicadores"
        description="Las cifras grandes de arriba. Usa “Sección” para agruparlas en filas con título."
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => metrics.add({ label: "Total", kind: "count", tone: "default" })}>
            <Plus /> Indicador
          </Button>
        }
      >
        {def.metrics.map((m: Metric, i) => (
          <Card key={i} className="grid gap-2 p-3">
            <div className="flex items-center gap-2">
              <div className="grid flex-1 gap-2 sm:grid-cols-4">
                <Input value={m.label} onChange={(e) => metrics.update(i, { label: e.target.value })} placeholder="Etiqueta" required />
                <NativeSelect value={m.kind} onChange={(e) => metrics.update(i, { kind: e.target.value as Metric["kind"] })}>
                  <option value="count">Total de registros</option>
                  <option value="groups">Cantidad de grupos</option>
                  <option value="management">Por estado de gestión</option>
                  <option value="where">Registros que cumplen…</option>
                </NativeSelect>
                <Input value={m.section ?? ""} onChange={(e) => metrics.update(i, { section: e.target.value || undefined })} placeholder="Sección (opcional)" />
                <NativeSelect value={m.tone} onChange={(e) => metrics.update(i, { tone: e.target.value as Metric["tone"] })}>
                  <option value="default">Neutro</option>
                  <option value="brand">Rojo</option>
                  <option value="good">Verde</option>
                  <option value="warn">Ámbar</option>
                  <option value="muted">Gris</option>
                </NativeSelect>
              </div>
              <RowTools i={i} total={def.metrics.length} ops={metrics} />
            </div>
            {m.kind === "management" && (
              <div className="grid gap-2 sm:grid-cols-2">
                <Input value={m.field ?? ""} onChange={(e) => metrics.update(i, { field: e.target.value })} list={fieldsListId} placeholder="campo (ej. contraoferta_estado)" className="font-mono text-13" />
                <NativeSelect value={m.category ?? "ok"} onChange={(e) => metrics.update(i, { category: e.target.value as Metric["category"] })}>
                  <option value="ok">Gestionado OK (OK o Recuperado)</option>
                  <option value="pending">Pendiente (otro valor)</option>
                  <option value="none">Sin seguimiento</option>
                </NativeSelect>
              </div>
            )}
            {m.kind === "where" && (
              <ConditionEditor value={m.condition ?? { fields: ["status"], op: "eq", value: "" }} onChange={(c) => metrics.update(i, { condition: c })} fieldsListId={fieldsListId} valuesFor={valuesFor} />
            )}
          </Card>
        ))}
      </Section>

      <Section title="Cómo sale" description="Qué se genera en cada envío.">
        <div className="grid gap-2 sm:grid-cols-3">
          {(
            [
              ["email", "Reporte en el cuerpo del correo"],
              ["image", "Imagen para WhatsApp"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 hover:bg-accent/60">
              <Checkbox checked={def.output[k]} onCheckedChange={(v) => set("output", { ...def.output, [k]: !!v })} />
              <span className="text-13 font-medium">{label}</span>
            </label>
          ))}
          <NativeSelect value={def.output.excel} onChange={(e) => set("output", { ...def.output, excel: e.target.value as Definition["output"]["excel"] })} className="h-auto py-2.5">
            <option value="none">Sin Excel</option>
            <option value="per_group">Excel: una hoja por grupo</option>
            <option value="single">Excel: una sola hoja</option>
          </NativeSelect>
        </div>
      </Section>
    </div>
  );
}

function TargetsEditor({ targets, onChange }: { targets: Target[]; onChange: (t: Target[]) => void }) {
  const ops = useListOps(targets, onChange);
  return (
    <Section
      title="Páginas a capturar"
      description="El navegador entra a cada URL (con login si hace falta) y envía la captura completa."
      action={
        <Button type="button" variant="outline" size="sm" onClick={() => ops.add({ url: "", loginUrl: "", username: "", password: "" })}>
          <Plus /> URL
        </Button>
      }
    >
      {targets.map((t, i) => (
        <Card key={i} className="grid gap-3 p-4">
          <div className="flex items-center justify-between">
            <Badge variant="outline">Captura {i + 1}</Badge>
            <RowTools i={i} total={targets.length} ops={ops} />
          </div>
          <Field label="URL a capturar">
            <Input type="url" value={t.url} onChange={(e) => ops.update(i, { url: e.target.value })} placeholder="http://31.97.165.147/sales/sales" required />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="URL de login (opcional)">
              <Input type="url" value={t.loginUrl ?? ""} onChange={(e) => ops.update(i, { loginUrl: e.target.value })} placeholder="https://…/login" />
            </Field>
            <Field label="Usuario">
              <Input value={t.username ?? ""} onChange={(e) => ops.update(i, { username: e.target.value })} autoComplete="off" />
            </Field>
            <Field label="Contraseña" hint={t.hasPassword ? "Guardada. Escribe solo para cambiarla." : undefined}>
              <Input type="password" value={t.password ?? ""} onChange={(e) => ops.update(i, { password: e.target.value })} autoComplete="new-password" placeholder={t.hasPassword ? "••••••••" : ""} />
            </Field>
          </div>
          <details className="text-13">
            <summary className="cursor-pointer text-muted-foreground">Selectores avanzados (si el login no se detecta solo)</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Input value={t.usernameSelector ?? ""} onChange={(e) => ops.update(i, { usernameSelector: e.target.value })} placeholder='input[name="email"]' className="font-mono text-xs" />
              <Input value={t.passwordSelector ?? ""} onChange={(e) => ops.update(i, { passwordSelector: e.target.value })} placeholder='input[type="password"]' className="font-mono text-xs" />
              <Input value={t.submitSelector ?? ""} onChange={(e) => ops.update(i, { submitSelector: e.target.value })} placeholder='button[type="submit"]' className="font-mono text-xs" />
            </div>
          </details>
        </Card>
      ))}
    </Section>
  );
}

function TimesInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = React.useState("08:00");
  const times = value ? value.split(",").filter(Boolean) : [];
  const add = () => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft) || times.includes(draft)) return;
    onChange([...times, draft].sort().join(","));
  };
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {times.map((t) => (
          <Badge key={t} variant="solid" className="py-1 pr-1 text-13 tabular-nums">
            {t}
            <button type="button" onClick={() => onChange(times.filter((x) => x !== t).join(","))} className="rounded p-0.5 hover:bg-background/20" aria-label={`Quitar ${t}`}>
              <X />
            </button>
          </Badge>
        ))}
        {!times.length && <span className="text-13 text-muted-foreground">Sin horarios.</span>}
      </div>
      <div className="flex max-w-xs gap-2">
        <Input type="time" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <Button type="button" variant="outline" onClick={add}>
          <Plus /> Agregar
        </Button>
      </div>
    </div>
  );
}

function DeliveryEditor({ draft, set, recipients }: { draft: Draft; set: <K extends keyof Draft>(k: K, v: Draft[K]) => void; recipients: Recipient[] }) {
  const toggleRecipient = (id: string) => set("recipientIds", draft.recipientIds.includes(id) ? draft.recipientIds.filter((x) => x !== id) : [...draft.recipientIds, id]);
  return (
    <div className="grid gap-8">
      <Section title="Cuándo" description="Hora de Lima. Puedes poner varios horarios el mismo día.">
        <TimesInput value={draft.times} onChange={(v) => set("times", v)} />
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((d, i) => {
            const on = draft.daysOfWeek.includes(i);
            return (
              <button
                key={d}
                type="button"
                onClick={() => set("daysOfWeek", on ? draft.daysOfWeek.filter((x) => x !== i) : [...draft.daysOfWeek, i])}
                className={cn("h-9 w-12 rounded-md border text-13 font-medium transition-colors", on ? "border-foreground bg-foreground text-background" : "hover:bg-accent")}
                aria-pressed={on}
              >
                {d}
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="A quién" description="Los correos reciben un solo mensaje con todos en “Para”. WhatsApp se envía a cada uno.">
        {recipients.length === 0 && <p className="text-13 text-muted-foreground">Aún no hay destinatarios. Créalos en la pestaña Destinatarios.</p>}
        <div className="grid gap-1.5 sm:grid-cols-2">
          {recipients.map((r) => (
            <label key={r.id} className={cn("flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 hover:bg-accent/60", !r.active && "opacity-60")}>
              <Checkbox checked={draft.recipientIds.includes(r.id)} onCheckedChange={() => toggleRecipient(r.id)} />
              <span className="grid min-w-0">
                <span className="truncate text-13 font-medium">{r.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {RECIPIENT_KIND_LABEL[r.kind]} · {r.value}
                  {!r.active && " · inactivo"}
                </span>
              </span>
            </label>
          ))}
        </div>
      </Section>

      <Section title="Mensajes" description="Variables: {reporte} {subtitulo} {fecha} {total}">
        <Field label="Asunto del correo">
          <Input value={draft.emailSubject ?? ""} onChange={(e) => set("emailSubject", e.target.value)} placeholder="{reporte} — {subtitulo} — {fecha} ({total} registros)" />
        </Field>
        <Field label="Texto que acompaña la imagen en WhatsApp">
          <Textarea value={draft.caption ?? ""} onChange={(e) => set("caption", e.target.value)} className="min-h-20" placeholder={"📊 *{reporte}*\n{subtitulo}\n📅 {fecha} · {total} registros"} />
        </Field>
      </Section>

      <Section title="Si algo sale mal">
        <div className="divide-y rounded-lg border px-4">
          <SwitchRow title="No enviar si está vacío" description="Si el reporte sale sin registros, no se envía nada (como el Apps Script)." checked={draft.skipIfEmpty} onCheckedChange={(v) => set("skipIfEmpty", v)} />
          <div className="flex items-center justify-between gap-6 py-3">
            <span className="grid gap-1">
              <span className="text-sm font-medium">Reintentos</span>
              <span className="text-13 text-muted-foreground">Veces que se reintenta un envío programado que falla.</span>
            </span>
            <Input type="number" min={0} max={5} value={draft.retryCount} onChange={(e) => set("retryCount", Number(e.target.value))} className="w-20" />
          </div>
        </div>
      </Section>
    </div>
  );
}

export function ReportEditor({ target, onClose, onPreview }: { target: EditorTarget | null; onClose: () => void; onPreview: (runId: string) => void }) {
  const { run, pending } = useAction();
  const { data: recipients } = useQuery({ queryKey: ["reports", "recipients"], queryFn: () => api.get<Recipient[]>("/reports/recipients"), enabled: !!target });
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [tab, setTab] = React.useState("content");

  React.useEffect(() => {
    if (!target) return;
    setTab("content");
    if (target.mode === "edit") {
      const { id: _id, lastRunAt: _l, nextRunAt: _n, ...rest } = target.report;
      setDraft(structuredClone(rest));
    } else setDraft(structuredClone(target.draft));
  }, [target]);

  if (!target || !draft) return null;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const isNew = target.mode === "new";

  const save = async (andPreview: boolean) => {
    if (!draft.times) return toast.error("Agrega al menos un horario");
    const body = { ...draft, description: draft.description || null };
    const saved = await run(() => (isNew ? api.post<Report>("/reports/reports", body) : api.put<Report>(`/reports/reports/${target.report.id}`, body)), {
      success: isNew ? "Reporte creado" : "Cambios guardados",
      invalidate,
    });
    if (!saved) return;
    if (andPreview) {
      const res = await run(() => api.post<{ id: string }>(`/reports/reports/${saved.id}/run`, { type: "PREVIEW" }));
      if (res) onPreview(res.id);
    }
    onClose();
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="xl">
        <SheetHeader title={isNew ? "Nuevo reporte" : draft.name} description={draft.kind === "SCREENSHOT" ? "Captura de pantalla de una o varias páginas" : "Reporte sobre las ventas del CRM"} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save(false);
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <SheetBody className="grid content-start gap-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nombre">
                <Input value={draft.name} onChange={(e) => set("name", e.target.value)} required autoFocus={isNew} />
              </Field>
              <Field label="Subtítulo" hint="Se muestra bajo el título (ej. la campaña).">
                <Input value={draft.subtitle ?? ""} onChange={(e) => set("subtitle", e.target.value)} placeholder="Telefonía Izaguirre" />
              </Field>
              <Field label="Descripción (interna)" className="sm:col-span-2">
                <Input value={draft.description ?? ""} onChange={(e) => set("description", e.target.value)} />
              </Field>
            </div>
            <SwitchRow title="Reporte activo" description="Si está apagado no se envía en sus horarios, pero puedes enviarlo a mano." checked={draft.active} onCheckedChange={(v) => set("active", v)} />
            <Tabs value={tab} onValueChange={setTab} className="grid gap-6">
              <TabsList className="w-fit">
                <TabsTrigger value="content">{draft.kind === "SCREENSHOT" ? "Páginas" : "Contenido"}</TabsTrigger>
                <TabsTrigger value="delivery">Envío</TabsTrigger>
              </TabsList>
              <TabsContent value="content">
                {draft.kind === "SCREENSHOT" ? (
                  <TargetsEditor targets={draft.targets} onChange={(t) => set("targets", t)} />
                ) : (
                  <ContentEditor def={draft.config} onChange={(d) => set("config", d)} />
                )}
              </TabsContent>
              <TabsContent value="delivery">
                <DeliveryEditor draft={draft} set={set} recipients={recipients ?? []} />
              </TabsContent>
            </Tabs>
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="ghost" className="mr-auto" onClick={() => save(true)} disabled={pending}>
              <Eye /> Guardar y ver vista previa
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              {isNew ? "Crear reporte" : "Guardar cambios"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
