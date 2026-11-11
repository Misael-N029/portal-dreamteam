import { getIntegrations, type Integrations } from "./config.js";

/** Cliente de Evolution API (WhatsApp vía Baileys) para la instancia configurada en EVOLUTION_INSTANCE */

export type WhatsAppState = "connected" | "connecting" | "disconnected" | "not_configured" | "error";

type Evo = Integrations["evolution"];

/** Solo desarrollo (EVOLUTION_API_URL=mock): simula una instancia conectada y envíos exitosos */
const isMock = (e: Evo) => e.url === "mock";
const ready = (e: Evo) => isMock(e) || !!(e.url && e.apiKey);

async function call(path: string, init: RequestInit = {}, timeoutMs = 15_000) {
  const { evolution: e } = await getIntegrations();
  if (!ready(e)) throw new Error("WhatsApp no está configurado: carga la Evolution API en Centro de Reportes → Conexiones.");
  return fetch(`${e.url}${path.replace("{instance}", encodeURIComponent(e.instance))}`, {
    ...init,
    headers: { "Content-Type": "application/json", apikey: e.apiKey!, ...init.headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function createInstance() {
  const { evolution: e } = await getIntegrations();
  const res = await call("/instance/create", {
    method: "POST",
    body: JSON.stringify({ instanceName: e.instance, qrcode: true, integration: "WHATSAPP-BAILEYS" }),
  });
  if (!res.ok) throw new Error(`No se pudo crear la instancia de WhatsApp: ${await res.text()}`);
}

export async function whatsappState(): Promise<{ state: WhatsAppState; error?: string }> {
  const { evolution: e } = await getIntegrations();
  if (!ready(e)) return { state: "not_configured" };
  if (isMock(e)) return { state: "connected" };
  try {
    const res = await call(`/instance/connectionState/{instance}`, {}, 8_000);
    if (res.status === 404) return { state: "disconnected" };
    if (!res.ok) return { state: "error", error: `Evolution API respondió ${res.status}` };
    const data = (await res.json()) as { instance?: { state?: string } };
    const s = data.instance?.state;
    return { state: s === "open" ? "connected" : s === "connecting" ? "connecting" : "disconnected" };
  } catch (err) {
    return { state: "error", error: (err as Error).message };
  }
}

let qrCache: { qr: string; at: number } | null = null;

/** Estado y, si no está conectado, el QR para vincular (se reutiliza 25 s para no regenerar la sesión) */
export async function whatsappQr(): Promise<{ state: WhatsAppState; qr: string | null; error?: string }> {
  const current = await whatsappState();
  if (current.state === "connected" || current.state === "not_configured") {
    qrCache = null;
    return { ...current, qr: null };
  }
  if (qrCache && Date.now() - qrCache.at < 25_000) return { state: "connecting", qr: qrCache.qr };
  try {
    let res = await call(`/instance/connect/{instance}`);
    if (res.status === 404) {
      await createInstance();
      res = await call(`/instance/connect/{instance}`);
    }
    const data = (await res.json().catch(() => ({}))) as { base64?: string };
    if (data.base64) qrCache = { qr: data.base64, at: Date.now() };
    return { state: "connecting", qr: data.base64 ?? qrCache?.qr ?? null };
  } catch (err) {
    return { state: "error", qr: null, error: (err as Error).message };
  }
}

/** Borra la sesión y crea una instancia limpia (pedirá escanear un QR nuevo) */
export async function whatsappReset() {
  if (isMock((await getIntegrations()).evolution)) return;
  await call(`/instance/logout/{instance}`, { method: "DELETE" }).catch(() => undefined);
  await call(`/instance/delete/{instance}`, { method: "DELETE" }).catch(() => undefined);
  qrCache = null;
  await new Promise((r) => setTimeout(r, 1500));
  await createInstance();
}

/** Número sin "+" ni espacios; los grupos (…@g.us) se envían tal cual */
export const normalizeRecipient = (value: string) => (value.includes("@") ? value.trim() : value.replace(/\D/g, ""));

export async function sendMedia(to: string, file: { data: Buffer; fileName: string; type: "image" | "document"; caption: string }) {
  if (isMock((await getIntegrations()).evolution)) {
    await new Promise((r) => setTimeout(r, 400));
    return;
  }
  const res = await call(
    `/message/sendMedia/{instance}`,
    {
      method: "POST",
      body: JSON.stringify({
        number: normalizeRecipient(to),
        mediatype: file.type,
        mimetype: file.type === "image" ? "image/png" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        media: file.data.toString("base64"),
        fileName: file.fileName,
        caption: file.caption,
      }),
    },
    60_000,
  );
  if (!res.ok) throw new Error(`Evolution API respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
