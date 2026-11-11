export type Permission =
  | "dashboard.view"
  | "modules.manage"
  | "users.manage"
  | "roles.manage"
  | "reports.manage"
  | "announcements.manage"
  | "settings.manage"
  | "audit.view";

export type RoleRef = { id: string; key: string; name: string; color: string };

export type ModuleScope = "ALL" | "SITE" | "TEAM" | "OWN";
/** Acciones y alcance del usuario en una pantalla interna (ver lib/module-access.ts en el servidor) */
export type ModuleAccess = { actions: string[]; scope: ModuleScope; siteId: string | null };

export type SessionUser = {
  siteId: string | null;
  access: Record<string, ModuleAccess>;
  id: string;
  email: string;
  name: string;
  area: string | null;
  position: string | null;
  role: RoleRef;
  permissions: Permission[];
  mustChangePassword: boolean;
};

export type ModuleType = "INTERNAL" | "LINK" | "IFRAME";

export type PortalModule = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  icon: string;
  color: string;
  type: ModuleType;
  url: string | null;
  internalKey: string | null;
  section: string;
  order: number;
  newTab: boolean;
  badge: string | null;
  imageUrl: string | null;
  favorite: boolean;
  uses30d: number;
};

export type AdminModule = Omit<PortalModule, "favorite" | "uses30d"> & {
  active: boolean;
  roleIds: string[];
  users: { id: string; name: string; email: string }[];
  favorites: number;
  opens30d: number;
  createdAt: string;
  updatedAt: string;
};

export type InternalScreen = { key: string; label: string; description: string };

export type Role = RoleRef & {
  description: string | null;
  system: boolean;
  permissions: Permission[];
  bypassIp: boolean;
  users: number;
  moduleIds: string[];
};

export type ActionDef = { key: string; label: string; description: string };
export type ModuleCatalog = { actions: ActionDef[]; scopes: ModuleScope[] };
export type RolesMeta = {
  permissions: PermissionDef[];
  catalog: Record<string, ModuleCatalog>;
  /** Roles base de la matriz fija (lib/role-matrix.ts en el servidor) */
  baseRoles: string[];
  /** clave de módulo → clave de rol → acceso fijo */
  matrix: Record<string, Record<string, { actions: string[]; scope: ModuleScope }>>;
};

export type PermissionDef = { key: Permission; label: string; group: string; description: string };

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  active: boolean;
  area: string | null;
  position: string | null;
  phone: string | null;
  documentId: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  locked: boolean;
  hasAssignedPassword: boolean;
  role: RoleRef;
  createdBy: { id: string; name: string } | null;
  moduleIds: string[];
  siteId: string | null;
  site: { id: string; name: string; code: string } | null;
  supervisorId: string | null;
  supervisor: { id: string; name: string } | null;
};

export type Lookups = {
  roles: RoleRef[];
  modules: { id: string; key: string; name: string; icon: string; color: string; section: string; active: boolean; type: ModuleType; internalKey: string | null }[];
  sites: { id: string; name: string; code: string; active: boolean }[];
  supervisors: { id: string; name: string; area: string | null }[];
};

export type AnnouncementLevel = "INFO" | "IMPORTANT" | "URGENT";

export type Announcement = {
  id: string;
  title: string;
  body: string;
  level: AnnouncementLevel;
  pinned: boolean;
  active: boolean;
  roleKeys: string[];
  publishedAt: string;
  expiresAt: string | null;
  author: string | null;
};

export type DirectoryEntry = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  area: string | null;
  position: string | null;
  role: { name: string; color: string };
};

export type AuditEntry = {
  id: string;
  at: string;
  actorId: string | null;
  actorName: string;
  action: string;
  entity: string;
  entityId: string | null;
  detail: string | null;
  ip: string | null;
};

export type Dashboard = {
  users: number;
  activeUsers: number;
  neverLoggedIn: number;
  modules: number;
  activeModules: number;
  loginsToday: number;
  peopleToday: number;
  perDay: { date: string; logins: number; people: number }[];
  topModules: { id: string; name: string; icon: string; color: string; opens: number }[];
  roles: { id: string; name: string; color: string; users: number }[];
  recent: AuditEntry[];
};

