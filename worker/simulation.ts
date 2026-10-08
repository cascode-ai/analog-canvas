/** Profile routing is shared; each engine retains its own verified wire protocol.
 * No retry or engine fallback is performed here. */
import {
  routeVacaskSimulationRequest,
  type SimulationEnv as VacaskEnv,
} from "./simulation-vacask";
import {
  routeNgspiceSimulationRequest,
  type SimulationEnv as NgspiceEnv,
} from "./simulation-ngspice";
import ngspiceProfile from "../containers/ngspice/hosted-sky130-profile.json";
import { sessionUserOf } from "./auth";
import type { AuthEnv } from "./auth-do";
import { bearerMatches } from "./bearer";
export type { SimulationRequestBody } from "./simulation-vacask";

/** The answer to a signed-out request for computation. */
export function signInToSimulate(): Response {
  return Response.json(
    {
      error: "simulation-authentication-required",
      message: "Sign in to run simulations.",
    },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

/**
 * Simulation runs on the operator's host, so only a signed-in account
 * computes through `/api/simulate`. Discovering the Profiles stays open, so
 * the editor can describe them before anyone signs in. The deploy check
 * proves the route with a credential that deploy made and the next replaces.
 */
export async function refuseSignedOutSimulation(
  request: Request,
  env: Partial<AuthEnv> & { SIMULATION_SMOKE_TOKEN?: string },
): Promise<Response | null> {
  if (
    new URL(request.url).pathname !== "/api/simulate" ||
    request.method !== "POST"
  )
    return null;
  if (bearerMatches(request, env.SIMULATION_SMOKE_TOKEN)) return null;
  if (await sessionUserOf(request, env)) return null;
  if (await asksForCapabilities(request)) return null;
  return signInToSimulate();
}

/** Discovery is a few bytes of JSON; a larger body is never one. */
async function asksForCapabilities(request: Request): Promise<boolean> {
  const text = await boundedText(request, 4096);
  if (text === null) return false;
  try {
    return (
      (JSON.parse(text) as { operation?: unknown }).operation === "capabilities"
    );
  } catch {
    return false;
  }
}

/** The body of a copy of `request` as text, or null once it passes `limit` bytes. */
async function boundedText(
  request: Request,
  limit: number,
): Promise<string | null> {
  const reader = request.clone().body?.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (reader) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > limit) {
        void reader.cancel();
        return null;
      }
      text += decoder.decode(item.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader?.releaseLock();
  }
  return text;
}

export interface SimulationEnv extends VacaskEnv, NgspiceEnv {
  /** Opt-in independent native endpoint; never overwrites the ngspice origin. */
  VACASK_PROFILE_ID?: string;
  VACASK_UPSTREAM_URL?: string;
  VACASK_UPSTREAM_TOKEN?: string;
}

export async function routeSimulationRequest(
  request: Request,
  env: SimulationEnv,
  runnerKey?: string,
): Promise<Response | null> {
  // Keep existing isolated native harnesses working without changing their config.
  if (!env.VACASK_PROFILE_ID && env.SIMULATION_PROFILE_ID)
    return routeVacaskSimulationRequest(request, env, runnerKey);
  if (new URL(request.url).pathname !== "/api/simulate") return null;
  if (request.method !== "POST")
    return Response.json({ error: "method-not-allowed" }, { status: 405 });
  // Bound the dispatcher too; the selected engine independently validates input.
  const text = await boundedText(request, 8 * 1024 * 1024);
  if (text === null)
    return Response.json({ error: "request-too-large" }, { status: 413 });
  let body: {
    operation?: unknown;
    language?: unknown;
    environment?: { profileId?: unknown };
  };
  try {
    body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error();
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400 });
  }
  const nativeId = env.VACASK_PROFILE_ID?.trim();
  if (nativeId === ngspiceProfile.id)
    return Response.json(
      { error: "simulation-profile-configuration-invalid" },
      { status: 503 },
    );
  const profileId = body.environment?.profileId;
  if (
    profileId !== undefined &&
    profileId !== ngspiceProfile.id &&
    profileId !== nativeId
  )
    return Response.json(
      { error: "simulation-profile-unavailable" },
      { status: 400 },
    );
  const nativeEnv: VacaskEnv = {
    ...(env.VACASK ? { VACASK: env.VACASK } : {}),
    ...(nativeId ? { SIMULATION_PROFILE_ID: nativeId } : {}),
    ...(env.VACASK_UPSTREAM_URL
      ? { SIMULATION_UPSTREAM_URL: env.VACASK_UPSTREAM_URL }
      : {}),
    ...(env.VACASK_UPSTREAM_TOKEN
      ? { SIMULATION_UPSTREAM_TOKEN: env.VACASK_UPSTREAM_TOKEN }
      : {}),
    SIMULATION_DEFAULT_EXECUTOR: env.VACASK_UPSTREAM_URL
      ? "operator-host"
      : "cloudflare-container",
  };
  if (nativeId && profileId === nativeId)
    return annotateEngine(
      await routeVacaskSimulationRequest(request, nativeEnv, runnerKey),
      body.operation,
      "vacask",
    );
  if (body.language !== undefined)
    return Response.json(
      { error: "simulation-engine-profile-mismatch" },
      { status: 400 },
    );
  if (body.operation === "cancel" && nativeId && profileId === undefined)
    return Response.json(
      { error: "simulation-cancel-profile-required" },
      { status: 400 },
    );
  const response = await annotateEngine(
    await routeNgspiceSimulationRequest(request, env, runnerKey),
    body.operation,
    "ngspice",
  );
  if (
    body.operation !== "capabilities" ||
    profileId !== undefined ||
    !nativeId ||
    !response?.ok
  )
    return response;
  // Discovery advertises both Profiles. Prepare must fetch selected-Profile caps;
  // global limits and collection protocol here describe the default ngspice path.
  const native = await routeVacaskSimulationRequest(
    new Request(request.url, {
      method: "POST",
      body: JSON.stringify({ operation: "capabilities" }),
    }),
    nativeEnv,
  );
  const defaults = (await response.json()) as {
    configured: boolean;
    profiles: unknown[];
  };
  if (native?.ok) {
    const caps = (await native.json()) as {
      configured: boolean;
      profiles: unknown[];
    };
    if (caps.configured) {
      defaults.configured = true;
      defaults.profiles.push(
        ...caps.profiles.map((profile) => ({
          ...(profile as object),
          engine: "vacask",
        })),
      );
    }
  }
  return Response.json(defaults);
}

async function annotateEngine(
  response: Response | null,
  operation: unknown,
  engine: "ngspice" | "vacask",
) {
  if (operation !== "capabilities" || !response?.ok) return response;
  const caps = (await response.json()) as { profiles: object[] };
  return Response.json({
    ...caps,
    profiles: caps.profiles.map((profile) => ({ ...profile, engine })),
  });
}
