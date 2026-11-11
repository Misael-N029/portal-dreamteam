import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma, textSearch } from "../lib/prisma.js";
import { currentUser, type AuthUser } from "../lib/auth.js";
import { badRequest, forbidden } from "../lib/http.js";
import { decryptPassword, encryptPassword } from "../lib/vault.js";
import { ADMIN_ROLE_KEY } from "../lib/permissions.js";
import { assertEmailDomain, assertPassword, getSettings, normalizeEmail } from "../lib/settings.js";
import { audit } from "../lib/audit.js";

/** Usuarios del portal (requiere users.manage) */
export const usersRouter = Router();

const optionalText = z.string().trim().max(80).nullish();

const userInput = z.object({
  name: z.string().trim().min(3, "Ingresa nombre y apellido"),
  email: z.string().trim().email("Correo inválido").transform(normalizeEmail),
  password: z.string().optional(),
  roleId: z.string().min(1, "Elige un rol"),
  area: optionalText,
  position: optionalText,
  phone: z.string().trim().max(30).nullish(),
  documentId: z.string().trim().max(20).nullish(),
  /** Sede (Inventario: el supervisor opera solo la suya) */
  siteId: z.string().nullish(),
  /** Supervisor a cargo (Inventario: el supervisor reubica solo a su equipo) */
  supervisorId: z.string().nullish(),
  moduleIds: z.array(z.string()).optional(),
});

const userSelect = {
  id: true,
  name: true,
  email: true,
  active: true,
  area: true,
  position: true,
  phone: true,
  documentId: true,
  siteId: true,
  site: { select: { id: true, code: true, name: true } },
  supervisorId: true,
  supervisor: { select: { id: true, name: true } },
  lastLoginAt: true,
  lockedUntil: true,
  createdAt: true,
  passwordEnc: true,
  role: { select: { id: true, key: true, name: true, color: true } },
  createdBy: { select: { id: true, name: true } },
  extraModules: { select: { moduleId: true } },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

const present = ({ extraModules, passwordEnc, lockedUntil, ...u }: UserRow) => ({
  ...u,
  locked: !!lockedUntil && lockedUntil > new Date(),
  hasAssignedPassword: passwordEnc !== null,
  moduleIds: extraModules.map((m) => m.moduleId),
});

/** Sede elegida (o null). Falla si no existe. */
async function validSite(siteId: string | null | undefined) {
  if (!siteId) return null;
  if (!(await prisma.site.findUnique({ where: { id: siteId }, select: { id: true } }))) throw badRequest("La sede no existe");
  return siteId;
}

/** Supervisor elegido (o null). Debe ser un usuario con rol Supervisor. */
async function validSupervisor(id: string | null | undefined) {
  if (!id) return null;
  const u = await prisma.user.findUnique({ where: { id }, select: { role: { select: { key: true } } } });
  if (u?.role.key !== "supervisor") throw badRequest("El supervisor elegido no tiene el rol Supervisor");
  return id;
}

/** Solo un administrador crea, edita o asigna el rol Administrador */
async function assertRoleAssignable(actor: AuthUser, roleId: string) {
  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) throw badRequest("El rol no existe");
  if (role.key === ADMIN_ROLE_KEY && actor.roleKey !== ADMIN_ROLE_KEY) {
    throw forbidden("Solo un administrador puede asignar el rol Administrador");
  }
  return role;
}

async function loadTarget(actor: AuthUser, id: string) {
  const target = await prisma.user.findUniqueOrThrow({ where: { id }, include: { role: true } });
  if (target.role.key === ADMIN_ROLE_KEY && actor.roleKey !== ADMIN_ROLE_KEY) {
    throw forbidden("Solo un administrador puede modificar a otro administrador");
  }
  return target;
}

usersRouter.get("/", async (req, res) => {
  const q = z.object({ roleId: z.string().optional(), q: z.string().optional() }).parse(req.query);
  const users = await prisma.user.findMany({
    where: {
      ...(q.roleId ? { roleId: q.roleId } : {}),
      ...(q.q ? { OR: [{ name: textSearch(q.q) }, { email: textSearch(q.q) }, { area: textSearch(q.q) }] } : {}),
    },
    select: userSelect,
    orderBy: { createdAt: "desc" },
  });
  res.json(users.map(present));
});

usersRouter.post("/", async (req, res) => {
  const actor = currentUser(req);
  const data = userInput.parse(req.body);
  const settings = await getSettings();
  assertEmailDomain(data.email, settings);
  if (!data.password) throw badRequest("Ingresa una contraseña");
  assertPassword(data.password, settings);
  const role = await assertRoleAssignable(actor, data.roleId);

  const created = await prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      roleId: role.id,
      area: data.area || null,
      position: data.position || null,
      phone: data.phone || null,
      documentId: data.documentId || null,
      siteId: await validSite(data.siteId),
      supervisorId: await validSupervisor(data.supervisorId),
      passwordHash: await bcrypt.hash(data.password, 10),
      passwordEnc: encryptPassword(data.password),
      createdById: actor.id,
      extraModules: { create: (data.moduleIds ?? []).map((moduleId) => ({ moduleId })) },
    },
    select: userSelect,
  });
  await audit(req, "user.created", "user", { entityId: created.id, detail: `${created.email} · ${role.name}` });
  res.status(201).json(present(created));
});

