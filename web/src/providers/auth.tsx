import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, setUnauthorizedHandler, tokenStore } from "@/lib/api";
import type { Permission, SessionUser } from "@/lib/types";

type AuthContextValue = {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<SessionUser>;
  logout: () => void;
  can: (permission: Permission) => boolean;
  /** Puede hacer `action` en la pantalla interna `screen` (p. ej. canModule("inventario", "assign")) */
  canModule: (screen: string, action: string) => boolean;
  /** Tiene al menos un permiso de administración */
  isStaff: boolean;
};

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [token, setToken] = React.useState(tokenStore.get());

  const me = useQuery({
    queryKey: ["me", token],
    queryFn: () => api.get<SessionUser>("/auth/me"),
    enabled: !!token,
    staleTime: 60_000,
    retry: false,
  });

  const clear = React.useCallback(() => {
    tokenStore.set(null);
    setToken(null);
    qc.clear();
  }, [qc]);

  const logout = React.useCallback(() => {
    // Deja constancia en la auditoría; si falla, la sesión se cierra igual
    api.post("/portal/logout").catch(() => undefined).finally(clear);
  }, [clear]);

  React.useEffect(() => setUnauthorizedHandler(clear), [clear]);

  const login = async (email: string, password: string) => {
    const res = await api.post<{ token: string; user: SessionUser }>("/auth/login", { email, password });
    tokenStore.set(res.token);
    qc.setQueryData(["me", res.token], res.user);
    setToken(res.token);
    return res.user;
  };

  const user = token ? (me.data ?? null) : null;

  return (
    <AuthContext.Provider
      value={{
        user,
        loading: !!token && me.isLoading,
        login,
        logout,
        can: (p) => !!user?.permissions.includes(p),
        canModule: (screen, action) => !!user?.access?.[screen]?.actions.includes(action),
        isStaff: !!user && user.permissions.length > 0,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth fuera de AuthProvider");
  return ctx;
}
