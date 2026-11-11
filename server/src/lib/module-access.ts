import type { RequestHandler } from "express";
import { prisma } from "./prisma.js";
import { ADMIN_ROLE_KEY } from "./permissions.js";
import { currentUser, type AuthUser } from "./auth.js";
import { forbidden } from "./http.js";
import { visibleModulesWhere } from "./modules.js";
import { parseStringArray } from "./json.js";
import { isBaseRole, matrixGrant, type Scope } from "./role-matrix.js";

/**
 * Permisos por módulo. Cada rol recibe, módulo a módulo, una lista de acciones y un alcance:
 *   ALL  → ve y opera todos los datos del módulo
 *   SITE → solo lo de su sede (la sede del usuario, ver User.siteId)
 *   TEAM → ve su sede, pero solo actúa sobre su equipo (los usuarios que lo tienen como supervisor)
 *   OWN  → solo lo asignado a la persona
 * El Administrador tiene siempre todas las acciones con alcance ALL.
 * Los módulos sin catálogo propio (enlaces, incrustados, pantallas simples) solo tienen la acción "ver".
 */

export type { Scope } from "./role-matrix.js";
export type ActionDef = { key: string; label: string; description: string };
export type ModuleCatalog = { actions: ActionDef[]; scopes: Scope[] };

const VIEW: ActionDef = { key: "view", label: "Ver", description: "Abrir el módulo y consultar" };

/** Catálogo por pantalla interna (clave = internalKey del módulo) */
export const MODULE_CATALOG: Record<string, ModuleCatalog> = {
  zona: {
    scopes: ["ALL"],
    actions: [
      VIEW,
      { key: "comment", label: "Comentar", description: "Votar, comentar y reaccionar en las publicaciones" },
      { key: "publish", label: "Publicar", description: "Crear publicaciones, votaciones, encuestas, dinámicas y fotos" },
      { key: "moderate", label: "Moderar", description: "Editar o quitar publicaciones y ocultar comentarios de otros" },
    ],
  },
  inventario: {
    scopes: ["ALL", "SITE", "TEAM", "OWN"],
    actions: [
      VIEW,
      { key: "seat", label: "Reubicar personas", description: "Cambiar a un colaborador de puesto en el plano (los equipos se quedan en su puesto)" },
      { key: "create", label: "Registrar", description: "Dar de alta equipos e insumos" },
      { key: "edit", label: "Editar", description: "Modificar datos y cambiar el estado de un equipo o insumo" },
      { key: "assign", label: "Mover equipos", description: "Mover equipos entre puestos (arrastrar en el plano), asignarlos y llevarlos con la persona al reubicarla" },
      { key: "transfer", label: "Trasladar", description: "Enviar equipos o insumos a otra sede o cancelar el envío" },
      { key: "receive", label: "Recibir", description: "Confirmar la llegada de un equipo a su sede" },
      { key: "stock", label: "Kardex", description: "Registrar entradas, salidas y ajustes de stock de insumos" },
      { key: "deliver", label: "Entregar", description: "Entregar insumos a un colaborador" },
      { key: "incident", label: "Reportar falla", description: "Abrir una incidencia sobre un equipo" },
      { key: "repair", label: "Atender incidencias", description: "Gestionar reparaciones y cerrar incidencias" },
      { key: "retire", label: "Dar de baja", description: "Retirar o reactivar un equipo del inventario" },
      { key: "layout", label: "Plano", description: "Diseñar el plano de sala: zonas y puestos" },
      { key: "sites", label: "Sedes y categorías", description: "Crear y editar sedes y categorías" },
      { key: "import", label: "Importar / exportar", description: "Carga masiva desde Excel y exportación" },
    ],
  },
};

const VIEW_ONLY: ModuleCatalog = { scopes: ["ALL"], actions: [VIEW] };

export const catalogFor = (internalKey?: string | null): ModuleCatalog => MODULE_CATALOG[internalKey ?? ""] ?? VIEW_ONLY;

