import type { ElementType } from "react";
import { Award, BarChart3, CalendarDays, Camera, Megaphone, Trophy } from "lucide-react";
import type { PostKind } from "@/lib/types";

/** Tipos de publicación de DreamZone. Aparte de la pantalla: la campanita lo usa en todo el portal */
export const KIND_META: Record<PostKind, { label: string; icon: ElementType; accent: string }> = {
  NEWS: { label: "Publicación", icon: Megaphone, accent: "text-foreground" },
  EVENT: { label: "Evento", icon: CalendarDays, accent: "text-brand" },
  POLL: { label: "Votación / encuesta", icon: BarChart3, accent: "text-brand" },
  CHALLENGE: { label: "Dinámica", icon: Trophy, accent: "text-brand" },
  PHOTO: { label: "Foto", icon: Camera, accent: "text-foreground" },
  KUDOS: { label: "Reconocimiento", icon: Award, accent: "text-brand" },
};
