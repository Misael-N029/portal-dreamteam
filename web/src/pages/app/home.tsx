import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, ArrowUpRight, LayoutGrid, Megaphone, Star } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/auth";
import { useDocumentTitle } from "@/providers/branding";
import type { Announcement, PortalModule } from "@/lib/types";
import { ModuleIcon, moduleTint } from "@/lib/icons";
import { groupBySection, useMyModules, useOpenModule } from "@/lib/modules";
import { EmptyState } from "@/components/page";
import { Badge, Skeleton } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { LEVEL } from "./announcement-card";

const greeting = () => {
  const h = Number(new Intl.DateTimeFormat("es-PE", { hour: "numeric", hour12: false, timeZone: "America/Lima" }).format(new Date()));
  return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
};

const today = () => new Intl.DateTimeFormat("es-PE", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Lima" }).format(new Date());

function useToggleFavorite() {
  const qc = useQueryClient();
  return async (m: PortalModule) => {
    // Cambio optimista: la estrella responde al instante
    qc.setQueryData<PortalModule[]>(["portal", "modules"], (prev) => prev?.map((x) => (x.id === m.id ? { ...x, favorite: !m.favorite } : x)));
    try {
      await api.put(`/portal/modules/${m.key}/favorite`, { favorite: !m.favorite });
    } catch (err) {
      toast.error((err as Error).message);
      qc.invalidateQueries({ queryKey: ["portal", "modules"] });
    }
  };
}

/** Bloque con foto de un módulo. Sin foto se dibuja con la identidad de marca (negro, icono e isotipo). */
function ModuleTile({ m }: { m: PortalModule }) {
  const open = useOpenModule();
  const toggleFavorite = useToggleFavorite();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => open(m)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open(m);
        }
      }}
      aria-label={`Abrir ${m.name}`}
      className="group relative isolate flex aspect-[4/3] cursor-pointer flex-col justify-end overflow-hidden rounded-2xl bg-[#0A0A0A] text-white shadow-xs outline-none transition-shadow hover:shadow-lg focus-visible:ring-3 focus-visible:ring-ring/60"
    >
      {m.imageUrl ? (
        <img src={m.imageUrl} alt="" loading="lazy" className="absolute inset-0 -z-10 size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
      ) : (
        <>
          <img src="/isotipo-dark.png" alt="" aria-hidden className="absolute -top-8 -right-10 -z-10 size-56 opacity-[0.07]" />
          <span className="absolute top-1/2 right-8 -z-10 -translate-y-1/2 opacity-90" style={{ color: moduleTint(m.color) ?? "#ffffff" }}>
            <ModuleIcon name={m.icon} className="size-20 stroke-[1.25]" />
          </span>
        </>
      )}
      {/* Velo oscuro para que el texto se lea sobre cualquier foto */}
      {m.imageUrl && <span aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-black/85 via-black/35 to-black/5" />}

      <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
        <span className="flex size-9 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm">
          <ModuleIcon name={m.icon} className="size-4" />
        </span>
        <div className="flex items-center gap-1.5">
          {m.badge && <Badge className="bg-brand text-white">{m.badge}</Badge>}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleFavorite(m);
            }}
            className={cn(
              "flex size-9 items-center justify-center rounded-xl backdrop-blur-sm transition-all",
              m.favorite ? "bg-white text-brand" : "bg-white/15 text-white opacity-0 group-hover:opacity-100 hover:bg-white/25 focus-visible:opacity-100",
            )}
            aria-label={m.favorite ? "Quitar de favoritos" : "Agregar a favoritos"}
            aria-pressed={m.favorite}
          >
            <Star className={cn("size-4", m.favorite && "fill-current")} />
          </button>
        </div>
      </div>

      <div className="grid gap-1 p-5">
        <h3 className="text-lg leading-tight font-semibold tracking-tight">{m.name}</h3>
        {m.description && <p className="line-clamp-2 text-13 leading-relaxed text-white/75">{m.description}</p>}
        <span className="mt-2 flex items-center gap-1.5 text-13 font-medium text-white/90">
          Abrir
          {m.type === "LINK" ? (
            <ArrowUpRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          ) : (
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          )}
        </span>
      </div>
    </div>
  );
}

