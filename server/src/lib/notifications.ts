import { prisma } from "./prisma.js";
import { ADMIN_ROLE_KEY } from "./permissions.js";
import { resolveAccess } from "./module-access.js";
import { parseStringArray } from "./json.js";

/**
 * Campanita: cada aviso se guarda para cada destinatario, según lo que su rol puede ver.
 * Quién recibe qué se decide en cada ruta con estas ayudas, usando los mismos permisos de los módulos.
 */

export type NotificationData = { kind: string; title: string; body?: string | null; link?: string | null };

const DAY = 86_400_000;

/** Guarda un aviso por persona. Se llama después de confirmar el cambio: si falla, la operación principal sigue siendo válida */
export async function notify(userIds: (string | null | undefined)[], data: NotificationData, opts: { except?: string | null } = {}) {
  try {
    const ids = [...new Set(userIds.filter((id): id is string => !!id && id !== opts.except))];
    if (!ids.length) return;
    await prisma.notification.createMany({
      data: ids.map((userId) => ({ userId, kind: data.kind, title: data.title.slice(0, 160), body: data.body?.slice(0, 300) ?? null, link: data.link ?? null })),
    });
  } catch (err) {
    console.error("No se pudo guardar la notificación:", err);
  }
}

/** Personas activas con acceso a una pantalla interna, con sus acciones y alcance resueltos */
async function moduleHolders(internalKey: string) {
  const mod = await prisma.module.findFirst({ where: { type: "INTERNAL", internalKey, active: true }, include: { roles: true, users: { select: { userId: true } } } });
  if (!mod) return [];
  const users = await prisma.user.findMany({ where: { active: true }, select: { id: true, roleId: true, siteId: true, role: { select: { key: true } } } });
  const granted = new Set(mod.users.map((u) => u.userId));
  return users.flatMap((u) => {
    const roles = mod.roles.filter((r) => r.roleId === u.roleId);
    if (u.role.key !== ADMIN_ROLE_KEY && !roles.length && !granted.has(u.id)) return [];
    return [{ id: u.id, roleKey: u.role.key, siteId: u.siteId, ...resolveAccess({ roleKey: u.role.key }, { key: mod.key, internalKey: mod.internalKey, roles }) }];
  });
}

/** Quienes pueden hacer una acción en una pantalla. Con `siteId`, solo quienes operan en esa sede */
export async function usersWithAction(internalKey: string, action: string, siteId?: string) {
  const holders = await moduleHolders(internalKey);
  return holders.filter((h) => h.actions.includes(action) && (!siteId || h.scope === "ALL" || (h.scope !== "OWN" && h.siteId === siteId))).map((h) => h.id);
}

/** Destinatarios de una publicación o comunicado: quienes tienen la pantalla y son de esos roles (sin roles = todos) */
export async function usersForRoles(internalKey: string, roleKeys: string[]) {
  const holders = await moduleHolders(internalKey);
  return holders.filter((h) => roleKeys.length === 0 || roleKeys.includes(h.roleKey)).map((h) => h.id);
}

/** Supervisores de estas personas */
export async function supervisorsOf(userIds: (string | null | undefined)[]) {
  const ids = userIds.filter((id): id is string => !!id);
  if (!ids.length) return [];
  const rows = await prisma.user.findMany({ where: { id: { in: ids } }, select: { supervisorId: true } });
  return rows.map((r) => r.supervisorId);
}

/** Avisa los comunicados vigentes aún sin avisar (también los programados, al llegar su hora). Cada uno se reclama para no repetirlo */
export async function notifyDueAnnouncements() {
  try {
    const now = new Date();
    const due = await prisma.announcement.findMany({
      where: { notifiedAt: null, active: true, publishedAt: { lte: now, gte: new Date(now.getTime() - 2 * DAY) }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    });
    for (const a of due) {
      const claimed = await prisma.announcement.updateMany({ where: { id: a.id, notifiedAt: null }, data: { notifiedAt: now } });
      if (!claimed.count) continue;
      const label = a.level === "URGENT" ? "Comunicado urgente" : a.level === "IMPORTANT" ? "Comunicado importante" : "Nuevo comunicado";
      await notify(await usersForRoles("comunicados", parseStringArray(a.roleKeys)), { kind: "announcement", title: a.title, body: label, link: "comunicados" }, { except: a.authorId });
    }
  } catch (err) {
    console.error("No se pudieron avisar los comunicados:", err);
  }
}

/** Los avisos viejos ya no se muestran: se borran para que la tabla no crezca sin límite */
export const cleanupNotifications = () => prisma.notification.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 90 * DAY) } } });
