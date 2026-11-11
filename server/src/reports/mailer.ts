import nodemailer, { type Transporter } from "nodemailer";
import { getIntegrations, type Integrations } from "./config.js";

const isMock = (smtp: Integrations["smtp"]) => smtp.host === "mock";
export const emailReady = (smtp: Integrations["smtp"]) => isMock(smtp) || !!(smtp.host && smtp.user && smtp.pass);

let transport: { key: string; t: Transporter } | null = null;

export async function sendEmail(mail: { to: string[]; subject: string; html: string; attachments?: { filename: string; content: Buffer; cid?: string }[] }) {
  const { smtp } = await getIntegrations();
  if (!emailReady(smtp)) throw new Error("El correo no está configurado: carga la cuenta de Google en Centro de Reportes → Conexiones.");
  if (isMock(smtp)) {
    await new Promise((r) => setTimeout(r, 300));
    return;
  }
  // Se recrea si cambió la cuenta desde el portal
  const key = `${smtp.host}|${smtp.port}|${smtp.user}|${smtp.pass}`;
  if (transport?.key !== key) {
    transport = {
      key,
      t: nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.port === 465, auth: { user: smtp.user, pass: smtp.pass } }),
    };
  }
  try {
    // Un solo correo con todos en "Para", como el Apps Script
    await transport.t.sendMail({ from: smtp.from, to: mail.to.join(", "), subject: mail.subject, html: mail.html, attachments: mail.attachments });
  } catch (err) {
    const msg = (err as Error).message;
    if (/Invalid login|535|Username and Password not accepted/i.test(msg)) {
      throw new Error("Google rechazó el acceso: usa una contraseña de aplicación (no la contraseña normal) y verifica que la cuenta tenga la verificación en dos pasos activa.");
    }
    throw new Error(`No se pudo enviar el correo: ${msg}`);
  }
}
