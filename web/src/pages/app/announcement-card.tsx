import { AlertTriangle, Info, Pin, Siren } from "lucide-react";
import type { Announcement, AnnouncementLevel } from "@/lib/types";
import { Badge } from "@/components/ui/misc";
import { cn, timeAgo } from "@/lib/utils";

export const LEVEL: Record<AnnouncementLevel, { label: string; variant: "default" | "warning" | "danger"; icon: typeof Info }> = {
  INFO: { label: "Informativo", variant: "default", icon: Info },
  IMPORTANT: { label: "Importante", variant: "warning", icon: AlertTriangle },
  URGENT: { label: "Urgente", variant: "danger", icon: Siren },
};

export function AnnouncementCard({ a, compact }: { a: Announcement; compact?: boolean }) {
  const level = LEVEL[a.level];
  return (
    <article className={cn("grid gap-2 rounded-lg border bg-card p-4", a.level === "URGENT" && "border-destructive/40 bg-destructive/[0.03]")}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={level.variant}>
          <level.icon />
          {level.label}
        </Badge>
        {a.pinned && (
          <Badge variant="outline">
            <Pin /> Fijado
          </Badge>
        )}
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">{timeAgo(a.publishedAt)}</span>
      </div>
      <h3 className="text-sm font-semibold">{a.title}</h3>
      <p className={cn("text-13 leading-relaxed whitespace-pre-line text-muted-foreground", compact && "line-clamp-3")}>{a.body}</p>
      {a.author && <p className="text-xs text-muted-foreground">— {a.author}</p>}
    </article>
  );
}
