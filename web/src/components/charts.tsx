import * as React from "react";
import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

/**
 * Gráficos del dashboard, hechos a mano (sin librería):
 * barras finas ≤ 24px con punta redondeada, una sola línea base, cuadrícula tenue,
 * tooltip en hover y foco, leyenda cuando hay 2+ series y el texto siempre en tinta de texto.
 */

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export type Granularity = "day" | "week" | "month" | "year";

/** "2026-10-21" → "21 oct" · "2026-10" → "oct 2026" · "2026" → "2026" · semana → "sem. 19 oct" */
export function bucketLabel(key: string, bucket: Granularity) {
  if (bucket === "year") return key;
  if (bucket === "month") return `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
  const label = `${Number(key.slice(8, 10))} ${MONTHS[Number(key.slice(5, 7)) - 1]}`;
  return bucket === "week" ? `sem. ${label}` : label;
}

const DAY = 86_400_000;
const LIMA = -5 * 3_600_000;

/** Clave del período en hora de Lima (Perú no cambia de hora): día, semana que empieza el lunes, mes o año. */
export function bucketKey(d: Date, g: Granularity) {
  const lima = new Date(d.getTime() + LIMA);
  if (g === "year") return lima.toISOString().slice(0, 4);
  if (g === "month") return lima.toISOString().slice(0, 7);
  if (g === "week") return new Date(lima.getTime() - ((lima.getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
  return lima.toISOString().slice(0, 10);
}

/** Marcas "lindas" para el eje: 0 y uno o dos escalones redondos hasta cubrir el máximo. */
function niceTicks(max: number) {
  if (max <= 0) return [0, 1];
  const raw = max / 2;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= top + 1e-9; t += step) ticks.push(Math.round(t));
  return ticks;
}

// ── Tooltip ──

type Tip = { x: number; y: number; title: string; rows: { label: string; value: React.ReactNode; color?: string }[] };

function useTooltip() {
  const ref = React.useRef<HTMLDivElement>(null);
  const [tip, setTip] = React.useState<Tip | null>(null);
  const show = (el: HTMLElement, data: Omit<Tip, "x" | "y">) => {
    const box = ref.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (!box) return;
    setTip({ ...data, x: r.left - box.left + r.width / 2, y: r.top - box.top });
  };
  const node = tip && (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 min-w-36 -translate-x-1/2 -translate-y-full rounded-lg border bg-popover px-3 py-2 text-13 shadow-md"
      style={{ left: Math.max(70, Math.min(tip.x, (ref.current?.clientWidth ?? 0) - 70)), top: tip.y - 8 }}
    >
      <p className="mb-1 text-xs text-muted-foreground">{tip.title}</p>
      {tip.rows.map((r) => (
        <p key={r.label} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 text-muted-foreground">
            {r.color && <span className="h-0.5 w-3 rounded-full" style={{ background: r.color }} />}
            {r.label}
          </span>
          <span className="font-semibold text-foreground tabular-nums">{r.value}</span>
        </p>
      ))}
    </div>
  );
  return { ref, show, hide: () => setTip(null), node };
}

// ── Tarjeta de gráfico ──

export function ChartCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("flex flex-col gap-4 p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-0.5">
          <h3 className="text-sm font-semibold">{title}</h3>
          {description && <p className="text-13 text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

export type Series = { key: string; label: string; color: string };

export function Legend({ series }: { series: Series[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {series.map((s) => (
        <span key={s.key} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

// ── Columnas en el tiempo (una serie, o varias apiladas) ──

export function ColumnChart({
  data,
  series,
  bucket,
  height = 180,
  emptyText = "Sin datos en este período.",
}: {
  data: ({ key: string } & Record<string, number | string>)[];
  series: Series[];
  bucket: Granularity;
  height?: number;
  emptyText?: string;
}) {
  const tt = useTooltip();
  const totals = data.map((d) => series.reduce((n, s) => n + Number(d[s.key] ?? 0), 0));
  const max = Math.max(0, ...totals);
  const ticks = niceTicks(max);
  const top = ticks.at(-1)!;
  // Etiquetas del eje X: primera, intermedia y última, para que nunca se pisen
  const labelAt = new Set([0, Math.floor((data.length - 1) / 2), data.length - 1]);

  if (max === 0) return <p className="grid place-items-center text-13 text-muted-foreground" style={{ height }}>{emptyText}</p>;

  return (
    <div className="grid gap-3">
      {series.length > 1 && <Legend series={series} />}
      <div ref={tt.ref} className="relative">
        {/* pt-2: la etiqueta superior del eje no se monta sobre la descripción */}
        <div className="flex gap-2 pt-3">
          {/* Eje Y */}
          <div className="relative w-7 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums" style={{ height }}>
            {ticks.map((t) => (
              <span key={t} className="absolute right-0 -translate-y-1/2" style={{ bottom: `${(t / top) * 100}%` }}>
                {t}
              </span>
            ))}
          </div>
          <div className="relative flex-1" style={{ height }}>
            {ticks.map((t) => (
              <div key={t} className="absolute inset-x-0 border-t" style={{ bottom: `${(t / top) * 100}%`, borderColor: t === 0 ? "var(--viz-ink-soft)" : "var(--viz-grid)" }} />
            ))}
            <div className="absolute inset-0 flex items-end">
              {data.map((d, i) => (
                <button
                  key={d.key}
                  type="button"
                  className="group flex h-full flex-1 items-end justify-center px-px outline-none"
                  aria-label={`${bucketLabel(d.key, bucket)}: ${series.map((s) => `${s.label} ${d[s.key]}`).join(", ")}`}
                  onMouseEnter={(e) =>
                    tt.show(e.currentTarget, {
                      title: bucketLabel(d.key, bucket),
                      rows: series.map((s) => ({ label: s.label, value: Number(d[s.key] ?? 0), color: s.color })),
                    })
                  }
                  onFocus={(e) =>
                    tt.show(e.currentTarget, {
                      title: bucketLabel(d.key, bucket),
                      rows: series.map((s) => ({ label: s.label, value: Number(d[s.key] ?? 0), color: s.color })),
                    })
                  }
                  onMouseLeave={tt.hide}
                  onBlur={tt.hide}
                >
                  <span
                    className="flex w-full max-w-6 flex-col-reverse gap-0.5 transition-opacity group-hover:opacity-80 group-focus-visible:ring-2 group-focus-visible:ring-ring"
                    style={{ height: `${(totals[i] / top) * 100}%` }}
                  >
                    {series.map((s, si) => {
                      const v = Number(d[s.key] ?? 0);
                      if (!v) return null;
                      const isTop = series.slice(si + 1).every((x) => !Number(d[x.key] ?? 0));
                      return (
                        <span
                          key={s.key}
                          className={cn("min-h-0.5 w-full", isTop && "rounded-t")}
                          style={{ flexGrow: v, background: s.color }}
                        />
                      );
                    })}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="ml-9 flex text-[11px] text-muted-foreground">
          {data.map((d, i) => (
            <span key={d.key} className="flex-1 text-center whitespace-nowrap">
              {labelAt.has(i) ? bucketLabel(d.key, bucket) : ""}
            </span>
          ))}
        </div>
        {tt.node}
      </div>
    </div>
  );
}

// ── Barras horizontales (ranking o distribución) ──

export function BarList({
  rows,
  color = "var(--viz-ink)",
  format = (v: number) => String(v),
  emptyText = "Sin datos.",
}: {
  rows: { label: string; value: number; hint?: string }[];
  color?: string;
  format?: (v: number) => string;
  emptyText?: string;
}) {
  const tt = useTooltip();
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="py-6 text-center text-13 text-muted-foreground">{emptyText}</p>;
  return (
    <div ref={tt.ref} className="relative grid gap-2.5">
      {rows.map((r) => (
        <button
          key={r.label}
          type="button"
          className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-3 rounded text-left text-13 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onMouseEnter={(e) => tt.show(e.currentTarget, { title: r.label, rows: [{ label: r.hint ?? "Valor", value: format(r.value) }] })}
          onFocus={(e) => tt.show(e.currentTarget, { title: r.label, rows: [{ label: r.hint ?? "Valor", value: format(r.value) }] })}
          onMouseLeave={tt.hide}
          onBlur={tt.hide}
        >
          <span className="truncate" title={r.label}>
            {r.label}
          </span>
          <span className="h-3 rounded-r" style={{ width: `${Math.max(r.value ? 1.5 : 0, (r.value / max) * 100)}%`, background: color }} />
          <span className="min-w-8 text-right font-medium tabular-nums">{format(r.value)}</span>
        </button>
      ))}
      {tt.node}
    </div>
  );
}

// ── Indicador con variación ──

export function Kpi({
  label,
  value,
  hint,
  delta,
  upIsGood = true,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  /** Diferencia contra el período anterior (null = no aplica, p. ej. en "Todo") */
  delta?: number | null;
  upIsGood?: boolean;
  icon?: LucideIcon;
}) {
  const tone = delta == null || delta === 0 ? "text-muted-foreground" : delta > 0 === upIsGood ? "text-success" : "text-destructive";
  const DeltaIcon = !delta ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <Card className="grid gap-2 p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-13 text-muted-foreground">{label}</p>
        {Icon && <Icon className="size-4 text-muted-foreground" />}
      </div>
      <p className="text-[28px] leading-none font-semibold tracking-tight">{value}</p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {delta != null && (
          <span className={cn("inline-flex items-center gap-0.5 font-medium", tone)}>
            <DeltaIcon className="size-3.5" />
            {delta > 0 ? `+${delta}` : delta} vs período anterior
          </span>
        )}
        {hint && <span className="text-muted-foreground">{hint}</span>}
      </div>
    </Card>
  );
}
