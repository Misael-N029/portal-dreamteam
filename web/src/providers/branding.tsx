import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { PublicSettings } from "@/lib/types";

const FALLBACK: PublicSettings = {
  platformName: "Portal DreamTeam",
  tagline: "Todo lo que tu equipo necesita, en un solo lugar",
  logoUrl: null,
  primaryColor: "#DC2626",
  loginMessage: "",
  allowedEmailDomains: ["dreamteam.com.pe"],
};

/** Ajustes públicos (marca del portal y del inicio de sesión) */
export function usePublicSettings() {
  return useQuery({
    queryKey: ["settings", "public"],
    queryFn: () => api.get<PublicSettings>("/settings/public"),
    staleTime: 5 * 60_000,
  });
}

export function useBranding() {
  return usePublicSettings().data ?? FALLBACK;
}

export function BrandingEffect() {
  const brand = useBranding();
  React.useEffect(() => {
    document.documentElement.style.setProperty("--brand", brand.primaryColor);
  }, [brand.primaryColor]);
  return null;
}

/** Título de la pestaña: "Sección · Portal DreamTeam" */
export function useDocumentTitle(section?: string) {
  const brand = useBranding();
  React.useEffect(() => {
    document.title = section ? `${section} · ${brand.platformName}` : brand.platformName;
  }, [section, brand.platformName]);
}

// ── Tema claro / oscuro ──

const ThemeContext = React.createContext<{ dark: boolean; toggle: () => void }>({ dark: false, toggle: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [dark, setDark] = React.useState(() => document.documentElement.classList.contains("dark"));
  const toggle = React.useCallback(() => {
    setDark((d) => {
      const next = !d;
      document.documentElement.classList.toggle("dark", next);
      try {
        localStorage.setItem("portal-theme", next ? "dark" : "light");
      } catch {
        /* noop */
      }
      return next;
    });
  }, []);
  return <ThemeContext.Provider value={{ dark, toggle }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => React.useContext(ThemeContext);
