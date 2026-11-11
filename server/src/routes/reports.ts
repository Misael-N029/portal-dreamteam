import { Router, type RequestHandler } from "express";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { can, currentUser } from "../lib/auth.js";
import { badRequest, forbidden, notFound } from "../lib/http.js";
import { visibleModulesWhere } from "../lib/modules.js";
import { encryptPassword } from "../lib/vault.js";
import { audit } from "../lib/audit.js";
import { parseJson } from "../lib/json.js";
import { COLUMN_FORMATS, CONDITION_OPS, TRANSFORMS, definitionSchema, parseDefinition } from "../reports/definition.js";
import { BLANK_DEFINITION, KNOWN_FIELDS, PRESETS } from "../reports/presets.js";
import { listRunImages, parseTargets, runDir } from "../reports/engine.js";
import { fetchSales } from "../reports/crm.js";
import { nextRuns, parseTimes, limaDay } from "../reports/time.js";
import { publicIntegrations, updateIntegrations } from "../reports/config.js";
import { whatsappQr, whatsappReset } from "../reports/whatsapp.js";
import { sendEmail } from "../reports/mailer.js";

/** Centro de Reportes. Verlo exige tener habilitado el módulo; cambiar algo, el permiso reports.manage. */
export const reportsRouter = Router();

reportsRouter.use(async (req, _res, next) => {
  const user = currentUser(req);
  const allowed = await prisma.module.findFirst({ where: { type: "INTERNAL", internalKey: "reportes", ...visibleModulesWhere(user) } });
  if (!allowed) throw forbidden("El Centro de Reportes no está habilitado para tu usuario");
  next();
});

const manage: RequestHandler<Record<string, string>> = (req, _res, next) => {
  if (!can(currentUser(req), "reports.manage")) throw forbidden("Tu rol puede ver los reportes, pero no modificarlos ni enviarlos");
  next();
};

const readJson = parseJson;

async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row ? readJson(row.value, fallback) : fallback;
}

const reportInclude = { recipients: { select: { recipientId: true } } } as const;

function presentReport(r: Prisma.ReportGetPayload<{ include: typeof reportInclude }>) {
  const days = readJson<number[]>(r.daysOfWeek, []);
  return {
    ...r,
    config: readJson(r.config, {}),
    daysOfWeek: days,
    // Las contraseñas de las capturas nunca salen del servidor
    targets: parseTargets(r.targets).map(({ passwordEnc, ...t }) => ({ ...t, password: "", hasPassword: !!passwordEnc })),
    recipientIds: r.recipients.map((x) => x.recipientId),
    recipients: undefined,
    nextRunAt: r.active ? (nextRuns(r.times, days)[0]?.toISOString() ?? null) : null,
  };
}

// ── Catálogos para el editor ──

reportsRouter.get("/meta", (_req, res) => {
  res.json({ ops: CONDITION_OPS, formats: COLUMN_FORMATS, transforms: TRANSFORMS, presets: PRESETS, blank: BLANK_DEFINITION, knownFields: KNOWN_FIELDS });
});

/** Campos y valores reales del CRM (para sugerir en filtros y columnas) */
reportsRouter.get("/crm-fields", manage, async (req, res) => {
  const campaignId = req.query.campaignId ? Number(req.query.campaignId) : null;
  const sales = await fetchSales(Number.isFinite(campaignId) ? campaignId : null);
  const fields = new Map<string, Set<string>>();
  for (const s of sales.slice(0, 2000)) {
    for (const [k, v] of Object.entries(s)) {
      if (!fields.has(k)) fields.set(k, new Set());
      const t = v === null || v === undefined ? "" : String(v);
      const set = fields.get(k)!;
      if (t && t.length <= 60 && set.size < 40) set.add(t);
    }
  }
  res.json({
    total: sales.length,
    fields: [...fields.entries()]
      .map(([key, values]) => ({ key, label: KNOWN_FIELDS[key] ?? null, values: values.size < 40 ? [...values].sort() : [] }))
      .sort((a, b) => Number(!!b.label) - Number(!!a.label) || a.key.localeCompare(b.key)),
  });
});

