import type { Permission } from "./permissions.js";

/** Roles base del portal (todos de sistema: no se pueden borrar). Solo el Administrador administra. Ver lib/role-matrix.ts */
export const DEFAULT_ROLES: {
  key: string;
  name: string;
  description: string;
  color: string;
  system: boolean;
  bypassIp: boolean;
  permissions: Permission[];
}[] = [
  { key: "admin", name: "Admin / TI", description: "Acceso total al portal y a su configuración; único que mueve, retira o reemplaza equipos", color: "#DC2626", system: true, bypassIp: true, permissions: [] },
  {
    key: "supervisor",
    name: "Supervisor",
    description: "Lidera un equipo y usa las herramientas de su operación",
    color: "#0A0A0A",
    system: true,
    bypassIp: true,
    permissions: [],
  },
  { key: "asesor", name: "Asesor comercial", description: "Usa las herramientas de venta del día a día", color: "#6B7280", system: true, bypassIp: false, permissions: [] },
  {
    key: "rrhh",
    name: "Recursos Humanos",
    description: "Usa las herramientas de gestión del personal",
    color: "#B45309",
    system: true,
    bypassIp: true,
    permissions: [],
  },
  { key: "backoffice", name: "Backoffice", description: "Validación, seguimiento e instalación de ventas", color: "#15803D", system: true, bypassIp: false, permissions: [] },
];

/** Módulos iniciales: las herramientas que ya usaba la consola de colaboradores. `roles`: claves de rol que lo ven. */
export const DEFAULT_MODULES: {
  key: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  type: "INTERNAL" | "LINK" | "IFRAME";
  url?: string;
  internalKey?: string;
  section: string;
  newTab: boolean;
  imageUrl?: string;
  badge?: string;
  roles: string[];
}[] = [
  {
    key: "crm",
    imageUrl: "/modules/operacion.jpg",
    name: "CRM Corporativo",
    description: "Leads, registro de llamadas, ventas y embudos de conversión",
    icon: "Headset",
    color: "#0A0A0A",
    type: "LINK",
    url: "http://31.97.165.147/login",
    section: "Ventas",
    newTab: true,
    roles: ["supervisor", "asesor", "backoffice"],
  },
  {
    key: "reportes",
    imageUrl: "/modules/metas.jpg",
    name: "Centro de Reportes",
    description: "Reportes del CRM programados por correo y WhatsApp",
    icon: "FileBarChart",
    color: "#15803D",
    type: "INTERNAL",
    internalKey: "reportes",
    section: "Operación",
    newTab: false,
    roles: ["supervisor", "backoffice"],
  },
  {
    key: "dashboard-ventas",
    imageUrl: "/modules/bonos.jpg",
    name: "Dashboard de ventas",
    description: "Indicadores de la operación en tiempo real",
    icon: "ChartNoAxesCombined",
    color: "#B45309",
    type: "LINK",
    url: "https://script.google.com/macros/s/AKfycbwWaw8oZha1QVh4RRCBez8ANPuLbnz11xtO3MZe5zVxnDZlfOZ0G3QKw1URJOEwQ7FwpQ/exec",
    section: "Operación",
    newTab: true,
    roles: ["supervisor"],
  },
  {
    key: "campus",
    imageUrl: "/modules/formacion.jpg",
    name: "Campus de formación",
    description: "Cursos, evaluaciones y material de cada campaña",
    icon: "GraduationCap",
    color: "#DC2626",
    type: "LINK",
    url: "https://campus.dreamteam.com.pe/",
    section: "Equipo",
    newTab: true,
    roles: ["supervisor", "asesor", "backoffice", "rrhh"],
  },
  {
    key: "rrhh",
    imageUrl: "/modules/equipo.jpg",
    name: "Gestión de RRHH",
    description: "Asistencia, altas y documentación del personal",
    icon: "IdCard",
    color: "#374151",
    type: "LINK",
    url: "https://script.google.com/macros/s/AKfycbxN7BPg2Wi8ZNn26-tMflP_ha7moifdt50ON1xUq7vcvKiJCx99BOe0hyBZx58W8Koj/exec",
    section: "Equipo",
    newTab: true,
    roles: ["rrhh"],
  },
  {
    key: "directorio",
    imageUrl: "/modules/integracion.jpg",
    name: "Directorio",
    description: "Encuentra a cualquier compañero por nombre, área o cargo",
    icon: "Contact",
    color: "#374151",
    type: "INTERNAL",
    internalKey: "directorio",
    section: "Equipo",
    newTab: false,
    roles: ["supervisor", "asesor", "backoffice", "rrhh"],
  },
  {
    key: "correo",
    imageUrl: "/modules/asesora.jpg",
    name: "Correo corporativo",
    description: "Buzón institucional para las comunicaciones oficiales",
    icon: "Mail",
    color: "#6B7280",
    type: "LINK",
    url: "https://witcher.mxrouting.net/roundcube/?_task=mail&_mbox=INBOX",
    section: "Recursos",
    newTab: true,
    roles: ["supervisor", "asesor", "backoffice", "rrhh"],
  },
  {
    key: "comunicados",
    imageUrl: "/modules/logros.jpg",
    name: "Comunicados",
    description: "Avisos y novedades publicados por la empresa",
    icon: "Megaphone",
    color: "#DC2626",
    type: "INTERNAL",
    internalKey: "comunicados",
    section: "Recursos",
    newTab: false,
    roles: ["supervisor", "asesor", "backoffice", "rrhh"],
  },
  {
    key: "inventario",
    imageUrl: "/modules/sala.jpg",
    name: "Inventario",
    description: "Plano de sala por puestos, equipos, insumos del almacén, entregas e incidencias",
    icon: "MonitorSmartphone",
    color: "#DC2626",
    type: "INTERNAL",
    internalKey: "inventario",
    section: "Operación",
    newTab: false,
    badge: "Nuevo",
    // Qué hace cada rol dentro del módulo lo define la matriz fija (lib/role-matrix.ts)
    roles: ["supervisor", "asesor", "backoffice", "rrhh"],
  },
  {
    key: "dreamzone",
    imageUrl: "/modules/celebracion.jpg",
    name: "DreamZone",
    description: "La comunidad DreamTeam: novedades, votaciones, encuestas, dinámicas y fotos",
    icon: "PartyPopper",
    color: "#DC2626",
    type: "INTERNAL",
    internalKey: "zona",
    section: "Equipo",
    newTab: false,
    badge: "Nuevo",
    roles: ["supervisor", "asesor", "backoffice", "rrhh"],
  },
];
