/**
 * Inicializa una base de producción vacía: ajustes, roles y módulos por defecto y la cuenta de administrador.
 * No carga datos de ejemplo. Se puede ejecutar más de una vez (no pisa lo que ya existe).
 *
 *   ADMIN_EMAIL=... ADMIN_NAME="..." ADMIN_PASSWORD='...' npm run db:init -w server
 */
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";
import { bootstrap } from "./bootstrap.js";

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const name = process.env.ADMIN_NAME?.trim() || "Administrador";
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!email || !email.includes("@")) throw new Error("Falta ADMIN_EMAIL");
  if (password.length < 10 || !/\d/.test(password)) throw new Error("ADMIN_PASSWORD debe tener al menos 10 caracteres y un número");

  const domain = email.split("@")[1]!;
  const roles = await bootstrap({ allowedEmailDomains: [...new Set([domain, "dreamteam.com.pe", "dreamteam.pe"])] });

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`El usuario ${email} ya existe; no se cambió.`);
  } else {
    await prisma.user.create({
      data: { email, name, roleId: roles.get("admin")!, passwordHash: await bcrypt.hash(password, 10) },
    });
    console.log(`Administrador ${email} creado.`);
  }
  console.log("Base de producción lista.");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
