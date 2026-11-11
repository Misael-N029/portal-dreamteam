import * as React from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { PageSuspense } from "@/lib/lazy-page";
import {
  ArrowUpRight,
  ChevronRight,
  FileClock,
  Home,
  LayoutDashboard,
  LayoutGrid,
  Megaphone,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  UserCog,
  X,
  type LucideIcon,
} from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useAuth } from "@/providers/auth";
import type { Permission, PortalModule } from "@/lib/types";
import { ModuleIcon } from "@/lib/icons";
import { groupBySection, useMyModules, useOpenModule } from "@/lib/modules";
import { NoAccess } from "@/components/page";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BrandMark, Clocks } from "./brand";
import { ThemeToggle, UserMenu } from "./user-menu";
import { NotificationBell } from "./notification-bell";

type AdminItem = { to: string; label: string; icon: LucideIcon; permission: Permission; end?: boolean };

/** Administración del portal: cada página exige su permiso */
export const ADMIN_ITEMS: AdminItem[] = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, permission: "dashboard.view", end: true },
  { to: "/admin/modulos", label: "Módulos", icon: LayoutGrid, permission: "modules.manage" },
  { to: "/admin/usuarios", label: "Usuarios", icon: UserCog, permission: "users.manage" },
  { to: "/admin/roles", label: "Roles", icon: ShieldCheck, permission: "roles.manage" },
  { to: "/admin/comunicados", label: "Comunicados", icon: Megaphone, permission: "announcements.manage" },
  { to: "/admin/auditoria", label: "Auditoría", icon: FileClock, permission: "audit.view" },
  { to: "/admin/configuracion", label: "Configuración", icon: Settings, permission: "settings.manage" },
];

const CRUMBS: Record<string, string> = {
  app: "Inicio",
  admin: "Administración",
  modulos: "Módulos",
  usuarios: "Usuarios",
  roles: "Roles",
  comunicados: "Comunicados",
  auditoria: "Auditoría",
  configuracion: "Configuración",
};

/** Bloquea una página de administración si falta el permiso */
export function PermissionGate({ permission, children }: { permission: Permission; children: React.ReactNode }) {
  const { can } = useAuth();
  if (can(permission)) return <>{children}</>;
  if (permission === "dashboard.view") {
    const first = ADMIN_ITEMS.find((i) => can(i.permission));
    if (first) return <Navigate to={first.to} replace />;
  }
  return <NoAccess message="Tu rol no tiene acceso a esta sección. Pide acceso a un administrador." />;
}

const navClass = (isActive: boolean) =>
  cn(
    "group flex h-9 items-center gap-3 rounded-md px-3 text-13 font-medium transition-colors",
    isActive ? "bg-sidebar-accent text-white" : "hover:bg-sidebar-accent/60 hover:text-white",
  );

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 px-3 text-[11px] font-medium tracking-wider text-sidebar-muted uppercase">{children}</p>;
}

