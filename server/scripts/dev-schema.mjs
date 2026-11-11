// Genera prisma/schema.dev.prisma (SQLite) desde prisma/schema.prisma (PostgreSQL) para trabajar en local
import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync("prisma/schema.prisma", "utf8");
if (!src.includes('provider = "postgresql"')) throw new Error('schema.prisma debe usar provider = "postgresql"');
writeFileSync(
  "prisma/schema.dev.prisma",
  "// Archivo generado por scripts/dev-schema.mjs: no lo edites, cambia schema.prisma\n" +
    src.replace('provider = "postgresql"', 'provider = "sqlite"'),
);
console.log("prisma/schema.dev.prisma listo (SQLite)");
