import { regionalDeviceDirectory } from "./agent-regional-routing";
import {
  browserLaunchProofText,
  BROWSER_LAUNCH_TTL_MS,
  DEVICE_TRUST_PATH,
} from "@icm/agent-adapter/browser-launch";
import { sessionUserOf } from "./auth";
import {
  DEVICE_TRUST_INTERNAL,
  directory,
  directoryName,
  untrustDevice,
  type RemovedDevice,
} from "./agent-device-directory";
import type {
  AgentSessionNamespaceLike,
  AgentSessionRouterEnv,
  DurableStorageLike,
} from "./agent-session-runtime";
import { sha256Text } from "./sha256-text";

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
  /** What the installation calls itself: a label for people, not an authority. */
  name?: string;
  trustedAt: number;
  /** When the device last opened a task. */
  lastUsedAt?: number;
  pendingUntil?: number;
  sessions: { id: string; expiresAt: number }[];
};

type DeviceRequest = {
  action: "auto" | "trust" | "commit" | "check" | "remove-session";
  deviceId: string;
  trustId?: string;
  sessionId?: string;
  name?: string;
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

/** The launching installation's name, as Settings and the prompt show it. */
export function deviceLabel(value: string | null | undefined) {
  const label = value
    ?.replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 64);
  return label || undefined;
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
      return sha256Text(publicKey);
  } catch {
    // An invalid proof grants no device authority.
  }
}

export async function deviceTrustDirectory(
  request: Request,
  env: AgentSessionRouterEnv,
) {
  const user = await sessionUserOf(request, env);
  return user
    ? regionalDeviceDirectory(
        await directoryName(new URL(request.url).origin, user.id),
        env,
      )
    : null;
}

/** What one circuit session asks of the directory holding its device's trust. */
export class DeviceTrustClient {
  constructor(
    private readonly namespace: AgentSessionNamespaceLike | undefined,
  ) {}

  private grant(name: string, input: DeviceRequest) {
    if (!this.namespace) throw Error("Device trust is unavailable");
    return directory(this.namespace, name).fetch("grant", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /** Enroll a task with its device; a refusal carries the directory's status. */
  async enroll(
    name: string,
    device: { deviceId: string; action: "auto" | "trust"; label?: string },
    sessionId: string,
  ): Promise<{ link: DeviceTrustLink; pending: boolean } | { status: number }> {
    const response = await this.grant(name, {
      action: device.action,
      deviceId: device.deviceId,
      sessionId,
      ...(device.label ? { name: device.label } : {}),
    }).catch(() => null);
    if (!response?.ok) return { status: response?.status ?? 503 };
    const result = (await response.json()) as {
      trustId: string;
      pending: boolean;
    };
    return {
      link: {
        directory: name,
        deviceId: device.deviceId,
        trustId: result.trustId,
      },
      pending: result.pending,
    };
  }

  /** One task's standing with the device that opened it. */
  task(link: DeviceTrustLink, sessionId: string) {
    const send = (action: "commit" | "check" | "remove-session") =>
      this.grant(link.directory, {
        action,
        deviceId: link.deviceId,
        trustId: link.trustId,
        sessionId,
      });
    const namespace = this.namespace;
    return {
      /** Make a first trust standing once its task is approved. */
      async commit() {
        const response = await send("commit").catch(() => null);
        return { ok: response?.ok === true, status: response?.status ?? 503 };
      },
      /** Throws when the directory cannot answer; renews the task's lease. */
      async isCurrent() {
        const response = await send("check");
        if (!response.ok) throw Error("Device trust could not be verified");
        return (
          ((await response.json()) as { trusted: boolean }).trusted === true
        );
      },
      async leave() {
        await send("remove-session").catch(() => undefined);
      },
      /** The person in this task's tab stops trusting its device; the task ends itself. */
      untrust() {
        if (!namespace) return Promise.resolve(false);
        return untrustDevice(namespace, link.directory, link.deviceId, {
          trustId: link.trustId,
          except: sessionId,
        }).catch(() => false);
      },
    };
  }
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
    const url = new URL(request.url);
    const path = url.pathname.slice(DEVICE_TRUST_INTERNAL.length);
    const now = Date.now();
    const entries = (
      (await this.storage.get<DeviceEntry[]>(DEVICES_KEY)) ?? []
    ).filter((entry) => !entry.pendingUntil || entry.pendingUntil > now);
    const reply = (data: unknown, status = 200) =>
      Response.json(data, { status });
    const removed = (entry: DeviceEntry): RemovedDevice => ({
      deviceId: entry.id,
      trustId: entry.trustId,
      sessions: entry.sessions
        .filter((session) => session.expiresAt > now)
        .map(({ id }) => id),
    });
    if (request.method === "GET" && path === "list")
      return reply({
        devices: entries
          .filter((entry) => !entry.pendingUntil)
          .map(({ id, name, trustedAt, lastUsedAt }) => ({
            id,
            ...(name ? { name } : {}),
            trustedAt,
            ...(lastUsedAt ? { lastUsedAt } : {}),
          })),
      });
    if (request.method === "DELETE" && path === "all") {
      await this.storage.put(DEVICES_KEY, []);
      return reply({ devices: entries.map(removed) });
    }
    if (request.method === "DELETE" && DEVICE_ID.test(path)) {
      const trust = url.searchParams.get("trust");
      const entry = entries.find(
        ({ id, trustId }) => id === path && (!trust || trustId === trust),
      );
      if (!entry) return reply({ sessions: [] });
      await this.storage.put(
        DEVICES_KEY,
        entries.filter((candidate) => candidate !== entry),
      );
      const { trustId, sessions } = removed(entry);
      return reply({ sessions, trustId });
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
        trustedAt: now,
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
      entry.lastUsedAt = now;
      const name = deviceLabel(input.name);
      if (name) entry.name = name;
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
  const name = await deviceTrustDirectory(request, env);
  if (!name) return new Response(null, { status: 401, headers });
  if (revoke)
    return new Response(null, {
      status: (await untrustDevice(env.AGENT_SESSION, name, deviceId).catch(
        () => false,
      ))
        ? 204
        : 503,
      headers,
    });
  const response = await directory(env.AGENT_SESSION, name).fetch("list", {
    method: "GET",
  });
  if (!response.ok) return new Response(null, { status: 503, headers });
  return Response.json(await response.json(), { headers });
}
