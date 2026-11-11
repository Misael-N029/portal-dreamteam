import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { env } from "./env.js";

/**
 * Cifrado reversible para las contraseñas asignadas por un administrador (las que se ven con el ojito).
 * La clave sale de PASSWORD_VAULT_KEY (o, si falta, del JWT_SECRET).
 * Al descifrar se prueba también la clave derivada del JWT_SECRET: así, definir PASSWORD_VAULT_KEY en una
 * instalación que venía usando el respaldo no deja ilegibles las contraseñas ya guardadas (AES-GCM detecta la clave errónea).
 */
const derive = (secret: string) => scryptSync(secret, "portal-dreamteam-vault", 32);
const key = derive(env.passwordVaultKey);
const legacyKeys = env.passwordVaultKey !== env.jwtSecret ? [derive(env.jwtSecret)] : [];

export function encryptPassword(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

function tryDecrypt(k: Buffer, iv: Buffer, tag: Buffer, data: Buffer) {
  const decipher = createDecipheriv("aes-256-gcm", k, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function decryptPassword(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const parts = stored.split(".").map((p) => Buffer.from(p, "base64"));
  if (parts.length !== 3) return null;
  const [iv, tag, data] = parts as [Buffer, Buffer, Buffer];
  for (const k of [key, ...legacyKeys]) {
    try {
      return tryDecrypt(k, iv, tag, data);
    } catch {
      /* siguiente clave */
    }
  }
  return null;
}