// ── Resumen ──

reportsRouter.get("/overview", async (_req, res) => {
  const today = new Date(`${limaDay(new Date())}T05:00:00.000Z`);
  const [reports, runsToday, recent, worker, whatsapp, scheduler] = await Promise.all([
    prisma.report.findMany({ where: { active: true }, select: { id: true, name: true, kind: true, times: true, daysOfWeek: true } }),
    prisma.reportRun.groupBy({ by: ["status"], where: { createdAt: { gte: today }, type: { not: "PREVIEW" } }, _count: true }),
    prisma.reportRun.findMany({
      where: { type: { not: "PREVIEW" } },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, type: true, status: true, createdAt: true, durationMs: true, records: true, errorMessage: true, report: { select: { id: true, name: true } } },
    }),
    getSetting<{ at?: string } | null>("reports.worker", null),
    getSetting<{ state: string; at?: string; error?: string }>("reports.whatsapp", { state: "unknown" }),
    getSetting<{ enabled: boolean }>("reports.scheduler", { enabled: true }),
  ]);
  const upcoming = reports
    .flatMap((r) => nextRuns(r.times, readJson(r.daysOfWeek, []), 3).map((at) => ({ reportId: r.id, name: r.name, kind: r.kind, at: at.toISOString() })))
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, 8);
  const count = (s: string) => runsToday.find((r) => r.status === s)?._count ?? 0;
  res.json({
    sentToday: count("SUCCESS") + count("PARTIAL"),
    failedToday: count("FAILED"),
    skippedToday: count("SKIPPED"),
    activeReports: reports.length,
    upcoming,
    recent,
    worker: { lastSeen: worker?.at ?? null, online: !!worker?.at && Date.now() - Date.parse(worker.at) < 60_000 },
    whatsapp,
    schedulerEnabled: scheduler.enabled !== false,
  });
});

reportsRouter.post("/scheduler", manage, async (req, res) => {
  const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
  await prisma.setting.upsert({ where: { key: "reports.scheduler" }, create: { key: "reports.scheduler", value: JSON.stringify({ enabled }) }, update: { value: JSON.stringify({ enabled }) } });
  await audit(req, enabled ? "reports.scheduler_on" : "reports.scheduler_off", "report");
  res.json({ enabled });
});

// ── Reportes ──

const targetInput = z.object({
  url: z.string().trim().url("URL de captura inválida"),
  loginUrl: z.string().trim().url("URL de login inválida").or(z.literal("")).nullish(),
  username: z.string().trim().max(120).nullish(),
  /** Vacío = conservar la guardada */
  password: z.string().max(200).nullish(),
  usernameSelector: z.string().trim().max(200).nullish(),
  passwordSelector: z.string().trim().max(200).nullish(),
  submitSelector: z.string().trim().max(200).nullish(),
});

const reportInput = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).nullish(),
  kind: z.enum(["CRM", "SCREENSHOT"]),
  template: z.string().max(40).nullish(),
  config: z.unknown().optional(),
  active: z.boolean(),
  times: z.string().refine((t) => parseTimes(t).length > 0, "Agrega al menos un horario (HH:MM)"),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1, "Elige al menos un día"),
  retryCount: z.number().int().min(0).max(5),
  subtitle: z.string().trim().max(80).nullish(),
  caption: z.string().trim().max(1000).nullish(),
  emailSubject: z.string().trim().max(200).nullish(),
  skipIfEmpty: z.boolean(),
  targets: z.array(targetInput).max(8).default([]),
  recipientIds: z.array(z.string()),
});

