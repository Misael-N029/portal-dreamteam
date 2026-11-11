/**
 * Worker del Centro de Reportes: proceso aparte del API (servicio portal-worker en el VPS).
 * - Cada 15 s revisa los horarios (hora de Lima) y encola las ejecuciones que tocan.
 * - Procesa la cola de ejecuciones (programadas, manuales, pruebas y vistas previas) de a una.
 * - Publica su estado y el de WhatsApp para que el portal los muestre.
 */
import { env } from "./lib/env.js";
import { prisma } from "./lib/prisma.js";
import { Prisma } from "@prisma/client";
import { cleanupOldRuns, executeRun, log } from "./reports/engine.js";
import { whatsappState } from "./reports/whatsapp.js";
import { limaDay, limaTime, limaWeekday, parseTimes } from "./reports/time.js";
import { cleanupNotifications, notifyDueAnnouncements } from "./lib/notifications.js";

const setSetting = (key: string, value: unknown) =>
  prisma.setting.upsert({ where: { key }, create: { key, value: JSON.stringify(value) }, update: { value: JSON.stringify(value) } });

async function schedulerEnabled() {
  const row = await prisma.setting.findUnique({ where: { key: "reports.scheduler" } });
  try {
    return row ? (JSON.parse(row.value) as { enabled: boolean }).enabled !== false : true;
  } catch {
    return true;
  }
}

/** Encola los reportes cuyo horario coincide con este minuto o el anterior (por si el ciclo se atrasó) */
async function scheduleTick() {
  if (!(await schedulerEnabled())) return;
  const now = new Date();
  const slots = [now, new Date(now.getTime() - 60_000)].map((d) => ({ day: limaDay(d), time: limaTime(d), weekday: limaWeekday(d) }));
  const reports = await prisma.report.findMany({ where: { active: true } });
  for (const r of reports) {
    const days = JSON.parse(r.daysOfWeek) as number[];
    const times = parseTimes(r.times);
    for (const s of slots) {
      if (!times.includes(s.time) || !(days.length ? days : [0, 1, 2, 3, 4, 5, 6]).includes(s.weekday)) continue;
      try {
        const run = await prisma.reportRun.create({ data: { reportId: r.id, type: "AUTOMATIC", slotKey: `${r.id}|${s.day}|${s.time}`, requestedBy: "Programador" } });
        await log(run.id, "INFO", "SCHEDULER", `Horario ${s.time} de “${r.name}”: ejecución encolada`);
      } catch (err) {
        // P2002: ese horario ya se encoló (otro ciclo u otro worker)
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
      }
    }
  }
}

/** Toma la ejecución en cola más antigua; el update condicional evita que dos workers tomen la misma */
async function processQueue() {
  for (;;) {
    const next = await prisma.reportRun.findFirst({ where: { status: "QUEUED" }, orderBy: { createdAt: "asc" } });
    if (!next) return;
    const claimed = await prisma.reportRun.updateMany({ where: { id: next.id, status: "QUEUED" }, data: { status: "RUNNING", startedAt: new Date() } });
    if (!claimed.count) continue;
    await executeRun(next.id).catch(async (err) => {
      console.error(err);
      await prisma.reportRun.update({ where: { id: next.id }, data: { status: "FAILED", errorMessage: String(err?.message ?? err), finishedAt: new Date() } });
    });
  }
}

async function heartbeat() {
  await setSetting("reports.worker", { at: new Date().toISOString(), pid: process.pid });
}

async function refreshWhatsApp() {
  const s = await whatsappState();
  await setSetting("reports.whatsapp", { ...s, at: new Date().toISOString() });
}

/** Ejecuciones que quedaron a medias si el worker se reinició */
async function recoverStale() {
  const stale = await prisma.reportRun.updateMany({
    where: { status: "RUNNING", startedAt: { lt: new Date(Date.now() - 15 * 60_000) } },
    data: { status: "FAILED", errorMessage: "El worker se reinició durante la ejecución", finishedAt: new Date() },
  });
  if (stale.count) console.log(`${stale.count} ejecución(es) interrumpida(s) marcadas como fallidas`);
}

let busy = false;
async function loop() {
  if (busy) return;
  busy = true;
  try {
    await heartbeat();
    await scheduleTick();
    await processQueue();
  } catch (err) {
    console.error("Error en el ciclo del worker:", err);
  } finally {
    busy = false;
  }
}

async function main() {
  console.log(`Portal DreamTeam worker iniciado · imágenes en ${env.storageDir} · horarios en hora de Lima`);
  await recoverStale();
  await refreshWhatsApp().catch(() => undefined);
  await cleanupOldRuns().catch((e) => console.error("Limpieza:", e));
  await loop();
  // La cola se revisa seguido para que "Enviar ahora" y la vista previa respondan rápido
  setInterval(loop, 3_000);
  // El estado de WhatsApp cada 5 minutos (además mantiene despierta una Evolution API alojada en Render)
  setInterval(() => refreshWhatsApp().catch(() => undefined), 5 * 60_000);
  setInterval(() => cleanupOldRuns().catch((e) => console.error("Limpieza:", e)), 6 * 3_600_000);
  // Comunicados programados: se avisan en la campanita al llegar su hora
  await notifyDueAnnouncements();
  setInterval(notifyDueAnnouncements, 60_000);
  setInterval(() => cleanupNotifications().catch((e) => console.error("Limpieza de avisos:", e)), 6 * 3_600_000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}
