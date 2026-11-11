import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Recipient, Report, ReportRun } from "@prisma/client";
import { env } from "../lib/env.js";
import { prisma } from "../lib/prisma.js";
import { decryptPassword } from "../lib/vault.js";
import { parseJson } from "../lib/json.js";
import { getSettings } from "../lib/settings.js";
import { fetchSales } from "./crm.js";
import { parseDefinition, runDefinition, type ReportData } from "./definition.js";
import { renderReportEmail, renderReportHtml, renderScreenshotEmail } from "./html.js";
import { buildExcel } from "./excel.js";
import { captureTargets, htmlToPng, type Target } from "./browser.js";
import { sendMedia } from "./whatsapp.js";
import { sendEmail } from "./mailer.js";
import { formatDay, limaTime, limaToday } from "./time.js";

type Level = "INFO" | "SUCCESS" | "WARNING" | "ERROR";
type Step = "SCHEDULER" | "CRM" | "RENDER" | "SEND" | "SYSTEM";

export const runDir = (runId: string) => path.resolve(env.storageDir, "runs", runId);

export async function log(runId: string | null, level: Level, step: Step, message: string) {
  await prisma.reportLog.create({ data: { runId, level, step, message: message.slice(0, 1000) } });
}

export type StoredTarget = Omit<Target, "password"> & { passwordEnc?: string | null };

export const parseTargets = (raw: string): StoredTarget[] => {
  const v = parseJson<unknown>(raw, []);
  return Array.isArray(v) ? v : [];
};

/** Reemplaza {reporte} {subtitulo} {fecha} {total} en asuntos y textos */
export function fillTemplate(template: string, vars: { reporte: string; subtitulo: string; total: number }) {
  return template
    .replace(/\{reporte\}/g, vars.reporte)
    .replace(/\{subtitulo\}/g, vars.subtitulo)
    .replace(/\{fecha\}/g, formatDay(limaToday()))
    .replace(/\{total\}/g, String(vars.total))
    .replace(/\s+—\s+—/g, " —")
    .trim();
}

/** Respeta la ventana horaria del destinatario (hora de Lima) */
function insideWindow(r: Recipient) {
  if (!r.windowStart || !r.windowEnd) return true;
  const now = limaTime(new Date());
  return now >= r.windowStart && now <= r.windowEnd;
}

const safeName = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

type Built = {
  records: number;
  html: string | null;
  images: { name: string; data: Buffer; url?: string }[];
  excel: { name: string; data: Buffer } | null;
  email: { html: string; attachments: { filename: string; content: Buffer; cid?: string }[] } | null;
  title: string;
};

