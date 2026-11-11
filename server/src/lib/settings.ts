import { z } from "zod";
import { prisma } from "./prisma.js";
import { badRequest } from "./http.js";
import { isValidIpRule } from "./ip.js";

export const settingsSchema = z.object({
  // Marca
  platformName: z.string().min(2).max(60),
  tagline: z.string().max(120),
  logoUrl: z.string().max(500).nullable(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color hexadecimal inválido"),
  loginMessage: z.string().max(300),
  welcomeMessage: z.string().max(500),
  // Acceso
  allowedEmailDomains: z.array(z.string().min(3)).min(1, "Debe haber al menos un dominio"),
  passwordMinLength: z.number().int().min(6).max(64),
  passwordRequireNumber: z.boolean(),
  sessionHours: z.number().int().min(1).max(720),
  maxFailedLogins: z.number().int().min(3).max(20),
  lockMinutes: z.number().int().min(1).max(1440),
  // Red
  ipRestrictionEnabled: z.boolean(),
  allowedIps: z.array(z.string().trim().refine(isValidIpRule, "IP o rango inválido")),
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  platformName: "Portal DreamTeam",
  tagline: "Todo lo que tu equipo necesita, en un solo lugar",
  logoUrl: null,
  primaryColor: "#DC2626",
  loginMessage: "Ingresa con tu correo corporativo para acceder a tus herramientas.",
  welcomeMessage: "Estas son tus herramientas de trabajo. Si te falta alguna, pídela a tu supervisor.",
  allowedEmailDomains: ["dreamteam.com.pe", "dreamteam.pe"],
  passwordMinLength: 8,
  passwordRequireNumber: true,
  sessionHours: 12,
  maxFailedLogins: 5,
  lockMinutes: 15,
  ipRestrictionEnabled: false,
  allowedIps: [],
};

/** Lo que el inicio de sesión puede leer sin sesión (marca) */
export const PUBLIC_KEYS = ["platformName", "tagline", "logoUrl", "primaryColor", "loginMessage", "allowedEmailDomains"] as const satisfies readonly (keyof Settings)[];

let cache: Settings | null = null;

export async function getSettings(): Promise<Settings> {
  if (cache) return cache;
  const rows = await prisma.setting.findMany();
  const stored: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      stored[row.key] = JSON.parse(row.value);
    } catch {
      // valor corrupto: se ignora y se usa el default
    }
  }
  const merged = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const parsed = settingsSchema.shape[key].safeParse(stored[key]);
    if (parsed.success) (merged as Record<string, unknown>)[key] = parsed.data;
  }
  cache = merged;
  return merged;
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const data = settingsSchema.partial().parse(patch);
  await prisma.$transaction(
    Object.entries(data).map(([key, value]) =>
      prisma.setting.upsert({
        where: { key },
        create: { key, value: JSON.stringify(value) },
        update: { value: JSON.stringify(value) },
      }),
    ),
  );
  cache = null;
  return getSettings();
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function assertEmailDomain(email: string, settings: Settings) {
  const domain = email.split("@")[1];
  const allowed = settings.allowedEmailDomains.map((d) => d.toLowerCase().replace(/^@/, ""));
  if (!domain || !allowed.includes(domain)) {
    throw badRequest(`El correo debe pertenecer a: ${allowed.map((d) => "@" + d).join(", ")}`);
  }
}

export function assertPassword(password: string, settings: Settings) {
  if (password.length < settings.passwordMinLength) {
    throw badRequest(`La contraseña debe tener al menos ${settings.passwordMinLength} caracteres`);
  }
  if (settings.passwordRequireNumber && !/\d/.test(password)) {
    throw badRequest("La contraseña debe incluir al menos un número");
  }
}