/** Marca que el inicio de sesión lee sin sesión */
export type PublicSettings = {
  platformName: string;
  tagline: string;
  logoUrl: string | null;
  primaryColor: string;
  loginMessage: string;
  allowedEmailDomains: string[];
};

export type Settings = PublicSettings & {
  welcomeMessage: string;
  passwordMinLength: number;
  passwordRequireNumber: boolean;
  sessionHours: number;
  maxFailedLogins: number;
  lockMinutes: number;
  ipRestrictionEnabled: boolean;
  allowedIps: string[];
};

// ── Inventario ──

export type MachineStatus = "ACTIVE" | "STORAGE" | "REPAIR" | "TRANSIT" | "RETIRED";
export type KitSlot = "PC" | "MONITOR" | "HEADSET" | "PERIPHERAL" | "PHONE" | "OTHER";
export type SiteRef = { id: string; name: string; code: string };
export type PersonRef = {
  id: string;
  name: string;
  email: string;
  area: string | null;
  position: string | null;
  supervisorId?: string | null;
  /** Solo en /inventory/people */
  supervisor?: { id: string; name: string } | null;
  site?: { name: string } | null;
  stations?: { code: string; siteId: string }[];
};

export type InventoryCategory = {
  id: string;
  kind: "EQUIPMENT" | "SUPPLY";
  key: string;
  name: string;
  icon: string;
  color: string;
  slot: KitSlot | null;
  unit: string | null;
  order: number;
  active: boolean;
};

export type InventoryMeta = { categories: InventoryCategory[]; sites: (SiteRef & { active: boolean })[]; statuses: MachineStatus[] };

export type InventoryOverview = {
  equipment: Record<MachineStatus, number> & { total: number };
  byCategory: { categoryId: string | null; count: number }[];
  pendingTransfers: number;
  openIncidents: number;
  lowStock: number;
  pendingDeliveries: number;
  warrantySoon: number;
};

export type Site = SiteRef & {
  address: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  active: boolean;
  planCols: number;
  planRows: number;
  counts: Partial<Record<MachineStatus, number>> & { total: number };
  incoming: number;
  stations: number;
  lowStock: number;
};

/** Equipo tal como aparece en el plano */
export type MachineCard = {
  id: string;
  assetTag: string;
  status: MachineStatus;
  brand: string | null;
  model: string | null;
  hostname: string | null;
  categoryId: string | null;
  workstationId: string | null;
  assignedUserId: string | null;
  warrantyUntil: string | null;
  _count: { incidents: number };
  assignedUser?: PersonRef | null;
};

export type FloorZone = { id: string; name: string; color: string; x: number; y: number; w: number; h: number };
export type Workstation = {
  id: string;
  code: string;
  x: number;
  y: number;
  active: boolean;
  zoneId: string | null;
  userId: string | null;
  user: PersonRef | null;
  machines: MachineCard[];
};
export type SitePlan = { site: Site; zones: FloorZone[]; stations: Workstation[]; loose: MachineCard[] };

export type Machine = {
  id: string;
  assetTag: string;
  type: string;
  brand: string | null;
  model: string | null;
  serial: string | null;
  hostname: string | null;
  status: MachineStatus;
  location: string | null;
  assignedTo: string | null;
  notes: string | null;
  cpu: string | null;
  ram: string | null;
  storage: string | null;
  os: string | null;
  purchaseDate: string | null;
  supplier: string | null;
  warrantyUntil: string | null;
  lastMovedAt: string | null;
  updatedAt: string;
  siteId: string;
  categoryId: string | null;
  workstationId: string | null;
  assignedUserId: string | null;
  site: SiteRef;
  workstation: { id: string; code: string } | null;
  assignedUser: PersonRef | null;
  _count?: { incidents: number };
};

export type AssetEvent = { id: string; at: string; kind: string; detail: string | null; actorName: string | null };

export type IncidentStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CANCELLED";
export type Incident = {
  id: string;
  title: string;
  description: string | null;
  status: IncidentStatus;
  priority: "LOW" | "MEDIUM" | "HIGH";
  technician: string | null;
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
  reportedByName: string | null;
  machineId: string;
  machine?: { id: string; assetTag: string; brand: string | null; model: string | null; status?: MachineStatus; categoryId?: string | null; site?: SiteRef; workstation?: { code: string } | null };
};

