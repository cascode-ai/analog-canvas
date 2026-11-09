import {
  browserLaunchProofText,
  BROWSER_LAUNCH_TTL_MS,
  DEVICE_TRUST_PATH,
} from "@icm/agent-adapter/browser-launch";
import { sessionUserOf } from "./auth";
import type {
  AgentSessionRouterEnv,
  DurableStorageLike,
} from "./agent-session-runtime";

export const DEVICE_TRUST_INTERNAL = "/device-trust/";
const DEVICE_ID = /^[a-f0-9]{64}$/u;
const MAX_DEVICES = 16;
const MAX_SESSIONS = 32;
const DEVICE_TASK_LEASE_MS = 60 * 60_000;
const DEVICES_KEY = "agent-trusted-devices";

export type DeviceTrustLink = {
  directory: string;
  deviceId: string;
  trustId: string;
};

type DeviceEntry = {
  id: string;
  trustId: string;
  trustedAt: number;
  pendingUntil?: number;
  sessions: { id: string; expiresAt: number }[];
};

type DeviceRequest = {
  action: "auto" | "trust" | "commit" | "check" | "remove-session";
  deviceId: string;
  trustId?: string;
  sessionId?: string;
};

function base64UrlBytes(value: string, length: number) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return;
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  if (
    binary.length !== length ||
    btoa(binary)
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/u, "") !== value
  )
    return;
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function digest(text: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function verifyLaunchDevice(
  origin: string,
  sessionId: string,
  grant: string,
  publicKey: string,
  signature: string,
): Promise<string | undefined> {
  try {
    const key = base64UrlBytes(publicKey, 32);
    const proof = base64UrlBytes(signature, 64);
    if (!key || !proof) return;
    const verifier = await crypto.subtle.importKey(
      "raw",
      key,
      "Ed25519",
      false,
      ["verify"],
    );
    const text = new TextEncoder().encode(
      browserLaunchProofText(origin, sessionId, grant),
    );
    if (await crypto.subtle.verify("Ed25519", verifier, proof, text))
      return digest(publicKey);
  } catch {
    // An invalid proof grants no device authority.
  }
}

export async function deviceTrustDirectory(
  request: Request,
  env: AgentSessionRouterEnv,
) {
  const user = await sessionUserOf(request, env);
  if (!user) return null;
  const key = await digest(
    JSON.stringify([new URL(request.url).origin, user.id]),
  );
  return `agent-device-trust-${key}`;
}

/** Runs in an account-and-origin DO, separate from every circuit session. */
export class AgentDeviceTrustDirectory {
  private queue = Promise.resolve();

  constructor(private readonly storage: DurableStorageLike) {}

  handle(request: Request): Promise<Response> {
    const next = this.queue.then(() => this.handleSerial(request));
    this.queue = next.then(
      () => {},
      () => {},
    );
    return next;
  }

  private async handleSerial(request: Request) {
    const path = new URL(request.url).pathname.slice(
      DEVICE_TRUST_INTERNAL.length,
    );
    const now = Date.now();
    const entries = (
      (await this.storage.get<DeviceEntry[]>(DEVICES_KEY)) ?? []
    ).filter((entry) => !entry.pendingUntil || entry.pendingUntil > now);
    const reply = (data: unknown, status = 200) =>
      Response.json(data, { status });
    if (request.method === "GET" && path === "list")
      return reply({
        devices: entries
          .filter((entry) => !entry.pendingUntil)
          .map(({ id, trustedAt }) => ({ id, trustedAt })),
      });
    if (request.method === "DELETE" && DEVICE_ID.test(path)) {
      const entry = entries.find(({ id }) => id === path);
      if (!entry) return reply({ sessions: [] });
      await this.storage.put(
        DEVICES_KEY,
        entries.filter(({ id }) => id !== path),
      );
      return reply({
        sessions: entry.sessions
          .filter((session) => session.expiresAt > now)
          .map(({ id }) => id),
        trustId: entry.trustId,
      });
    }
    if (request.method !== "POST" || path !== "grant")
      return reply({ error: "Invalid device request" }, 400);
    const input = (await request.json()) as DeviceRequest;
    if (!input || !DEVICE_ID.test(input.deviceId))
      return reply({ error: "Invalid device proof" }, 400);
    let entry = entries.find(({ id }) => id === input.deviceId);
    if (input.action === "check") {
      if (!entry || entry.pendingUntil || entry.trustId !== input.trustId)
        return reply({ trusted: false });
      const session = entry.sessions.find(({ id }) => id === input.sessionId);
      if (session && session.expiresAt - now < DEVICE_TASK_LEASE_MS / 2) {
        session.expiresAt = now + DEVICE_TASK_LEASE_MS;
        await this.storage.put(DEVICES_KEY, entries);
      }
      return reply({ trusted: true });
    }
    if (input.action === "commit") {
      if (
        !entry ||
        entry.trustId !== input.trustId ||
        !entry.sessions.some(({ id }) => id === input.sessionId)
      )
        return reply(
          { error: "Pending device authorization expired or was revoked" },
          409,
        );
      delete entry.pendingUntil;
      await this.storage.put(DEVICES_KEY, entries);
      return reply({ ok: true });
    }
    if (input.action === "remove-session") {
      if (entry && entry.trustId === input.trustId) {
        entry.sessions = entry.sessions.filter(
          ({ id }) => id !== input.sessionId,
        );
        await this.storage.put(
          DEVICES_KEY,
          entries.filter(
            (candidate) =>
              candidate !== entry ||
              !entry.pendingUntil ||
              entry.sessions.length > 0,
          ),
        );
      }
      return reply({ ok: true });
    }
    if (
      !input.sessionId ||
      (input.action !== "trust" && input.action !== "auto")
    )
      return reply({ error: "Invalid device authorization" }, 400);
    if (input.action === "auto" && (!entry || entry.pendingUntil))
      return reply({ error: "Device is not trusted for this account" }, 403);
    if (!entry) {
      if (entries.length >= MAX_DEVICES)
        return reply({ error: "Revoke a trusted device first" }, 409);
      entry = {
        id: input.deviceId,
        trustId: crypto.randomUUID(),
        trustedAt: Date.now(),
        pendingUntil: now + BROWSER_LAUNCH_TTL_MS,
        sessions: [],
      };
      entries.push(entry);
    }
    entry.sessions = entry.sessions.filter(
      (session) => session.expiresAt > now,
    );
    if (!entry.sessions.some(({ id }) => id === input.sessionId)) {
      if (entry.sessions.length >= MAX_SESSIONS)
        return reply({ error: "Too many active tasks from this device" }, 409);
      entry.sessions.push({
        id: input.sessionId,
        expiresAt: now + DEVICE_TASK_LEASE_MS,
      });
      await this.storage.put(DEVICES_KEY, entries);
    }
    return reply({
      trustId: entry.trustId,
      pending: Boolean(entry.pendingUntil),
    });
  }
}

export async function routeTrustedDevices(
  request: Request,
  env: AgentSessionRouterEnv,
) {
  const url = new URL(request.url);
  const deviceId = url.pathname.slice(DEVICE_TRUST_PATH.length + 1);
  const revoke = request.method === "DELETE";
  const headers = { "cache-control": "no-store" };
  if (
    (revoke &&
      (!DEVICE_ID.test(deviceId) ||
        request.headers.get("origin") !== url.origin ||
        request.headers.get("sec-fetch-site") !== "same-origin")) ||
    (!revoke &&
      (request.method !== "GET" || url.pathname !== DEVICE_TRUST_PATH))
  )
    return new Response(null, { status: 403, headers });
  const directory = await deviceTrustDirectory(request, env);
  if (!directory) return new Response(null, { status: 401, headers });
  const response = await env.AGENT_SESSION.getByName(directory).fetch(
    `https://agent-session.internal${DEVICE_TRUST_INTERNAL}${revoke ? deviceId : "list"}`,
    { method: request.method },
  );
  if (!response.ok) return new Response(null, { status: 503, headers });
  if (!revoke) return Response.json(await response.json(), { headers });
  const result = (await response.json()) as {
    sessions: string[];
    trustId?: string;
  };
  await Promise.allSettled(
    result.sessions.map((sessionId) =>
      env.AGENT_SESSION.getByName(sessionId).fetch(
        "https://agent-session.internal/revoke-trusted-device",
        {
          method: "POST",
          body: JSON.stringify({
            directory,
            deviceId,
            trustId: result.trustId,
          }),
        },
      ),
    ),
  );
  return new Response(null, { status: 204, headers });
}
