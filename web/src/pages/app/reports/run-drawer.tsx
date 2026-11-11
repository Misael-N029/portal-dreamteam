import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Download, FileSpreadsheet, Image as ImageIcon, Loader2, Mail, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/misc";
import { Sheet, SheetBody, SheetContent, SheetHeader } from "@/components/ui/overlay";
import { cn, formatDateTime } from "@/lib/utils";
import { RUN_TYPE_LABEL, RunStatusBadge, formatDuration, type RunDetail } from "./shared";

const STEPS = [
  { key: "SCHEDULER", label: "En cola" },
  { key: "CRM", label: "Datos del CRM" },
  { key: "RENDER", label: "Imagen y Excel" },
  { key: "SEND", label: "Envío" },
  { key: "SYSTEM", label: "Listo" },
] as const;

const LEVEL_COLOR = { INFO: "text-muted-foreground", SUCCESS: "text-success", WARNING: "text-warning", ERROR: "text-destructive" } as const;

function Stepper({ run }: { run: RunDetail }) {
  const done = !["QUEUED", "RUNNING"].includes(run.status);
  const seen = new Set(run.logs.map((l) => l.step));
  const failed = run.status === "FAILED";
  const current = done ? -1 : Math.max(0, ...STEPS.map((s, i) => (seen.has(s.key) ? i : 0)));
  return (
    <ol className="grid grid-cols-5 gap-2">
      {STEPS.map((s, i) => {
        const reached = seen.has(s.key) || (done && s.key === "SYSTEM");
        const active = i === current;
        const skipped = done && !reached;
        return (
          <li key={s.key} className="grid gap-1.5">
            <span className={cn("h-1 rounded-full bg-muted", reached && !active && "bg-foreground", active && "animate-pulse bg-brand", failed && s.key === "SYSTEM" && "bg-destructive")} />
            <span className={cn("flex items-center gap-1 text-xs", reached ? "text-foreground" : "text-muted-foreground", skipped && "line-through opacity-60")}>
              {active ? <Loader2 className="size-3 animate-spin" /> : reached && !(failed && s.key === "SYSTEM") ? <Check className="size-3" /> : failed && s.key === "SYSTEM" ? <X className="size-3 text-destructive" /> : null}
              {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function RunImages({ run }: { run: RunDetail }) {
  const [urls, setUrls] = React.useState<string[]>([]);
  React.useEffect(() => {
    let alive = true;
    const created: string[] = [];
    Promise.all(run.imageFiles.map((f) => api.blobUrl(`/reports/runs/${run.id}/images/${f}`)))
      .then((list) => {
        created.push(...list);
        if (alive) setUrls(list);
      })
      .catch(() => toast.error("No se pudieron cargar las imágenes"));
    return () => {
      alive = false;
      created.forEach(URL.revokeObjectURL);
    };
  }, [run.id, run.imageFiles]);
  if (!run.imageFiles.length) return <p className="py-10 text-center text-13 text-muted-foreground">Este reporte no genera imagen.</p>;
  return (
    <div className="grid gap-4">
      {urls.map((u, i) => (
        <a key={u} href={u} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border bg-white" title="Abrir en tamaño real">
          <img src={u} alt={`Imagen ${i + 1} del reporte`} className="w-full" />
        </a>
      ))}
    </div>
  );
}

export function RunDrawer({ runId, onClose }: { runId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: run } = useQuery({
    queryKey: ["reports", "run", runId],
    queryFn: () => api.get<RunDetail>(`/reports/runs/${runId}`),
    enabled: !!runId,
    refetchInterval: (q) => (q.state.data && !["QUEUED", "RUNNING"].includes(q.state.data.status) ? false : 1200),
  });
  const finished = run && !["QUEUED", "RUNNING"].includes(run.status);

  React.useEffect(() => {
    if (finished) {
      qc.invalidateQueries({ queryKey: ["reports", "runs"] });
      qc.invalidateQueries({ queryKey: ["reports", "overview"] });
      qc.invalidateQueries({ queryKey: ["reports", "list"] });
    }
  }, [finished, qc]);

  const downloadExcel = async () => {
    if (!run?.attachment) return;
    try {
      await api.download(`/reports/runs/${run.id}/excel`, run.attachment);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const defaultTab = run?.html ? "html" : "images";

  return (
    <Sheet open={!!runId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="xl">
        <SheetHeader
          title={run ? run.report.name : "Cargando…"}
          description={run ? `${RUN_TYPE_LABEL[run.type]} · ${formatDateTime(run.createdAt)}${run.requestedBy ? ` · ${run.requestedBy}` : ""}` : undefined}
        />
        <SheetBody className="grid content-start gap-5">
          {!run ? (
            <Loader2 className="mx-auto size-6 animate-spin text-brand" />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <RunStatusBadge status={run.status} preview={run.type === "PREVIEW"} />
                {run.records != null && <span className="text-13 text-muted-foreground tabular-nums">{run.records} registros</span>}
                {run.durationMs != null && <span className="text-13 text-muted-foreground tabular-nums">{formatDuration(run.durationMs)}</span>}
                {run.attachment && (
                  <Button variant="outline" size="sm" className="ml-auto" onClick={downloadExcel}>
                    <Download /> {run.attachment}
                  </Button>
                )}
              </div>
              <Stepper run={run} />
              {run.errorMessage && <p className="rounded-md bg-destructive/10 px-3 py-2 text-13 text-destructive">{run.errorMessage}</p>}
              {run.sentTo.length > 0 && (
                <p className="text-13">
                  <span className="text-muted-foreground">Entregado a: </span>
                  {run.sentTo.join(", ")}
                </p>
              )}

              {finished && (run.html || run.imageFiles.length > 0) && (
                <Tabs defaultValue={defaultTab} className="grid gap-3">
                  <TabsList className="w-fit">
                    {run.html && (
                      <TabsTrigger value="html">
                        <Mail /> Correo
                      </TabsTrigger>
                    )}
                    <TabsTrigger value="images">
                      <ImageIcon /> Imagen WhatsApp
                    </TabsTrigger>
                    {run.attachment && (
                      <TabsTrigger value="excel">
                        <FileSpreadsheet /> Excel
                      </TabsTrigger>
                    )}
                  </TabsList>
                  {run.html && (
                    <TabsContent value="html">
                      {/* Sin scripts: el HTML lleva datos del CRM */}
                      <iframe title="Vista previa del correo" srcDoc={run.html} sandbox="" className="h-[70vh] w-full rounded-lg border bg-white" />
                    </TabsContent>
                  )}
                  <TabsContent value="images">
                    <RunImages run={run} />
                  </TabsContent>
                  {run.attachment && (
                    <TabsContent value="excel">
                      <Card className="flex items-center gap-4 p-5">
                        <FileSpreadsheet className="size-8 text-success" />
                        <div className="grid flex-1">
                          <span className="text-sm font-medium">{run.attachment}</span>
                          <span className="text-13 text-muted-foreground">Se adjunta en el correo{run.imageFiles.length ? "" : " y se envía como documento por WhatsApp"}.</span>
                        </div>
                        <Button variant="outline" onClick={downloadExcel}>
                          <Download /> Descargar
                        </Button>
                      </Card>
                    </TabsContent>
                  )}
                </Tabs>
              )}

              <div className="grid gap-2">
                <h3 className="text-sm font-semibold">Bitácora</h3>
                <ol className="grid gap-1 rounded-lg border bg-surface/60 p-3 font-mono text-xs">
                  {run.logs.map((l) => (
                    <li key={l.id} className="flex gap-3">
                      <span className="shrink-0 text-muted-foreground tabular-nums">{new Date(l.at).toLocaleTimeString("es-PE", { timeZone: "America/Lima" })}</span>
                      <span className={cn("shrink-0 w-16", LEVEL_COLOR[l.level])}>{l.step}</span>
                      <span className={cn(l.level === "ERROR" && "text-destructive", l.level === "WARNING" && "text-warning")}>{l.message}</span>
                    </li>
                  ))}
                  {!finished && (
                    <li className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="size-3 animate-spin" /> {run.status === "QUEUED" ? "Esperando al worker…" : "Trabajando…"}
                    </li>
                  )}
                </ol>
              </div>
            </>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
