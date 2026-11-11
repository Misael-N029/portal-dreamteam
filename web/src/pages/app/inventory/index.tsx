import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { Boxes, Building2, FileSpreadsheet, LayoutGrid, MapPin, Monitor, Package, Settings2, ShieldCheck, Tags, TriangleAlert, Truck, UserRound, Wrench } from "lucide-react";
import { api } from "@/lib/api";
import { useDocumentTitle } from "@/providers/branding";
import type { InventoryOverview, Site } from "@/lib/types";
import { PageHeader, StatCard } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/misc";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/overlay";
import { cn } from "@/lib/utils";
import { InvActionsContext, useInvAccess, type InvActions } from "./shared";
import { FloorPlanTab } from "./floor-plan";
import { WarehouseTab } from "./warehouse";
import { EquipmentTab, MachineDetailSheet, TransferDialog } from "./equipment";
import { IncidentsTab, ReportIssueDialog } from "./incidents";
import { MyEquipmentTab } from "./my-equipment";
import { CategoriesSheet, ImportExportSheet, SitesSheet } from "./settings";

const SITE_KEY = "inventory-site";

export function InventoryScreen() {
  useDocumentTitle("Inventario");
  const { can, own, global, team, manages, siteId: mySite } = useInvAccess();
  const [machineId, setMachineId] = React.useState<string | null>(null);
  const [issue, setIssue] = React.useState<{ id: string; assetTag: string } | null>(null);
  const [transfer, setTransfer] = React.useState<{ id: string; assetTag: string; siteId: string }[] | null>(null);
  const [panel, setPanel] = React.useState<"categories" | "sites" | "excel" | null>(null);

  const actions = React.useMemo<InvActions>(
    () => ({ openMachine: setMachineId, reportIssue: (m) => setIssue({ id: m.id, assetTag: m.assetTag }), transfer: (ms) => setTransfer(ms) }),
    [],
  );

  const shared = (
    <>
      <MachineDetailSheet machineId={machineId} onClose={() => setMachineId(null)} />
      <ReportIssueDialog machine={issue} onClose={() => setIssue(null)} />
      <TransferDialog machines={transfer} onClose={() => setTransfer(null)} />
    </>
  );

  // Asesores y backoffice: solo "Mi equipo"
  if (own) {
    return (
      <InvActionsContext.Provider value={actions}>
        <div className="grid gap-2">
          <PageHeader title="Mi equipo" description="Tu puesto, los equipos que tienes a cargo y los insumos que te entregaron." />
          <MyEquipmentTab />
        </div>
        {shared}
      </InvActionsContext.Provider>
    );
  }

  return (
    <InvActionsContext.Provider value={actions}>
      <ManagerView mySite={mySite} global={global} team={team} manages={manages} can={can} onPanel={setPanel} />
      {shared}
      {can("sites") && global && (
        <>
          <CategoriesSheet open={panel === "categories"} onClose={() => setPanel(null)} />
          <SitesSheet open={panel === "sites"} onClose={() => setPanel(null)} />
        </>
      )}
      {can("import") && <ImportExportSheet open={panel === "excel"} onClose={() => setPanel(null)} />}
    </InvActionsContext.Provider>
  );
}

