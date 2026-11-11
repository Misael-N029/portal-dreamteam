import * as React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { KeyRound, LayoutGrid, LogOut, Moon, Settings, ShieldCheck, Sun } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/providers/auth";
import { useTheme } from "@/providers/branding";
import { api } from "@/lib/api";
import { Avatar } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/overlay";
import { cn } from "@/lib/utils";

export function UserMenu({ variant = "topbar" }: { variant?: "topbar" | "sidebar" }) {
  const { user, logout, can, isStaff } = useAuth();
  const { dark, toggle } = useTheme();
  const navigate = useNavigate();
  const inAdmin = useLocation().pathname.startsWith("/admin");
  const [pwdOpen, setPwdOpen] = React.useState(false);
  React.useEffect(() => {
    // Contraseña asignada por un administrador: se pide cambiarla una vez por sesión
    if (user?.mustChangePassword && variant === "topbar" && !sessionStorage.getItem("pwd-prompted")) {
      sessionStorage.setItem("pwd-prompted", "1");
      setPwdOpen(true);
    }
  }, [user?.mustChangePassword, variant]);
  if (!user) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {variant === "sidebar" ? (
            <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-sidebar-accent">
              <Avatar name={user.name} className="size-8" color="var(--brand)" />
              <span className="grid min-w-0 flex-1">
                <span className="truncate text-13 font-medium text-white">{user.name}</span>
                <span className="truncate text-xs text-sidebar-muted">{user.role.name}</span>
              </span>
            </button>
          ) : (
            <button className="rounded-full" aria-label="Menú de usuario">
              <Avatar name={user.name} />
            </button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align={variant === "sidebar" ? "start" : "end"} side={variant === "sidebar" ? "top" : "bottom"} className="w-60">
          <DropdownMenuLabel className="grid gap-0.5">
            <span className="text-13 font-medium text-foreground">{user.name}</span>
            <span className="truncate font-normal">{user.email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setPwdOpen(true)}>
            <KeyRound /> Cambiar contraseña
          </DropdownMenuItem>
          {isStaff &&
            (inAdmin ? (
              <DropdownMenuItem onSelect={() => navigate("/app")}>
                <LayoutGrid /> Mis módulos
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => navigate("/admin")}>
                <ShieldCheck /> Administración
              </DropdownMenuItem>
            ))}
          {can("settings.manage") && (
            <DropdownMenuItem onSelect={() => navigate("/admin/configuracion")}>
              <Settings /> Configuración
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={toggle}>
            {dark ? <Sun /> : <Moon />} Tema {dark ? "claro" : "oscuro"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={logout}>
            <LogOut /> Cerrar sesión
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangePasswordDialog open={pwdOpen} onOpenChange={setPwdOpen} />
    </>
  );
}

export function ThemeToggle({ className }: { className?: string }) {
  const { dark, toggle } = useTheme();
  return (
    <Button variant="ghost" size="icon" onClick={toggle} className={cn(className)} aria-label="Cambiar tema">
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}

function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const mismatch = confirm.length > 0 && next !== confirm;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mismatch) return;
    setSaving(true);
    try {
      await api.post("/auth/change-password", { currentPassword: current, newPassword: next });
      toast.success("Contraseña actualizada");
      await qc.invalidateQueries({ queryKey: ["me"] });
      onOpenChange(false);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title="Cambiar contraseña"
          description={
            user?.mustChangePassword
              ? "Tu contraseña la asignó un administrador. Cámbiala por una personal que solo tú conozcas."
              : "Usa una contraseña que no utilices en otros sitios."
          }
        />
        <form onSubmit={submit} className="grid gap-4">
          <Field label="Contraseña actual">
            <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
          </Field>
          <Field label="Nueva contraseña">
            <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} required autoComplete="new-password" />
          </Field>
          <Field label="Confirmar nueva contraseña" error={mismatch ? "Las contraseñas no coinciden" : null}>
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required aria-invalid={mismatch} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={saving}>
              Guardar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