function reportColumns(data: z.infer<typeof reportInput>, previousTargets: string) {
  const prev = parseTargets(previousTargets);
  return {
    name: data.name,
    description: data.description || null,
    kind: data.kind,
    template: data.template || null,
    config: data.kind === "CRM" ? JSON.stringify(definitionSchema.parse(data.config)) : "{}",
    active: data.active,
    times: parseTimes(data.times).join(","),
    daysOfWeek: JSON.stringify([...new Set(data.daysOfWeek)].sort()),
    retryCount: data.retryCount,
    subtitle: data.subtitle || null,
    caption: data.caption || null,
    emailSubject: data.emailSubject || null,
    skipIfEmpty: data.skipIfEmpty,
    targets: JSON.stringify(
      data.kind === "SCREENSHOT"
        ? data.targets.map((t, i) => ({
            url: t.url,
            loginUrl: t.loginUrl || null,
            username: t.username || null,
            usernameSelector: t.usernameSelector || null,
            passwordSelector: t.passwordSelector || null,
            submitSelector: t.submitSelector || null,
            passwordEnc: t.password ? encryptPassword(t.password) : (prev[i]?.passwordEnc ?? null),
          }))
        : [],
    ),
  };
}

reportsRouter.get("/reports", async (_req, res) => {
  const rows = await prisma.report.findMany({ include: reportInclude, orderBy: { name: "asc" } });
  res.json(rows.map(presentReport));
});

reportsRouter.post("/reports", manage, async (req, res) => {
  const data = reportInput.parse(req.body);
  if (data.kind === "SCREENSHOT" && !data.targets.length) throw badRequest("Agrega al menos una URL para capturar");
  const created = await prisma.report.create({
    data: { ...reportColumns(data, "[]"), recipients: { create: data.recipientIds.map((recipientId) => ({ recipientId })) } },
    include: reportInclude,
  });
  await audit(req, "report.created", "report", { entityId: created.id, detail: created.name });
  res.status(201).json(presentReport(created));
});

reportsRouter.put("/reports/:id", manage, async (req, res) => {
  const data = reportInput.parse(req.body);
  const current = await prisma.report.findUniqueOrThrow({ where: { id: req.params.id } });
  if (data.kind === "SCREENSHOT" && !data.targets.length) throw badRequest("Agrega al menos una URL para capturar");
  await prisma.$transaction([
    prisma.report.update({ where: { id: current.id }, data: reportColumns(data, current.targets) }),
    prisma.reportRecipient.deleteMany({ where: { reportId: current.id } }),
    prisma.reportRecipient.createMany({ data: data.recipientIds.map((recipientId) => ({ recipientId, reportId: current.id })) }),
  ]);
  await audit(req, "report.updated", "report", { entityId: current.id, detail: data.name });
  res.json(presentReport(await prisma.report.findUniqueOrThrow({ where: { id: current.id }, include: reportInclude })));
});

reportsRouter.patch("/reports/:id/active", manage, async (req, res) => {
  const { active } = z.object({ active: z.boolean() }).parse(req.body);
  const r = await prisma.report.update({ where: { id: req.params.id }, data: { active } });
  await audit(req, active ? "report.activated" : "report.deactivated", "report", { entityId: r.id, detail: r.name });
  res.json({ ok: true });
});

reportsRouter.post("/reports/:id/duplicate", manage, async (req, res) => {
  const r = await prisma.report.findUniqueOrThrow({ where: { id: req.params.id }, include: reportInclude });
  const { id: _id, createdAt: _c, updatedAt: _u, lastRunAt: _l, recipients, ...rest } = r;
  const copy = await prisma.report.create({
    data: { ...rest, name: `${r.name} (copia)`, active: false, recipients: { create: recipients.map((x) => ({ recipientId: x.recipientId })) } },
    include: reportInclude,
  });
  await audit(req, "report.created", "report", { entityId: copy.id, detail: `${copy.name}` });
  res.status(201).json(presentReport(copy));
});

reportsRouter.delete("/reports/:id", manage, async (req, res) => {
  const r = await prisma.report.delete({ where: { id: req.params.id } });
  await audit(req, "report.deleted", "report", { entityId: r.id, detail: r.name });
  res.json({ ok: true });
});

