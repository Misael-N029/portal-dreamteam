import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { PortalModule } from "@/lib/types";

export const MODULE_TYPE_LABEL = { INTERNAL: "Pantalla interna", LINK: "Enlace externo", IFRAME: "Incrustado" } as const;

export function useMyModules() {
  return useQuery({ queryKey: ["portal", "modules"], queryFn: () => api.get<PortalModule[]>("/portal/modules"), staleTime: 60_000 });
}

/** Agrupa por sección respetando el orden definido por el administrador */
export function groupBySection<T extends { section: string }>(modules: T[]) {
  const groups = new Map<string, T[]>();
  for (const m of modules) groups.set(m.section, [...(groups.get(m.section) ?? []), m]);
  return [...groups.entries()].map(([section, items]) => ({ section, items }));
}

/**
 * Abre un módulo. Los enlaces externos se abren en el mismo clic (si no, el navegador bloquea la ventana)
 * y la apertura se registra en segundo plano; los incrustados e internos se muestran dentro del portal.
 */
export function useOpenModule() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  return React.useCallback(
    (m: Pick<PortalModule, "key" | "type" | "url" | "newTab">) => {
      if (m.type === "LINK" && m.url) {
        const url = m.url;
        if (m.newTab) window.open(url, "_blank", "noopener,noreferrer");
        api
          .post(`/portal/modules/${m.key}/open`)
          .then(() => qc.invalidateQueries({ queryKey: ["portal", "modules"] }))
          .catch((e: Error) => toast.error(e.message))
          // En la misma pestaña se sale del portal después de registrar la apertura
          .finally(() => {
            if (!m.newTab) window.location.href = url;
          });
        return;
      }
      navigate(`/app/m/${m.key}`);
    },
    [navigate, qc],
  );
}
