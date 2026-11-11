import * as React from "react";
import { Loader2 } from "lucide-react";

/** Carga una pantalla (export con nombre) solo cuando se abre: un asesor no descarga el panel de administración */
export function lazyPage<K extends string, M extends Record<K, React.ComponentType>>(load: () => Promise<M>, name: K) {
  return React.lazy(() => load().then((m) => ({ default: m[name] })));
}

/** Mientras llega la pantalla: el mismo indicador de carga del resto del portal */
export function PageFallback() {
  return (
    <div className="flex h-full flex-1 items-center justify-center">
      <Loader2 className="size-6 animate-spin text-brand" />
    </div>
  );
}

/** Zona donde aparecen las pantallas: el menú y la cabecera se quedan visibles mientras carga */
export function PageSuspense({ children }: { children: React.ReactNode }) {
  return <React.Suspense fallback={<PageFallback />}>{children}</React.Suspense>;
}