export type MachineTransfer = {
  id: string;
  status: "PENDING" | "RECEIVED" | "CANCELLED";
  reason: string | null;
  note: string | null;
  createdAt: string;
  receivedAt: string | null;
  createdByName: string | null;
  receivedByName: string | null;
  fromSiteId: string;
  toSiteId: string;
  machine: { id: string; assetTag: string; type: string; brand: string | null; model: string | null; categoryId: string | null };
  from: SiteRef;
  to: SiteRef;
};

export type MachineDetail = {
  machine: Machine & { category: InventoryCategory | null; workstation: { id: string; code: string; user: PersonRef | null } | null };
  events: AssetEvent[];
  incidents: Incident[];
  transfers: MachineTransfer[];
};

export type SupplyStock = { supplyId: string; siteId: string; quantity: number; minStock: number; site: SiteRef };
export type Supply = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  description: string | null;
  defaultMin: number;
  active: boolean;
  categoryId: string | null;
  stock: SupplyStock[];
  quantity: number;
  minStock: number;
  low: boolean;
};

export type SupplyMovement = {
  id: string;
  at: string;
  kind: "IN" | "OUT" | "ADJUST" | "DELIVERY" | "RETURN" | "TRANSFER_OUT" | "TRANSFER_IN";
  quantity: number;
  balance: number;
  reason: string | null;
  note: string | null;
  actorName: string | null;
  site: { code: string; name: string };
};

export type SupplyDelivery = {
  id: string;
  quantity: number;
  status: "PENDING" | "CONFIRMED" | "REJECTED";
  note: string | null;
  answerNote: string | null;
  createdAt: string;
  answeredAt: string | null;
  deliveredByName: string | null;
  supply: { id: string; name: string; unit: string; sku?: string; categoryId?: string | null };
  user?: PersonRef;
  site: { code?: string; name: string };
};

export type MyEquipment = {
  machines: (Machine & { category: InventoryCategory | null })[];
  stations: { id: string; code: string; site: SiteRef; zone: { name: string; color: string } | null }[];
  deliveries: SupplyDelivery[];
  incidents: Incident[];
};

export type ImportPreview = {
  applied: boolean;
  summary: { create: number; update: number; error: number };
  rows: { row: number; key: string; action: "create" | "update" | "error"; message?: string }[];
};

// ── DreamZone ──

export type PostKind = "NEWS" | "EVENT" | "POLL" | "CHALLENGE" | "PHOTO" | "KUDOS";
export type ReactionKind = "LIKE" | "CLAP" | "PARTY" | "STRONG" | "LAUGH";
export type ZoneStats = { posts: number; votes: number; comments: number; reactions: number; kudos: number };
export type ZonePerson = { id: string; name: string; area: string | null; position: string | null };
export type ZonePost = {
  id: string;
  kind: PostKind;
  title: string;
  body: string;
  imageUrl: string | null;
  eventAt: string | null;
  closesAt: string | null;
  closed: boolean;
  pinned: boolean;
  active: boolean;
  commentsOpen: boolean;
  notify: boolean;
  roleKeys: string[];
  publishedAt: string;
  author: string | null;
  authorRole: { name: string; color: string } | null;
  options: { id: string; label: string; votes: number }[];
  totalVotes: number;
  myVote: string | null;
  liked: boolean;
  likes: number;
  reactions: Record<ReactionKind, number>;
  myReaction: ReactionKind | null;
  /** Reconocimiento: a quién se felicita */
  mention: ZonePerson | null;
  comments: number;
  isNew: boolean;
};
export type ZoneComment = {
  id: string;
  body: string;
  hidden: boolean;
  createdAt: string;
  mine: boolean;
  user: { id: string; name: string; role: { name: string; color: string } };
};
export type NotificationItem = { id: string; kind: string; title: string; body: string | null; link: string | null; read: boolean; createdAt: string };
export type NotificationFeed = { unread: number; items: NotificationItem[] };
export type ZoneMeta = { roles: { key: string; name: string }[]; actions: string[] };
