import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { api, qs } from "@/lib/api";
import { DataTable } from "@/components/data-table";
import { NativeSelect } from "@/components/ui/form";
import { formatDateTime } from "@/lib/utils";
import { RUN_TYPE_LABEL, RunStatusBadge, formatDuration, type Report, type RunSummary } from "./shared";

export function HistoryTab({ onOpenRun }: { onOpenRun: (id: string) => void }) {
  const [reportId, setReportId] = React.useState("");
  const [status, setStatus] = React.useState("");
  const { data: reports } = useQuery({ queryKey: ["reports", "list"], queryFn: () => api.get<Report[]>("/reports/reports") });
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "runs", reportId, status],
    queryFn: () => api.get<RunSummary[]>(`/reports/runs${qs({ reportId, status })}`),
    refetchInterval: 15_000,
  });

  const columns: ColumnDef<RunSummary>[] = [
    {
      accessorKey: "createdAt",
      header: "Fecha",
      sortingFn: "datetime",
      cell: ({ getValue }) => <span className="text-13 whitespace-nowrap tabular-nums">{formatDateTime(getValue() as string)}</span>,
    },
    { id: "report", accessorFn: (r) => r.report.name, header: "Reporte", cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span> },
    {
      accessorKey: "type",
      header: "Tipo",
      cell: ({ row: { original: r } }) => (
        <span className="text-13">
          {RUN_TYPE_LABEL[r.type]}
          {r.attempt > 1 && <span className="text-muted-foreground"> · reintento {r.attempt - 1}</span>}
        </span>
      ),
    },
    { accessorKey: "status", header: "Estado", cell: ({ row }) => <RunStatusBadge status={row.original.status} /> },
    { accessorKey: "records", header: "Registros", meta: { align: "right" }, cell: ({ getValue }) => (getValue() as number | null) ?? "—" },
    {
      id: "detail",
      header: "Detalle",
      enableSorting: false,
      cell: ({ row: { original: r } }) => (
        <span className="line-clamp-1 max-w-md text-13 text-muted-foreground">{r.errorMessage ? <span className="text-destructive">{r.errorMessage}</span> : r.sentTo.length ? `A ${r.sentTo.join(", ")}` : "—"}</span>
      ),
    },
    { accessorKey: "durationMs", header: "Duración", meta: { align: "right" }, cell: ({ getValue }) => formatDuration(getValue() as number | null) },
  ];

  return (
    <DataTable
      columns={columns}
      data={data}
      loading={isLoading}
      pageSize={20}
      searchPlaceholder="Buscar en el historial…"
      onRowClick={(r) => onOpenRun(r.id)}
      toolbar={
        <>
          <NativeSelect value={reportId} onChange={(e) => setReportId(e.target.value)} className="w-auto" aria-label="Reporte">
            <option value="">Todos los reportes</option>
            {reports?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto" aria-label="Estado">
            <option value="">Todos los estados</option>
            <option value="SUCCESS">Enviados</option>
            <option value="PARTIAL">Parciales</option>
            <option value="FAILED">Fallidos</option>
            <option value="SKIPPED">Sin registros</option>
          </NativeSelect>
        </>
      }
      empty="Todavía no hay envíos."
    />
  );
}