function ModuleNavItem({ module, onNavigate }: { module: PortalModule; onNavigate?: () => void }) {
  const open = useOpenModule();
  const { pathname } = useLocation();
  const isActive = pathname === `/app/m/${module.key}`;
  return (
    <li>
      <button
        type="button"
        onClick={() => {
          open(module);
          onNavigate?.();
        }}
        className={cn(navClass(isActive), "w-full text-left")}
      >
        <ModuleIcon name={module.icon} className={cn("size-4", isActive ? "text-brand" : "text-sidebar-muted group-hover:text-sidebar-foreground")} />
        <span className="flex-1 truncate">{module.name}</span>
        {module.type === "LINK" ? (
          <ArrowUpRight className="size-3.5 text-sidebar-muted opacity-0 transition-opacity group-hover:opacity-100" />
        ) : (
          isActive && <span className="size-1.5 rounded-full bg-brand" />
        )}
      </button>
    </li>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { can } = useAuth();
  const { data: modules } = useMyModules();
  const admin = ADMIN_ITEMS.filter((i) => can(i.permission));
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 shrink-0 items-center border-b border-sidebar-border px-6">
        <Link to="/app" onClick={onNavigate}>
          <BrandMark inverted />
        </Link>
      </div>
      <nav className="scrollbar-none flex-1 space-y-6 overflow-y-auto px-3 py-6" aria-label="Navegación principal">
        <ul className="grid gap-0.5">
          <li>
            <NavLink to="/app" end onClick={onNavigate} className={({ isActive }) => navClass(isActive)}>
              {({ isActive }) => (
                <>
                  <Home className={cn("size-4", isActive ? "text-brand" : "text-sidebar-muted group-hover:text-sidebar-foreground")} />
                  <span className="flex-1">Inicio</span>
                  {isActive && <span className="size-1.5 rounded-full bg-brand" />}
                </>
              )}
            </NavLink>
          </li>
        </ul>
        {groupBySection(modules ?? []).map(({ section, items }) => (
          <div key={section}>
            <SectionTitle>{section}</SectionTitle>
            <ul className="grid gap-0.5">
              {items.map((m) => (
                <ModuleNavItem key={m.id} module={m} onNavigate={onNavigate} />
              ))}
            </ul>
          </div>
        ))}
        {admin.length > 0 && (
          <div>
            <SectionTitle>Administración</SectionTitle>
            <ul className="grid gap-0.5">
              {admin.map((item) => (
                <li key={item.to}>
                  <NavLink to={item.to} end={item.end} onClick={onNavigate} className={({ isActive }) => navClass(isActive)}>
                    {({ isActive }) => (
                      <>
                        <item.icon className={cn("size-4", isActive ? "text-brand" : "text-sidebar-muted group-hover:text-sidebar-foreground")} />
                        <span className="flex-1">{item.label}</span>
                        {isActive && <span className="size-1.5 rounded-full bg-brand" />}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        )}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <UserMenu variant="sidebar" />
      </div>
    </div>
  );
}

function Breadcrumbs() {
  const { pathname } = useLocation();
  const { data: modules } = useMyModules();
  const parts = pathname.split("/").filter(Boolean);
  const crumbs = parts
    .map((p, i) => ({ part: p, to: "/" + parts.slice(0, i + 1).join("/"), prev: parts[i - 1] }))
    .filter((c) => c.part !== "m")
    .map((c) => ({ to: c.to, label: c.prev === "m" ? (modules?.find((m) => m.key === c.part)?.name ?? "Módulo") : (CRUMBS[c.part] ?? c.part) }));
  return (
    <nav aria-label="Ruta" className="hidden min-w-0 items-center gap-1.5 text-13 text-muted-foreground sm:flex">
      {crumbs.map((c, i) => (
        <React.Fragment key={c.to}>
          {i > 0 && <ChevronRight className="size-3.5 shrink-0" />}
          {i === crumbs.length - 1 ? (
            <span className="truncate font-medium text-foreground">{c.label}</span>
          ) : (
            <Link to={c.to} className="truncate hover:text-foreground">
              {c.label}
            </Link>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}

/** Buscador rápido (Ctrl+K): módulos y páginas de administración */
export function CommandSearch() {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [index, setIndex] = React.useState(0);
  const { can } = useAuth();
  const { data: modules } = useMyModules();
  const openModule = useOpenModule();
  const navigate = useNavigate();

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const results = [
    ...(modules ?? []).map((m) => ({
      id: m.id,
      label: m.name,
      hint: m.description ?? m.section,
      icon: <ModuleIcon name={m.icon} className="size-4" />,
      group: "Módulos",
      run: () => openModule(m),
    })),
    ...ADMIN_ITEMS.filter((i) => can(i.permission)).map((i) => ({
      id: i.to,
      label: i.label,
      hint: "Administración",
      icon: <i.icon className="size-4" />,
      group: "Administración",
      run: () => navigate(i.to),
    })),
  ].filter((r) => !q || norm(`${r.label} ${r.hint}`).includes(norm(q)));

  const choose = (i: number) => {
    const r = results[i];
    if (!r) return;
    setOpen(false);
    setQ("");
    r.run();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden h-9 w-56 items-center gap-2 rounded-md border bg-background px-3 text-13 text-muted-foreground shadow-xs transition-colors hover:bg-accent md:flex"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Buscar módulo…</span>
        <kbd className="rounded border bg-muted px-1.5 font-sans text-[11px]">Ctrl K</kbd>
      </button>
      <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(true)} aria-label="Buscar">
        <Search />
      </Button>
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in" />
          <DialogPrimitive.Content className="fixed top-[15vh] left-1/2 z-50 w-[calc(100%-32px)] max-w-lg -translate-x-1/2 overflow-hidden rounded-xl border bg-popover shadow-lg outline-none data-[state=open]:animate-in">
            <DialogPrimitive.Title className="sr-only">Buscar</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Busca un módulo o una página de administración</DialogPrimitive.Description>
            <div className="flex items-center gap-2 border-b px-4">
              <Search className="size-4 text-muted-foreground" />
              <input
                autoFocus
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setIndex(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setIndex((i) => Math.min(i + 1, results.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setIndex((i) => Math.max(i - 1, 0));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    choose(index);
                  }
                }}
                placeholder="Escribe el nombre de un módulo…"
                className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <ul className="max-h-80 overflow-y-auto p-1.5">
              {results.length === 0 && <li className="px-3 py-8 text-center text-13 text-muted-foreground">Sin resultados para “{q}”.</li>}
              {results.map((r, i) => (
                <li key={r.id}>
                  {(i === 0 || results[i - 1]!.group !== r.group) && (
                    <p className="px-3 pt-2 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{r.group}</p>
                  )}
                  <button
                    type="button"
                    onMouseEnter={() => setIndex(i)}
                    onClick={() => choose(i)}
                    className={cn("flex w-full items-center gap-3 rounded-md px-3 py-2 text-left", i === index && "bg-accent")}
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">{r.icon}</span>
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate text-13 font-medium">{r.label}</span>
                      <span className="truncate text-xs text-muted-foreground">{r.hint}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}

export function AppLayout() {
  const { user } = useAuth();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const { pathname } = useLocation();
  React.useEffect(() => setMobileOpen(false), [pathname]);
  // Los módulos incrustados usan todo el alto disponible, sin el margen del contenido
  const fullBleed = pathname.startsWith("/app/m/");

  if (!user) return <Navigate to="/login" replace state={{ from: pathname }} />;

  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 lg:block">
        <div className="fixed inset-y-0 w-64">
          <Sidebar />
        </div>
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 animate-in">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute top-4 right-3 text-white hover:bg-white/10"
              onClick={() => setMobileOpen(false)}
              aria-label="Cerrar menú"
            >
              <X />
            </Button>
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 h-16 shrink-0 border-b bg-background/95 px-4 backdrop-blur sm:px-6 lg:px-8">
          <div className={cn("mx-auto flex h-full items-center gap-3", !fullBleed && "max-w-7xl")}>
            <Button variant="ghost" size="icon" className="-ml-2 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Abrir menú">
              <Menu />
            </Button>
            <Breadcrumbs />
            <div className="ml-auto flex items-center gap-2">
              <CommandSearch />
              <Clocks />
              <NotificationBell />
              <ThemeToggle />
              <UserMenu />
            </div>
          </div>
        </header>
        <main className={cn("flex flex-1 flex-col", fullBleed ? "bg-background" : "bg-surface/40 px-4 py-8 sm:px-6 lg:px-8")}>
          <div className={cn(fullBleed ? "flex flex-1 flex-col" : "mx-auto w-full max-w-7xl")}>
            <PageSuspense>
              <Outlet />
            </PageSuspense>
          </div>
        </main>
      </div>
    </div>
  );
}
