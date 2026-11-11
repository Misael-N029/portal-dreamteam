import type { Request } from "express";

/** IP del cliente. Nginx la envía en X-Real-IP / X-Forwarded-For y Express confía en el proxy local. */
export function clientIp(req: Request) {
  const ip = req.ip ?? req.socket.remoteAddress ?? "";
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

const toInt = (ip: string) => {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
};

/** Una entrada es una IP exacta (IPv4 o IPv6) o un rango IPv4 en notación CIDR (190.12.4.0/24) */
export function isValidIpRule(rule: string) {
  const [base, bits] = rule.split("/");
  if (bits !== undefined) return toInt(base!) !== null && /^\d+$/.test(bits) && Number(bits) <= 32;
  return toInt(rule) !== null || /^[0-9a-f:]+$/i.test(rule);
}

export function ipAllowed(ip: string, rules: string[]) {
  if (ip === "127.0.0.1" || ip === "::1") return true;
  const value = toInt(ip);
  return rules.some((rule) => {
    const [base, bits] = rule.split("/");
    if (bits === undefined) return rule.toLowerCase() === ip.toLowerCase();
    const start = toInt(base!);
    if (start === null || value === null) return false;
    const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
    return (value & mask) === (start & mask);
  });
}
