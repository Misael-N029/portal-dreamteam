import * as React from "react";
import { useBranding, useTheme } from "@/providers/branding";
import { cn } from "@/lib/utils";

/** Isotipo oficial de DreamTeam (recortado del logotipo; no se redibuja) */
export function Isotipo({ className, inverted }: { className?: string; inverted?: boolean }) {
  const { dark } = useTheme();
  return (
    <img
      src={inverted || dark ? "/isotipo-dark.png" : "/isotipo.png"}
      alt=""
      className={cn("size-8 shrink-0 object-contain", className)}
    />
  );
}

/** Logotipo horizontal oficial (isotipo + DreamTeam Contact Center) */
export function Logotipo({ className, inverted }: { className?: string; inverted?: boolean }) {
  const { dark } = useTheme();
  return (
    <img
      src={inverted || dark ? "/logo-dark.png" : "/logo.png"}
      alt="DreamTeam Contact Center"
      className={cn("h-9 w-auto object-contain", className)}
    />
  );
}

export function BrandMark({ inverted, className }: { inverted?: boolean; className?: string }) {
  const brand = useBranding();
  const [first, ...rest] = brand.platformName.split(" ");
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      {brand.logoUrl ? (
        <img src={brand.logoUrl} alt="" className="size-8 shrink-0 rounded-lg object-contain" />
      ) : (
        <Isotipo inverted={inverted} />
      )}
      <span className={cn("truncate text-[15px] font-semibold tracking-tight", inverted ? "text-white" : "text-foreground")}>
        {first} <span className="text-brand">{rest.join(" ")}</span>
      </span>
    </div>
  );
}

export function FlagPeru({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 3 2" className={cn("h-3 w-[18px] rounded-[2px] ring-1 ring-black/10", className)} aria-label="Perú">
      <rect width="3" height="2" fill="#fff" />
      <rect width="1" height="2" fill="#D91023" />
      <rect x="2" width="1" height="2" fill="#D91023" />
    </svg>
  );
}

export function FlagSpain({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 3 2" className={cn("h-3 w-[18px] rounded-[2px] ring-1 ring-black/10", className)} aria-label="España">
      <rect width="3" height="2" fill="#AA151B" />
      <rect y="0.5" width="3" height="1" fill="#F1BF00" />
    </svg>
  );
}

const timeFmt = (tz: string) =>
  new Intl.DateTimeFormat("es-PE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz });
const lima = timeFmt("America/Lima");
const madrid = timeFmt("Europe/Madrid");

export function Clocks() {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="hidden items-center gap-3 rounded-lg border bg-surface/60 px-3 py-1.5 text-13 tabular-nums md:flex">
      <span className="flex items-center gap-1.5" title="Hora Perú (Lima)">
        <FlagPeru />
        {lima.format(now)}
      </span>
      <span className="h-3.5 w-px bg-border" />
      <span className="flex items-center gap-1.5" title="Hora España (Madrid)">
        <FlagSpain />
        {madrid.format(now)}
      </span>
    </div>
  );
}