export type ModuleAccess = { actions: string[]; scope: Scope; siteId: string | null };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      access?: ModuleAccess;
    }
  }
}

const readActions = parseStringArray;

/** Filtra acciones y alcance a lo que el catálogo del módulo admite */
export function normalizeAccess(internalKey: string | null | undefined, actions: string[], scope: string) {
  const cat = catalogFor(internalKey);
  const valid = new Set(cat.actions.map((a) => a.key));
  const clean = [...new Set(["view", ...actions])].filter((a) => valid.has(a));
  const sc = (cat.scopes as string[]).includes(scope) ? (scope as Scope) : "ALL";
  return { actions: clean, scope: sc };
}

type ModWithGrant = { key: string; internalKey: string | null; roles: { actions: string; scope: string }[] };

/** Resuelve acciones y alcance: admin = todo; rol base en módulo de la matriz = lo fijo; resto = lo guardado */
export function resolveAccess(user: Pick<AuthUser, "roleKey">, m: ModWithGrant): Omit<ModuleAccess, "siteId"> {
  const cat = catalogFor(m.internalKey);
  if (user.roleKey === ADMIN_ROLE_KEY) return { actions: cat.actions.map((a) => a.key), scope: "ALL" };
  const fixed = isBaseRole(user.roleKey) ? matrixGrant(m.key, user.roleKey) : undefined;
  if (fixed) return normalizeAccess(m.internalKey, fixed.actions, fixed.scope);
  const grant = m.roles[0];
  // Concedido solo al usuario a título individual: únicamente "ver"; en módulos con "lo suyo", solo lo suyo
  if (!grant) return { actions: ["view"], scope: cat.scopes.includes("OWN") ? "OWN" : "ALL" };
  return normalizeAccess(m.internalKey, readActions(grant.actions), grant.scope);
}

/**
 * Acceso del usuario a una pantalla interna, o null si no la tiene habilitada.
 * Une lo del rol (acciones + alcance) con lo concedido al usuario a título individual (solo "ver").
 */
export async function moduleAccess(user: AuthUser, internalKey: string): Promise<ModuleAccess | null> {
  const mod = await prisma.module.findFirst({
    where: { type: "INTERNAL", internalKey, ...visibleModulesWhere(user) },
    include: { roles: { where: { roleId: user.roleId } } },
  });
  if (!mod) return null;
  return { ...resolveAccess(user, mod), siteId: user.siteId };
}

/** Acceso a todas las pantallas internas que el usuario tiene habilitadas (para la sesión del navegador) */
export async function allModuleAccess(user: AuthUser): Promise<Record<string, ModuleAccess>> {
  const mods = await prisma.module.findMany({
    where: { type: "INTERNAL", ...visibleModulesWhere(user) },
    include: { roles: { where: { roleId: user.roleId } } },
  });
  const out: Record<string, ModuleAccess> = {};
  for (const m of mods) {
    if (!m.internalKey) continue;
    out[m.internalKey] = { ...resolveAccess(user, m), siteId: user.siteId };
  }
  return out;
}

/** Exige tener habilitada la pantalla y deja el acceso resuelto en req.access */
export const requireModule =
  (internalKey: string): RequestHandler<Record<string, string>> =>
  async (req, _res, next) => {
    const access = await moduleAccess(currentUser(req), internalKey);
    if (!access) throw forbidden("Este módulo no está habilitado para tu usuario");
    req.access = access;
    next();
  };

/** Exige una acción concreta dentro de un módulo ya resuelto con requireModule */
export const requireAction =
  (action: string): RequestHandler<Record<string, string>> =>
  (req, _res, next) => {
    if (!req.access?.actions.includes(action)) throw forbidden("Tu rol no puede realizar esta acción en este módulo");
    next();
  };

export const hasAction = (req: { access?: ModuleAccess }, action: string) => !!req.access?.actions.includes(action);
