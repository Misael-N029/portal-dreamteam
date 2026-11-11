import * as React from "react";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/providers/auth";
import { useMyModules } from "@/lib/modules";
import { PageSuspense } from "@/lib/lazy-page";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BrandMark, Clocks } from "./brand";
import { CommandSearch } from "./app-layout";
import { ThemeToggle, UserMenu } from "./user-menu";
import { NotificationBell } from "./notification-bell";

/**
 * Estructura del panel para quien no administra: sin barra lateral, solo una cabecera.
 * El inicio son bloques con foto; al abrir un módulo la cabecera ofrece volver al inicio.
 */
export function PortalLayout() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const { data: modules } = useMyModules();
  const inModule = pathname.startsWith("/app/m/");
  const current = inModule ? modules?.find((m) => m.key === pathname.split("/")[3]) : undefined;

  React.useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  if (!user) return <Navigate to="/login" replace state={{ from: pathname }} />;

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-40 h-16 shrink-0 border-b bg-background/95 backdrop-blur">
        <div className={cn("mx-auto flex h-full items-center gap-3 px-4 sm:px-6 lg:px-8", !inModule && "max-w-7xl")}>
          {inModule ? (
            <>
              <Button asChild variant="ghost" size="sm" className="-ml-2">
                <Link to="/app">
                  <ArrowLeft /> <span className="hidden sm:inline">Mis módulos</span>
                </Link>
              </Button>
              <span className="h-5 w-px bg-border" />
              <span className="truncate text-sm font-semibold">{current?.name ?? "Módulo"}</span>
            </>
          ) : (
            <Link to="/app" className="min-w-0">
              <BrandMark />
            </Link>
          )}
          <div className="ml-auto flex items-center gap-2">
            <CommandSearch />
            <Clocks />
            <NotificationBell />
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
      </header>
      <main className={cn("flex flex-1 flex-col", inModule ? "bg-background" : "bg-surface/40")}>
        <PageSuspense>
          {inModule ? (
            <Outlet />
          ) : (
            <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
              <Outlet />
            </div>
          )}
        </PageSuspense>
      </main>
    </div>
  );
}
