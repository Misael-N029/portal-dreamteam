import type { RequestHandler } from "express";
import { forbidden } from "./http.js";

/**
 * Permisos de administración. Regla de la empresa: SOLO el rol Administrador los tiene (todos);
 * el resto de roles únicamente usa los módulos de su panel. Qué módulos ve cada rol se decide en cada módulo.
 */
export const PERMISSIONS = [
  { key: "dashboard.view", label: "Ver indicadores", group: "Administración", description: "Dashboard de uso del portal" },
  { key: "modules.manage", label: "Gestionar módulos", group: "Administración", description: "Crear, editar, ordenar y asignar módulos" },
  { key: "users.manage", label: "Gestionar usuarios", group: "Administración", description: "Crear, editar, activar y restablecer contraseñas" },
  { key: "roles.manage", label: "Gestionar roles", group: "Administración", description: "Crear roles y definir sus permisos" },
  { key: "reports.manage", label: "Gestionar reportes", group: "Operación", description: "Programar reportes, destinatarios, envíos y la conexión de WhatsApp" },
  { key: "announcements.manage", label: "Publicar comunicados", group: "Comunicación", description: "Comunicados en el inicio del panel" },
  { key: "settings.manage", label: "Configuración", group: "Sistema", description: "Marca, acceso e IPs permitidas" },
  { key: "audit.view", label: "Ver auditoría", group: "Sistema", description: "Bitácora de accesos y cambios" },
] as const;

export type Permission = (typeof PERMISSIONS)[number]["key"];
export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key) as Permission[];

export const ADMIN_ROLE_KEY = "admin";

/** El Administrador tiene todos los permisos; cualquier otro rol, ninguno (aunque la base diga otra cosa) */
export function parsePermissions(roleKey: string, _raw?: string): Permission[] {
  return roleKey === ADMIN_ROLE_KEY ? [...PERMISSION_KEYS] : [];
}

/** Exige al menos uno de los permisos (requiere requireAuth antes) */
export const requirePermission =
  (...keys: Permission[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user?.permissions.some((p) => keys.includes(p))) throw forbidden("No tienes acceso a esta sección");
    next();
  };
