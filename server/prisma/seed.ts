/** Datos de ejemplo para desarrollo local (npm run db:setup / db:reset). Nunca se ejecuta en producción. */
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";
import { bootstrap } from "./bootstrap.js";

const PEOPLE: { name: string; email: string; role: string; area: string; position: string; phone?: string; password: string }[] = [
  { name: "Administrador Portal", email: "admin@dreamteam.com.pe", role: "admin", area: "Sistemas", position: "Administrador", password: "Admin2026!" },
  { name: "Rosa Villanueva", email: "rosa.villanueva@dreamteam.com.pe", role: "supervisor", area: "Vodafone Portabilidad", position: "Supervisora", phone: "987 654 321", password: "Supervisor2026" },
  { name: "Walter Rosario", email: "walter.rosario@dreamteam.com.pe", role: "rrhh", area: "Recursos Humanos", position: "Analista de RRHH", password: "Rrhh2026" },
  { name: "Diego Huamán", email: "diego.huaman@dreamteam.com.pe", role: "asesor", area: "Vodafone Portabilidad", position: "Asesor comercial", password: "Asesor2026" },
  { name: "Milagros Quispe", email: "milagros.quispe@dreamteam.com.pe", role: "asesor", area: "Yoigo Fibra", position: "Asesora comercial", password: "Asesor2026" },
  { name: "Kevin Paredes", email: "kevin.paredes@dreamteam.com.pe", role: "asesor", area: "Yoigo Fibra", position: "Asesor comercial", password: "Asesor2026" },
  { name: "Lucía Ramos", email: "lucia.ramos@dreamteam.com.pe", role: "backoffice", area: "Backoffice", position: "Validadora de ventas", password: "Backoffice2026" },
];

