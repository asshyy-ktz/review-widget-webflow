import crypto from "crypto";

const SECRET = process.env.APP_SIGNING_SECRET || "dev-secret-change-me";

function hmac(data: string, len = 32): string {
  return crypto.createHmac("sha256", SECRET).update(data).digest("hex").slice(0, len);
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function newId(): string {
  return crypto.randomUUID();
}
export function newPublicKey(): string {
  return crypto.randomBytes(12).toString("hex");
}
export function newAdminToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

/** Keyed hash so raw emails / IPs are never stored. */
export function hashValue(value: string): string {
  return hmac(value.trim().toLowerCase(), 48);
}
export function hashEmail(email: string): string {
  return email ? hashValue("email:" + email) : "";
}
export function hashIp(ip: string): string {
  return hashValue("ip:" + ip);
}
export function hashText(text: string): string {
  return crypto.createHash("sha256").update(text.toLowerCase().replace(/\s+/g, " ").trim()).digest("hex");
}

/** Signed payload token: base64url(json).signature. Payload must carry `exp` (epoch ms). */
export function signPayload(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${hmac(body)}`;
}

export function verifyPayload<T extends { exp: number }>(token: string): T | null {
  const [body, sig] = (token || "").split(".");
  if (!body || !sig || !safeEqual(sig, hmac(body))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf-8")) as T;
    if (typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Signed visitor id used in the rw_voter cookie. */
export function newVoterCookie(): { id: string; cookie: string } {
  const id = crypto.randomBytes(12).toString("hex");
  return { id, cookie: `${id}.${hmac("voter:" + id, 16)}` };
}
export function parseVoterCookie(value: string | undefined): string | null {
  if (!value) return null;
  const [id, sig] = value.split(".");
  if (!id || !sig || !safeEqual(sig, hmac("voter:" + id, 16))) return null;
  return id;
}
