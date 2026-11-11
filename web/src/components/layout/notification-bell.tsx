import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Award, Bell, CheckCheck, Inbox, Megaphone, MessageCircle, Monitor, PackageCheck, PackageX, TriangleAlert, Truck, UsersRound, Wrench } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/auth";
import { useMyModules } from "@/lib/modules";
import type { NotificationFeed, NotificationItem, PostKind } from "@/lib/types";
import { KIND_META } from "@/pages/app/zone-meta";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/overlay";
import { cn, timeAgo } from "@/lib/utils";

const KEY = ["notifications"];

const ICONS: Record<string, React.ElementType> = {
  announcement: Megaphone,
  "zone.kudos": Award,
  "zone.comment": MessageCircle,
  "inv.seat": ArrowRightLeft,
  "inv.supervisor": UsersRound,
  "inv.equipment": Monitor,
  "inv.delivery": PackageCheck,
  "inv.delivery.rejected": PackageX,
  "inv.incident": Wrench,
  "inv.incident.update": Wrench,
  "inv.transfer": Truck,
  "inv.stock": TriangleAlert,
};
const iconOf = (kind: string) => (kind.startsWith("post.") ? KIND_META[kind.slice(5) as PostKind]?.icon : ICONS[kind]) ?? Inbox;

/**
 * Campanita: lo que cambió y el rol de la persona le permite ver. Consulta cada 20 s y al volver a la pestaña.
 * Conserva el historial reciente; una novedad cuenta como leída al abrirla.
 */
export function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: modules } = useMyModules();
  const { data } = useQuery({
    queryKey: KEY,
    queryFn: () => api.get<NotificationFeed>("/notifications"),
    enabled: !!user,
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
  });

  // Destino: ruta directa, o pantalla interna (la clave del módulo la define el administrador)
  const destination = React.useCallback(
    (link: string | null) => {
      if (!link) return null;
      if (link.startsWith("/")) return link;
      const [, screen = "", rest = ""] = /^([a-z]+)(.*)$/.exec(link) ?? [];
      const mod = modules?.find((m) => m.internalKey === screen);
      return mod ? `/app/m/${mod.key}${rest}` : null;
    },
    [modules],
  );

  const markRead = React.useCallback(
    (n: NotificationItem) => {
      if (n.read) return;
      qc.setQueryData<NotificationFeed>(KEY, (prev) => prev && { unread: Math.max(0, prev.unread - 1), items: prev.items.map((x) => (x.id === n.id ? { ...x, read: true } : x)) });
      api.post(`/notifications/${n.id}/read`).catch(() => qc.invalidateQueries({ queryKey: KEY }));
    },
    [qc],
  );

  const open = React.useCallback(
    (n: NotificationItem) => {
      markRead(n);
      const to = destination(n.link);
      if (to) navigate(to);
    },
    [destination, markRead, navigate],
  );

  const markAll = () => {
    qc.setQueryData<NotificationFeed>(KEY, (prev) => prev && { unread: 0, items: prev.items.map((x) => ({ ...x, read: true })) });
    api.post("/notifications/read-all").catch(() => qc.invalidateQueries({ queryKey: KEY }));
  };

  // Card emergente: un resumen al entrar y luego una por cada novedad que llegue
  const announced = React.useRef<Set<string> | null>(null);
  React.useEffect(() => {
    if (!data) return;
    if (!announced.current) {
      announced.current = new Set(data.items.map((n) => n.id));
      const first = data.items.find((n) => !n.read);
      if (data.unread > 0 && first)
        toast(`Tienes ${data.unread} ${data.unread === 1 ? "notificación" : "notificaciones"} sin leer`, { description: first.title, duration: 10_000 });
      return;
    }
    for (const n of data.items) {
      if (announced.current.has(n.id)) continue;
      announced.current.add(n.id);
      if (!n.read) toast(n.title, { description: n.body ?? undefined, action: { label: "Ver", onClick: () => open(n) }, duration: 10_000 });
    }
  }, [data, open]);

  if (!user) return null;
  const unread = data?.unread ?? 0;
  const items = data?.items ?? [];
  return (
    <DropdownMenu onOpenChange={(o) => o && qc.invalidateQueries({ queryKey: KEY })}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={unread ? `${unread} notificaciones sin leer` : "Notificaciones"} className="relative">
          <Bell />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] leading-4 font-bold text-white">{unread > 9 ? "9+" : unread}</span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-96 max-w-[calc(100vw-1rem)]">
        <DropdownMenuLabel>Notificaciones{unread > 0 ? ` · ${unread} sin leer` : ""}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.length ? (
          <div className="max-h-96 overflow-y-auto">
            {items.map((n) => {
              const I = iconOf(n.kind);
              return (
                <DropdownMenuItem key={n.id} onSelect={() => open(n)} className="items-start gap-2.5">
                  <I className={cn("mt-0.5 shrink-0", !n.read && "text-brand!")} />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-13", n.read ? "text-muted-foreground" : "font-medium")}>{n.title}</span>
                    {n.body && <span className="line-clamp-2 text-xs text-muted-foreground">{n.body}</span>}
                    <span className="block text-[11px] text-muted-foreground">{timeAgo(n.createdAt)}</span>
                  </span>
                  {!n.read && <span aria-label="Sin leer" className="mt-1.5 size-2 shrink-0 rounded-full bg-brand" />}
                </DropdownMenuItem>
              );
            })}
          </div>
        ) : (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">Aún no tienes notificaciones.</p>
        )}
        {unread > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                markAll();
              }}
            >
              <CheckCheck /> Marcar todas como leídas
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
