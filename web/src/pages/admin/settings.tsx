import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Globe, KeyRound, Palette, Plus, Save, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import { useDocumentTitle } from "@/providers/branding";
import type { Settings } from "@/lib/types";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Field, Input, SwitchRow, Textarea } from "@/components/ui/form";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/misc";

type Response = { settings: Settings; yourIp: string };

export function SettingsPage() {
  useDocumentTitle("Configuración");
  const { data } = useQuery({ queryKey: ["admin", "settings"], queryFn: () => api.get<Response>("/settings") });
  const { run, pending } = useAction();
  const [form, setForm] = React.useState<Settings | null>(null);
  const [ipDraft, setIpDraft] = React.useState("");
  const [domainDraft, setDomainDraft] = React.useState("");

  React.useEffect(() => {
    if (data) setForm(data.settings);
  }, [data]);

  if (!form || !data) {
    return (
      <>
        <PageHeader title="Configuración" />
        <Skeleton className="h-96 rounded-xl" />
      </>
    );
  }

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const dirty = JSON.stringify(form) !== JSON.stringify(data.settings);
  const save = () =>
    run(() => api.put<Response>("/settings", form), {
      success: "Configuración guardada",
      invalidate: [["admin", "settings"], ["settings"]],
    });

  const addIp = () => {
    const ip = ipDraft.trim();
    if (ip && !form.allowedIps.includes(ip)) set("allowedIps", [...form.allowedIps, ip]);
    setIpDraft("");
  };
  const addDomain = () => {
    const d = domainDraft.trim().toLowerCase().replace(/^@/, "");
    if (d && !form.allowedEmailDomains.includes(d)) set("allowedEmailDomains", [...form.allowedEmailDomains, d]);
    setDomainDraft("");
  };
  const ownIpListed = form.allowedIps.includes(data.yourIp);

  return (
    <>
      <PageHeader
        title="Configuración"
        description="Marca, reglas de acceso y red permitida"
        actions={
          <Button onClick={save} loading={pending} disabled={!dirty}>
            <Save /> Guardar cambios
          </Button>
        }
      />
      <Tabs defaultValue="marca" className="grid gap-6">
        <TabsList className="w-fit">
          <TabsTrigger value="marca">
            <Palette /> Marca
          </TabsTrigger>
          <TabsTrigger value="acceso">
            <KeyRound /> Acceso
          </TabsTrigger>
          <TabsTrigger value="red">
            <Globe /> Red
          </TabsTrigger>
        </TabsList>

        <TabsContent value="marca" className="grid gap-6">
          <Card>
            <CardHeader>
              <div className="grid gap-1">
                <CardTitle>Identidad</CardTitle>
                <CardDescription>Nombre y color que se ven en el portal y en el inicio de sesión.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Nombre de la plataforma">
                <Input value={form.platformName} onChange={(e) => set("platformName", e.target.value)} />
              </Field>
              <Field label="Lema">
                <Input value={form.tagline} onChange={(e) => set("tagline", e.target.value)} />
              </Field>
              <Field label="Color principal" hint="El rojo DreamTeam es #DC2626.">
                <div className="flex gap-2">
                  <Input type="color" value={form.primaryColor} onChange={(e) => set("primaryColor", e.target.value.toUpperCase())} className="w-14 cursor-pointer p-1" />
                  <Input value={form.primaryColor} onChange={(e) => set("primaryColor", e.target.value)} className="font-mono" />
                </div>
              </Field>
              <Field label="Logo propio (URL, opcional)" hint="Vacío = isotipo oficial de DreamTeam.">
                <Input value={form.logoUrl ?? ""} onChange={(e) => set("logoUrl", e.target.value || null)} placeholder="https://" />
              </Field>
              <Field label="Mensaje del inicio de sesión" className="sm:col-span-2">
                <Input value={form.loginMessage} onChange={(e) => set("loginMessage", e.target.value)} />
              </Field>
              <Field label="Bienvenida del panel" hint="Se muestra bajo el saludo en el inicio de cada colaborador." className="sm:col-span-2">
                <Textarea value={form.welcomeMessage} onChange={(e) => set("welcomeMessage", e.target.value)} className="min-h-16" />
              </Field>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="acceso" className="grid gap-6">
          <Card>
            <CardHeader>
              <div className="grid gap-1">
                <CardTitle>Correos permitidos</CardTitle>
                <CardDescription>Solo se pueden crear usuarios con estos dominios.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="flex flex-wrap gap-2">
                {form.allowedEmailDomains.map((d) => (
                  <Badge key={d} variant="outline" className="py-1 pr-1 text-13">
                    @{d}
                    <button
                      type="button"
                      className="rounded p-0.5 hover:bg-accent disabled:opacity-40"
                      disabled={form.allowedEmailDomains.length === 1}
                      onClick={() => set("allowedEmailDomains", form.allowedEmailDomains.filter((x) => x !== d))}
                      aria-label={`Quitar ${d}`}
                    >
                      <X />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex max-w-sm gap-2">
                <Input value={domainDraft} onChange={(e) => setDomainDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addDomain())} placeholder="dreamteam.com.pe" />
                <Button type="button" variant="outline" onClick={addDomain}>
                  <Plus /> Agregar
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div className="grid gap-1">
                <CardTitle>Contraseñas y sesión</CardTitle>
                <CardDescription>Se aplican al crear usuarios y al cambiar contraseñas.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Largo mínimo">
                <Input type="number" min={6} max={64} value={form.passwordMinLength} onChange={(e) => set("passwordMinLength", Number(e.target.value))} />
              </Field>
              <Field label="Duración de la sesión (horas)">
                <Input type="number" min={1} max={720} value={form.sessionHours} onChange={(e) => set("sessionHours", Number(e.target.value))} />
              </Field>
              <Field label="Intentos antes de bloquear">
                <Input type="number" min={3} max={20} value={form.maxFailedLogins} onChange={(e) => set("maxFailedLogins", Number(e.target.value))} />
              </Field>
              <Field label="Minutos de bloqueo">
                <Input type="number" min={1} max={1440} value={form.lockMinutes} onChange={(e) => set("lockMinutes", Number(e.target.value))} />
              </Field>
              <div className="sm:col-span-2 lg:col-span-4">
                <SwitchRow title="Exigir al menos un número" checked={form.passwordRequireNumber} onCheckedChange={(v) => set("passwordRequireNumber", v)} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="red" className="grid gap-6">
          <Card>
            <CardHeader>
              <div className="grid gap-1">
                <CardTitle>Restricción por IP</CardTitle>
                <CardDescription>
                  Limita el ingreso a la red de la oficina. Los roles marcados con “Entrar desde cualquier red” (como Administrador) no se ven afectados. Se valida en el servidor en cada petición.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4">
              <SwitchRow
                title="Activar restricción por IP"
                description="Al activarla, los usuarios afectados que estén fuera de la oficina perderán el acceso de inmediato."
                checked={form.ipRestrictionEnabled}
                onCheckedChange={(v) => set("ipRestrictionEnabled", v)}
              />
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted px-3 py-2 text-13">
                Tu IP actual: <code className="font-mono font-medium">{data.yourIp}</code>
                {!ownIpListed && (
                  <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => set("allowedIps", [...form.allowedIps, data.yourIp])}>
                    <Plus /> Agregar mi IP
                  </Button>
                )}
              </div>
              {form.ipRestrictionEnabled && form.allowedIps.length === 0 && (
                <p className="flex items-center gap-2 rounded-md bg-warning/12 px-3 py-2 text-13 text-warning">
                  <AlertTriangle className="size-4 shrink-0" /> La lista está vacía: solo podrán entrar los roles exentos.
                </p>
              )}
              <Field label="IPs y rangos autorizados" hint="Una IP (181.176.120.40) o un rango CIDR (181.176.120.0/24).">
                <div className="flex max-w-md gap-2">
                  <Input value={ipDraft} onChange={(e) => setIpDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addIp())} placeholder="181.176.120.40" className="font-mono" />
                  <Button type="button" variant="outline" onClick={addIp}>
                    <Plus /> Agregar
                  </Button>
                </div>
              </Field>
              {form.allowedIps.length > 0 && (
                <ul className="grid max-w-md divide-y rounded-lg border">
                  {form.allowedIps.map((ip) => (
                    <li key={ip} className="flex items-center justify-between px-3 py-2">
                      <code className="font-mono text-13">{ip}</code>
                      <Button variant="ghost" size="icon-sm" onClick={() => set("allowedIps", form.allowedIps.filter((x) => x !== ip))} aria-label={`Quitar ${ip}`}>
                        <Trash2 />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}

