import { chromium, type Browser, type Page } from "playwright";
import { env } from "../lib/env.js";

export type Target = {
  url: string;
  loginUrl?: string | null;
  username?: string | null;
  password?: string | null;
  usernameSelector?: string | null;
  passwordSelector?: string | null;
  submitSelector?: string | null;
};

type Log = (level: "INFO" | "WARNING" | "ERROR", message: string) => Promise<void>;

async function withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
  let browser: Browser;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: env.chromePath,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
  } catch (err) {
    throw new Error(
      `No se pudo abrir Chromium: ${(err as Error).message.split("\n")[0]}. En el VPS ejecuta "npx playwright install --with-deps chromium" o define CHROME_PATH.`,
    );
  }
  try {
    return await fn(browser);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/** Convierte el HTML del reporte en una imagen PNG del tamaño exacto del contenido */
export function htmlToPng(html: string): Promise<Buffer> {
  return withBrowser(async (browser) => {
    const page = await browser.newPage({ viewport: { width: 948, height: 800 }, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "load" });
    return page.locator("#report").screenshot({ type: "png" });
  });
}

async function login(page: Page, t: Target, log: Log) {
  if (!t.loginUrl) return;
  await log("INFO", `Iniciando sesión en ${new URL(t.loginUrl).host}`);
  await page.goto(t.loginUrl, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);
  await page.waitForTimeout(800);
  if (!/login|signin|ingresar/i.test(page.url())) return; // ya hay sesión
  if (!t.username || !t.password) {
    await log("WARNING", "La página pide login pero el reporte no tiene usuario y contraseña");
    return;
  }
  const user = page.locator(t.usernameSelector || 'input[type="email"], input[name="email"], input[name="username"], input[type="text"]').first();
  const pass = page.locator(t.passwordSelector || 'input[type="password"]').first();
  await user.waitFor({ state: "visible", timeout: 10_000 });
  await user.fill(t.username);
  await pass.fill(t.password);
  const submit = page.locator(t.submitSelector || 'button[type="submit"], input[type="submit"], button:has-text("Ingresar"), button:has-text("Iniciar")').first();
  if (await submit.isVisible().catch(() => false)) await submit.click();
  else await pass.press("Enter");
  await page.waitForURL((u) => !/login|signin/i.test(u.pathname), { timeout: 15_000 }).catch(() => undefined);
  if (/login|signin/i.test(page.url())) throw new Error("El login no avanzó: revisa usuario, contraseña o selectores");
  await page.waitForTimeout(1500);
}

/** Captura cada URL (iniciando sesión antes si hace falta). Devuelve las capturas que salieron bien. */
export function captureTargets(targets: Target[], log: Log): Promise<{ url: string; image: Buffer }[]> {
  return withBrowser(async (browser) => {
    const context = await browser.newContext({ viewport: { width: 1366, height: 860 }, deviceScaleFactor: 1 });
    context.setDefaultTimeout(20_000);
    const out: { url: string; image: Buffer }[] = [];
    for (const [i, t] of targets.entries()) {
      const page = await context.newPage();
      try {
        await log("INFO", `Captura ${i + 1}/${targets.length}: ${t.url}`);
        await login(page, t, log);
        if (page.url().replace(/\/$/, "") !== t.url.replace(/\/$/, "")) {
          await page.goto(t.url, { waitUntil: "networkidle", timeout: 25_000 }).catch(() => page.goto(t.url, { waitUntil: "domcontentloaded" }));
        }
        await page.waitForTimeout(2000);
        out.push({ url: t.url, image: await page.screenshot({ fullPage: true, type: "png" }) });
      } catch (err) {
        await log("ERROR", `No se pudo capturar ${t.url}: ${(err as Error).message.split("\n")[0]}`);
      } finally {
        await page.close().catch(() => undefined);
      }
    }
    return out;
  });
}
