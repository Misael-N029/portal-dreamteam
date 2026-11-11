import type { Request } from "express";
import { prisma } from "./prisma.js";
import { clientIp } from "./ip.js";

/** Registra una acción en la bitácora. Nunca hace fallar la petición si la escritura falla. */
export async function audit(
  req: Request,
  action: string,
  entity: string,
  opts: { entityId?: string | null; detail?: string; actor?: { id: string; name: string } } = {},
) {
  const actor = opts.actor ?? req.user;
  try {
    await prisma.auditLog.create({
      data: {
        actorId: actor?.id ?? null,
        actorName: actor?.name ?? "Sistema",
        action,
        entity,
        entityId: opts.entityId ?? null,
        detail: opts.detail?.slice(0, 500),
        ip: clientIp(req),
      },
    });
  } catch (err) {
    console.error("No se pudo registrar la auditoría", err);
  }
}
