import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { ADMIN_ROLE_KEY } from "./permissions.js";
import type { AuthUser } from "./auth.js";

export const MODULE_TYPES = ["INTERNAL", "LINK", "IFRAME"] as const;

/** Pantallas propias del portal que un módulo INTERNAL puede mostrar */
export const INTERNAL_SCREENS = [
  { key: "directorio", label: "Directorio del equipo", description: "Contactos del personal activo, con búsqueda por área" },
  { key: "comunicados", label: "Comunicados", description: "Todos los comunicados vigentes para el usuario" },
  { key: "reportes", label: "Centro de Reportes", description: "Reportes del CRM programados por correo y WhatsApp" },
  { key: "inventario", label: "Inventario", description: "Plano de sala, equipos, insumos del almacén, entregas e incidencias" },
  { key: "zona", label: "DreamZone", description: "Muro de la comunidad: publicaciones, votaciones, encuestas, dinámicas y fotos con comentarios" },
] as const;

export const INTERNAL_KEYS = INTERNAL_SCREENS.map((s) => s.key) as string[];

/** Módulos que un usuario puede abrir: los de su rol más los concedidos a él. El administrador ve todos. */
export function visibleModulesWhere(user: AuthUser): Prisma.ModuleWhereInput {
  if (user.roleKey === ADMIN_ROLE_KEY) return { active: true };
  return {
    active: true,
    OR: [{ roles: { some: { roleId: user.roleId } } }, { users: { some: { userId: user.id } } }],
  };
}

export async function findVisibleModule(user: AuthUser, key: string) {
  return prisma.module.findFirst({ where: { key, ...visibleModulesWhere(user) } });
}