/** Encola una ejecución: MANUAL (a todos), TEST (a un destinatario) o PREVIEW (sin envío). El worker la procesa. */
reportsRouter.post("/reports/:id/run", async (req, res) => {
  const user = currentUser(req);
  const body = z.object({ type: z.enum(["MANUAL", "TEST", "PREVIEW"]), recipientId: z.string().optional() }).parse(req.body);
  // Cualquiera con acceso al módulo puede pedir una vista previa; enviar exige el permiso
  if (body.type !== "PREVIEW" && !can(user, "reports.manage")) throw forbidden("Tu rol no puede enviar reportes");
  const report = await prisma.report.findUniqueOrThrow({ where: { id: req.params.id } });
  if (report.kind === "CRM") parseDefinition(report.config);
  if (body.type === "TEST" && !body.recipientId) throw badRequest("Elige a quién enviar la prueba");
  const run = await prisma.reportRun.create({
    data: { reportId: report.id, type: body.type, testRecipientId: body.recipientId ?? null, requestedById: user.id, requestedBy: user.name },
  });
  if (body.type !== "PREVIEW") await audit(req, body.type === "TEST" ? "report.test_sent" : "report.sent", "report", { entityId: report.id, detail: report.name });
  res.status(201).json({ id: run.id });
});

// ── Destinatarios ──

const recipientInput = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(200).nullish(),
    kind: z.enum(["EMAIL", "WHATSAPP", "WHATSAPP_GROUP"]),
    value: z.string().trim().min(3).max(200),
    active: z.boolean(),
    windowStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullish().or(z.literal("")),
    windowEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullish().or(z.literal("")),
    reportIds: z.array(z.string()).optional(),
  })
  .superRefine((r, ctx) => {
    if (r.kind === "EMAIL" && !z.string().email().safeParse(r.value).success) ctx.addIssue({ code: "custom", path: ["value"], message: "Correo inválido" });
    if (r.kind === "WHATSAPP" && r.value.replace(/\D/g, "").length < 8) ctx.addIssue({ code: "custom", path: ["value"], message: "Número inválido: incluye el código de país (ej. 51987654321)" });
    if (r.kind === "WHATSAPP_GROUP" && !r.value.endsWith("@g.us")) ctx.addIssue({ code: "custom", path: ["value"], message: "El id de un grupo termina en @g.us" });
  });

const recipientColumns = (d: z.infer<typeof recipientInput>) => ({
  name: d.name,
  description: d.description || null,
  kind: d.kind,
  value: d.kind === "EMAIL" ? d.value.toLowerCase() : d.kind === "WHATSAPP" ? d.value.replace(/\D/g, "") : d.value,
  active: d.active,
  windowStart: d.windowStart || null,
  windowEnd: d.windowEnd || null,
});

reportsRouter.get("/recipients", async (_req, res) => {
  const rows = await prisma.recipient.findMany({ include: { reports: { select: { reportId: true } } }, orderBy: { name: "asc" } });
  res.json(rows.map(({ reports, ...r }) => ({ ...r, reportIds: reports.map((x) => x.reportId) })));
});

reportsRouter.post("/recipients", manage, async (req, res) => {
  const d = recipientInput.parse(req.body);
  const r = await prisma.recipient.create({ data: { ...recipientColumns(d), reports: { create: (d.reportIds ?? []).map((reportId) => ({ reportId })) } } });
  await audit(req, "recipient.created", "report", { entityId: r.id, detail: r.name });
  res.status(201).json(r);
});

reportsRouter.put("/recipients/:id", manage, async (req, res) => {
  const d = recipientInput.parse(req.body);
  await prisma.$transaction([
    prisma.recipient.update({ where: { id: req.params.id }, data: recipientColumns(d) }),
    ...(d.reportIds
      ? [
          prisma.reportRecipient.deleteMany({ where: { recipientId: req.params.id } }),
          prisma.reportRecipient.createMany({ data: d.reportIds.map((reportId) => ({ reportId, recipientId: req.params.id })) }),
        ]
      : []),
  ]);
  await audit(req, "recipient.updated", "report", { entityId: req.params.id, detail: d.name });
  res.json({ ok: true });
});

reportsRouter.delete("/recipients/:id", manage, async (req, res) => {
  const r = await prisma.recipient.delete({ where: { id: req.params.id } });
  await audit(req, "recipient.deleted", "report", { entityId: r.id, detail: r.name });
  res.json({ ok: true });
});

// ── Historial ──