function ManagerView({
  mySite,
  global,
  team,
  manages,
  can,
  onPanel,
}: {
  mySite: string | null;
  global: boolean;
  team: boolean;
  /** Admin/TI: gestiona equipos e insumos. Si no (supervisor, RRHH), la vista es de personas. */
  manages: boolean;
  can: (a: string) => boolean;
  onPanel: (p: "categories" | "sites" | "excel") => void;
}) {
  const sites = useQuery({ queryKey: ["inventory", "sites"], queryFn: () => api.get<Site[]>("/inventory/sites") });
  const overview = useQuery({ queryKey: ["inventory", "overview"], queryFn: () => api.get<InventoryOverview>("/inventory/overview") });
  const [siteId, setSiteId] = React.useState<string | null>(() => {
    try {
      return localStorage.getItem(SITE_KEY);
    } catch {
      return null;
    }
  });
  const [tab, setTab] = React.useState("plano");
  // Al llegar desde una notificación se abre su pestaña, si el rol la tiene
  const { search, key: navKey } = useLocation();
  React.useEffect(() => {
    const wanted = new URLSearchParams(search).get("tab");
    if (wanted && ["plano", "incidencias", "mio", ...(manages ? ["almacen", "equipos"] : [])].includes(wanted)) setTab(wanted);
  }, [search, navKey, manages]);
  const list = sites.data ?? [];
  const active = list.filter((s) => s.active);
  const current = list.find((s) => s.id === siteId) ?? list.find((s) => s.id === mySite) ?? active[0] ?? list[0];
  React.useEffect(() => {
    if (!current) return;
    try {
      localStorage.setItem(SITE_KEY, current.id);
    } catch {
      /* sin almacenamiento */
    }
  }, [current]);

  const o = overview.data;
  return (
    <div className="grid gap-5">
      <PageHeader
        title="Inventario"
        description={
          manages
            ? "Plano de sala por puestos, equipos, insumos del almacén, entregas e incidencias."
            : team
              ? "El plano de tu sede: reubica a los asesores de tu equipo y reporta fallas de sus computadoras."
              : "Los planos de todas las sedes: reubica a cualquier colaborador y cambia su supervisor cuando pasa a otra campaña."
        }
        actions={
          <>
            {can("import") && (
              <Button variant="outline" onClick={() => onPanel("excel")}>
                <FileSpreadsheet /> Excel
              </Button>
            )}
            {can("sites") && global && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    <Settings2 /> Configurar
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onSelect={() => onPanel("sites")}>
                    <Building2 /> Sedes
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onPanel("categories")}>
                    <Tags /> Categorías
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />

      {/* Sedes: una pestaña grande por sede, con sus alertas */}
      {sites.isLoading ? (
        <Skeleton className="h-16" />
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {list.map((s) => {
            const on = s.id === current?.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSiteId(s.id)}
                className={cn(
                  "rounded-lg border flex min-w-44 shrink-0 items-center gap-3 px-5 py-2.5 text-left transition-all",
                  on ? "bg-foreground text-background" : "bg-muted text-foreground hover:bg-accent",
                  !s.active && "opacity-50",
                )}
              >
                <MapPin className={cn("size-4 shrink-0", on ? "text-brand" : "text-muted-foreground")} />
                <span className="grid min-w-0">
                  <span className="truncate font-semibold text-[15px]">{s.name}</span>
                  <span className={cn("text-xs", on ? "text-background/70" : "text-muted-foreground")}>
                    {s.counts.total} equipos · {s.stations} puestos
                  </span>
                </span>
                <span className={cn("ml-auto flex gap-1", !manages && "hidden")}>
                  {s.incoming > 0 && (
                    <span title={`${s.incoming} equipo(s) en camino`} className="flex items-center gap-0.5 bg-brand px-1.5 text-[11px] font-bold text-white">
                      <Truck className="size-3" /> {s.incoming}
                    </span>
                  )}
                  {s.lowStock > 0 && (
                    <span title={`${s.lowStock} insumo(s) bajo mínimo`} className="flex items-center gap-0.5 bg-warning px-1.5 text-[11px] font-bold text-white">
                      <TriangleAlert className="size-3" /> {s.lowStock}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className={cn("grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6", !manages && "hidden")}>
        {!o ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : (
          <>
            <StatCard label="Equipos" value={o.equipment.total} icon={Monitor} hint={`${o.equipment.ACTIVE} en uso · ${o.equipment.STORAGE} en almacén`} />
            <StatCard label="Reparación" value={o.equipment.REPAIR} icon={Wrench} accent={o.equipment.REPAIR > 0} />
            <StatCard label="Incidencias" value={o.openIncidents} icon={TriangleAlert} accent={o.openIncidents > 0} hint="abiertas o en atención" />
            <StatCard label="En traslado" value={o.equipment.TRANSIT} icon={Truck} accent={o.pendingTransfers > 0} hint={o.pendingTransfers ? `${o.pendingTransfers} por recibir` : undefined} />
            <StatCard label="Bajo mínimo" value={o.lowStock} icon={Package} accent={o.lowStock > 0} hint="insumos por reponer" />
            <StatCard label="Garantías" value={o.warrantySoon} icon={ShieldCheck} accent={o.warrantySoon > 0} hint="vencen en 30 días" />
          </>
        )}
      </div>

      {current ? (
        <Tabs value={tab} onValueChange={setTab} className="grid gap-4">
          <TabsList className="flex-wrap">
            <TabsTrigger value="plano">
              <LayoutGrid /> Plano de sala
            </TabsTrigger>
            {manages && (
              <>
                <TabsTrigger value="almacen">
                  <Boxes /> Almacén de insumos
                </TabsTrigger>
                <TabsTrigger value="equipos">
                  <Monitor /> Equipos
                </TabsTrigger>
              </>
            )}
            <TabsTrigger value="incidencias">
              <Wrench /> Incidencias{o?.openIncidents ? ` (${o.openIncidents})` : ""}
            </TabsTrigger>
            <TabsTrigger value="mio">
              <UserRound /> Mi equipo
            </TabsTrigger>
          </TabsList>
          <TabsContent value="plano">
            <FloorPlanTab siteId={current.id} />
          </TabsContent>
          {manages && (
            <>
              <TabsContent value="almacen">
                <WarehouseTab siteId={current.id} />
              </TabsContent>
              <TabsContent value="equipos">
                <EquipmentTab siteId={current.id} />
              </TabsContent>
            </>
          )}
          <TabsContent value="incidencias">
            <IncidentsTab siteId={current.id} />
          </TabsContent>
          <TabsContent value="mio">
            <MyEquipmentTab />
          </TabsContent>
        </Tabs>
      ) : (
        !sites.isLoading && <p className="py-10 text-center text-13 text-muted-foreground">{global ? "Crea la primera sede desde Configurar → Sedes." : "Tu usuario no tiene una sede asignada. Pide a TI que te asigne una."}</p>
      )}
    </div>
  );
}
