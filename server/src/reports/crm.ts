import { getIntegrations } from "./config.js";
import { limaToday } from "./time.js";

/** Una venta tal como la devuelve /api/export/sales del CRM (solo los campos que usan los reportes) */
export type Sale = {
  status?: string;
  sale_date?: string;
  updated_at?: string;
  cabecera_f_instalacion?: string;
  supervisor?: string;
  agent?: string;
  cliente_nombre_del_cliente?: string;
  cliente_nro_de_documento?: string;
  cliente_provincia?: string;
  producto_compania?: string;
  contraoferta_estado?: string;
  contraoferta_bo?: string;
  fidelizacion_estado?: string;
  fidelizacion_bo?: string;
  [key: string]: unknown;
};

export async function fetchSales(campaignId: number | null): Promise<Sale[]> {
  const { crm } = await getIntegrations();
  if (crm.demo) return demoSales();
  if (!crm.apiKey) throw new Error("Falta la API key del CRM: cárgala en Centro de Reportes → Conexiones.");
  const url = new URL(crm.exportUrl);
  url.searchParams.set("company_id", String(crm.companyId));
  if (campaignId) url.searchParams.set("campaign_id", String(campaignId));
  url.searchParams.set("limit", "5000");
  let res: Response;
  try {
    res = await fetch(url, { headers: { "x-api-key": crm.apiKey, Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    throw new Error(`No se pudo conectar con el CRM: ${(err as Error).message}`);
  }
  if (!res.ok) throw new Error(`El CRM respondió ${res.status} ${res.statusText}`);
  const json = (await res.json()) as { data?: Sale[] };
  return Array.isArray(json.data) ? json.data : [];
}

// ── Datos ficticios para desarrollo (CRM_DEMO=1) ──

const SUPERVISORS = ["Rosa Villanueva", "Carlos Mendoza", "Patricia Salas"];
const AGENTS = ["Diego Huamán", "Milagros Quispe", "Kevin Paredes", "Ana Torres", "Luis Ramírez", "Sofía Cárdenas", "Jorge Flores"];
const CLIENTS = ["María García López", "Antonio Fernández Ruiz", "Lucía Martínez Gil", "Javier Sánchez Moreno", "Carmen Romero Díaz", "Pablo Navarro Ortiz", "Elena Torres Vidal", "Sergio Molina Castro", "Laura Ortega Rubio", "David Delgado Marín", "Isabel Castillo Pardo", "Manuel Iglesias Soto"];
const PROVINCES = ["Madrid", "Barcelona", "Valencia", "Sevilla", "Málaga", "Zaragoza", "Murcia", "Alicante"];
const COMPANIES = ["Vodafone", "Yoigo", "Lowi", "Orange", "DIGI"];
const STATUSES = ["PDT DE INSTALAR", "INSTALADO", "EN PROCESO", "CANCELADO", "PDT DE INSTALAR", "EN PROCESO"];
const MANAGEMENT = ["OK", "OK", "Recuperado", "No contesta", "Volver a llamar", "Sin seguimiento"];

function demoSales(): Sale[] {
  // Semilla fija por día: la vista previa y el envío muestran los mismos datos
  let seed = Number(limaToday().replace(/-/g, ""));
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)]!;
  const today = limaToday();
  const sales: Sale[] = [];
  for (let i = 0; i < 46; i++) {
    const daysAgo = i < 26 ? 0 : Math.floor(rand() * 20);
    const saleDate = new Date(Date.parse(`${today}T13:00:00Z`) - daysAgo * 86_400_000 + Math.floor(rand() * 9) * 3_600_000);
    const install = new Date(saleDate.getTime() + (2 + Math.floor(rand() * 6)) * 86_400_000);
    sales.push({
      status: pick(STATUSES),
      sale_date: saleDate.toISOString(),
      updated_at: new Date(saleDate.getTime() + Math.floor(rand() * 4) * 3_600_000).toISOString(),
      cabecera_f_instalacion: install.toISOString().slice(0, 10),
      supervisor: pick(SUPERVISORS),
      agent: pick(AGENTS),
      cliente_nombre_del_cliente: pick(CLIENTS),
      cliente_nro_de_documento: `${10000000 + Math.floor(rand() * 89999999)}${"TRWAGMYFPDXBNJZSQVHLCKE"[i % 23]}`,
      cliente_provincia: pick(PROVINCES),
      producto_compania: pick(COMPANIES),
      contraoferta_estado: pick(MANAGEMENT),
      contraoferta_bo: pick(["Lucía Ramos", "Walter Rosario", "-"]),
      fidelizacion_estado: pick(MANAGEMENT),
      fidelizacion_bo: pick(["Lucía Ramos", "Walter Rosario", "-"]),
    });
  }
  return sales;
}
