import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { env } from "./env.js";
import { prisma } from "./prisma.js";
import { HttpError } from "./http.js";
import { parsePermissions, type Permission } from "./permissions.js";
import { getSettings } from "./settings.js";
import { clientIp, ipAllowed } from "./ip.js";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  roleId: string;
  roleKey: string;
  /** Sede del usuario (alcance "su sede" en los módulos) */
  siteId: string | null;
  permissions: Permission[];
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(userId: string, hours: number) {
  return jwt.sign({ sub: userId }, env.jwtSecret, { expiresIn: `${hours}h` });
}

/** Si la restricción por IP está activa, solo se entra desde las IPs de la oficina (salvo roles exentos) */
export async function assertNetworkAllowed(ip: string, role: { bypassIp: boolean }) {
  const settings = await getSettings();
  if (!settings.ipRestrictionEnabled || role.bypassIp) return;
  if (!ipAllowed(ip, settings.allowedIps)) {
    throw new HttpError(403, `Acceso restringido: tu red (${ip}) no está autorizada. Conéctate desde la oficina.`);
  }
}

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) throw new HttpError(401, "Sesión no iniciada");
  let sub: string;
  try {
    sub = (jwt.verify(token, env.jwtSecret) as { sub: string }).sub;
  } catch {
    throw new HttpError(401, "Sesión expirada, vuelve a ingresar");
  }
  const user = await prisma.user.findUnique({ where: { id: sub }, include: { role: true } });
  if (!user || !user.active) throw new HttpError(401, "Usuario inactivo o inexistente");
  await assertNetworkAllowed(clientIp(req), user.role);
  req.user = {
    id: user.id,
    email: user.email,
    name: user.name,
    roleId: user.roleId,
    roleKey: user.role.key,
    siteId: user.siteId,
    permissions: parsePermissions(user.role.key, user.role.permissions),
  };
  next();
};

export function currentUser(req: { user?: AuthUser }): AuthUser {
  if (!req.user) throw new HttpError(401, "Sesión no iniciada");
  return req.user;
}

export const can = (user: AuthUser, permission: Permission) => user.permissions.includes(permission);
