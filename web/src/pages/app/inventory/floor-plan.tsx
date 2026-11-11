import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  ArrowRightLeft,
  Monitor,
  UsersRound,
  Eraser,
  Grid3x3,
  GripVertical,
  LayoutGrid,
  Minus,
  MousePointer2,
  Pencil,
  Plus,
  Rows3,
  Save,
  Search,
  SquareDashed,
  Truck,
  UserRound,
  Warehouse,
  Wrench,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { api, qs } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import type { FloorZone, MachineCard, PersonRef, SitePlan, Workstation } from "@/lib/types";
import { EmptyState } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, NativeSelect } from "@/components/ui/form";
import { Avatar, Badge, Card, Skeleton } from "@/components/ui/misc";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  useConfirm,
} from "@/components/ui/overlay";
import { cn, initials } from "@/lib/utils";
import type { DeskItem, DeskKind } from "./desk-3d";
import {
  CategoryIcon,
  DND_KIT,
  DND_MACHINE,
  DND_PERSON,
  KIT_SLOTS,
  PersonPicker,
  SLOT_LABEL,
  STATUS_COLOR,
  dragProps,
  invalidate,
  useDrop,
  useInvAccess,
  useInvActions,
  useInventoryMeta,
} from "./shared";

/** Escritorio 3D: three.js se descarga solo al abrir un puesto */
const Desk3D = React.lazy(() => import("./desk-3d"));

const ZONE_COLORS = ["#DC2626", "#0369A1", "#15803D", "#B45309", "#7C3AED", "#374151"];

type Health = "empty" | "ok" | "partial" | "alert";
const HEALTH_RING: Record<Health, string> = {
  empty: "border-dashed border-border",
  ok: "border-success",
  partial: "border-warning",
  alert: "border-brand",
};
const HEALTH_LABEL: Record<Health, string> = { empty: "Libre / sin equipos", ok: "Kit completo", partial: "Kit incompleto", alert: "Falla o reparación" };

// ═══════════════════════════════════════════════════════════════════════════
// Vista del plano (operación diaria)
// ═══════════════════════════════════════════════════════════════════════════

/** Tamaño base de una celda (100 %). Los puestos ocupan casi toda la celda. */
const BASE_CELL = 76;

