import "./env.js";
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

/** Producción usa PostgreSQL; el desarrollo local, SQLite (ver scripts/dev-schema.mjs) */
const isPostgres = /^postgres(ql)?:/.test(process.env.DATABASE_URL ?? "");

/**
 * Búsqueda de texto sin distinguir mayúsculas. SQLite ya lo hace solo; PostgreSQL necesita
 * mode "insensitive", que el cliente de SQLite no acepta: por eso se agrega solo en PostgreSQL.
 */
export const textSearch = (value: string) =>
  (isPostgres ? { contains: value, mode: "insensitive" } : { contains: value }) as { contains: string };