async function buildCrmReport(run: ReportRun, report: Report): Promise<Built> {
  const def = parseDefinition(report.config);
  const brand = (await getSettings()).platformName.replace(/^Portal\s+/i, "") || "DreamTeam";
  await log(run.id, "INFO", "CRM", `Consultando ventas del CRM${def.campaignId ? ` (campaña ${def.campaignId})` : ""}`);
  const sales = await fetchSales(def.campaignId);
  await log(run.id, "INFO", "CRM", `${sales.length} ventas recibidas; aplicando ${def.filters.length} filtro(s)`);
  const data: ReportData = runDefinition(def, sales, report.subtitle ?? "");
  await log(run.id, "SUCCESS", "CRM", `${data.records} registros en ${data.groups.length} grupo(s)`);

  const stamp = formatDay(limaToday()).replace(/\//g, "-");
  const base = `${safeName(report.name)}_${stamp}`;
  const html = renderReportHtml(data, brand);
  const built: Built = { records: data.records, html, images: [], excel: null, email: null, title: data.title };
  if (!data.records) return built;

  if (def.output.image) {
    await log(run.id, "INFO", "RENDER", "Generando la imagen del reporte");
    built.images.push({ name: `${base}.png`, data: await htmlToPng(html) });
  }
  if (def.output.excel !== "none") {
    await log(run.id, "INFO", "RENDER", `Generando Excel (${def.output.excel === "per_group" ? "una hoja por grupo" : "una sola hoja"})`);
    built.excel = { name: `${base}.xlsx`, data: await buildExcel(data, def.output.excel) };
  }
  built.email = {
    html: def.output.email ? renderReportEmail(data, brand) : renderScreenshotEmail(data.title, built.images.map((_, i) => ({ url: "", cid: `img${i}` })), brand),
    attachments: [
      ...(def.output.email ? [] : built.images.map((img, i) => ({ filename: img.name, content: img.data, cid: `img${i}` }))),
      ...(built.excel ? [{ filename: built.excel.name, content: built.excel.data }] : []),
    ],
  };
  return built;
}

async function buildScreenshotReport(run: ReportRun, report: Report): Promise<Built> {
  const targets: Target[] = parseTargets(report.targets)
    .filter((t) => t.url)
    .map(({ passwordEnc, ...t }) => ({ ...t, password: decryptPassword(passwordEnc) }));
  if (!targets.length) throw new Error("El reporte no tiene URLs para capturar");
  await log(run.id, "INFO", "RENDER", `Abriendo navegador para ${targets.length} captura(s)`);
  const shots = await captureTargets(targets, (level, message) => log(run.id, level, "RENDER", message));
  if (!shots.length) throw new Error("No se pudo capturar ninguna de las páginas");
  const base = safeName(report.name);
  const images = shots.map((s, i) => ({ name: `${base}_${i + 1}.png`, data: s.image, url: s.url }));
  return {
    records: images.length,
    html: null,
    images,
    excel: null,
    title: report.name,
    email: {
      html: renderScreenshotEmail(report.name, images.map((img, i) => ({ url: img.url ?? "", cid: `img${i}` }))),
      attachments: images.map((img, i) => ({ filename: img.name, content: img.data, cid: `img${i}` })),
    },
  };
}

/** Ejecuta una corrida ya marcada como RUNNING por el worker */
export async function executeRun(runId: string) {
  const started = Date.now();
  const run = await prisma.reportRun.findUniqueOrThrow({ where: { id: runId }, include: { report: { include: { recipients: { include: { recipient: true } } } } } });
  const report = run.report;
  const label = { AUTOMATIC: "programada", MANUAL: "manual", TEST: "de prueba", PREVIEW: "de vista previa" }[run.type] ?? run.type;
  await log(runId, "INFO", "SCHEDULER", `Ejecución ${label} de “${report.name}”${run.attempt > 1 ? ` (reintento ${run.attempt - 1})` : ""}`);

  const finish = async (data: Partial<ReportRun>) => {
    await prisma.reportRun.update({ where: { id: runId }, data: { ...data, finishedAt: new Date(), durationMs: Date.now() - started } });
  };

  try {
    const built = report.kind === "SCREENSHOT" ? await buildScreenshotReport(run, report) : await buildCrmReport(run, report);

    // Imágenes y Excel en disco para verlos y descargarlos desde el historial
    if (built.images.length || built.excel) {
      await mkdir(runDir(runId), { recursive: true });
      await Promise.all(built.images.map((img, i) => writeFile(path.join(runDir(runId), `${i + 1}.png`), img.data)));
      if (built.excel) await writeFile(path.join(runDir(runId), "report.xlsx"), built.excel.data);
    }
    await prisma.reportRun.update({
      where: { id: runId },
      data: { html: built.html, images: built.images.length, attachment: built.excel?.name ?? null, records: built.records },
    });

    if (run.type === "PREVIEW") {
      await log(runId, "SUCCESS", "SYSTEM", "Vista previa lista (no se envió a nadie)");
      return finish({ status: "SUCCESS" });
    }
    if (!built.records && report.skipIfEmpty) {
      await log(runId, "WARNING", "SYSTEM", "Sin registros: no se envió nada (opción “No enviar si está vacío”)");
      return finish({ status: "SKIPPED" });
    }

    // Destinatarios
    let recipients = report.recipients.map((rr) => rr.recipient).filter((r) => r.active);
    if (run.type === "TEST") {
      const test = await prisma.recipient.findUnique({ where: { id: run.testRecipientId ?? "" } });
      recipients = test ? [test] : [];
    } else if (run.type === "AUTOMATIC") {
      const outside = recipients.filter((r) => !insideWindow(r));
      for (const r of outside) await log(runId, "WARNING", "SEND", `Omitido ${r.name}: fuera de su horario (${r.windowStart}–${r.windowEnd})`);
      recipients = recipients.filter(insideWindow);
    }
    if (!recipients.length) throw new Error("No hay destinatarios activos para este envío");

    const vars = { reporte: built.title, subtitulo: report.subtitle ?? "", total: built.records };
    const testTag = run.type === "TEST" ? " (prueba)" : "";
    const sent: string[] = [];
    let failed = 0;

    // Correo: un solo mensaje con todos los correos en "Para"
    const emails = recipients.filter((r) => r.kind === "EMAIL");
    if (emails.length && built.email) {
      const subject = fillTemplate(report.emailSubject || "{reporte} — {subtitulo} — {fecha} ({total} registros)", vars) + testTag;
      await log(runId, "INFO", "SEND", `Enviando correo a ${emails.length} destinatario(s): ${subject}`);
      try {
        await sendEmail({ to: emails.map((r) => r.value), subject, ...built.email });
        sent.push(...emails.map((r) => r.name));
        await prisma.recipient.updateMany({ where: { id: { in: emails.map((r) => r.id) } }, data: { lastDeliveryAt: new Date() } });
        await log(runId, "SUCCESS", "SEND", "Correo enviado");
      } catch (err) {
        failed += emails.length;
        await log(runId, "ERROR", "SEND", (err as Error).message);
      }
    }

    // WhatsApp: imagen(es) del reporte; si el reporte no tiene imagen, el Excel como documento
    const caption = fillTemplate(report.caption || "📊 *{reporte}*\n{subtitulo}\n📅 {fecha} · {total} registros", vars) + testTag;
    for (const r of recipients.filter((x) => x.kind !== "EMAIL")) {
      await log(runId, "INFO", "SEND", `Enviando por WhatsApp a ${r.name}`);
      try {
        if (built.images.length) {
          for (const [i, img] of built.images.entries()) {
            await sendMedia(r.value, { data: img.data, fileName: img.name, type: "image", caption: built.images.length > 1 ? `${caption}\n(${i + 1}/${built.images.length})` : caption });
          }
        } else if (built.excel) {
          await sendMedia(r.value, { data: built.excel.data, fileName: built.excel.name, type: "document", caption });
        } else {
          throw new Error("El reporte no genera imagen ni Excel para WhatsApp: activa una de esas salidas");
        }
        sent.push(r.name);
        await prisma.recipient.update({ where: { id: r.id }, data: { lastDeliveryAt: new Date() } });
        await log(runId, "SUCCESS", "SEND", `Entregado a ${r.name}`);
      } catch (err) {
        failed++;
        await log(runId, "ERROR", "SEND", `${r.name}: ${(err as Error).message}`);
      }
    }

    if (!sent.length) throw new Error("No se pudo entregar a ningún destinatario");
    if (run.type !== "TEST") await prisma.report.update({ where: { id: report.id }, data: { lastRunAt: new Date() } });
    const status = failed ? "PARTIAL" : "SUCCESS";
    await log(runId, failed ? "WARNING" : "SUCCESS", "SYSTEM", `Finalizado: entregado a ${sent.length}${failed ? `, ${failed} con error` : ""}`);
    return finish({ status, sentTo: JSON.stringify(sent) });
  } catch (err) {
    const message = (err as Error).message.split("\n")[0]!;
    await log(runId, "ERROR", "SYSTEM", message);
    await finish({ status: "FAILED", errorMessage: message });
    // Reintento de las ejecuciones programadas
    if (run.type === "AUTOMATIC" && run.attempt <= report.retryCount) {
      await prisma.reportRun.create({ data: { reportId: report.id, type: "AUTOMATIC", attempt: run.attempt + 1, requestedBy: "Programador" } });
      await log(runId, "WARNING", "SCHEDULER", `Se programó el reintento ${run.attempt} de ${report.retryCount}`);
    }
  }
}

/** Borra las imágenes y el HTML de ejecuciones antiguas (el registro y la bitácora se conservan) */
export async function cleanupOldRuns(days = 30) {
  const before = new Date(Date.now() - days * 86_400_000);
  const old = await prisma.reportRun.findMany({ where: { createdAt: { lt: before }, OR: [{ images: { gt: 0 } }, { html: { not: null } }] }, select: { id: true } });
  for (const r of old) await rm(runDir(r.id), { recursive: true, force: true });
  await prisma.reportRun.updateMany({ where: { id: { in: old.map((r) => r.id) } }, data: { images: 0, html: null } });
  // Vistas previas: solo se guardan 2 días
  const previews = await prisma.reportRun.findMany({ where: { type: "PREVIEW", createdAt: { lt: new Date(Date.now() - 2 * 86_400_000) } }, select: { id: true } });
  for (const r of previews) await rm(runDir(r.id), { recursive: true, force: true });
  await prisma.reportRun.deleteMany({ where: { id: { in: previews.map((r) => r.id) } } });
  await prisma.reportLog.deleteMany({ where: { at: { lt: new Date(Date.now() - 90 * 86_400_000) } } });
  return old.length + previews.length;
}

export async function listRunImages(runId: string) {
  try {
    return (await readdir(runDir(runId))).filter((f) => f.endsWith(".png")).sort((a, b) => parseInt(a) - parseInt(b));
  } catch {
    return [];
  }
}
