import { z } from "zod";
import { env } from "../lib/env.js";
import { prisma } from "../lib/prisma.js";
import { decryptPassword, encryptPassword } from "../lib/vault.js";

/**
 * Conexiones del Centro de Reportes, editables desde el portal. Las claves se guardan cifradas (AES-256-GCM)
 * y nunca se devuelven al navegador. Si un valor no está configurado en el portal, se usa el de server/.env.
 */

const KEY = "reports.integrations";

type Stored = {
  crmExportUrl?: string;
  crmCompanyId?: number;
  crmApiKeyEnc?: string | null;
  googleEmail?: string;
  googleAppPasswordEnc?: string | null;
  senderName?: string;
  evolutionUrl?: string;
  evolutionApiKeyEnc?: string | null;
  evolutionInstance?: string;
};

export type Integrations = {
  crm: { exportUrl: string; companyId: number; apiKey?: string; demo: boolean };
  smtp: { host?: string; port: number; user?: string; pass?: string; from: string };
  evolution: { url?: string; apiKey?: string; instance: string };
};

async function readStored(): Promise<Stored> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  try {
    return row ? (JSON.parse(row.value) as Stored) : {};
  } catch {
    return {};
  }
}

let cache: { at: number; value: Integrations } | null = null;

export async function getIntegrations(): Promise<Integrations> {
  if (cache && Date.now() - cache.at < 15_000) return cache.value;
  const s = await readStored();
  const googleUser = s.googleEmail || env.smtp.user;
  const googlePass = decryptPassword(s.googleAppPasswordEnc) ?? env.smtp.pass;
  const value: Integrations = {
    crm: {
      exportUrl: s.crmExportUrl || env.crm.exportUrl,
      companyId: s.crmCompanyId ?? env.crm.companyId,
      apiKey: decryptPassword(s.crmApiKeyEnc) ?? env.crm.apiKey,
      demo: env.crm.demo,
    },
    smtp: {
      // Una cuenta de Google configurada en el portal siempre sale por el SMTP de Gmail
      host: s.googleEmail ? "smtp.gmail.com" : env.smtp.host,
      port: s.googleEmail ? 465 : env.smtp.port,
      user: googleUser,
      pass: googlePass,
      from: googleUser ? `${s.senderName || "Reportes DreamTeam"} <${googleUser}>` : env.smtp.from,
    },
    evolution: {
      url: (s.evolutionUrl || env.evolution.url)?.replace(/\/+$/, ""),
      apiKey: decryptPassword(s.evolutionApiKeyEnc) ?? env.evolution.apiKey,
      instance: s.evolutionInstance || env.evolution.instance,
    },
  };
  cache = { at: Date.now(), value };
  return value;
}

/** Lo que ve el administrador: valores no secretos y si cada clave está cargada (sin mostrarla) */
export async function publicIntegrations() {
  const s = await readStored();
  const eff = await getIntegrations();
  return {
    crmExportUrl: eff.crm.exportUrl,
    crmCompanyId: eff.crm.companyId,
    crmApiKeySet: !!eff.crm.apiKey,
    crmDemo: eff.crm.demo,
    googleEmail: s.googleEmail ?? "",
    googleAppPasswordSet: !!decryptPassword(s.googleAppPasswordEnc),
    senderName: s.senderName ?? "Reportes DreamTeam",
    smtpFromEnv: !s.googleEmail && !!env.smtp.host,
    evolutionUrl: s.evolutionUrl ?? env.evolution.url ?? "",
    evolutionApiKeySet: !!eff.evolution.apiKey,
    evolutionInstance: eff.evolution.instance,
  };
}

export const integrationsInput = z.object({
  crmExportUrl: z.string().trim().url("URL del CRM inválida").optional(),
  crmCompanyId: z.number().int().positive().optional(),
  /** Vacío = no cambiar · null = borrar */
  crmApiKey: z.string().trim().nullable().optional(),
  googleEmail: z.string().trim().email("Correo de Google inválido").or(z.literal("")).optional(),
  googleAppPassword: z.string().trim().nullable().optional(),
  senderName: z.string().trim().max(60).optional(),
  evolutionUrl: z.string().trim().max(300).optional(),
  evolutionApiKey: z.string().trim().nullable().optional(),
  evolutionInstance: z.string().trim().min(1).max(60).optional(),
});

export async function updateIntegrations(raw: unknown) {
  const input = integrationsInput.parse(raw);
  const s = await readStored();
  const secret = (value: string | null | undefined, current: string | null | undefined) =>
    value === null ? null : value ? encryptPassword(value.replace(/\s+/g, "")) : current;
  const next: Stored = {
    ...s,
    crmExportUrl: input.crmExportUrl ?? s.crmExportUrl,
    crmCompanyId: input.crmCompanyId ?? s.crmCompanyId,
    crmApiKeyEnc: secret(input.crmApiKey, s.crmApiKeyEnc),
    googleEmail: input.googleEmail ?? s.googleEmail,
    googleAppPasswordEnc: secret(input.googleAppPassword, s.googleAppPasswordEnc),
    senderName: input.senderName ?? s.senderName,
    evolutionUrl: input.evolutionUrl ?? s.evolutionUrl,
    evolutionApiKeyEnc: secret(input.evolutionApiKey, s.evolutionApiKeyEnc),
    evolutionInstance: input.evolutionInstance ?? s.evolutionInstance,
  };
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: JSON.stringify(next) }, update: { value: JSON.stringify(next) } });
  cache = null;
  return publicIntegrations();
}
