import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Database, ExternalLink, KeyRound, Mail, MessageCircle, RotateCcw, Save, Send } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import { useAuth } from "@/providers/auth";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/misc";
import { useConfirm } from "@/components/ui/overlay";

type Integrations = {
  crmExportUrl: string;
  crmCompanyId: number;
  crmApiKeySet: boolean;
  crmDemo: boolean;
  googleEmail: string;
  googleAppPasswordSet: boolean;
  senderName: string;
  smtpFromEnv: boolean;
  evolutionUrl: string;
  evolutionApiKeySet: boolean;
  evolutionInstance: string;
};

const invalidate = [["reports", "integrations"], ["reports", "overview"]];

function SecretField({ label, isSet, value, onChange, hint }: { label: string; isSet: boolean; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <Field label={label} hint={isSet ? "Guardada y cifrada. Escribe solo si quieres reemplazarla." : hint}>
      <div className="relative">
        <KeyRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input type="password" value={value} onChange={(e) => onChange(e.target.value)} placeholder={isSet ? "•••••••••••••" : ""} autoComplete="new-password" className="pl-9" />
      </div>
    </Field>
  );
}

function GoogleCard({ data }: { data: Integrations }) {
  const { user } = useAuth();
  const { run, pending } = useAction();
  const [email, setEmail] = React.useState(data.googleEmail);
  const [password, setPassword] = React.useState("");
  const [sender, setSender] = React.useState(data.senderName);
  const [testTo, setTestTo] = React.useState(user?.email ?? "");
  const ready = !!data.googleEmail && data.googleAppPasswordSet;

  return (
    <Card>
      <CardHeader>
        <div className="grid gap-1">
          <CardTitle className="flex items-center gap-2">
            <Mail className="size-4" /> Cuenta de Google para el correo
            {ready ? <Badge variant="success" dot>Lista</Badge> : <Badge variant="warning" dot>Pendiente</Badge>}
          </CardTitle>
          <CardDescription>Los reportes salen desde esta cuenta (Gmail o Google Workspace, p. ej. sistemas@dreamteam.com.pe).</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Correo de la cuenta">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="sistemas@dreamteam.com.pe" />
          </Field>
          <Field label="Nombre del remitente">
            <Input value={sender} onChange={(e) => setSender(e.target.value)} />
          </Field>
        </div>
        <SecretField label="Contraseña de aplicación" isSet={data.googleAppPasswordSet} value={password} onChange={setPassword} hint="16 letras que genera Google. No es la contraseña normal de la cuenta." />
        <details className="rounded-lg bg-muted px-4 py-3 text-13">
          <summary className="cursor-pointer font-medium">¿Cómo obtengo la contraseña de aplicación?</summary>
          <ol className="mt-2 grid list-decimal gap-1 pl-5 text-muted-foreground">
            <li>Entra a la cuenta de Google que enviará los reportes.</li>
            <li>Activa la verificación en dos pasos (Seguridad → Verificación en dos pasos).</li>
            <li>
              Abre{" "}
              <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
                myaccount.google.com/apppasswords <ExternalLink className="size-3" />
              </a>
              , crea una llamada “Portal DreamTeam” y copia las 16 letras aquí.
            </li>
            <li>Si es Google Workspace y no aparece la opción, el administrador del dominio debe permitirla.</li>
          </ol>
        </details>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Button
            loading={pending}
            onClick={async () => {
              const ok = await run(() => api.put("/reports/integrations", { googleEmail: email, senderName: sender, ...(password ? { googleAppPassword: password } : {}) }), {
                success: "Cuenta de Google guardada",
                invalidate,
              });
              if (ok) setPassword("");
            }}
          >
            <Save /> Guardar cuenta
          </Button>
          <div className="flex items-end gap-2">
            <Field label="Enviar correo de prueba a">
              <Input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} className="w-64" />
            </Field>
            <Button variant="outline" disabled={!ready || pending} onClick={() => run(() => api.post("/reports/integrations/test-email", { to: testTo }), { success: `Correo de prueba enviado a ${testTo}` })}>
              <Send /> Probar
            </Button>
          </div>
        </div>
        {data.smtpFromEnv && <p className="text-xs text-muted-foreground">Mientras no cargues una cuenta aquí, se usa el SMTP configurado en el servidor.</p>}
      </CardContent>
    </Card>
  );
}

