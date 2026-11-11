import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

const opt = (name: string) => process.env[name]?.trim() || undefined;

const jwtSecret = opt("JWT_SECRET") ?? "dev-secret-cambiar";
if (process.env.NODE_ENV === "production" && jwtSecret === "dev-secret-cambiar") {
  throw new Error("Define JWT_SECRET en server/.env antes de arrancar en producción");
}
if (process.env.NODE_ENV === "production" && !opt("PASSWORD_VAULT_KEY")) {
  console.warn("Aviso: PASSWORD_VAULT_KEY no está definida; las contraseñas asignadas se cifran con JWT_SECRET. Defínela en server/.env (las ya guardadas se siguen leyendo).");
}

export const env = {
  port: Number(process.env.PORT ?? 4100),
  jwtSecret,
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5174",
  /** Clave del cifrado reversible de contraseñas asignadas (ver lib/vault.ts) */
  passwordVaultKey: opt("PASSWORD_VAULT_KEY") ?? jwtSecret,
  /** Centro de Reportes: API de exportación de ventas del CRM */
  crm: {
    exportUrl: opt("CRM_EXPORT_URL") ?? "http://31.97.165.147/api/export/sales",
    apiKey: opt("CRM_API_KEY"),
    companyId: Number(process.env.CRM_COMPANY_ID ?? 1),
    /** Solo desarrollo: genera ventas ficticias en lugar de consultar el CRM */
    demo: process.env.CRM_DEMO === "1",
  },
  /** Evolution API (WhatsApp) */
  evolution: {
    url: opt("EVOLUTION_API_URL")?.replace(/\/+$/, ""),
    apiKey: opt("EVOLUTION_API_KEY"),
    instance: opt("EVOLUTION_INSTANCE") ?? "dreamteam",
  },
  /** Correo saliente de los reportes (Google Workspace: smtp.gmail.com + contraseña de aplicación). SMTP_HOST=mock simula en desarrollo */
  smtp: {
    host: opt("SMTP_HOST"),
    port: Number(process.env.SMTP_PORT ?? 465),
    user: opt("SMTP_USER"),
    pass: opt("SMTP_PASS"),
    from: opt("SMTP_FROM") ?? "Reportes DreamTeam <sistemas@dreamteam.com.pe>",
  },
  /** Chrome/Chromium para Playwright. Vacío = el que instala `npx playwright install chromium` */
  chromePath: opt("CHROME_PATH"),
  /** Imágenes de las ejecuciones (vistas previas e historial) */
  storageDir: opt("STORAGE_DIR") ?? "storage",
};