function QuickChip({ m }: { m: PortalModule }) {
  const open = useOpenModule();
  return (
    <button
      type="button"
      onClick={() => open(m)}
      className="flex shrink-0 items-center gap-2.5 rounded-full border bg-card py-1.5 pr-4 pl-1.5 text-13 font-medium shadow-xs transition-colors hover:bg-accent"
    >
      {m.imageUrl ? (
        <img src={m.imageUrl} alt="" className="size-7 rounded-full object-cover" />
      ) : (
        <span className="flex size-7 items-center justify-center rounded-full bg-[#0A0A0A] text-white">
          <ModuleIcon name={m.icon} className="size-3.5" />
        </span>
      )}
      {m.name}
      {m.favorite && <Star className="size-3.5 fill-current text-brand" />}
    </button>
  );
}

function AnnouncementStrip({ items, allKey }: { items: Announcement[]; allKey?: string }) {
  const [a, ...rest] = items;
  if (!a) return null;
  const level = LEVEL[a.level];
  return (
    <div className={cn("grid gap-2 rounded-xl border bg-card px-4 py-3 shadow-xs sm:flex sm:items-center sm:gap-3", a.level === "URGENT" && "border-destructive/40 bg-destructive/[0.04]")}>
      <div className="flex shrink-0 items-center gap-2">
        <Megaphone className="size-4 shrink-0 text-brand" />
        <Badge variant={level.variant}>
          <level.icon /> {level.label}
        </Badge>
      </div>
      <p className="line-clamp-3 min-w-0 flex-1 text-13 sm:line-clamp-2">
        <span className="font-semibold">{a.title}.</span> <span className="text-muted-foreground">{a.body}</span>
      </p>
      {allKey && (
        <Link to={`/app/m/${allKey}`} className="shrink-0 text-13 font-medium text-brand hover:underline">
          {rest.length ? `Ver los ${rest.length + 1} comunicados` : "Ver comunicados"}
        </Link>
      )}
    </div>
  );
}

export function HomePage() {
  useDocumentTitle("Inicio");
  const { user } = useAuth();
  const { data: modules, isLoading } = useMyModules();
  const { data: welcome } = useQuery({ queryKey: ["settings", "app"], queryFn: () => api.get<{ welcomeMessage: string }>("/settings/app") });
  const { data: announcements } = useQuery({ queryKey: ["portal", "announcements"], queryFn: () => api.get<Announcement[]>("/portal/announcements") });

  const list = modules ?? [];
  const quick = [...list.filter((m) => m.favorite), ...list.filter((m) => !m.favorite && m.uses30d > 0).sort((a, b) => b.uses30d - a.uses30d)].slice(0, 6);
  const allAnnouncements = list.find((m) => m.internalKey === "comunicados")?.key;
  const firstName = user?.name.split(" ")[0];

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <p className="text-13 text-muted-foreground first-letter:uppercase">{today()}</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">
            {greeting()}, {firstName}
          </h1>
          {welcome?.welcomeMessage && <p className="max-w-2xl text-sm text-muted-foreground">{welcome.welcomeMessage}</p>}
        </div>
        {user && (
          <div className="flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-13 shadow-xs">
            <span className="size-2 rounded-full" style={{ background: user.role.color }} />
            <span className="font-medium">{user.role.name}</span>
            {user.area && <span className="text-muted-foreground">· {user.area}</span>}
          </div>
        )}
      </div>

      {announcements && announcements.length > 0 && <AnnouncementStrip items={announcements} allKey={allAnnouncements} />}

      {quick.length > 0 && (
        <section className="grid gap-2.5">
          <h2 className="text-13 font-medium text-muted-foreground">Accesos rápidos</h2>
          <div className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {quick.map((m) => (
              <QuickChip key={m.id} m={m} />
            ))}
          </div>
        </section>
      )}

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[4/3] rounded-2xl" />
          ))}
        </div>
      ) : list.length ? (
        groupBySection(list).map(({ section, items }) => (
          <section key={section} className="grid gap-3">
            <div className="flex items-baseline gap-3">
              <h2 className="text-base font-semibold tracking-tight">{section}</h2>
              <span className="text-13 text-muted-foreground tabular-nums">{items.length}</span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((m) => (
                <ModuleTile key={m.id} m={m} />
              ))}
            </div>
          </section>
        ))
      ) : (
        <EmptyState icon={LayoutGrid} title="Aún no tienes módulos asignados" description="Pide al administrador que te habilite las herramientas que necesitas." />
      )}
    </div>
  );
}