function CrmCard({ data }: { data: Integrations }) {
  const { run, pending } = useAction();
  const [url, setUrl] = React.useState(data.crmExportUrl);
  const [company, setCompany] = React.useState(String(data.crmCompanyId));
  const [key, setKey] = React.useState("");
  const [campaign, setCampaign] = React.useState("4");
  return (
    <Card>
      <CardHeader>
        <div className="grid gap-1">
          <CardTitle className="flex items-center gap-2">
            <Database className="size-4" /> API de ventas del CRM
            {data.crmDemo ? <Badge variant="warning" dot>Modo demo</Badge> : data.crmApiKeySet ? <Badge variant="success" dot>Lista</Badge> : <Badge variant="warning" dot>Falta la API key</Badge>}
          </CardTitle>
          <CardDescription>De aquí salen los datos de todos los reportes.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {data.crmDemo && <p className="rounded-md bg-warning/12 px-3 py-2 text-13 text-warning">El servidor está en modo demo (CRM_DEMO=1): los reportes usan ventas ficticias. Quítalo del .env en producción.</p>}
        <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
          <Field label="URL del export de ventas">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} />
          </Field>
          <Field label="Empresa (id)">
            <Input type="number" min={1} value={company} onChange={(e) => setCompany(e.target.value)} />
          </Field>
        </div>
        <SecretField label="API key (x-api-key)" isSet={data.crmApiKeySet} value={key} onChange={setKey} />
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Button
            loading={pending}
            onClick={async () => {
              const ok = await run(() => api.put("/reports/integrations", { crmExportUrl: url, crmCompanyId: Number(company), ...(key ? { crmApiKey: key } : {}) }), { success: "Conexión al CRM guardada", invalidate });
              if (ok) setKey("");
            }}
          >
            <Save /> Guardar
          </Button>
          <div className="flex items-end gap-2">
            <Field label="Probar con la campaña">
              <Input type="number" value={campaign} onChange={(e) => setCampaign(e.target.value)} className="w-28" />
            </Field>
            <Button
              variant="outline"
              disabled={pending}
              onClick={async () => {
                const res = await run(() => api.post<{ total: number; ms: number }>("/reports/integrations/test-crm", { campaignId: campaign ? Number(campaign) : null }));
                if (res) toast.success(`El CRM respondió en ${res.ms} ms con ${res.total} ventas`);
              }}
            >
              <CheckCircle2 /> Probar
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function WhatsAppCard({ data }: { data: Integrations }) {
  const { run, pending } = useAction();
  const confirm = useConfirm();
  const [url, setUrl] = React.useState(data.evolutionUrl);
  const [instance, setInstance] = React.useState(data.evolutionInstance);
  const [key, setKey] = React.useState("");
  const configured = !!data.evolutionUrl && (data.evolutionApiKeySet || data.evolutionUrl === "mock");
  const { data: qr } = useQuery({
    queryKey: ["reports", "whatsapp"],
    queryFn: () => api.get<{ state: string; qr: string | null; error?: string }>("/reports/whatsapp"),
    enabled: configured,
    refetchInterval: (q) => (q.state.data?.state === "connected" ? 30_000 : 5_000),
  });

  return (
    <Card>
      <CardHeader>
        <div className="grid gap-1">
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="size-4" /> WhatsApp (Evolution API)
            {qr?.state === "connected" ? <Badge variant="success" dot>Conectado</Badge> : <Badge variant="warning" dot>{configured ? "Sin vincular" : "Sin configurar"}</Badge>}
          </CardTitle>
          <CardDescription>Para enviar la imagen de los reportes a números y grupos.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[1fr_auto]">
        <div className="grid content-start gap-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
            <Field label="URL de Evolution API">
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://evolution.tu-servidor.com" />
            </Field>
            <Field label="Instancia">
              <Input value={instance} onChange={(e) => setInstance(e.target.value)} />
            </Field>
          </div>
          <SecretField label="API key global" isSet={data.evolutionApiKeySet} value={key} onChange={setKey} />
          <div className="flex flex-wrap gap-2">
            <Button
              loading={pending}
              onClick={async () => {
                const ok = await run(() => api.put("/reports/integrations", { evolutionUrl: url, evolutionInstance: instance, ...(key ? { evolutionApiKey: key } : {}) }), {
                  success: "Conexión de WhatsApp guardada",
                  invalidate: [...invalidate, ["reports", "whatsapp"]],
                });
                if (ok) setKey("");
              }}
            >
              <Save /> Guardar
            </Button>
            {configured && (
              <Button
                variant="outline"
                disabled={pending}
                onClick={async () => {
                  if (await confirm({ title: "¿Reiniciar la sesión de WhatsApp?", description: "Se cierra la sesión actual y habrá que escanear un QR nuevo desde el teléfono.", confirmText: "Reiniciar", destructive: true }))
                    run(() => api.post("/reports/whatsapp/reset"), { success: "Sesión reiniciada: escanea el nuevo QR", invalidate: [["reports", "whatsapp"]] });
                }}
              >
                <RotateCcw /> Reiniciar sesión
              </Button>
            )}
          </div>
        </div>
        {configured && (
          <div className="grid w-56 justify-items-center gap-2 rounded-lg border bg-surface/60 p-4 text-center">
            {qr?.state === "connected" ? (
              <>
                <CheckCircle2 className="size-10 text-success" />
                <p className="text-13 font-medium">Teléfono vinculado</p>
              </>
            ) : qr?.qr ? (
              <>
                <img src={qr.qr} alt="Código QR de WhatsApp" className="size-44 rounded bg-white p-2" />
                <p className="text-xs text-muted-foreground">WhatsApp → Dispositivos vinculados → Vincular un dispositivo</p>
              </>
            ) : (
              <p className="text-13 text-muted-foreground">{qr?.error ?? "Generando QR…"}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ConnectionsTab() {
  const { data } = useQuery({ queryKey: ["reports", "integrations"], queryFn: () => api.get<Integrations>("/reports/integrations") });
  if (!data) return null;
  return (
    <div className="grid gap-4">
      <GoogleCard data={data} />
      <CrmCard data={data} />
      <WhatsAppCard data={data} />
    </div>
  );
}
