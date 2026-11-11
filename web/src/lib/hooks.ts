import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

/**
 * Ejecuta una acción contra la API con estado de carga, toast de éxito/error
 * e invalidación de las queries indicadas. Devuelve `undefined` si falló.
 */
export function useAction() {
  const qc = useQueryClient();
  const [pending, setPending] = React.useState(false);
  const run = React.useCallback(
    async <T,>(fn: () => Promise<T>, opts: { success?: string; invalidate?: unknown[][] } = {}): Promise<T | undefined> => {
      setPending(true);
      try {
        const res = await fn();
        if (opts.success) toast.success(opts.success);
        await Promise.all((opts.invalidate ?? []).map((queryKey) => qc.invalidateQueries({ queryKey })));
        return res;
      } catch (err) {
        toast.error((err as Error).message);
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [qc],
  );
  return { run, pending };
}
