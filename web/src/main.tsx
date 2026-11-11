import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { Loader2 } from "lucide-react";
import "./index.css";
import { AuthProvider, useAuth } from "@/providers/auth";
import { BrandingEffect, ThemeProvider, useTheme } from "@/providers/branding";
import { ConfirmProvider } from "@/components/ui/overlay";
import { AppLayout, PermissionGate } from "@/components/layout/app-layout";
import { PortalLayout } from "@/components/layout/portal-layout";
import { LoginPage } from "@/pages/login";
import { HomePage } from "@/pages/app/home";
import { ModuleViewPage } from "@/pages/app/module-view";
import { PageSuspense, lazyPage } from "@/lib/lazy-page";

const AdminDashboardPage = lazyPage(() => import("@/pages/admin/dashboard"), "AdminDashboardPage");
const ModulesPage = lazyPage(() => import("@/pages/admin/modules"), "ModulesPage");
const UsersPage = lazyPage(() => import("@/pages/admin/users"), "UsersPage");
const RolesPage = lazyPage(() => import("@/pages/admin/roles"), "RolesPage");
const AnnouncementsAdminPage = lazyPage(() => import("@/pages/admin/announcements"), "AnnouncementsAdminPage");
const AuditPage = lazyPage(() => import("@/pages/admin/audit"), "AuditPage");
const SettingsPage = lazyPage(() => import("@/pages/admin/settings"), "SettingsPage");

/** Tras actualizar el portal, una pestaña abierta puede pedir archivos que ya no existen: se recarga (como mucho una vez por minuto) */
window.addEventListener("vite:preloadError", (event) => {
  const key = "portal-reload-at";
  if (Date.now() - Number(sessionStorage.getItem(key) ?? 0) < 60_000) return;
  sessionStorage.setItem(key, String(Date.now()));
  event.preventDefault();
  window.location.reload();
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

/** Avisos emergentes: abajo a la derecha (no tapan la campanita) y con el mismo tema claro u oscuro del portal */
function PortalToaster() {
  const { dark } = useTheme();
  return <Toaster position="bottom-right" theme={dark ? "dark" : "light"} richColors closeButton />;
}

/** El administrador trabaja con barra lateral; el resto ve su panel de bloques sin barra lateral */
function AppShell() {
  const { isStaff } = useAuth();
  return isStaff ? <AppLayout /> : <PortalLayout />;
}

/** El portal es solo para colaboradores: la dirección principal lleva al inicio de sesión o, con sesión, al inicio */
function RootRedirect() {
  const { user } = useAuth();
  return <Navigate to={user ? "/app" : "/login"} replace />;
}

function AppRoutes() {
  const { loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-brand" />
      </div>
    );
  }
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AppShell />}>
        <Route path="/app" element={<HomePage />} />
        <Route path="/app/m/:key" element={<ModuleViewPage />} />
        <Route path="/admin" element={<PermissionGate permission="dashboard.view"><AdminDashboardPage /></PermissionGate>} />
        <Route path="/admin/modulos" element={<PermissionGate permission="modules.manage"><ModulesPage /></PermissionGate>} />
        <Route path="/admin/usuarios" element={<PermissionGate permission="users.manage"><UsersPage /></PermissionGate>} />
        <Route path="/admin/roles" element={<PermissionGate permission="roles.manage"><RolesPage /></PermissionGate>} />
        <Route path="/admin/comunicados" element={<PermissionGate permission="announcements.manage"><AnnouncementsAdminPage /></PermissionGate>} />
        <Route path="/admin/auditoria" element={<PermissionGate permission="audit.view"><AuditPage /></PermissionGate>} />
        <Route path="/admin/configuracion" element={<PermissionGate permission="settings.manage"><SettingsPage /></PermissionGate>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ThemeProvider>
          <AuthProvider>
            <ConfirmProvider>
              <BrandingEffect />
              <PageSuspense>
                <AppRoutes />
              </PageSuspense>
              <PortalToaster />
            </ConfirmProvider>
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
