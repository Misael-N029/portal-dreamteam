import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Box,
  Cable,
  Headset,
  Keyboard,
  Laptop,
  Monitor,
  MonitorSmartphone,
  Mouse,
  Package,
  PenLine,
  Phone,
  Printer,
  Search,
  SprayCan,
  type LucideIcon,
} from "lucide-react";
import { api, qs } from "@/lib/api";
import { useAuth } from "@/providers/auth";
import { MODULE_ICONS } from "@/lib/icons";
import type { InventoryCategory, InventoryMeta, MachineStatus, PersonRef } from "@/lib/types";
import { Input } from "@/components/ui/form";
import { Badge } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

export const invalidate = [["inventory"]];

export const STATUS_LABEL: Record<MachineStatus, string> = { ACTIVE: "En uso", STORAGE: "Almacén", REPAIR: "Reparación", TRANSIT: "En traslado", RETIRED: "De baja" };
export const STATUS_COLOR: Record<MachineStatus, string> = { ACTIVE: "#22c55e", STORAGE: "#94a3b8", REPAIR: "#f59e0b", TRANSIT: "#38bdf8", RETIRED: "#525252" };
const STATUS_VARIANT: Record<MachineStatus, "success" | "default" | "warning" | "brand" | "outline"> = {
  ACTIVE: "success",
  STORAGE: "default",
  REPAIR: "warning",
  TRANSIT: "brand",
  RETIRED: "outline",
};

export function StatusBadge({ status }: { status: MachineStatus }) {
  return (
    <Badge variant={STATUS_VARIANT[status]}>
      <span className="size-1.5 rotate-45" style={{ background: STATUS_COLOR[status] }} /> {STATUS_LABEL[status]}
    </Badge>
  );
}

/** Iconos propios del inventario (además de los de módulos) */
const INVENTORY_ICONS: Record<string, LucideIcon> = { Monitor, Laptop, MonitorSmartphone, Headset, Keyboard, Mouse, Phone, Box, Package, PenLine, SprayCan, Cable, Printer };
export const CATEGORY_ICON_NAMES = [...new Set([...Object.keys(INVENTORY_ICONS), ...Object.keys(MODULE_ICONS)])];

export function CategoryIcon({ name, className, style }: { name?: string | null; className?: string; style?: React.CSSProperties }) {
  const Icon = (name && (INVENTORY_ICONS[name] ?? MODULE_ICONS[name])) || Box;
  return <Icon className={className} style={style} />;
}

export const SLOT_LABEL: Record<string, string> = { PC: "Computadora", MONITOR: "Monitor", HEADSET: "Headset", PERIPHERAL: "Periféricos", PHONE: "Teléfono", OTHER: "Otros" };
/** Orden del kit de un puesto */
export const KIT_SLOTS = ["PC", "MONITOR", "HEADSET", "PERIPHERAL", "PHONE", "OTHER"] as const;

export const KIND_LABEL: Record<string, string> = {
  CREATED: "Alta",
  UPDATED: "Edición",
  STATUS: "Estado",
  MOVED: "Movido",
  ASSIGNED: "Asignación",
  TRANSFER: "Traslado",
  RECEIVED: "Recibido",
  TRANSFER_CANCELLED: "Traslado cancelado",
  INCIDENT: "Falla reportada",
  INCIDENT_UPDATE: "Incidencia",
  RETIRED: "Baja",
  REACTIVATED: "Reactivado",
  IMPORTED: "Excel",
};

export const MOVEMENT_LABEL: Record<string, string> = {
  IN: "Entrada",
  OUT: "Salida",
  ADJUST: "Ajuste",
  DELIVERY: "Entrega",
  RETURN: "Devolución",
  TRANSFER_OUT: "Traslado (sale)",
  TRANSFER_IN: "Traslado (entra)",
};

/** Permisos del usuario en el inventario */
export function useInvAccess() {
  const { canModule, user } = useAuth();
  const scope = user?.access.inventario?.scope ?? "OWN";
  const can = (a: string) => canModule("inventario", a);
  return {
    can,
    scope,
    me: user?.id ?? null,
    siteId: user?.access.inventario?.siteId ?? null,
    own: scope === "OWN",
    global: scope === "ALL",
    /** Supervisor: actúa solo sobre su equipo */
    team: scope === "TEAM",
    /** Gestiona equipos e insumos (Admin/TI). Sin esto, la vista es de personas: plano, incidencias y "Mi equipo". */
    manages: ["create", "edit", "assign", "transfer", "receive", "stock", "deliver", "retire", "layout"].some(can),
  };
}

export function useInventoryMeta() {
  const q = useQuery({ queryKey: ["inventory", "meta"], queryFn: () => api.get<InventoryMeta>("/inventory/meta"), staleTime: 60_000 });
  const categories = q.data?.categories ?? [];
  const byId = React.useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  return {
    ...q,
    categories,
    equipmentCats: categories.filter((c) => c.kind === "EQUIPMENT"),
    supplyCats: categories.filter((c) => c.kind === "SUPPLY"),
    category: (id?: string | null): InventoryCategory | undefined => (id ? byId.get(id) : undefined),
    sites: q.data?.sites ?? [],
  };
}

