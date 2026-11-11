import { Router } from "express";
import { requireAuth } from "../lib/auth.js";
import { requirePermission } from "../lib/permissions.js";
import { PUBLIC_KEYS, getSettings, updateSettings } from "../lib/settings.js";
import { clientIp } from "../lib/ip.js";
import { audit } from "../lib/audit.js";

export const settingsRouter = Router();

settingsRouter.get("/public", async (_req, res) => {
  const s = await getSettings();
  res.json(Object.fromEntries(PUBLIC_KEYS.map((k) => [k, s[k]])));
});

/** Ajustes completos para la pantalla de Configuración, con la IP desde la que se conecta el admin */
settingsRouter.get("/", requireAuth, requirePermission("settings.manage"), async (req, res) => {
  res.json({ settings: await getSettings(), yourIp: clientIp(req) });
});

/** Ajustes que necesita cualquier colaborador con sesión (sin datos sensibles) */
settingsRouter.get("/app", requireAuth, async (_req, res) => {
  const s = await getSettings();
  res.json({ welcomeMessage: s.welcomeMessage, passwordMinLength: s.passwordMinLength, passwordRequireNumber: s.passwordRequireNumber });
});

settingsRouter.put("/", requireAuth, requirePermission("settings.manage"), async (req, res) => {
  const updated = await updateSettings(req.body);
  await audit(req, "settings.updated", "settings", { detail: Object.keys(req.body ?? {}).join(", ") });
  res.json({ settings: updated, yourIp: clientIp(req) });
});
