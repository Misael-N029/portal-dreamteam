import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/** "text-13" es un tamaño de letra propio del tema: sin esto tailwind-merge lo confunde con un color y borra el color del texto */
const twMerge = extendTailwindMerge({ extend: { classGroups: { "font-size": [{ text: ["13"] }] } } });

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const dateFmt = new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "2-digit", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("es-PE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export const formatDate = (d?: string | Date | null) => (d ? dateFmt.format(new Date(d)) : "—");
export const formatDateTime = (d?: string | Date | null) => (d ? dateTimeFmt.format(new Date(d)) : "—");

/** Fecha para <input type="datetime-local"> en hora local ("" si no hay fecha) */
export function toLocalInput(d?: string | Date | null) {
  if (!d) return "";
  const x = new Date(d);
  return new Date(x.getTime() - x.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function timeAgo(d?: string | Date | null) {
  if (!d) return "Nunca";
  const diff = (Date.now() - new Date(d).getTime()) / 1000;
  if (diff < 60) return "Hace un momento";
  if (diff < 3600) return `Hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `Hace ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 7) return `Hace ${Math.floor(diff / 86400)} d`;
  return formatDate(d);
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function pluralize(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Contraseña aleatoria legible que cumple la política por defecto (letras + números). */
export function generatePassword(length = 10) {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  let out = "";
  for (let i = 0; i < length - 3; i++) out += pick(letters);
  for (let i = 0; i < 3; i++) out += pick(digits);
  return out;
}
