import type { Request } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { currentUser } from "../lib/auth.js";
import { forbidden } from "../lib/http.js";
import type { ModuleAccess } from "../lib/module-access.js";

export const MACHINE_STATUSES = ["ACTIVE", "STORAGE", "REPAIR", "TRANSIT", "RETIRED"] as const;
/** Estados que se fijan a mano; TRANSIT lo pone un traslado */
export const MANUAL_STATUSES = ["ACTIVE", "STORAGE", "REPAIR", "RETIRED"] as const;
export const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "en uso",
  STORAGE: "almacén",
  REPAIR: "reparación",
  TRANSIT: "en traslado",
  RETIRED: "de baja",
};

export const DAY = 86400_000;
/** Sin sede asignada, el alcance "su sede" no ve nada */
export const NO_SITE = "__sin_sede__";

export const access = (req: Request): ModuleAccess => req.access!;
export const actor = (req: Request) => {
  const u = currentUser(req);
  return { id: u.id, name: u.name };
};

/** "Su sede" o "su equipo": los dos ven la sede del usuario */
export const isSite = (a: ModuleAccess) => a.scope === "SITE" || a.scope === "TEAM";
export const isTeam = (a: ModuleAccess) => a.scope === "TEAM";
export const isOwn = (a: ModuleAccess) => a.scope === "OWN";

/** Con alcance "su equipo" (supervisor), solo se actúa sobre él mismo y quienes lo tienen como supervisor */
export async function assertTeamMember(a: ModuleAccess, me: string, userId: string | null | undefined) {
  if (!isTeam(a) || !userId || userId === me) return;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { supervisorId: true } });
  if (u?.supervisorId !== me) throw forbidden("Solo puedes reubicar a los asesores de tu equipo");
}

/** Equipos sobre los que el supervisor puede reportar fallas: los de su equipo (asignados o en el puesto que ocupan) */
export const teamMachines = (me: string): Prisma.MachineWhereInput => ({
  OR: [
    { assignedUserId: me },
    { workstation: { userId: me } },
    { assignedUser: { supervisorId: me } },
    { workstation: { user: { supervisorId: me } } },
  ],
});

/** Equipos que el usuario puede ver según su alcance */
export function machineScope(a: ModuleAccess, userId: string): Prisma.MachineWhereInput {
  if (isSite(a)) return { siteId: a.siteId ?? NO_SITE };
  if (isOwn(a)) return { OR: [{ assignedUserId: userId }, { workstation: { userId } }] };
  return {};
}

export const siteScope = (a: ModuleAccess): Prisma.SiteWhereInput => (a.scope === "ALL" ? {} : { id: a.siteId ?? NO_SITE });

export const transferScope = (a: ModuleAccess): Prisma.MachineTransferWhereInput =>
  a.scope === "ALL" ? {} : { OR: [{ fromSiteId: a.siteId ?? NO_SITE }, { toSiteId: a.siteId ?? NO_SITE }] };

/** Con alcance "su sede", solo se opera sobre la propia sede */
export function assertOwnSite(a: ModuleAccess, siteId: string) {
  if (a.scope !== "ALL" && a.siteId !== siteId) throw forbidden("Solo puedes operar sobre tu sede");
}

/** Pantallas de gestión (plano, almacén, listados): no disponibles con alcance "lo suyo" */
export function assertNotOwn(a: ModuleAccess) {
  if (isOwn(a)) throw forbidden("Tu rol solo ve el equipo que tiene asignado");
}

/** Gestión global (sedes, categorías): exige alcance de todas las sedes */
export function assertGlobal(a: ModuleAccess) {
  if (a.scope !== "ALL") throw forbidden("Solo quien gestiona todas las sedes puede hacer esto");
}

type Tx = Prisma.TransactionClient | typeof prisma;

/** Registra un evento en la bitácora del equipo */
export function logEvent(tx: Tx, machineId: string, kind: string, detail: string | null, who: { id: string; name: string }) {
  return tx.assetEvent.create({ data: { machineId, kind, detail: detail?.slice(0, 500) ?? null, actorId: who.id, actorName: who.name } });
}

/** Igual que logEvent, para varios equipos en una sola escritura */
export function logEvents(tx: Tx, machineIds: string[], kind: string, detail: string, who: { id: string; name: string }) {
  return tx.assetEvent.createMany({ data: machineIds.map((machineId) => ({ machineId, kind, detail: detail.slice(0, 500), actorId: who.id, actorName: who.name })) });
}

/** Texto para la bitácora al liberar un equipo: quién lo tenía a cargo ("" si nadie) */
export async function formerOwnerNote(tx: Tx, userId: string | null | undefined) {
  if (!userId) return "";
  const u = await tx.user.findUnique({ where: { id: userId }, select: { name: true } });
  return u ? ` · antes a cargo de ${u.name}` : "";
}

// ── Validación común ──

/** Texto opcional: "" → null */
export const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

/** Fecha opcional (YYYY-MM-DD o ISO): "" → null */
export const optDate = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const d = new Date(v.length === 10 ? `${v}T12:00:00Z` : v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: "custom", message: "Fecha inválida" });
      return z.NEVER;
    }
    return d;
  });

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});

/** Datos de un usuario para mostrar */
export const userSelect = { id: true, name: true, email: true, area: true, position: true, supervisorId: true } as const;
