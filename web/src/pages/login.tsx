import * as React from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useAuth } from "@/providers/auth";
import { useBranding, useDocumentTitle } from "@/providers/branding";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { BrandMark, Clocks } from "@/components/layout/brand";
import { ThemeToggle } from "@/components/layout/user-menu";

export function LoginPage() {
  useDocumentTitle("Ingresar");
  const { user, login } = useAuth();
  const brand = useBranding();
  const navigate = useNavigate();
  // Vuelve a la página que pidió el login (p. ej. un módulo compartido por enlace)
  const from = (useLocation().state as { from?: string } | null)?.from;
  const target = from && (from.startsWith("/app") || from.startsWith("/admin")) ? from : "/app";
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [show, setShow] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  if (user) return <Navigate to={target} replace />;

  const domain = brand.allowedEmailDomains[0] ?? "dreamteam.com.pe";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      navigate(target, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-full lg:grid-cols-[1.1fr_1fr]">
      {/* Panel de marca */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-[#0A0A0A] p-10 text-white lg:flex">
        <BrandMark inverted />
        <div className="relative z-10 max-w-md">
          <p className="mb-4 text-13 font-medium tracking-wider text-brand uppercase">Panel de colaboradores</p>
          <h1 className="text-[40px] leading-[1.1] font-semibold tracking-tight">{brand.tagline}</h1>
          <p className="mt-5 text-base text-neutral-400">
            CRM, reportes, formación y comunicados: entra una vez y encuentra cada herramienta de tu turno en el mismo lugar.
          </p>
        </div>
        <div className="relative z-10 grid grid-cols-3 gap-6 border-t border-white/10 pt-6 text-13">
          {[
            ["Un solo acceso", "Tus herramientas según tu rol"],
            ["Comunicados", "Las novedades de tu campaña al entrar"],
            ["Seguro", "Accesos registrados y red controlada"],
          ].map(([t, d]) => (
            <div key={t}>
              <p className="font-medium">{t}</p>
              <p className="mt-1 text-neutral-500">{d}</p>
            </div>
          ))}
        </div>
        {/* Isotipo oficial gigante como textura */}
        <img src="/isotipo-dark.png" alt="" aria-hidden className="pointer-events-none absolute -right-28 top-1/2 size-[560px] -translate-y-1/2 opacity-[0.06]" />
      </div>

      {/* Formulario */}
      <div className="flex flex-col bg-background">
        <div className="flex items-center justify-between p-4 sm:p-6">
          <span className="lg:hidden">
            <BrandMark />
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Clocks />
            <ThemeToggle />
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center px-4 pb-16 sm:px-6">
          <form onSubmit={submit} className="grid w-full max-w-sm gap-6">
            <div className="grid gap-2">
              <h2 className="text-xl font-semibold tracking-tight">Ingresa a {brand.platformName}</h2>
              <p className="text-sm text-muted-foreground">{brand.loginMessage}</p>
            </div>
            <div className="grid gap-4">
              <Field label="Correo corporativo" htmlFor="email">
                <div className="relative">
                  <Mail className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder={`nombre.apellido@${domain}`}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-10 pl-9"
                    required
                    autoFocus
                  />
                </div>
              </Field>
              <Field label="Contraseña" htmlFor="password">
                <div className="relative">
                  <Lock className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    type={show ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-10 pr-10 pl-9"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                    aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
                  >
                    {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </Field>
              {error && (
                <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-13 text-destructive">
                  {error}
                </p>
              )}
            </div>
            <Button type="submit" size="lg" loading={loading}>
              Ingresar
            </Button>
            <p className="text-center text-13 text-muted-foreground">
              ¿Olvidaste tu contraseña? Pide a tu supervisor o a RRHH que te asigne una nueva.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