/** Buscador de colaboradores (para asignar equipos o entregar insumos) */
export function PersonPicker({
  value,
  onChange,
  siteId,
  all,
  placeholder = "Busca por nombre, correo o área…",
}: {
  value: PersonRef | null;
  onChange: (p: PersonRef | null) => void;
  siteId?: string | null;
  /** Buscar en todas las sedes (RRHH) */
  all?: boolean;
  placeholder?: string;
}) {
  const [q, setQ] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data, isFetching } = useQuery({
    queryKey: ["inventory", "people", debounced, siteId, all],
    queryFn: () => api.get<PersonRef[]>(`/inventory/people${qs({ q: debounced, siteId: siteId ?? undefined, all: all ? "1" : undefined })}`),
    enabled: !value,
  });
  if (value) {
    return (
      <div className="flex items-center gap-3 border px-3 py-2">
        <div className="grid min-w-0 flex-1">
          <span className="truncate text-sm font-medium">{value.name}</span>
          <span className="truncate text-xs text-muted-foreground">{[value.area, value.email].filter(Boolean).join(" · ")}</span>
        </div>
        <button type="button" className="text-13 text-brand hover:underline" onClick={() => onChange(null)}>
          Cambiar
        </button>
      </div>
    );
  }
  return (
    <div className="grid gap-1">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="pl-9" />
      </div>
      <ul className="grid max-h-48 overflow-y-auto border">
        {(data ?? []).map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => onChange(p)} className="grid w-full px-3 py-1.5 text-left hover:bg-accent">
              <span className="flex items-center gap-2 text-13 font-medium">
                {p.name}
                {p.stations?.[0] && <span className="rounded bg-muted px-1.5 text-[11px] font-normal text-muted-foreground">{p.stations[0].code}</span>}
              </span>
              <span className="text-xs text-muted-foreground">
                {[p.position, p.area, all ? p.site?.name : null].filter(Boolean).join(" · ") || p.email}
              </span>
            </button>
          </li>
        ))}
        {!isFetching && data?.length === 0 && <li className="px-3 py-3 text-center text-13 text-muted-foreground">Sin resultados</li>}
      </ul>
    </div>
  );
}

// ── Arrastrar y soltar (HTML5 nativo; cada acción tiene también su menú para teclado y táctil) ──

export const DND_MACHINE = "application/x-dt-machine";
export const DND_KIT = "application/x-dt-kit";
/** Persona que ocupa un puesto (reubicar: se mueve solo la persona) */
export const DND_PERSON = "application/x-dt-person";
export const DND_INCIDENT = "application/x-dt-incident";

export function dragProps(type: string, id: string, enabled = true): React.HTMLAttributes<HTMLElement> & { draggable?: boolean } {
  if (!enabled) return {};
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.stopPropagation();
      e.dataTransfer.setData(type, id);
      e.dataTransfer.effectAllowed = "move";
    },
  };
}

/** Zona donde se puede soltar: devuelve props y si hay algo encima */
export function useDrop(types: string[], onDrop: (type: string, id: string) => void, enabled = true) {
  const [over, setOver] = React.useState(false);
  const depth = React.useRef(0);
  const accepts = (e: React.DragEvent) => enabled && types.some((t) => e.dataTransfer.types.includes(t));
  const props = {
    onDragEnter: (e: React.DragEvent) => {
      if (!accepts(e)) return;
      e.preventDefault();
      depth.current++;
      setOver(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!accepts(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!accepts(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (!accepts(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depth.current = 0;
      setOver(false);
      const t = types.find((x) => e.dataTransfer.types.includes(x))!;
      onDrop(t, e.dataTransfer.getData(t));
    },
  };
  return { props, over };
}

/** Barra de stock: verde sobrado, ámbar cerca del mínimo, rojo bajo el mínimo. Anima al aparecer. */
export function StockBar({ quantity, min, className }: { quantity: number; min: number; className?: string }) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const cap = Math.max(min * 2, quantity, 1);
  const pct = mounted ? (quantity / cap) * 100 : 0;
  const tone = min > 0 && quantity < min ? "bg-brand" : min > 0 && quantity <= min * 1.25 ? "bg-warning" : "bg-success";
  return (
    <div className={cn("relative h-2.5 w-full overflow-hidden bg-muted", className)}>
      <div className={cn("h-full transition-[width] duration-700 ease-out", tone)} style={{ width: `${pct}%` }} />
      {min > 0 && <span className="absolute top-0 h-full w-0.5 bg-foreground/70" style={{ left: `${(min / cap) * 100}%` }} title={`Mínimo: ${min}`} />}
    </div>
  );
}

/** Acciones que cualquier vista del inventario puede abrir (ficha del equipo, reportar falla, trasladar) */
export type InvActions = {
  openMachine: (id: string) => void;
  reportIssue: (m: { id: string; assetTag: string }) => void;
  transfer: (machines: { id: string; assetTag: string; siteId: string }[]) => void;
};
export const InvActionsContext = React.createContext<InvActions>({ openMachine: () => {}, reportIssue: () => {}, transfer: () => {} });
export const useInvActions = () => React.useContext(InvActionsContext);

export const stockTone =(quantity: number, min: number) => (min > 0 && quantity < min ? "low" : min > 0 && quantity <= min * 1.25 ? "warn" : "ok");