async function main() {
  const roles = await bootstrap();
  const users = new Map<string, string>();
  for (const p of PEOPLE) {
    const u = await prisma.user.upsert({
      where: { email: p.email },
      update: {},
      create: {
        name: p.name,
        email: p.email,
        roleId: roles.get(p.role)!,
        area: p.area,
        position: p.position,
        phone: p.phone ?? null,
        passwordHash: await bcrypt.hash(p.password, 10),
        lastLoginAt: p.role === "admin" ? null : new Date(Date.now() - Math.random() * 5 * 86400_000),
      },
    });
    users.set(p.email, u.id);
  }

  if ((await prisma.announcement.count()) === 0) {
    const author = users.get("rosa.villanueva@dreamteam.com.pe")!;
    await prisma.announcement.createMany({
      data: [
        {
          title: "Nuevas promociones de octubre",
          body: "Ya están vigentes las promociones de octubre. Revisa las condiciones con tu supervisor antes de tu primera llamada.",
          level: "IMPORTANT",
          pinned: true,
          authorId: author,
        },
        {
          title: "Tipificación correcta en el CRM",
          body: "Recuerden tipificar cada llamada al cerrarla. Las ventas sin tipificar no entran al reporte de backoffice del día.",
          level: "INFO",
          authorId: author,
          roleKeys: JSON.stringify(["asesor"]),
        },
        {
          title: "Mantenimiento del CRM el sábado",
          body: "El sábado de 7:00 a 8:00 (hora Perú) el CRM estará en mantenimiento. Programen sus rellamadas para después de las 8:00.",
          level: "URGENT",
          authorId: users.get("admin@dreamteam.com.pe")!,
        },
      ],
    });
  }

  // Actividad de ejemplo para que el dashboard no arranque vacío
  if ((await prisma.moduleOpen.count()) === 0) {
    const modules = await prisma.module.findMany({ select: { id: true, key: true } });
    const weight: Record<string, number> = { crm: 55, correo: 12, campus: 8, directorio: 6, reportes: 10, comunicados: 9 };
    const people = [...users.values()];
    for (const m of modules) {
      for (let i = 0; i < (weight[m.key] ?? 3); i++) {
        await prisma.moduleOpen.create({
          data: { moduleId: m.id, userId: people[i % people.length]!, at: new Date(Date.now() - Math.random() * 20 * 86400_000) },
        });
      }
    }
    for (let d = 0; d < 14; d++) {
      for (const [email, id] of users) {
        if (Math.random() < 0.25 || email.startsWith("admin")) continue;
        await prisma.auditLog.create({
          data: { actorId: id, actorName: PEOPLE.find((p) => p.email === email)!.name, action: "auth.login", entity: "user", entityId: id, ip: "181.176.120.40", at: new Date(Date.now() - d * 86400_000 - Math.random() * 8 * 3600_000) },
        });
      }
    }
  }
  // Centro de Reportes: destinatarios ficticios (en local el correo y WhatsApp se simulan con SMTP_HOST=mock y EVOLUTION_API_URL=mock)
  if ((await prisma.recipient.count()) === 0) {
    const recipients = await Promise.all(
      [
        { name: "Gerencia comercial", kind: "EMAIL", value: "gerencia@dreamteam.com.pe" },
        { name: "Supervisión Izaguirre", kind: "EMAIL", value: "supervision.izaguirre@dreamteam.com.pe" },
        { name: "Backoffice", kind: "EMAIL", value: "backoffice@dreamteam.com.pe" },
        { name: "Grupo Supervisores", kind: "WHATSAPP_GROUP", value: "120363000000000000@g.us" },
        { name: "Rosa Villanueva", kind: "WHATSAPP", value: "51987654321", windowStart: "08:00", windowEnd: "22:00" },
      ].map((r) => prisma.recipient.create({ data: r })),
    );
    const byName = (n: string) => recipients.find((r) => r.name === n)!.id;
    const assign: Record<string, string[]> = {
      pdt_instalar: ["Gerencia comercial", "Supervisión Izaguirre", "Grupo Supervisores"],
      seguimiento_bo: ["Gerencia comercial", "Backoffice", "Rosa Villanueva"],
      ventas_mes_bo: ["Gerencia comercial", "Backoffice"],
    };
    for (const [template, names] of Object.entries(assign)) {
      const report = await prisma.report.findFirst({ where: { template } });
      if (!report) continue;
      await prisma.report.update({
        where: { id: report.id },
        data: { active: template !== "ventas_mes_bo", recipients: { create: names.map((n) => ({ recipientId: byName(n) })) } },
      });
    }
  }

  // Inventario de ejemplo. bootstrap() ya creó las 3 sedes (la 2 y la 3 son marcadores que se renombran desde el módulo).
  const iza = await prisma.site.findUnique({ where: { code: "IZA" } });
  const s2 = await prisma.site.findUnique({ where: { code: "S02" } });
  const s3 = await prisma.site.findUnique({ where: { code: "S03" } });
  if (iza && s2 && s3 && (await prisma.machine.count()) === 0) {
    const cats = new Map((await prisma.inventoryCategory.findMany()).map((c) => [c.key, c.id]));
    const mk = (n: number, type: string, brand: string, model: string, status: string, site: string, location: string) => ({
      assetTag: `DT-${{ PC: "PC", LAPTOP: "LT", MONITOR: "MN", HEADSET: "HS" }[type] ?? "XX"}-${String(n).padStart(4, "0")}`,
      type, categoryId: cats.get(type), brand, model, status, siteId: site, location, serial: `SN${100000 + n * 37}`, hostname: `DT${type}${String(n).padStart(3, "0")}`,
    });
    const machines = await Promise.all(
      [
        mk(1, "PC", "Dell", "OptiPlex 3080", "ACTIVE", iza.id, "Piso 2 · P01"),
        mk(2, "PC", "Dell", "OptiPlex 3080", "ACTIVE", iza.id, "Piso 2 · P02"),
        mk(3, "PC", "HP", "ProDesk 400 G7", "ACTIVE", iza.id, "Piso 2 · P03"),
        mk(4, "PC", "Lenovo", "ThinkCentre M70s", "ACTIVE", iza.id, "Piso 1 · P11"),
        mk(5, "PC", "Lenovo", "ThinkCentre M70s", "REPAIR", iza.id, "Taller"),
        mk(6, "PC", "HP", "ProDesk 400 G7", "ACTIVE", s2.id, "Sala A · P01"),
        mk(7, "PC", "Dell", "OptiPlex 3090", "ACTIVE", s2.id, "Sala A · P02"),
        mk(8, "PC", "Dell", "OptiPlex 3090", "STORAGE", s2.id, "Estante 2"),
        mk(9, "PC", "HP", "EliteDesk 800", "ACTIVE", s3.id, "Sala B · P04"),
        mk(10, "PC", "HP", "EliteDesk 800", "RETIRED", s3.id, "Baja 2026-09"),
        mk(1, "LAPTOP", "Lenovo", "ThinkPad E14", "ACTIVE", iza.id, "Supervisión"),
        mk(1, "MONITOR", "Samsung", "S24R350", "ACTIVE", iza.id, "Piso 2 · P01"),
        mk(2, "MONITOR", "Samsung", "S24R350", "ACTIVE", s2.id, "Sala A · P01"),
        mk(1, "HEADSET", "Jabra", "Evolve 20", "ACTIVE", s3.id, "Sala B · P04"),
      ].map((m) => prisma.machine.create({ data: m })),
    );
    // Un traslado en tránsito, para ver el flujo de recepción
    const moving = machines[7]!;
    await prisma.machineTransfer.create({
      data: { machineId: moving.id, fromSiteId: s2.id, toSiteId: iza.id, reason: "Refuerzo de campaña", prevStatus: "STORAGE", createdByName: "Administrador Portal" },
    });
    await prisma.machine.update({ where: { id: moving.id }, data: { status: "TRANSIT" } });

    // Plano de sala de Izaguirre: dos islas y supervisión, kits por puesto
    await prisma.site.update({ where: { id: iza.id }, data: { planCols: 20, planRows: 11 } });
    const zoneA = await prisma.floorZone.create({ data: { siteId: iza.id, name: "Isla A · Vodafone", color: "#DC2626", x: 1, y: 1, w: 8, h: 4 } });
    const zoneB = await prisma.floorZone.create({ data: { siteId: iza.id, name: "Isla B · Yoigo", color: "#0369A1", x: 11, y: 1, w: 8, h: 4 } });
    const zoneS = await prisma.floorZone.create({ data: { siteId: iza.id, name: "Supervisión", color: "#15803D", x: 1, y: 7, w: 5, h: 3 } });
    const stations: { id: string; code: string; userId: string | null }[] = [];
    for (let i = 0; i < 6; i++) stations.push(await prisma.workstation.create({ data: { siteId: iza.id, zoneId: zoneA.id, code: `P-${String(i + 1).padStart(2, "0")}`, x: 2 + (i % 3) * 2, y: 2 + Math.floor(i / 3) * 2 } }));
    for (let i = 0; i < 6; i++) stations.push(await prisma.workstation.create({ data: { siteId: iza.id, zoneId: zoneB.id, code: `P-${String(i + 7).padStart(2, "0")}`, x: 12 + (i % 3) * 2, y: 2 + Math.floor(i / 3) * 2 } }));
    stations.push(await prisma.workstation.create({ data: { siteId: iza.id, zoneId: zoneS.id, code: "SUP-01", x: 3, y: 8 } }));
    const diego = users.get("diego.huaman@dreamteam.com.pe")!;
    const milagros = users.get("milagros.quispe@dreamteam.com.pe")!;
    const rosa = users.get("rosa.villanueva@dreamteam.com.pe")!;
    await prisma.workstation.update({ where: { id: stations[0]!.id }, data: { userId: diego } });
    await prisma.workstation.update({ where: { id: stations[6]!.id }, data: { userId: milagros } });
    await prisma.workstation.update({ where: { id: stations[12]!.id }, data: { userId: rosa } });
    const place = async (tag: string, st: number) => {
      const s = await prisma.workstation.findUniqueOrThrow({ where: { id: stations[st]!.id } });
      const m = await prisma.machine.findUnique({ where: { assetTag: tag } });
      if (m && m.siteId === iza.id && m.status !== "TRANSIT")
        await prisma.machine.update({ where: { id: m.id }, data: { workstationId: s.id, location: s.code, assignedUserId: s.userId, status: m.status === "STORAGE" ? "ACTIVE" : m.status } });
    };
    await place("DT-PC-0001", 0);
    await place("DT-MN-0001", 0);
    await place("DT-PC-0002", 1);
    await place("DT-PC-0003", 2);
    await place("DT-PC-0004", 6);
    await place("DT-LT-0001", 12);
    // Kit completo en P-01 (headset, teclado, mouse) con specs y garantía
    const kit = [
      { assetTag: "DT-HS-0101", type: "HEADSET", brand: "Jabra", model: "Evolve 20", warrantyUntil: new Date(Date.now() + 20 * 86400_000) },
      { assetTag: "DT-KB-0101", type: "KEYBOARD", brand: "Logitech", model: "K120" },
      { assetTag: "DT-MS-0101", type: "MOUSE", brand: "Logitech", model: "M90" },
    ];
    for (const k of kit) {
      await prisma.machine.create({
        data: { ...k, categoryId: cats.get(k.type), siteId: iza.id, status: "ACTIVE", workstationId: stations[0]!.id, location: "P-01", assignedUserId: diego },
      });
    }
    await prisma.machine.updateMany({
      where: { assetTag: "DT-PC-0001" },
      data: { cpu: "Intel Core i5-10500", ram: "8 GB", storage: "256 GB SSD", os: "Windows 11 Pro", supplier: "Deltron", purchaseDate: new Date("2024-02-10"), warrantyUntil: new Date("2027-02-10") },
    });
    for (const [i, t] of ["DT-HS-0201", "DT-HS-0202", "DT-KB-0201"].entries()) {
      await prisma.machine.create({ data: { assetTag: t, type: i < 2 ? "HEADSET" : "KEYBOARD", categoryId: cats.get(i < 2 ? "HEADSET" : "KEYBOARD"), brand: i < 2 ? "Jabra" : "Logitech", siteId: iza.id, status: "STORAGE", location: "Almacén" } });
    }
    const pc5 = await prisma.machine.findUnique({ where: { assetTag: "DT-PC-0005" } });
    if (pc5) await prisma.incident.create({ data: { machineId: pc5.id, title: "No enciende", description: "Se apagó durante la jornada y ya no prende.", status: "IN_PROGRESS", priority: "HIGH", technician: "Soporte TI", prevStatus: "ACTIVE", reportedByName: "Rosa Villanueva", reportedById: rosa } });
  }
  // Insumos del almacén de Izaguirre (dos bajo el mínimo) y una entrega pendiente de confirmar
  if (iza && (await prisma.supply.count()) === 0) {
    const cats = new Map((await prisma.inventoryCategory.findMany()).map((c) => [c.key, c.id]));
    const admin = { id: users.get("admin@dreamteam.com.pe")!, name: "Administrador Portal" };
    const items: [string, string, string, string, number, number][] = [
      ["OFI-001", "Papel bond A4 (millar)", "OFICINA", "paquete", 18, 5],
      ["OFI-002", "Lapiceros azules", "OFICINA", "caja", 2, 4],
      ["OFI-003", "Post-it amarillo", "OFICINA", "paquete", 9, 3],
      ["LIM-001", "Alcohol en gel 1 L", "LIMPIEZA", "unid.", 6, 4],
      ["LIM-002", "Paños de microfibra", "LIMPIEZA", "unid.", 25, 10],
      ["REP-001", "Almohadillas para headset", "REPUESTOS", "par", 3, 8],
      ["REP-002", "Cable de red Cat6 2 m", "REPUESTOS", "unid.", 14, 5],
      ["IMP-001", "Tóner HP 105A", "IMPRESION", "unid.", 1, 2],
    ];
    for (const [sku, name, cat, unit, qty, min] of items) {
      const s = await prisma.supply.create({ data: { sku, name, unit, categoryId: cats.get(cat), defaultMin: min } });
      await prisma.supplyStock.create({ data: { supplyId: s.id, siteId: iza.id, quantity: qty, minStock: min } });
      await prisma.supplyMovement.create({ data: { supplyId: s.id, siteId: iza.id, kind: "IN", quantity: qty, balance: qty, reason: "Stock inicial", actorId: admin.id, actorName: admin.name } });
    }
    const pads = await prisma.supply.findUniqueOrThrow({ where: { sku: "REP-001" } });
    await prisma.supplyStock.update({ where: { supplyId_siteId: { supplyId: pads.id, siteId: iza.id } }, data: { quantity: 2 } });
    await prisma.supplyMovement.create({ data: { supplyId: pads.id, siteId: iza.id, kind: "DELIVERY", quantity: -1, balance: 2, reason: "Entrega a Diego Huamán", actorId: admin.id, actorName: admin.name } });
    await prisma.supplyDelivery.create({ data: { supplyId: pads.id, siteId: iza.id, userId: users.get("diego.huaman@dreamteam.com.pe")!, quantity: 1, note: "Cambio por desgaste", deliveredById: admin.id, deliveredByName: admin.name } });
  }
  // Los usuarios de ejemplo trabajan en Izaguirre
  if (iza) await prisma.user.updateMany({ where: { email: { in: PEOPLE.map((p) => p.email) }, siteId: null }, data: { siteId: iza.id } });
  // Rosa supervisa a los asesores de ejemplo (son los que puede reubicar en el plano)
  await prisma.user.updateMany({
    where: { email: { in: PEOPLE.filter((p) => p.role === "asesor").map((p) => p.email) }, supervisorId: null },
    data: { supervisorId: users.get("rosa.villanueva@dreamteam.com.pe")! },
  });

  // DreamZone: publicaciones de ejemplo de RRHH
  if ((await prisma.post.count()) === 0) {
    const rrhh = users.get("walter.rosario@dreamteam.com.pe") ?? null;
    const day = 24 * 3600 * 1000;
    await prisma.post.create({
      data: {
        authorId: rrhh, kind: "POLL", title: "¿Qué actividad del mes prefieres?", body: "Elige una: la más votada se hace el último viernes.", closesAt: new Date(Date.now() + 5 * day), pinned: true,
        options: { create: ["Campeonato de fulbito", "Tarde de karaoke", "Almuerzo de integración"].map((label, position) => ({ label, position })) },
      },
    });
    await prisma.post.create({ data: { authorId: rrhh, kind: "EVENT", title: "Cumpleaños del mes", body: "Celebramos a los cumpleañeros de noviembre con torta en el comedor.", eventAt: new Date(Date.now() + 3 * day), imageUrl: "/modules/cumpleanos.jpg" } });
    await prisma.post.create({ data: { authorId: rrhh, kind: "CHALLENGE", title: "Dinámica: la mejor foto de tu puesto", body: "Comenta con tu idea más creativa para decorar tu puesto. La más votada gana un premio.", closesAt: new Date(Date.now() + 7 * day) } });
    await prisma.post.create({ data: { authorId: rrhh, kind: "NEWS", title: "Convenio de salud con clínica aliada", body: "Descuentos para colaboradores y familiares en chequeos preventivos. Pregunta en RRHH.", imageUrl: "/modules/equipo.jpg" } });
    await prisma.post.create({
      data: { authorId: users.get("rosa.villanueva@dreamteam.com.pe") ?? null, kind: "PHOTO", title: "¡Récord de ventas en Vodafone!", body: "Gracias equipo, cerramos la semana con el mejor resultado del año.", imageUrl: "/modules/logros.jpg", publishedAt: new Date(Date.now() - day) },
    });
  }

  console.log("Datos de ejemplo listos. Ingresa con admin@dreamteam.com.pe / Admin2026!");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
