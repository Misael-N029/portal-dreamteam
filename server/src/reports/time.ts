/** Utilidades de fecha en hora de Lima (UTC-5 todo el año: Perú no cambia de hora). */

const LIMA_OFFSET_MS = -5 * 3_600_000;
const DAY_MS = 86_400_000;

const shift = (d: Date) => new Date(d.getTime() + LIMA_OFFSET_MS);

/** "2026-10-23" de una fecha. Las fechas sin hora ("2026-10-23") se toman tal cual. */
export function limaDay(value: Date | string | null | undefined): string {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : shift(d).toISOString().slice(0, 10);
}

/** "08:05" de una fecha */
export function limaTime(value: Date | string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "-" : shift(d).toISOString().slice(11, 16);
}

export const limaToday = () => limaDay(new Date());

/** Día de la semana en Lima (0 = domingo) */
export const limaWeekday = (d = new Date()) => shift(d).getUTCDay();

/** "23/10/2026" */
export function formatDay(value: string | null | undefined): string {
  const day = limaDay(value ?? null);
  if (!day) return "-";
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
}

/** "23 oct 2026, 18:30" */
export function formatDateTime(d: Date) {
  return new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", dateStyle: "medium", timeStyle: "short" }).format(d);
}

export function parseTimes(times: string): string[] {
  return [
    ...new Set(
      times
        .split(",")
        .map((t) => t.trim())
        .filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)),
    ),
  ].sort();
}

/** Próximas ejecuciones programadas (hasta `limit`) dentro de los próximos 8 días */
export function nextRuns(times: string, days: number[], limit = 1, from = new Date()): Date[] {
  const slots = parseTimes(times);
  const active = days.length ? days : [0, 1, 2, 3, 4, 5, 6];
  const out: Date[] = [];
  // Medianoche de hoy en Lima, expresada en UTC
  const todayStart = Date.parse(`${limaDay(from)}T00:00:00.000Z`) - LIMA_OFFSET_MS;
  for (let offset = 0; offset <= 8 && out.length < limit; offset++) {
    const dayStart = todayStart + offset * DAY_MS;
    if (!active.includes(new Date(dayStart + LIMA_OFFSET_MS).getUTCDay())) continue;
    for (const s of slots) {
      const [h, m] = s.split(":").map(Number);
      const at = new Date(dayStart + (h! * 60 + m!) * 60_000);
      if (at > from) out.push(at);
      if (out.length >= limit) break;
    }
  }
  return out;
}
