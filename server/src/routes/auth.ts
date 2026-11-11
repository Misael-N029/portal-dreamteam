import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { assertNetworkAllowed, currentUser, requireAuth, signToken, type AuthUser } from "../lib/auth.js";
import { allModuleAccess } from "../lib/module-access.js";
import { HttpError, badRequest } from "../lib/http.js";
import { assertPassword, getSettings, normalizeEmail } from "../lib/settings.js";
import { parsePermissions } from "../lib/permissions.js";
import { clientIp } from "../lib/ip.js";
import { audit } from "../lib/audit.js";

export const authRouter = Router();

async function sessionPayload(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { role: true } });
  const authUser: AuthUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    roleId: user.roleId,
    roleKey: user.role.key,
    siteId: user.siteId,
    permissions: parsePermissions(user.role.key, user.role.permissions),
  };
  return {
    siteId: user.siteId,
    /** Acciones y alcance por pantalla interna (módulos con permisos propios, p. ej. Inventario) */
    access: await allModuleAccess(authUser),
    id: user.id,
    email: user.email,
    name: user.name,
    area: user.area,
    position: user.position,
    role: { id: user.role.id, key: user.role.key, name: user.role.name, color: user.role.color },
    permissions: parsePermissions(user.role.key, user.role.permissions),
    /** El administrador asignó la contraseña: se sugiere cambiarla */
    mustChangePassword: user.passwordEnc !== null,
  };
}

authRouter.post("/login", async (req, res) => {
  const body = z.object({ email: z.string().min(3), password: z.string().min(1) }).parse(req.body);
  const settings = await getSettings();
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(body.email) }, include: { role: true } });

  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    throw new HttpError(423, `Usuario bloqueado por intentos fallidos. Vuelve a intentar en ${minutes} min.`);
  }
  if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
    if (user) {
      const failed = user.failedLogins + 1;
      const lock = failed >= settings.maxFailedLogins;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLogins: lock ? 0 : failed,
          lockedUntil: lock ? new Date(Date.now() + settings.lockMinutes * 60_000) : null,
        },
      });
      if (lock) await audit(req, "user.locked", "user", { entityId: user.id, actor: user, detail: `${settings.maxFailedLogins} intentos fallidos` });
    }
    throw new HttpError(401, "Correo o contraseña incorrectos");
  }
  if (!user.active) throw new HttpError(403, "Tu usuario está desactivado. Contacta a tu supervisor.");
  await assertNetworkAllowed(clientIp(req), user.role);

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null } });
  await audit(req, "auth.login", "user", { entityId: user.id, actor: user });
  res.json({ token: signToken(user.id, settings.sessionHours), user: await sessionPayload(user.id) });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  res.json(await sessionPayload(currentUser(req).id));
});

authRouter.post("/change-password", requireAuth, async (req, res) => {
  const body = z.object({ currentPassword: z.string(), newPassword: z.string() }).parse(req.body);
  const me = currentUser(req);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: me.id } });
  if (!(await bcrypt.compare(body.currentPassword, user.passwordHash))) {
    throw badRequest("La contraseña actual no es correcta");
  }
  assertPassword(body.newPassword, await getSettings());
  await prisma.user.update({
    where: { id: me.id },
    // Contraseña personal: se borra la copia visible que había asignado el administrador
    data: { passwordHash: await bcrypt.hash(body.newPassword, 10), passwordEnc: null },
  });
  await audit(req, "auth.password_changed", "user", { entityId: me.id });
  res.json({ ok: true });
});