usersRouter.put("/:id", async (req, res) => {
  const actor = currentUser(req);
  const target = await loadTarget(actor, req.params.id);
  const data = userInput.partial().parse(req.body);
  const settings = await getSettings();
  if (data.email && data.email !== target.email) assertEmailDomain(data.email, settings);
  if (data.password) assertPassword(data.password, settings);
  if (data.roleId && data.roleId !== target.roleId) {
    await assertRoleAssignable(actor, data.roleId);
    if (target.id === actor.id) throw badRequest("No puedes cambiar tu propio rol");
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: target.id },
      data: {
        name: data.name,
        email: data.email,
        roleId: data.roleId,
        area: data.area,
        position: data.position,
        phone: data.phone,
        documentId: data.documentId,
        ...(data.siteId !== undefined ? { siteId: await validSite(data.siteId) } : {}),
        ...(data.supervisorId !== undefined ? { supervisorId: data.supervisorId === target.id ? null : await validSupervisor(data.supervisorId) } : {}),
        ...(data.password
          ? { passwordHash: await bcrypt.hash(data.password, 10), passwordEnc: encryptPassword(data.password), failedLogins: 0, lockedUntil: null }
          : {}),
      },
    });
    if (data.moduleIds) {
      await tx.userModule.deleteMany({ where: { userId: target.id } });
      await tx.userModule.createMany({ data: data.moduleIds.map((moduleId) => ({ moduleId, userId: target.id })) });
    }
    return tx.user.findUniqueOrThrow({ where: { id: target.id }, select: userSelect });
  });
  await audit(req, data.password ? "user.password_reset" : "user.updated", "user", { entityId: target.id, detail: updated.email });
  res.json(present(updated));
});

/** Contraseña asignada por un administrador (la del ojito). null = el usuario ya la cambió por su cuenta. */
usersRouter.get("/:id/password", async (req, res) => {
  const target = await loadTarget(currentUser(req), req.params.id);
  await audit(req, "user.password_viewed", "user", { entityId: target.id, detail: target.email });
  res.json({ password: decryptPassword(target.passwordEnc) });
});

usersRouter.patch("/:id/active", async (req, res) => {
  const actor = currentUser(req);
  const { active } = z.object({ active: z.boolean() }).parse(req.body);
  const target = await loadTarget(actor, req.params.id);
  if (target.id === actor.id) throw badRequest("No puedes desactivar tu propio usuario");
  await prisma.user.update({ where: { id: target.id }, data: { active } });
  await audit(req, active ? "user.activated" : "user.deactivated", "user", { entityId: target.id, detail: target.email });
  res.json({ ok: true });
});

usersRouter.post("/:id/unlock", async (req, res) => {
  const target = await loadTarget(currentUser(req), req.params.id);
  await prisma.user.update({ where: { id: target.id }, data: { failedLogins: 0, lockedUntil: null } });
  await audit(req, "user.unlocked", "user", { entityId: target.id, detail: target.email });
  res.json({ ok: true });
});

usersRouter.delete("/:id", async (req, res) => {
  const actor = currentUser(req);
  if (req.params.id === actor.id) throw badRequest("No puedes eliminar tu propio usuario");
  const target = await loadTarget(actor, req.params.id);
  await prisma.user.delete({ where: { id: target.id } });
  await audit(req, "user.deleted", "user", { entityId: target.id, detail: target.email });
  res.json({ ok: true });
});

/** Alta masiva (pegado desde Excel): nombre, correo, área y cargo con un rol y contraseña inicial comunes */
usersRouter.post("/bulk", async (req, res) => {
  const actor = currentUser(req);
  const body = z
    .object({
      roleId: z.string(),
      password: z.string(),
      rows: z
        .array(
          z.object({
            name: z.string().trim(),
            email: z.string().trim(),
            area: z.string().trim().optional(),
            position: z.string().trim().optional(),
          }),
        )
        .min(1, "No hay filas para importar")
        .max(500, "Máximo 500 filas por importación"),
    })
    .parse(req.body);
  const role = await assertRoleAssignable(actor, body.roleId);
  const settings = await getSettings();
  assertPassword(body.password, settings);
  const passwordHash = await bcrypt.hash(body.password, 10);
  const passwordEnc = encryptPassword(body.password);

  const errors: { row: number; email: string; error: string }[] = [];
  let created = 0;
  for (const [i, row] of body.rows.entries()) {
    const email = normalizeEmail(row.email);
    try {
      if (row.name.length < 3) throw badRequest("Nombre inválido");
      if (!z.string().email().safeParse(email).success) throw badRequest("Correo inválido");
      assertEmailDomain(email, settings);
      if (await prisma.user.findUnique({ where: { email } })) throw badRequest("El correo ya está registrado");
      await prisma.user.create({
        data: {
          name: row.name,
          email,
          area: row.area || null,
          position: row.position || null,
          roleId: role.id,
          passwordHash,
          passwordEnc,
          createdById: actor.id,
        },
      });
      created++;
    } catch (e) {
      errors.push({ row: i + 1, email, error: e instanceof Error ? e.message : "Error" });
    }
  }
  await audit(req, "user.bulk_created", "user", { detail: `${created} usuarios · ${role.name}` });
  res.json({ created, errors });
});
