import { env } from "./lib/env.js";
import express from "express";
import cors from "cors";
import { requireAuth } from "./lib/auth.js";
import { requirePermission } from "./lib/permissions.js";
import { errorHandler, notFound } from "./lib/http.js";
import { authRouter } from "./routes/auth.js";
import { settingsRouter } from "./routes/settings.js";
import { portalRouter } from "./routes/portal.js";
import { modulesRouter } from "./routes/modules.js";
import { rolesRouter } from "./routes/roles.js";
import { usersRouter } from "./routes/users.js";
import { announcementsRouter } from "./routes/announcements.js";
import { adminRouter } from "./routes/admin.js";
import { reportsRouter } from "./routes/reports.js";
import { MODULE_IMAGES_DIR } from "./routes/modules.js";
import { inventoryRouter } from "./routes/inventory.js";
import { zoneRouter, ZONE_IMAGES_DIR } from "./routes/zone.js";
import { notificationsRouter } from "./routes/notifications.js";
import { startupSync } from "./lib/startup-sync.js";

const app = express();
// Nginx corre en el mismo servidor: se confía en su X-Forwarded-For para conocer la IP real
app.set("trust proxy", "loopback");
app.disable("x-powered-by");
app.use(cors({ origin: env.webOrigin }));
app.use(express.json({ limit: "1mb" }));

// Fotos de los bloques del panel: públicas y con nombre único, así que se pueden cachear mucho
app.use("/api/files/module-images", express.static(MODULE_IMAGES_DIR(), { maxAge: "30d", immutable: true, index: false }));
// Fotos de DreamZone: nombre aleatorio e irrepetible, se cachean igual
app.use("/api/files/zone-images", express.static(ZONE_IMAGES_DIR(), { maxAge: "30d", immutable: true, index: false }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});
app.use("/api/auth", authRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/portal", requireAuth, portalRouter);
app.use("/api/modules", requireAuth, requirePermission("modules.manage"), modulesRouter);
app.use("/api/roles", requireAuth, requirePermission("roles.manage"), rolesRouter);
app.use("/api/users", requireAuth, requirePermission("users.manage"), usersRouter);
app.use("/api/announcements", requireAuth, requirePermission("announcements.manage"), announcementsRouter);
app.use("/api/admin", requireAuth, adminRouter);
app.use("/api/reports", requireAuth, reportsRouter);
app.use("/api/inventory", requireAuth, inventoryRouter);
app.use("/api/zone", requireAuth, zoneRouter);
app.use("/api/notifications", requireAuth, notificationsRouter);
app.use("/api", () => {
  throw notFound("Ruta no encontrada");
});
app.use(errorHandler);

// Roles base, matriz de permisos e inventario alineados con el código antes de atender
await startupSync();

app.listen(env.port, () => {
  console.log(`Portal DreamTeam API → http://localhost:${env.port}`);
});