export function FloorPlanTab({ siteId }: { siteId: string }) {
  const { can, team, global, me, manages } = useInvAccess();
  const meta = useInventoryMeta();
  const { run } = useAction();
  const confirm = useConfirm();
  const actions = useInvActions();
  const [editing, setEditing] = React.useState(false);
  const [cell, setCell] = React.useState(BASE_CELL);
  const [q, setQ] = React.useState("");
  const [openStation, setOpenStation] = React.useState<string | null>(null);
  const [seatReq, setSeatReq] = React.useState<SeatRequest | null>(null);

  const plan = useQuery({ queryKey: ["inventory", "plan", siteId], queryFn: () => api.get<SitePlan>(`/inventory/sites/${siteId}/plan`) });
  const data = plan.data;
  const canMove = can("assign");
  const canSeat = can("seat");
  // Personas que se pueden reubicar: el equipo del supervisor, o (RRHH) la gente de la sede
  const people = useQuery({
    queryKey: ["inventory", "people", "rail", siteId],
    queryFn: () => api.get<PersonRef[]>(`/inventory/people${qs({ siteId })}`),
    enabled: canSeat && !manages,
  });

  // Al abrir una sede, el zoom se ajusta para que la sala entre a lo ancho (con puestos grandes)
  const box = React.useRef<HTMLDivElement>(null);
  const fitted = React.useRef<string | null>(null);
  React.useLayoutEffect(() => {
    if (!data || !box.current || fitted.current === siteId) return;
    fitted.current = siteId;
    const w = box.current.clientWidth - 32;
    setCell(Math.max(44, Math.min(104, Math.floor(w / data.site.planCols))));
  }, [data, siteId]);

  /**
   * Puestos grandes: cada puesto se agranda hacia el espacio libre que lo rodea (centrado en su celda).
   * Pegado a otro puesto ocupa su celda; con una celda libre alrededor llega a ~1.8 celdas.
   */
  const scaleOf = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const s of data?.stations ?? []) {
      let gap = Infinity;
      for (const o of data!.stations) if (o.id !== s.id) gap = Math.min(gap, Math.max(Math.abs(o.x - s.x), Math.abs(o.y - s.y)));
      m.set(s.id, Math.max(1, Math.min(1.8, gap - 0.2)));
    }
    return m;
  }, [data]);

  /** ¿La persona es de mi equipo? (supervisor) */
  const isMine = (p?: PersonRef | null) => !!p && (p.id === me || p.supervisorId === me);
  /** Pide reubicar a una persona en un puesto: abre la confirmación */
  const askSeat = (personId: string, targetId: string) => {
    const target = data?.stations.find((s) => s.id === targetId);
    if (!target || target.userId === personId) return;
    const from = data?.stations.find((s) => s.userId === personId) ?? null;
    const person = from?.user ?? people.data?.find((p) => p.id === personId);
    if (!person) return;
    setSeatReq({ person, from, target });
  };

  /** Salud de un puesto: falla/reparación > kit incompleto > completo */
  const health = React.useCallback(
    (st: Workstation): Health => {
      if (!st.machines.length) return "empty";
      if (st.machines.some((m) => m.status === "REPAIR" || m._count.incidents > 0)) return "alert";
      const slots = new Set(st.machines.map((m) => meta.category(m.categoryId)?.slot));
      return slots.has("PC") && slots.has("MONITOR") && slots.has("HEADSET") ? "ok" : "partial";
    },
    [meta],
  );

  const term = q.trim().toLowerCase();
  const matches = (st: Workstation) =>
    !term ||
    st.code.toLowerCase().includes(term) ||
    st.user?.name.toLowerCase().includes(term) ||
    st.machines.some((m) => m.assetTag.toLowerCase().includes(term) || m.hostname?.toLowerCase().includes(term));

  const moveMachine = (machineId: string, workstationId: string | null) => {
    const m = [...(data?.loose ?? []), ...(data?.stations.flatMap((s) => s.machines) ?? [])].find((x) => x.id === machineId);
    const st = data?.stations.find((s) => s.id === workstationId);
    if (!m || m.workstationId === workstationId) return;
    run(() => api.post(`/inventory/machines/${machineId}/move`, { workstationId }), { success: `${m.assetTag} → ${st ? st.code : "almacén"}`, invalidate });
  };
  const moveKit = async (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const from = data?.stations.find((s) => s.id === fromId);
    const to = data?.stations.find((s) => s.id === toId);
    if (!from || !to) return;
    if (to.machines.length) {
      const ok = await confirm({ title: `¿Intercambiar ${from.code} y ${to.code}?`, description: `${to.code} ya tiene equipos: los dos kits cambian de puesto.`, confirmText: "Intercambiar" });
      if (!ok) return;
    }
    run(() => api.post(`/inventory/stations/${fromId}/move-kit`, { toStationId: toId }), { success: `Kit ${from.code} → ${to.code}`, invalidate });
  };

  if (plan.isLoading) return <Skeleton className="h-[480px]" />;
  if (!data) return null;

  if (editing) return <FloorEditor plan={data} onClose={() => setEditing(false)} />;

  const stats = data.stations.reduce(
    (acc, st) => {
      acc[health(st)]++;
      if (st.user) acc.occupied++;
      return acc;
    },
    { empty: 0, ok: 0, partial: 0, alert: 0, occupied: 0 } as Record<Health | "occupied", number>,
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Busca puesto, persona o código…" className="pl-9" />
        </div>
        <div className="flex items-center rounded-md border">
          <Button variant="ghost" size="icon-sm" onClick={() => setCell((c) => Math.max(48, c - 8))} aria-label="Alejar">
            <ZoomOut />
          </Button>
          <span className="w-12 text-center text-xs text-muted-foreground tabular-nums">{Math.round((cell / BASE_CELL) * 100)}%</span>
          <Button variant="ghost" size="icon-sm" onClick={() => setCell((c) => Math.min(136, c + 8))} aria-label="Acercar">
            <ZoomIn />
          </Button>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {(Object.keys(HEALTH_LABEL) as Health[]).map((h) => (
            <span key={h} className="flex items-center gap-1.5">
              <span className={cn("size-3 rounded-sm border-2", HEALTH_RING[h])} /> {HEALTH_LABEL[h]} <b className="text-foreground tabular-nums">{stats[h]}</b>
            </span>
          ))}
          {team && (
            <span className="flex items-center gap-1.5">
              <span className="size-3 rounded-full bg-brand" /> Tu equipo
            </span>
          )}
        </div>
        {can("layout") && (
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil /> Editar plano
          </Button>
        )}
      </div>

      {canSeat && !manages && (
        <p className="flex items-center gap-2 rounded-lg border bg-surface/60 px-3 py-2 text-13 text-muted-foreground">
          <UserRound className="size-4 shrink-0 text-brand" />
          {team
            ? "Arrastra a un asesor de tu equipo (o su puesto) a otro puesto para reubicarlo. Solo se mueve la persona: los equipos se quedan en su puesto."
            : "Arrastra a una persona (o su puesto) a otro puesto para reubicarla. Solo se mueve la persona: los equipos se quedan en su puesto."}
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card ref={box} className="overflow-auto p-4">
          {data.stations.length === 0 ? (
            <EmptyState
              icon={LayoutGrid}
              title="Esta sede aún no tiene plano"
              description={can("layout") ? "Dibuja las islas y los puestos de la sala con el editor de cuadrícula." : "Pide a TI que dibuje el plano de la sala."}
              action={
                can("layout") && (
                  <Button onClick={() => setEditing(true)}>
                    <Grid3x3 /> Diseñar plano
                  </Button>
                )
              }
              className="border-0 shadow-none"
            />
          ) : (
            <div className="relative mx-auto" style={{ width: data.site.planCols * cell, height: data.site.planRows * cell }}>
              <GridBackdrop cell={cell} />
              {data.zones.map((z) => (
                <ZoneRect key={z.id} zone={z} cell={cell} />
              ))}
              {data.stations.map((st) => {
                // Supervisor: puede mover a su gente; los puestos de otros equipos se ven, pero no se tocan
                const seatable = canSeat && !canMove && (!team || !st.user || isMine(st.user));
                return (
                  <StationTile
                    key={st.id}
                    station={st}
                    cell={cell}
                    scale={scaleOf.get(st.id) ?? 1}
                    health={health(st)}
                    dim={!matches(st)}
                    canMove={canMove}
                    canSeat={seatable}
                    mine={team && isMine(st.user)}
                    onOpen={() => setOpenStation(st.id)}
                    onDropMachine={(id) => moveMachine(id, st.id)}
                    onDropKit={(id) => moveKit(id, st.id)}
                    onDropPerson={(pid) => askSeat(pid, st.id)}
                  />
                );
              })}
            </div>
          )}
        </Card>

        {manages ? (
          <StorageRail loose={data.loose} canMove={canMove} onDropMachine={(id) => moveMachine(id, null)} />
        ) : canSeat ? (
          <PeopleRail people={people.data ?? []} loading={people.isLoading} team={team} stations={data.stations} />
        ) : null}
      </div>

      <StationSheet
        station={data.stations.find((s) => s.id === openStation) ?? null}
        stations={data.stations}
        loose={data.loose}
        siteId={siteId}
        global={global}
        canSeatHere={(st) => canSeat && (!team || !st.user || isMine(st.user))}
        onClose={() => setOpenStation(null)}
        onMoveMachine={moveMachine}
        onMoveKit={moveKit}
        onOpenMachine={actions.openMachine}
        onSeat={(person, target) => setSeatReq({ person, target, from: data.stations.find((s) => s.userId === person.id) ?? null })}
        onFree={async (st) => {
          if (!st.user) return;
          if (await confirm({ title: `¿Liberar ${st.code}?`, description: `${st.user.name} queda sin puesto. Los equipos se quedan en ${st.code}.`, confirmText: "Liberar" }))
            run(() => api.post(`/inventory/stations/${st.id}/occupant`, { userId: null }), { success: `${st.code} liberado`, invalidate });
        }}
      />
      <SeatDialog req={seatReq} onClose={() => setSeatReq(null)} canCarry={canMove} />
    </div>
  );
}

// ── Reubicar personas ──

type SeatRequest = { person: PersonRef; from: Workstation | null; target: Workstation };

/** Confirmación al reubicar: qué pasa con la persona, con quien ocupaba el puesto y con los equipos */
function SeatDialog({ req, onClose, canCarry }: { req: SeatRequest | null; onClose: () => void; canCarry: boolean }) {
  const { run, pending } = useAction();
  const meta = useInventoryMeta();
  const [carry, setCarry] = React.useState<string[]>([]);
  React.useEffect(() => setCarry([]), [req]);
  if (!req) return <Dialog open={false} />;
  const { person, from, target } = req;
  const displaced = target.user && target.user.id !== person.id ? target.user : null;
  const fromMachines = from?.machines ?? [];
  const save = async () => {
    const ok = await run(() => api.post(`/inventory/stations/${target.id}/occupant`, { userId: person.id, carry }), {
      success: `${person.name.split(" ")[0]} ahora está en ${target.code}`,
      invalidate,
    });
    if (ok) onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader title={`Reubicar a ${person.name}`} description="Se mueve solo la persona: los equipos se quedan en su puesto." />
        <div className="grid gap-2 text-13">
          <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
            <Avatar name={person.name} />
            <span className="grid min-w-0 flex-1">
              <span className="truncate font-medium">{person.name}</span>
              <span className="text-xs text-muted-foreground">{[person.position, person.area].filter(Boolean).join(" · ")}</span>
            </span>
            <span className="flex items-center gap-1.5 font-semibold tabular-nums">
              {from?.code ?? "Sin puesto"} <ArrowRight className="size-3.5 text-brand" /> {target.code}
            </span>
          </div>
          {displaced && (
            <p className="flex items-start gap-2 rounded-lg bg-surface/60 px-3 py-2 text-muted-foreground">
              <ArrowRightLeft className="mt-0.5 size-3.5 shrink-0" />
              <span>
                <b className="text-foreground">{displaced.name}</b> ocupaba {target.code}: {from ? `pasa a ${from.code} (intercambio).` : "queda sin puesto."}
              </span>
            </p>
          )}
          <p className="flex items-start gap-2 rounded-lg bg-surface/60 px-3 py-2 text-muted-foreground">
            <Monitor className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Los equipos de {target.code} pasan a cargo de {person.name.split(" ")[0]}
              {from ? `; los de ${from.code} se quedan en su puesto${displaced ? ` y pasan a ${displaced.name.split(" ")[0]}` : ""}.` : "."}
            </span>
          </p>
        </div>
        {canCarry && fromMachines.length > 0 && (
          <div className="grid gap-2 rounded-lg border border-dashed p-3">
            <p className="text-13 font-medium">Excepción: ¿se lleva algún equipo de {from!.code}?</p>
            <p className="text-xs text-muted-foreground">Solo para casos puntuales (p. ej. información importante en su PC). Queda registrado en la bitácora del equipo.</p>
            <div className="grid gap-1.5">
              {fromMachines.map((m) => {
                const cat = meta.category(m.categoryId);
                return (
                  <label key={m.id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-0.5 text-13 hover:bg-accent/60">
                    <Checkbox checked={carry.includes(m.id)} onCheckedChange={(v) => setCarry((c) => (v ? [...c, m.id] : c.filter((x) => x !== m.id)))} />
                    <CategoryIcon name={cat?.icon} className="size-4" style={{ color: cat?.color }} />
                    <span className="font-medium tabular-nums">{m.assetTag}</span>
                    <span className="truncate text-muted-foreground">{[cat?.name, m.brand, m.model].filter(Boolean).join(" · ")}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} loading={pending}>
            <UserRound /> Reubicar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Panel lateral con las personas que se pueden reubicar (arrastrables al plano) */
function PeopleRail({ people, loading, team, stations }: { people: PersonRef[]; loading: boolean; team: boolean; stations: Workstation[] }) {
  const seatOf = (id: string) => stations.find((s) => s.userId === id)?.code;
  const list = [...people].sort((a, b) => Number(!!seatOf(a.id)) - Number(!!seatOf(b.id)) || a.name.localeCompare(b.name));
  return (
    <Card className="flex max-h-[640px] flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <UsersRound className="size-4 text-brand" />
        <h3 className="text-sm font-semibold">{team ? "Tu equipo" : "Personas de la sede"}</h3>
        <span className="ml-auto text-sm font-semibold text-muted-foreground tabular-nums">{people.length}</span>
      </div>
      <p className="px-4 pt-3 text-xs text-muted-foreground">Arrastra a una persona a un puesto del plano. Los que no tienen puesto aparecen primero.</p>
      <div className="grid gap-1.5 overflow-y-auto p-4">
        {loading && <Skeleton className="h-24" />}
        {!loading && list.length === 0 && <p className="py-6 text-center text-13 text-muted-foreground">{team ? "Aún no tienes asesores a cargo." : "No hay personas en esta sede."}</p>}
        {list.map((p) => {
          const code = seatOf(p.id);
          return (
            <div key={p.id} {...dragProps(DND_PERSON, p.id)} className="flex cursor-grab items-center gap-2.5 rounded-lg border bg-card px-2.5 py-2 transition-colors hover:border-foreground/40 active:cursor-grabbing">
              <GripVertical className="size-3.5 shrink-0 text-muted-foreground" />
              <Avatar name={p.name} className="size-7 text-[10px]" />
              <span className="grid min-w-0 flex-1">
                <span className="truncate text-13 font-medium">{p.name}</span>
                <span className="truncate text-xs text-muted-foreground">{p.area ?? p.position ?? p.email}</span>
              </span>
              <Badge variant={code ? "default" : "warning"}>{code ?? (p.stations?.length ? "Otra sede" : "Sin puesto")}</Badge>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function GridBackdrop({ cell }: { cell: number }) {
  return (
    <div
      className="pointer-events-none absolute inset-0 opacity-60"
      style={{
        backgroundImage: "linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
        backgroundSize: `${cell}px ${cell}px`,
      }}
    />
  );
}

function ZoneRect({ zone, cell, selected, onPointerDown, children }: { zone: Pick<FloorZone, "name" | "color" | "x" | "y" | "w" | "h">; cell: number; selected?: boolean; onPointerDown?: (e: React.PointerEvent) => void; children?: React.ReactNode }) {
  return (
    <div
      onPointerDown={onPointerDown}
      className={cn("absolute border-2", selected && "ring-2 ring-foreground ring-offset-2 ring-offset-background", onPointerDown && "cursor-move")}
      style={{
        left: zone.x * cell,
        top: zone.y * cell,
        width: zone.w * cell,
        height: zone.h * cell,
        borderColor: `${zone.color}99`,
        background: `${zone.color}14`,
      }}
    >
      <span className="absolute -top-px left-2 -translate-y-1/2 bg-background px-1.5 font-semibold text-[11px]" style={{ color: zone.color }}>
        {zone.name}
      </span>
      {children}
    </div>
  );
}

function StationTile({
  station,
  cell,
  scale,
  health,
  dim,
  canMove,
  canSeat,
  mine,
  onOpen,
  onDropMachine,
  onDropKit,
  onDropPerson,
}: {
  station: Workstation;
  cell: number;
  /** Cuántas celdas ocupa el puesto (1 si está pegado a otro) */
  scale: number;
  health: Health;
  dim: boolean;
  canMove: boolean;
  /** Puede reubicar a la persona de este puesto (o traer a alguien) */
  canSeat: boolean;
  /** Ocupado por alguien de su equipo (supervisor) */
  mine: boolean;
  onOpen: () => void;
  onDropMachine: (id: string) => void;
  onDropKit: (id: string) => void;
  onDropPerson: (id: string) => void;
}) {
  const meta = useInventoryMeta();
  const { props, over } = useDrop(
    canMove ? [DND_MACHINE, DND_KIT] : [DND_PERSON],
    (t, id) => (t === DND_MACHINE ? onDropMachine(id) : t === DND_KIT ? onDropKit(id) : onDropPerson(id)),
    canMove || canSeat,
  );
  const pad = Math.max(3, cell * 0.06);
  const size = cell * scale - pad * 2;
  // Centrado en su celda
  const left = (station.x + 0.5) * cell - size / 2;
  const top = (station.y + 0.5) * cell - size / 2;
  const big = size >= 64;
  const huge = size >= 88;
  // Admin/TI arrastra el kit; quien reubica arrastra a la persona
  const drag = canMove ? dragProps(DND_KIT, station.id, station.machines.length > 0) : dragProps(DND_PERSON, station.userId ?? "", canSeat && !!station.userId);
  const draggable = canMove ? station.machines.length > 0 : canSeat && !!station.userId;
  return (
    <button
      type="button"
      {...props}
      {...drag}
      onClick={onOpen}
      title={`${station.code}${station.user ? ` · ${station.user.name}` : " · libre"} · ${HEALTH_LABEL[health]}`}
      className={cn(
        "group absolute flex flex-col items-center justify-between rounded-lg border-2 bg-card text-center shadow-sm transition-all duration-150 outline-none hover:z-10 hover:-translate-y-0.5 hover:shadow-lg focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring",
        HEALTH_RING[health],
        dim && "opacity-25",
        mine && "ring-2 ring-brand/60 ring-offset-1 ring-offset-background",
        over && "z-10 scale-110 bg-brand/10 ring-2 ring-brand",
        draggable && "cursor-grab active:cursor-grabbing",
      )}
      style={{ left, top, width: size, height: size, padding: big ? 5 : 3 }}
    >
      <span className={cn("leading-none font-semibold tabular-nums", huge ? "text-[13px]" : big ? "text-[12px]" : "text-[10px]")}>{station.code}</span>
      {station.user ? (
        <span
          className={cn(
            "grid shrink-0 place-items-center rounded-full font-semibold",
            mine ? "bg-brand text-white" : "bg-foreground text-background",
            huge ? "size-8 text-[11px]" : big ? "size-7 text-[10px]" : "size-4 text-[8px]",
          )}
        >
          {initials(station.user.name)}
        </span>
      ) : (
        big && <span className="text-[10px] text-muted-foreground">Libre</span>
      )}
      <span className="flex max-h-3.5 flex-wrap justify-center gap-0.5 overflow-hidden">
        {station.machines.slice(0, huge ? 6 : big ? 5 : 3).map((m) => (
          <CategoryIcon key={m.id} name={meta.category(m.categoryId)?.icon} className={huge ? "size-3.5" : big ? "size-3" : "size-2.5"} style={{ color: STATUS_COLOR[m.status] }} />
        ))}
      </span>
      {station.user && huge && <span className="max-w-full truncate text-[11px] leading-none text-muted-foreground">{station.user.name.split(" ")[0]}</span>}
      {health === "alert" && <span className="absolute -top-1.5 -right-1.5 size-3 rotate-45 bg-brand" />}
    </button>
  );
}

function MachineChip({ m, canMove, compact, onClick }: { m: MachineCard; canMove: boolean; compact?: boolean; onClick?: () => void }) {
  const meta = useInventoryMeta();
  const cat = meta.category(m.categoryId);
  return (
    <div
      {...dragProps(DND_MACHINE, m.id, canMove && m.status !== "TRANSIT")}
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-left transition-colors hover:border-foreground/40",
        canMove && "cursor-grab active:cursor-grabbing",
        onClick && "cursor-pointer",
      )}
    >
      {canMove && <GripVertical className="size-3.5 shrink-0 text-muted-foreground" />}
      <CategoryIcon name={cat?.icon} className="size-4 shrink-0" style={{ color: cat?.color }} />
      <div className="grid min-w-0 flex-1">
        <span className="truncate text-13 font-semibold tabular-nums">{m.assetTag}</span>
        {!compact && <span className="truncate text-xs text-muted-foreground">{[cat?.name, m.brand, m.model].filter(Boolean).join(" · ")}</span>}
      </div>
      <span className="size-2 shrink-0 rotate-45" style={{ background: STATUS_COLOR[m.status] }} title={m.status} />
      {m._count.incidents > 0 && <AlertTriangle className="size-3.5 shrink-0 text-brand" />}
    </div>
  );
}

function StorageRail({ loose, canMove, onDropMachine }: { loose: MachineCard[]; canMove: boolean; onDropMachine: (id: string) => void }) {
  const meta = useInventoryMeta();
  const actions = useInvActions();
  const { props, over } = useDrop([DND_MACHINE], (_t, id) => onDropMachine(id), canMove);
  const groups = new Map<string, MachineCard[]>();
  for (const m of loose) groups.set(m.categoryId ?? "", [...(groups.get(m.categoryId ?? "") ?? []), m]);
  return (
    <Card {...props} className={cn("flex max-h-[640px] flex-col transition-colors", over && "bg-brand/5 ring-2 ring-brand")}>
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Warehouse className="size-4 text-brand" />
        <h3 className="text-sm font-semibold">Almacén de la sede</h3>
        <span className="ml-auto font-semibold text-sm text-muted-foreground tabular-nums">{loose.length}</span>
      </div>
      <p className="px-4 pt-3 text-xs text-muted-foreground">{canMove ? "Arrastra un equipo a un puesto del plano, o suéltalo aquí para guardarlo." : "Equipos de la sede que no están en ningún puesto."}</p>
      <div className="grid gap-3 overflow-y-auto p-4">
        {loose.length === 0 && <p className="py-6 text-center text-13 text-muted-foreground">No hay equipos sueltos.</p>}
        {[...groups.entries()].map(([catId, items]) => (
          <div key={catId} className="grid gap-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              {meta.category(catId)?.name ?? "Sin categoría"} · {items.length}
            </p>
            {items.map((m) => (
              <MachineChip key={m.id} m={m} canMove={canMove} onClick={() => actions.openMachine(m.id)} />
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}

/** RRHH / Admin-TI: supervisor a cargo de la persona (cambia cuando pasa a otra campaña o equipo) */
function SupervisorRow({ person }: { person: PersonRef }) {
  const { run, pending } = useAction();
  const sups = useQuery({
    queryKey: ["inventory", "people", "supervisors"],
    queryFn: () => api.get<PersonRef[]>(`/inventory/people${qs({ role: "supervisor", all: "1" })}`),
    staleTime: 60_000,
  });
  const change = (supervisorId: string) =>
    run(() => api.post(`/inventory/people/${person.id}/supervisor`, { supervisorId: supervisorId || null }), {
      success: supervisorId ? `${person.name.split(" ")[0]} ahora está con ${sups.data?.find((s) => s.id === supervisorId)?.name ?? "su nuevo supervisor"}` : "Supervisor quitado",
      invalidate,
    });
  return (
    <div className="flex items-center gap-2 rounded-lg bg-surface/60 px-3 py-2 text-13">
      <UsersRound className="size-4 shrink-0 text-muted-foreground" />
      <span className="text-muted-foreground">Supervisor</span>
      <NativeSelect
        value={person.supervisorId ?? ""}
        disabled={pending || sups.isLoading}
        onChange={(e) => change(e.target.value)}
        className="ml-auto h-8 w-auto max-w-56"
        aria-label="Supervisor a cargo"
      >
        <option value="">Sin supervisor</option>
        {sups.data
          ?.filter((s) => s.id !== person.id)
          .map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.area ? ` · ${s.area}` : ""}
            </option>
          ))}
      </NativeSelect>
    </div>
  );
}

/** Tipo de pieza del modelo 3D según la categoría del equipo */
function deskKind(key?: string, slot?: string | null): DeskKind {
  if (key === "LAPTOP") return "LAPTOP";
  if (key === "KEYBOARD") return "KEYBOARD";
  if (key === "MOUSE") return "MOUSE";
  if (slot === "PC" || slot === "MONITOR" || slot === "HEADSET" || slot === "PHONE") return slot;
  return "OTHER";
}

function StationSheet({
  station,
  stations,
  loose,
  siteId,
  global,
  canSeatHere,
  onClose,
  onMoveMachine,
  onMoveKit,
  onOpenMachine,
  onSeat,
  onFree,
}: {
  station: Workstation | null;
  stations: Workstation[];
  loose: MachineCard[];
  siteId: string;
  global: boolean;
  canSeatHere: (st: Workstation) => boolean;
  onClose: () => void;
  onMoveMachine: (machineId: string, workstationId: string | null) => void;
  onMoveKit: (from: string, to: string) => void;
  onOpenMachine: (id: string) => void;
  onSeat: (person: PersonRef, target: Workstation) => void;
  onFree: (st: Workstation) => void;
}) {
  const { can } = useInvAccess();
  const meta = useInventoryMeta();
  const actions = useInvActions();
  const [picking, setPicking] = React.useState(false);
  React.useEffect(() => setPicking(false), [station?.id]);
  if (!station) return <Sheet open={false} />;

  const bySlot = new Map<string, MachineCard[]>();
  for (const m of station.machines) {
    const slot = meta.category(m.categoryId)?.slot ?? "OTHER";
    bySlot.set(slot, [...(bySlot.get(slot) ?? []), m]);
  }
  const deskItems: DeskItem[] = station.machines.map((m) => {
    const cat = meta.category(m.categoryId);
    return {
      id: m.id,
      kind: deskKind(cat?.key, cat?.slot),
      label: `${cat?.name ?? "Equipo"} ${m.assetTag}`,
      status: m.status,
      alert: m.status === "REPAIR" || m._count.incidents > 0,
    };
  });
  const seatable = canSeatHere(station);

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="lg">
        <SheetHeader title={`Puesto ${station.code}`} description="Así está el puesto ahora: la persona que lo ocupa y su kit de equipos." />
        <SheetBody className="grid content-start gap-6">
          <React.Suspense fallback={<Skeleton className="h-[300px] shrink-0 rounded-xl" />}>
            <Desk3D items={deskItems} occupied={!!station.user} onOpen={onOpenMachine} />
          </React.Suspense>

          <section className="grid gap-2">
            <h3 className="text-sm font-semibold">Ocupante</h3>
            {station.user && !picking ? (
              <div className="flex items-center gap-3 rounded-lg border px-3 py-2">
                <Avatar name={station.user.name} />
                <div className="grid min-w-0 flex-1">
                  <span className="truncate text-sm font-medium">{station.user.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{[station.user.position, station.user.area].filter(Boolean).join(" · ")}</span>
                </div>
                {seatable && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setPicking(true)}>
                      <ArrowRightLeft /> Cambiar
                    </Button>
                    <Button size="icon-sm" variant="ghost" onClick={() => onFree(station)} aria-label="Liberar puesto" title="Liberar puesto">
                      <X />
                    </Button>
                  </>
                )}
              </div>
            ) : seatable ? (
              <div className="grid gap-2">
                {picking && (
                  <button type="button" className="w-fit text-13 text-muted-foreground hover:text-foreground" onClick={() => setPicking(false)}>
                    ← Cancelar
                  </button>
                )}
                <p className="text-xs text-muted-foreground">Elige a quién reubicar en {station.code}. Solo se mueve la persona; los equipos se quedan en su puesto.</p>
                <PersonPicker
                  value={null}
                  siteId={siteId}
                  all={global}
                  onChange={(p) => {
                    setPicking(false);
                    if (p) onSeat(p, station);
                  }}
                />
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm">
                <UserRound className="size-4 text-muted-foreground" /> {station.user?.name ?? "Libre"}
              </p>
            )}
            {station.user && global && can("seat") && <SupervisorRow person={station.user} />}
          </section>

          <section className="grid gap-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Kit del puesto</h3>
              {can("assign") && station.machines.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="ghost" className="ml-auto">
                      <ArrowRightLeft /> Mover kit
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="max-h-72 overflow-y-auto">
                    <DropdownMenuLabel>Llevar todo el kit a…</DropdownMenuLabel>
                    {stations
                      .filter((s) => s.id !== station.id)
                      .map((s) => (
                        <DropdownMenuItem key={s.id} onSelect={() => onMoveKit(station.id, s.id)}>
                          {s.code} {s.machines.length > 0 ? "· intercambiar" : "· libre"}
                        </DropdownMenuItem>
                      ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {can("transfer") && station.machines.length > 0 && (
                <Button size="sm" variant="ghost" className={cn(!can("assign") && "ml-auto")} onClick={() => actions.transfer(station.machines.map((m) => ({ id: m.id, assetTag: m.assetTag, siteId })))}>
                  <Truck /> Otra sede
                </Button>
              )}
            </div>
            <div className="grid gap-2">
              {KIT_SLOTS.filter((s) => bySlot.has(s) || s === "PC" || s === "MONITOR" || s === "HEADSET").map((slot) => (
                <div key={slot} className="grid gap-1.5">
                  <p className="text-xs font-medium text-muted-foreground">{SLOT_LABEL[slot]}</p>
                  {(bySlot.get(slot) ?? []).map((m) => (
                    <div key={m.id} className="flex items-center gap-1">
                      <div className="min-w-0 flex-1">
                        <MachineChip m={m} canMove={false} onClick={() => onOpenMachine(m.id)} />
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon-sm" variant="ghost" aria-label={`Acciones de ${m.assetTag}`}>
                            <Wrench />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onSelect={() => onOpenMachine(m.id)}>Ver ficha e historial</DropdownMenuItem>
                          {can("incident") && <DropdownMenuItem onSelect={() => actions.reportIssue(m)}>Reportar falla</DropdownMenuItem>}
                          {can("assign") && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onSelect={() => onMoveMachine(m.id, null)}>Devolver al almacén</DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  ))}
                  {!bySlot.has(slot) && <p className="rounded-md border border-dashed px-3 py-2 text-13 text-muted-foreground">Vacío</p>}
                </div>
              ))}
            </div>
          </section>

          {can("assign") && (
            <section className="grid gap-2">
              <h3 className="text-sm font-semibold">Agregar desde el almacén</h3>
              {loose.filter((m) => m.status !== "REPAIR").length === 0 ? (
                <p className="text-13 text-muted-foreground">No hay equipos disponibles en el almacén de la sede.</p>
              ) : (
                <div className="grid max-h-64 gap-1.5 overflow-y-auto">
                  {loose
                    .filter((m) => m.status !== "REPAIR")
                    .map((m) => (
                      <button key={m.id} type="button" onClick={() => onMoveMachine(m.id, station.id)} className="text-left">
                        <MachineChip m={m} canMove={false} />
                      </button>
                    ))}
                </div>
              )}
            </section>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Editor de cuadrícula
// ═══════════════════════════════════════════════════════════════════════════

type DZone = { ref: string; id?: string; name: string; color: string; x: number; y: number; w: number; h: number };
type DStation = { ref: string; id?: string; code: string; x: number; y: number; active: boolean; machines: number };
type Tool = "select" | "station" | "row" | "zone" | "erase";
type Drag =
  | { kind: "zone-new" | "row"; x0: number; y0: number; x1: number; y1: number }
  | { kind: "move-station"; ref: string; dx: number; dy: number; x: number; y: number }
  | { kind: "move-zone"; ref: string; dx: number; dy: number; x: number; y: number }
  | { kind: "resize-zone"; ref: string; x: number; y: number };

const TOOLS: { key: Tool; label: string; icon: typeof MousePointer2; hint: string }[] = [
  { key: "select", label: "Mover", icon: MousePointer2, hint: "Arrastra puestos y zonas. Clic para editar sus datos." },
  { key: "station", label: "Puesto", icon: Plus, hint: "Clic en una celda vacía para agregar un puesto." },
  { key: "row", label: "Fila de puestos", icon: Rows3, hint: "Arrastra en línea recta para crear varios puestos seguidos." },
  { key: "zone", label: "Zona / isla", icon: SquareDashed, hint: "Arrastra un rectángulo para crear una isla o zona." },
  { key: "erase", label: "Borrar", icon: Eraser, hint: "Clic sobre un puesto o una zona para quitarlo." },
];

function nextCode(stations: DStation[], prefix: string) {
  const nums = stations.map((s) => (s.code.startsWith(prefix) ? Number(s.code.slice(prefix.length)) : NaN)).filter((n) => !Number.isNaN(n));
  let n = nums.length ? Math.max(...nums) + 1 : 1;
  return () => `${prefix}${String(n++).padStart(2, "0")}`;
}

/** Celdas de una fila arrastrada: va en línea recta por el eje en que más se movió */
function rowCells(d: { x0: number; y0: number; x1: number; y1: number }) {
  const horizontal = Math.abs(d.x1 - d.x0) >= Math.abs(d.y1 - d.y0);
  const n = horizontal ? Math.abs(d.x1 - d.x0) : Math.abs(d.y1 - d.y0);
  const step = horizontal ? Math.sign(d.x1 - d.x0) : Math.sign(d.y1 - d.y0);
  return Array.from({ length: n + 1 }, (_, i) => (horizontal ? { x: d.x0 + i * step, y: d.y0 } : { x: d.x0, y: d.y0 + i * step }));
}

function FloorEditor({ plan, onClose }: { plan: SitePlan; onClose: () => void }) {
  const { run, pending } = useAction();
  const confirm = useConfirm();
  const [cols, setCols] = React.useState(plan.site.planCols);
  const [rows, setRows] = React.useState(plan.site.planRows);
  const [zones, setZones] = React.useState<DZone[]>(plan.zones.map((z) => ({ ref: z.id, ...z })));
  const [stations, setStations] = React.useState<DStation[]>(plan.stations.map((s) => ({ ref: s.id, id: s.id, code: s.code, x: s.x, y: s.y, active: s.active, machines: s.machines.length })));
  const [tool, setTool] = React.useState<Tool>(plan.stations.length ? "select" : "zone");
  const [prefix, setPrefix] = React.useState("P-");
  const [selected, setSelected] = React.useState<{ type: "zone" | "station"; ref: string } | null>(null);
  const [drag, setDrag] = React.useState<Drag | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const canvas = React.useRef<HTMLDivElement>(null);
  // Cuadrícula del editor más grande (antes 44 px), con zoom
  const [cell, setCell] = React.useState(64);
  const seq = React.useRef(0);
  const newRef = () => `new-${++seq.current}`;
  const touch = () => setDirty(true);

  const at = (e: React.PointerEvent | PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(cols - 1, Math.floor((e.clientX - r.left) / cell))), y: Math.max(0, Math.min(rows - 1, Math.floor((e.clientY - r.top) / cell))) };
  };
  const stationAt = (x: number, y: number) => stations.find((s) => s.x === x && s.y === y);
  const zoneAt = (x: number, y: number) => [...zones].reverse().find((z) => x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h);

  const removeStation = async (s: DStation) => {
    if (s.machines > 0) {
      const ok = await confirm({ title: `¿Quitar el puesto ${s.code}?`, description: `Tiene ${s.machines} equipo(s): quedarán en el almacén de la sede al guardar.`, confirmText: "Quitar", destructive: true });
      if (!ok) return;
    }
    setStations((list) => list.filter((x) => x.ref !== s.ref));
    setSelected(null);
    touch();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const c = at(e);
    const st = stationAt(c.x, c.y);
    const zn = zoneAt(c.x, c.y);
    canvas.current?.setPointerCapture?.(e.pointerId);
    canvas.current?.focus();
    if (tool === "erase") {
      if (st) removeStation(st);
      else if (zn) {
        setZones((l) => l.filter((z) => z.ref !== zn.ref));
        touch();
      }
      return;
    }
    if (tool === "station") {
      if (!st) {
        const code = nextCode(stations, prefix)();
        const ref = newRef();
        setStations((l) => [...l, { ref, code, x: c.x, y: c.y, active: true, machines: 0 }]);
        setSelected({ type: "station", ref });
        touch();
      }
      return;
    }
    if (tool === "row" || tool === "zone") {
      setDrag({ kind: tool === "row" ? "row" : "zone-new", x0: c.x, y0: c.y, x1: c.x, y1: c.y });
      return;
    }
    // Mover
    if (st) {
      setSelected({ type: "station", ref: st.ref });
      setDrag({ kind: "move-station", ref: st.ref, dx: 0, dy: 0, x: c.x, y: c.y });
    } else if (zn) {
      setSelected({ type: "zone", ref: zn.ref });
      const corner = c.x === zn.x + zn.w - 1 && c.y === zn.y + zn.h - 1;
      setDrag(corner ? { kind: "resize-zone", ref: zn.ref, x: c.x, y: c.y } : { kind: "move-zone", ref: zn.ref, dx: c.x - zn.x, dy: c.y - zn.y, x: c.x, y: c.y });
    } else setSelected(null);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const c = at(e);
    if (drag.kind === "zone-new" || drag.kind === "row") {
      if (c.x !== drag.x1 || c.y !== drag.y1) setDrag({ ...drag, x1: c.x, y1: c.y });
    } else {
      const d = drag as Extract<Drag, { x: number }>;
      if (c.x !== d.x || c.y !== d.y) setDrag({ ...d, x: c.x, y: c.y });
    }
  };

  const onPointerUp = () => {
    if (!drag) return;
    if (drag.kind === "zone-new") {
      const x = Math.min(drag.x0, drag.x1);
      const y = Math.min(drag.y0, drag.y1);
      const w = Math.abs(drag.x1 - drag.x0) + 1;
      const h = Math.abs(drag.y1 - drag.y0) + 1;
      if (w * h >= 2) {
        const ref = newRef();
        setZones((l) => [...l, { ref, name: `Isla ${String.fromCharCode(65 + l.length)}`, color: ZONE_COLORS[l.length % ZONE_COLORS.length]!, x, y, w, h }]);
        setSelected({ type: "zone", ref });
        setTool("row");
        touch();
      }
    } else if (drag.kind === "row") {
      const gen = nextCode(stations, prefix);
      const add = rowCells(drag).filter((p) => !stationAt(p.x, p.y)).map((p) => ({ ref: newRef(), code: gen(), x: p.x, y: p.y, active: true, machines: 0 }));
      if (add.length) {
        setStations((l) => [...l, ...add]);
        touch();
      }
    } else if (drag.kind === "move-station") {
      const s = stations.find((x) => x.ref === drag.ref);
      if (s && (s.x !== drag.x || s.y !== drag.y) && !stationAt(drag.x, drag.y)) {
        setStations((l) => l.map((x) => (x.ref === drag.ref ? { ...x, x: drag.x, y: drag.y } : x)));
        touch();
      }
    } else if (drag.kind === "move-zone") {
      const z = zones.find((x) => x.ref === drag.ref);
      if (z) {
        const nx = Math.max(0, Math.min(cols - z.w, drag.x - drag.dx));
        const ny = Math.max(0, Math.min(rows - z.h, drag.y - drag.dy));
        if (nx !== z.x || ny !== z.y) {
          // Los puestos dentro de la zona se mueven con ella (si no chocan con otros)
          const inside = (s: DStation) => s.x >= z.x && s.x < z.x + z.w && s.y >= z.y && s.y < z.y + z.h;
          const moved = stations.map((s) => (inside(s) ? { ...s, x: s.x + nx - z.x, y: s.y + ny - z.y } : s));
          if (new Set(moved.map((s) => `${s.x}:${s.y}`)).size === moved.length) setStations(moved);
          setZones(zones.map((x) => (x.ref === z.ref ? { ...x, x: nx, y: ny } : x)));
          touch();
        }
      }
    } else if (drag.kind === "resize-zone") {
      setZones((l) => l.map((z) => (z.ref === drag.ref ? { ...z, w: Math.max(1, drag.x - z.x + 1), h: Math.max(1, drag.y - z.y + 1) } : z)));
      touch();
    }
    setDrag(null);
  };

  // Vista previa de lo que se está arrastrando
  const ghost = drag?.kind === "zone-new" ? { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: Math.abs(drag.x1 - drag.x0) + 1, h: Math.abs(drag.y1 - drag.y0) + 1 } : null;
  const rowGhost = drag?.kind === "row" ? rowCells(drag) : [];

  const shownStations = stations.map((s) => (drag?.kind === "move-station" && drag.ref === s.ref ? { ...s, x: drag.x, y: drag.y } : s));
  const shownZones = zones.map((z) => {
    if (drag?.kind === "move-zone" && drag.ref === z.ref) return { ...z, x: Math.max(0, Math.min(cols - z.w, drag.x - drag.dx)), y: Math.max(0, Math.min(rows - z.h, drag.y - drag.dy)) };
    if (drag?.kind === "resize-zone" && drag.ref === z.ref) return { ...z, w: Math.max(1, drag.x - z.x + 1), h: Math.max(1, drag.y - z.y + 1) };
    return z;
  });

  const selZone = selected?.type === "zone" ? zones.find((z) => z.ref === selected.ref) : undefined;
  const selStation = selected?.type === "station" ? stations.find((s) => s.ref === selected.ref) : undefined;
  const outOfBounds = stations.some((s) => s.x >= cols || s.y >= rows) || zones.some((z) => z.x + z.w > cols || z.y + z.h > rows);
  // Se recalcula en cada movimiento del arrastre: un solo recorrido, no uno por puesto
  const codeUses = new Map<string, number>();
  for (const s of stations) codeUses.set(s.code, (codeUses.get(s.code) ?? 0) + 1);
  const dupCodes = codeUses.size !== stations.length;

  const save = async () => {
    const zoneOf = (s: DStation) => [...zones].reverse().find((z) => s.x >= z.x && s.x < z.x + z.w && s.y >= z.y && s.y < z.y + z.h)?.ref ?? null;
    const body = {
      cols,
      rows,
      zones: zones.map((z) => ({ ref: z.ref, id: z.id, name: z.name, color: z.color, x: z.x, y: z.y, w: z.w, h: z.h })),
      stations: stations.map((s) => ({ id: s.id, code: s.code, x: s.x, y: s.y, active: s.active, zoneRef: zoneOf(s) })),
    };
    const ok = await run(() => api.put(`/inventory/sites/${plan.site.id}/plan`, body), { success: "Plano guardado", invalidate });
    if (ok) onClose();
  };
  const discard = async () => {
    if (dirty && !(await confirm({ title: "¿Descartar los cambios del plano?", confirmText: "Descartar", destructive: true }))) return;
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!selStation && !selZone) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      if (selStation) removeStation(selStation);
      else if (selZone) {
        setZones((l) => l.filter((z) => z.ref !== selZone.ref));
        setSelected(null);
        touch();
      }
      return;
    }
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d) return;
    e.preventDefault();
    if (selStation) {
      const nx = selStation.x + d[0]!;
      const ny = selStation.y + d[1]!;
      if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && !stationAt(nx, ny)) {
        setStations((l) => l.map((s) => (s.ref === selStation.ref ? { ...s, x: nx, y: ny } : s)));
        touch();
      }
    } else if (selZone) {
      setZones((l) => l.map((z) => (z.ref === selZone.ref ? { ...z, x: Math.max(0, Math.min(cols - z.w, z.x + d[0]!)), y: Math.max(0, Math.min(rows - z.h, z.y + d[1]!)) } : z)));
      touch();
    }
  };

  return (
    <div className="grid gap-4">
      <Card className="flex flex-wrap items-center gap-2 p-3">
        <span className="text-13 font-semibold text-brand">Editor de plano</span>
        <div className="flex flex-wrap gap-1">
          {TOOLS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTool(t.key)}
              title={t.hint}
              aria-pressed={tool === t.key}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-13 font-medium transition-colors [&_svg]:size-3.5",
                tool === t.key ? "bg-brand text-white" : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              <t.icon /> {t.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center rounded-md border">
            <Button variant="ghost" size="icon-sm" onClick={() => setCell((c) => Math.max(40, c - 8))} aria-label="Alejar cuadrícula">
              <ZoomOut />
            </Button>
            <span className="w-12 text-center text-xs text-muted-foreground tabular-nums">{Math.round((cell / 64) * 100)}%</span>
            <Button variant="ghost" size="icon-sm" onClick={() => setCell((c) => Math.min(104, c + 8))} aria-label="Acercar cuadrícula">
              <ZoomIn />
            </Button>
          </div>
          <Button variant="outline" onClick={discard}>
            Cancelar
          </Button>
          <Button onClick={save} loading={pending} disabled={outOfBounds || dupCodes}>
            <Save /> Guardar plano
          </Button>
        </div>
        <p className="w-full text-xs text-muted-foreground">
          {TOOLS.find((t) => t.key === tool)!.hint} Con un elemento elegido: flechas para moverlo, Supr para quitarlo. Arrastra la esquina inferior derecha de una zona para cambiar su tamaño.
        </p>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <Card className="overflow-auto p-4">
          <div
            ref={canvas}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            className={cn("relative mx-auto touch-none outline-none select-none", tool === "select" ? "cursor-default" : "cursor-crosshair")}
            style={{ width: cols * cell, height: rows * cell }}
          >
            <GridBackdrop cell={cell} />
            {shownZones.map((z) => (
              <ZoneRect key={z.ref} zone={z} cell={cell} selected={selected?.ref === z.ref}>
                <span className="absolute right-0 bottom-0 size-3 cursor-se-resize bg-foreground/50" />
              </ZoneRect>
            ))}
            {ghost && <div className="pointer-events-none absolute border-2 border-dashed border-brand bg-brand/10" style={{ left: ghost.x * cell, top: ghost.y * cell, width: ghost.w * cell, height: ghost.h * cell }} />}
            {rowGhost.map((p, i) => (
              <div key={i} className="pointer-events-none absolute border-2 border-dashed border-brand bg-brand/10" style={{ left: p.x * cell + 4, top: p.y * cell + 4, width: cell - 8, height: cell - 8 }} />
            ))}
            {shownStations.map((s) => (
              <div
                key={s.ref}
                className={cn(
                  "pointer-events-none absolute flex items-center justify-center rounded-md border-2 bg-card text-13 font-semibold shadow-sm",
                  s.machines ? "border-success" : "border-foreground/40",
                  selected?.ref === s.ref && "ring-2 ring-brand ring-offset-1 ring-offset-background",
                  (codeUses.get(s.code) ?? 0) > 1 && "border-brand text-brand",
                )}
                style={{ left: s.x * cell + 4, top: s.y * cell + 4, width: cell - 8, height: cell - 8 }}
              >
                {s.code}
              </div>
            ))}
          </div>
        </Card>

        <div className="grid content-start gap-4">
          <Card className="grid gap-3 p-4">
            <h3 className="text-sm font-semibold">Sala</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Columnas">
                <Input type="number" min={6} max={60} value={cols} onChange={(e) => (setCols(Math.max(6, Math.min(60, Number(e.target.value) || 6))), touch())} />
              </Field>
              <Field label="Filas">
                <Input type="number" min={4} max={40} value={rows} onChange={(e) => (setRows(Math.max(4, Math.min(40, Number(e.target.value) || 4))), touch())} />
              </Field>
            </div>
            <Field label="Prefijo de puestos nuevos" hint="P- → P-01, P-02…">
              <Input value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase().slice(0, 6))} />
            </Field>
            <p className="text-xs text-muted-foreground">
              {stations.length} puestos · {zones.length} zonas
            </p>
            {outOfBounds && <p className="text-xs text-destructive">Hay puestos o zonas fuera de la cuadrícula: agranda la sala o muévelos.</p>}
            {dupCodes && <p className="text-xs text-destructive">Hay códigos de puesto repetidos (en rojo).</p>}
          </Card>

          {selZone && (
            <Card className="grid gap-3 p-4">
              <h3 className="text-sm font-semibold">Zona</h3>
              <Field label="Nombre">
                <Input value={selZone.name} maxLength={40} onChange={(e) => (setZones((l) => l.map((z) => (z.ref === selZone.ref ? { ...z, name: e.target.value } : z))), touch())} />
              </Field>
              <div className="flex flex-wrap gap-2">
                {ZONE_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Color ${c}`}
                    onClick={() => (setZones((l) => l.map((z) => (z.ref === selZone.ref ? { ...z, color: c } : z))), touch())}
                    className={cn("size-7 rounded-full ring-offset-2 ring-offset-background", selZone.color === c && "ring-2 ring-foreground")}
                    style={{ background: c }}
                  />
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {selZone.w} × {selZone.h} celdas · {stations.filter((s) => s.x >= selZone.x && s.x < selZone.x + selZone.w && s.y >= selZone.y && s.y < selZone.y + selZone.h).length} puestos dentro
              </p>
            </Card>
          )}
          {selStation && (
            <Card className="grid gap-3 p-4">
              <h3 className="text-sm font-semibold">Puesto</h3>
              <Field label="Código">
                <Input value={selStation.code} maxLength={12} onChange={(e) => (setStations((l) => l.map((s) => (s.ref === selStation.ref ? { ...s, code: e.target.value.toUpperCase() } : s))), touch())} />
              </Field>
              <p className="text-xs text-muted-foreground">{selStation.machines ? `${selStation.machines} equipo(s) en el puesto` : "Sin equipos"}</p>
              <Button variant="outline" onClick={() => removeStation(selStation)}>
                <Eraser /> Quitar puesto
              </Button>
            </Card>
          )}
          <Card className="grid gap-2 p-4 text-xs text-muted-foreground">
            <p className="flex items-center gap-2 font-medium text-foreground">
              <Badge variant="brand">Tip</Badge> Arma la sala en 3 pasos
            </p>
            <p>1. Zona / isla: arrastra un rectángulo por cada isla.</p>
            <p>2. Fila de puestos: arrastra dentro de la isla; se numeran solos.</p>
            <p>3. Guarda. Luego, en el plano, arrastra los equipos del almacén a cada puesto.</p>
          </Card>
          <Button variant="ghost" onClick={() => (setSelected(null), setTool("select"))}>
            <Minus /> Quitar selección
          </Button>
        </div>
      </div>
    </div>
  );
}
