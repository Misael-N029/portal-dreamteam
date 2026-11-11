import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Mail, Phone, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { DirectoryEntry } from "@/lib/types";
import { EmptyState, PageHeader } from "@/components/page";
import { Input } from "@/components/ui/form";
import { Avatar, Badge, Card, Skeleton } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

export function DirectoryScreen() {
  const { data, isLoading } = useQuery({ queryKey: ["portal", "directory"], queryFn: () => api.get<DirectoryEntry[]>("/portal/directory") });
  const [q, setQ] = React.useState("");
  const [area, setArea] = React.useState<string | null>(null);

  const areas = [...new Set((data ?? []).map((u) => u.area).filter(Boolean))].sort() as string[];
  const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const people = (data ?? []).filter(
    (u) => (!area || u.area === area) && (!q || norm(`${u.name} ${u.email} ${u.area ?? ""} ${u.position ?? ""}`).includes(norm(q))),
  );

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copiado al portapapeles");
    } catch {
      toast.error("No se pudo copiar");
    }
  };

  return (
    <>
      <PageHeader title="Directorio" description={`${data?.length ?? 0} personas activas en DreamTeam`} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, cargo o correo…" className="pl-9" aria-label="Buscar en el directorio" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[null, ...areas].map((a) => (
            <button
              key={a ?? "all"}
              type="button"
              onClick={() => setArea(a)}
              className={cn(
                "h-8 rounded-full border px-3 text-13 transition-colors",
                area === a ? "border-foreground bg-foreground text-background" : "bg-background hover:bg-accent",
              )}
            >
              {a ?? "Todas las áreas"}
            </button>
          ))}
        </div>
      </div>
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : people.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {people.map((u) => (
            <Card key={u.id} className="grid gap-3 p-4">
              <div className="flex items-center gap-3">
                <Avatar name={u.name} className="size-10" />
                <div className="grid min-w-0">
                  <span className="truncate text-sm font-semibold">{u.name}</span>
                  <span className="truncate text-13 text-muted-foreground">{u.position ?? u.role.name}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {u.area && <Badge variant="outline">{u.area}</Badge>}
                <Badge>
                  <span className="size-1.5 rounded-full" style={{ background: u.role.color }} />
                  {u.role.name}
                </Badge>
              </div>
              <div className="grid gap-1 border-t pt-3 text-13">
                <button type="button" onClick={() => copy(u.email)} className="group flex items-center gap-2 text-left text-muted-foreground hover:text-foreground">
                  <Mail className="size-3.5 shrink-0" />
                  <span className="truncate">{u.email}</span>
                  <Copy className="ml-auto size-3.5 opacity-0 group-hover:opacity-100" />
                </button>
                {u.phone && (
                  <a href={`tel:${u.phone.replace(/\s/g, "")}`} className="flex items-center gap-2 text-muted-foreground tabular-nums hover:text-foreground">
                    <Phone className="size-3.5 shrink-0" />
                    {u.phone}
                  </a>
                )}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState icon={Users} title="Sin resultados" description="Prueba con otro nombre o quita el filtro de área." />
      )}
    </>
  );
}
