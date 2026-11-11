/**
 * Matriz FIJA de roles del portal de colaboradores.
 *
 * Es la fuente única de qué módulos ve cada rol base y qué puede hacer en cada uno. Se aplica en cada
 * arranque del API (ver syncRoleMatrix en prisma/bootstrap.ts), así que una base existente queda siempre
 * alineada con este archivo. En Administración → Roles los roles base se muestran bloqueados para los
 * módulos de esta matriz; los roles que se creen después y los módulos nuevos se siguen configurando a mano.
 *
 * Reglas:
 *  - admin (TI) ve todo y tiene todas las acciones: no aparece en la matriz.
 *  - La administración del portal (usuarios, módulos, roles…) sigue siendo solo del Administrador (lib/permissions.ts).
 *  - Alcance: ALL = todas las sedes · SITE = solo su sede · TEAM = su sede, y solo actúa sobre su equipo
 *    (los usuarios que lo tienen como supervisor) · OWN = solo lo asignado a la persona.
 */
export type Scope = "ALL" | "SITE" | "TEAM" | "OWN";
export type Grant = { actions: string[]; scope: Scope };

/** Roles base que gobierna la matriz (además del Administrador) */
export const BASE_ROLE_KEYS = ["admin", "supervisor", "asesor", "rrhh", "backoffice"] as const;
export type BaseRoleKey = (typeof BASE_ROLE_KEYS)[number];
export const isBaseRole = (key: string) => (BASE_ROLE_KEYS as readonly string[]).includes(key);

const view: Grant = { actions: ["view"], scope: "ALL" };

/** clave de módulo → rol → acceso. Un rol que no aparece en un módulo NO lo ve. */
export const ROLE_MATRIX: Record<string, Partial<Record<Exclude<BaseRoleKey, "admin">, Grant>>> = {
  crm: { supervisor: view, asesor: view, backoffice: view, rrhh: view },
  reportes: { supervisor: view, backoffice: view, rrhh: view },
  "dashboard-ventas": { supervisor: view, rrhh: view },
  campus: { supervisor: view, asesor: view, backoffice: view, rrhh: view },
  rrhh: { rrhh: view },
  directorio: { supervisor: view, asesor: view, backoffice: view, rrhh: view },
  correo: { supervisor: view, asesor: view, backoffice: view, rrhh: view },
  comunicados: { supervisor: view, asesor: view, backoffice: view, rrhh: view },
  inventario: {
    // Los equipos no se mueven: solo Admin/TI los mueve, retira o reemplaza. Lo que se reubica son las personas.
    // El supervisor dirige a su equipo: ve el plano de su sede, reubica a SUS asesores y reporta fallas de sus computadoras
    supervisor: { actions: ["view", "seat", "incident"], scope: "TEAM" },
    // RRHH no tiene sede fija: reubica a cualquier colaborador en cualquier sede (y le cambia el supervisor si cambia de campaña)
    rrhh: { actions: ["view", "seat", "incident"], scope: "ALL" },
    // El resto ve "Mi equipo": lo que tiene asignado, confirma entregas y reporta fallas
    asesor: { actions: ["view", "incident"], scope: "OWN" },
    backoffice: { actions: ["view", "incident"], scope: "OWN" },
  },
  // DreamZone: RRHH publica y modera; los supervisores también publican; asesores y backoffice ven, votan, comentan y reaccionan
  dreamzone: {
    asesor: { actions: ["view", "comment"], scope: "ALL" },
    backoffice: { actions: ["view", "comment"], scope: "ALL" },
    supervisor: { actions: ["view", "comment", "publish"], scope: "ALL" },
    rrhh: { actions: ["view", "comment", "publish", "moderate"], scope: "ALL" },
  },
};

/** ¿El módulo está gobernado por la matriz? */
export const isMatrixModule = (moduleKey: string) => moduleKey in ROLE_MATRIX;

/** Acceso fijo de un rol base en un módulo de la matriz (undefined = no lo ve) */
export const matrixGrant = (moduleKey: string, roleKey: string): Grant | undefined =>
  (ROLE_MATRIX[moduleKey] as Record<string, Grant> | undefined)?.[roleKey];