reportsRouter.get("/runs", async (req, res) => {
  const q = z.object({ reportId: z.string().optional(), status: z.string().optional(), type: z.string().optional() }).parse(req.query);
  const rows = await prisma.reportRun.findMany({
    where: {
      ...(q.reportId ? { reportId: q.reportId } : {}),
      ...(q.status ? { status: q.status } : {}),
      type: q.type ? q.type : { not: "PREVIEW" },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true,
      type: true,
      status: true,
      attempt: true,
      records: true,
      images: true,
      attachment: true,
      sentTo: true,
      errorMessage: true,
      requestedBy: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
      durationMs: true,
      report: { select: { id: true, name: true, kind: true } },
    },
  });
  res.json(rows.map((r) => ({ ...r, sentTo: readJson<string[]>(r.sentTo, []) })));
});

reportsRouter.get("/runs/:id", async (req, res) => {
  const run = await prisma.reportRun.findUnique({
    where: { id: req.params.id },
    include: { report: { select: { id: true, name: true, kind: true } }, logs: { orderBy: { at: "asc" } } },
  });
  if (!run) throw notFound("Ejecución no encontrada");
  res.json({ ...run, sentTo: readJson<string[]>(run.sentTo, []), imageFiles: await listRunImages(run.id) });
});

reportsRouter.get("/runs/:id/images/:file", async (req, res) => {
  // El id de la ejecución es un cuid: se valida para que no pueda salir de la carpeta de ejecuciones (../)
  if (!/^\d+\.png$/.test(req.params.file) || !/^[a-z0-9]+$/i.test(req.params.id)) throw notFound();
  const file = path.join(runDir(req.params.id), req.params.file);
  const info = await stat(file).catch(() => null);
  if (!info) throw notFound("La imagen ya no está disponible");
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Content-Length", info.size);
  res.setHeader("Cache-Control", "private, max-age=3600");
  createReadStream(file).pipe(res);
});

reportsRouter.get("/runs/:id/excel", async (req, res) => {
  if (!/^[a-z0-9]+$/i.test(req.params.id)) throw notFound();
  const run = await prisma.reportRun.findUnique({ where: { id: req.params.id }, select: { attachment: true } });
  const file = path.join(runDir(req.params.id), "report.xlsx");
  if (!run?.attachment || !(await stat(file).catch(() => null))) throw notFound("El Excel ya no está disponible");
  res.download(file, run.attachment);
});

// ── Conexiones (CRM, cuenta de Google, WhatsApp) ──

reportsRouter.get("/integrations", manage, async (_req, res) => {
  res.json(await publicIntegrations());
});

reportsRouter.put("/integrations", manage, async (req, res) => {
  const result = await updateIntegrations(req.body);
  await audit(req, "reports.integrations_updated", "report", { detail: Object.keys(req.body ?? {}).filter((k) => !/key|password/i.test(k)).join(", ") || "claves" });
  res.json(result);
});

reportsRouter.post("/integrations/test-email", manage, async (req, res) => {
  const { to } = z.object({ to: z.string().trim().email("Correo inválido") }).parse(req.body);
  await sendEmail({
    to: [to],
    subject: "Prueba del Centro de Reportes",
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#171717;"><p>¡Listo! El Portal DreamTeam ya puede enviar reportes desde esta cuenta.</p><p style="color:#737373;font-size:12px;">Enviado por ${currentUser(req).name}.</p></div>`,
  });
  await audit(req, "reports.test_email", "report", { detail: to });
  res.json({ ok: true });
});

reportsRouter.post("/integrations/test-crm", manage, async (req, res) => {
  const { campaignId } = z.object({ campaignId: z.number().int().positive().nullish() }).parse(req.body);
  const started = Date.now();
  const sales = await fetchSales(campaignId ?? null);
  res.json({ ok: true, total: sales.length, ms: Date.now() - started });
});

reportsRouter.get("/whatsapp", manage, async (_req, res) => {
  res.json(await whatsappQr());
});

reportsRouter.post("/whatsapp/reset", manage, async (req, res) => {
  await whatsappReset();
  await audit(req, "reports.whatsapp_reset", "report");
  res.json({ ok: true });
});
