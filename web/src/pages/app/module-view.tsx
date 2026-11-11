import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { ArrowUpRight, Loader2, RotateCw, SearchX } from "lucide-react";
import { api } from "@/lib/api";
import { useDocumentTitle } from "@/providers/branding";
import type { PortalModule } from "@/lib/types";
import { ModuleIcon, moduleTint } from "@/lib/icons";
import { EmptyState } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { PageSuspense, lazyPage } from "@/lib/lazy-page";

/** Pantallas propias del portal para los módulos INTERNAL (la clave la elige el administrador) */
const INTERNAL_SCREENS: Record<string, React.ComponentType> = {
  directorio: lazyPage(() => import("./directory"), "DirectoryScreen"),
  comunicados: lazyPage(() => import("./announcements"), "AnnouncementsScreen"),
  reportes: lazyPage(() => import("./reports"), "ReportsScreen"),
  inventario: lazyPage(() => import("./inventory"), "InventoryScreen"),
  zona: lazyPage(() => import("./zone"), "ZoneScreen"),
};

export function ModuleViewPage() {
  const { key = "" } = useParams();
  const qc = useQueryClient();
  // Abrir registra el uso y confirma en el servidor que el usuario puede ver el módulo
  const { data: mod, isLoading, error } = useQuery({
    queryKey: ["portal", "open", key],
    queryFn: async () => {
      const m = await api.post<PortalModule>(`/portal/modules/${key}/open`);
      qc.invalidateQueries({ queryKey: ["portal", "modules"] });
      return m;
    },
    staleTime: Infinity,
    retry: false,
  });
  useDocumentTitle(mod?.name ?? "Módulo");
  const [frameKey, setFrameKey] = React.useState(0);
  const [frameLoading, setFrameLoading] = React.useState(true);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-brand" />
      </div>
    );
  }
  if (error || !mod) {
    return (
      <div className="p-8">
        <EmptyState icon={SearchX} title="Módulo no disponible" description={(error as Error | null)?.message ?? "No se encontró el módulo."} />
      </div>
    );
  }

  if (mod.type === "INTERNAL") {
    const Screen = INTERNAL_SCREENS[mod.internalKey ?? ""];
    return (
      <div className="px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          {Screen ? <PageSuspense><Screen /></PageSuspense> : <EmptyState icon={SearchX} title="Pantalla no disponible" description="Esta versión del portal no incluye la pantalla configurada." />}
        </div>
      </div>
    );
  }

  if (mod.type === "LINK") {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <Card className="grid max-w-md justify-items-center gap-4 p-8 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-muted" style={{ color: moduleTint(mod.color) }}>
            <ModuleIcon name={mod.icon} className="size-6" />
          </span>
          <div className="grid gap-1">
            <h1 className="text-base font-semibold">{mod.name}</h1>
            {mod.description && <p className="text-13 text-muted-foreground">{mod.description}</p>}
          </div>
          <Button asChild>
            <a href={mod.url ?? "#"} target="_blank" rel="noopener noreferrer">
              Abrir {mod.name} <ArrowUpRight />
            </a>
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b bg-surface/60 px-4 sm:px-6">
        <span style={{ color: moduleTint(mod.color) }}>
          <ModuleIcon name={mod.icon} className="size-4" />
        </span>
        <span className="truncate text-13 font-medium">{mod.name}</span>
        {frameLoading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFrameLoading(true);
              setFrameKey((k) => k + 1);
            }}
          >
            <RotateCw /> <span className="hidden sm:inline">Recargar</span>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <a href={mod.url ?? "#"} target="_blank" rel="noopener noreferrer">
              <ArrowUpRight /> <span className="hidden sm:inline">Pestaña nueva</span>
            </a>
          </Button>
        </div>
      </div>
      <iframe
        key={frameKey}
        src={mod.url ?? undefined}
        title={mod.name}
        onLoad={() => setFrameLoading(false)}
        className="min-h-[calc(100vh-7rem)] w-full flex-1 border-0 bg-white"
        allow="clipboard-write; microphone; camera; fullscreen"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}
