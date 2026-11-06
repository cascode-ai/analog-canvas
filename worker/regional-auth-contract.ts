import type { SessionUser, SqlStorage } from "./auth-do";

export const REGIONAL_PREFIX = "/api/auth/regional/";
export const REGIONAL_SESSION_COOKIE = "icm_regional_session";
export const REGIONAL_LEASE_MS = 60_000;
export const REGIONAL_HANDOFF_MS = 60_000;
export const REGIONAL_REFRESH_MS = 30_000;
export type RegionalSql = SqlStorage;
export type RegionalConfig = {
  origin: string;
  clientOrigin: string;
  /** Fixed authority backend; independent of browser geographic routing. */
  transportOrigin?: string;
  secret: string;
};

export function regionalConfig(
  value: string | undefined,
): RegionalConfig | null {
  try {
    const config = JSON.parse(value ?? "null") as RegionalConfig | null;
    if (
      !config ||
      typeof config.secret !== "string" ||
      config.secret.length < 32 ||
      config.secret.length > 256
    )
      return null;
    for (const origin of [
      config.origin,
      config.clientOrigin,
      ...(config.transportOrigin === undefined ? [] : [config.transportOrigin]),
    ]) {
      const url = new URL(origin);
      if (url.origin !== origin || url.username || url.password) return null;
      if (
        url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        )
      )
        return null;
    }
    const transport = config.transportOrigin ?? config.origin;
    return transport !== config.clientOrigin ? config : null;
  } catch {
    return null;
  }
}

/** Exact browser routes the domestic entry may proxy to the fixed authority. */
export function isRegionalAuthorityBrowserRoute(
  method: string,
  path: string,
): boolean {
  return [
    "GET /api/auth/regional/authorize",
    "GET /api/auth/github/start",
    "GET /api/auth/github/callback",
    "GET /api/auth/google/start",
    "GET /api/auth/google/callback",
    "POST /api/auth/email/start",
    "POST /api/auth/email/verify",
  ].includes(method + " " + path);
}

/** Account operations delegated by a regional session, never by a browser proxy. */
export function isRegionalAccountRoute(method: string, path: string): boolean {
  if (
    method === "DELETE" &&
    /^\/api\/auth\/owner-tokens\/[a-zA-Z0-9-]{1,64}$/u.test(path)
  )
    return true;
  return [
    "POST /api/auth/profile",
    "POST /api/auth/users/role",
    "GET /api/auth/admin/stats",
    "GET /api/auth/owner-tokens",
    "POST /api/auth/owner-tokens",
    "GET /api/auth/ai-accounts",
    "POST /api/auth/ai-accounts/switch",
    "POST /api/auth/ai-accounts/return",
    "GET /api/auth/blocked",
    "POST /api/auth/blocked/unblock",
    "POST /api/auth/blocked/apology",
    "POST /api/auth/blocked/notify",
  ].includes(method + " " + path);
}

/** Resource/maintenance calls on the trusted AUTH binding, never browser routes. */
export function isRegionalSecurityRoute(method: string, path: string): boolean {
  return (
    method === "POST" &&
    [
      "/internal/block-account",
      "/internal/block-notices",
      "/internal/gallery-rejection",
    ].includes(path)
  );
}

export function nonce(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}
function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}
export async function digest(value: string): Promise<string> {
  return base64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  );
}
export function validNonce(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/u.test(value);
}
export function cookie(request: Request, name: string): string | undefined {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(name + "="))
    ?.slice(name.length + 1);
}
export function setCookie(
  name: string,
  value: string,
  origin: string,
  seconds: number,
): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${origin.startsWith("https:") ? "; Secure" : ""}`;
}
export function answer(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}
export function redirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      location,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}
export function sessionIdentity(value: unknown): SessionUser | null {
  if (!value || typeof value !== "object") return null;
  const user = value as SessionUser;
  if (
    ![user.id, user.provider].every(
      (v) => typeof v === "string" && v.length > 0 && v.length <= 256,
    ) ||
    typeof user.displayName !== "string" ||
    user.displayName.length > 256 ||
    !(
      user.email === null ||
      (typeof user.email === "string" && user.email.length <= 254)
    ) ||
    !["user", "moderator"].includes(user.role) ||
    typeof user.isAdmin !== "boolean" ||
    !(user.isOwner === undefined || user.isOwner === true) ||
    !(user.blocked === undefined || user.blocked === true) ||
    !(
      user.seat === undefined ||
      (typeof user.seat === "string" && user.seat.length <= 100)
    ) ||
    !(
      user.switchedFrom === undefined ||
      (user.seat &&
        typeof user.switchedFrom === "object" &&
        user.switchedFrom !== null &&
        typeof user.switchedFrom.displayName === "string" &&
        user.switchedFrom.displayName.length <= 256 &&
        typeof user.switchedFrom.id === "string" &&
        user.switchedFrom.id.length > 0 &&
        user.switchedFrom.id.length <= 256 &&
        user.switchedFrom.id !== user.id)
    )
  )
    return null;
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    provider: user.provider,
    role: user.role,
    isAdmin: user.isAdmin,
    ...(user.isOwner ? { isOwner: true } : {}),
    ...(user.blocked ? { blocked: true } : {}),
    ...(user.seat ? { seat: user.seat } : {}),
    ...(user.switchedFrom?.id
      ? {
          switchedFrom: {
            id: user.switchedFrom.id,
            displayName: user.switchedFrom.displayName,
          },
        }
      : {}),
  };
}

export async function authenticated(
  request: Request,
  secret: string,
): Promise<boolean> {
  const header = request.headers.get("authorization") ?? "";
  if (header.length > 512) return false;
  const a = await digest(header);
  const b = await digest("Bearer " + secret);
  let difference = 0;
  for (let i = 0; i < a.length; i++)
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

export async function readBody(
  request: Pick<Request, "body">,
): Promise<Record<string, unknown> | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 16_384) {
        await reader.cancel();
        return null;
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
