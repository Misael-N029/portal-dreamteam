import { useQuery } from "@tanstack/react-query";
import { Megaphone } from "lucide-react";
import { api } from "@/lib/api";
import type { Announcement } from "@/lib/types";
import { EmptyState, PageHeader } from "@/components/page";
import { Skeleton } from "@/components/ui/misc";
import { AnnouncementCard } from "./announcement-card";

export function AnnouncementsScreen() {
  const { data, isLoading } = useQuery({ queryKey: ["portal", "announcements"], queryFn: () => api.get<Announcement[]>("/portal/announcements") });
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Comunicados" description="Avisos vigentes publicados para tu rol" />
      {isLoading ? (
        <div className="grid gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-lg" />
          ))}
        </div>
      ) : data?.length ? (
        <div className="grid gap-3">
          {data.map((a) => (
            <AnnouncementCard key={a.id} a={a} />
          ))}
        </div>
      ) : (
        <EmptyState icon={Megaphone} title="No hay comunicados vigentes" description="Cuando la empresa publique un aviso lo verás aquí." />
      )}
    </div>
  );
}
