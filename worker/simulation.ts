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
import ngspiceProfile from "../containers/ngspice/hosted-sky130-profile.json" with { type: "json" };
import sg13g2Profile from "../containers/ngspice/sg13g2/profile.json" with { type: "json" };
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
  /** SG13 executor behind the trusted ngspice gateway; same gateway bearer. */
  SG13G2_UPSTREAM_URL?: string;
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
  if (nativeId && [ngspiceProfile.id, sg13g2Profile.id].includes(nativeId))
    return Response.json(
      { error: "simulation-profile-configuration-invalid" },
      { status: 503 },
    );
  const profileId = body.environment?.profileId;
  const ngspiceProfiles = [
    { profile: ngspiceProfile, environment: env },
    ...(env.SG13G2_UPSTREAM_URL?.trim()
      ? [
          {
            profile: sg13g2Profile,
            environment: {
              SIMULATION_UPSTREAM_URL: env.SG13G2_UPSTREAM_URL,
              ...(env.SIMULATION_UPSTREAM_TOKEN
                ? { SIMULATION_UPSTREAM_TOKEN: env.SIMULATION_UPSTREAM_TOKEN }
                : {}),
              SIMULATION_DEFAULT_EXECUTOR: "operator-host",
            } satisfies NgspiceEnv,
          },
        ]
      : []),
  ];
  const selectedNgspice = ngspiceProfiles.find(
    ({ profile }) => profile.id === (profileId ?? ngspiceProfile.id),
  );
  if (profileId !== undefined && !selectedNgspice && profileId !== nativeId)
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
  if (
    body.operation === "cancel" &&
    (nativeId || ngspiceProfiles.length > 1) &&
    profileId === undefined
  )
    return Response.json(
      { error: "simulation-cancel-profile-required" },
      { status: 400 },
    );
  const response = await annotateEngine(
    await routeNgspiceSimulationRequest(
      request,
      selectedNgspice!.environment,
      runnerKey,
      selectedNgspice!.profile,
    ),
    body.operation,
    "ngspice",
  );
  if (
    body.operation !== "capabilities" ||
    profileId !== undefined ||
    !response?.ok
  )
    return response;
  // Discovery advertises both Profiles. Prepare must fetch selected-Profile caps;
  // global limits and collection protocol here describe the default ngspice path.
  const native = nativeId
    ? await routeVacaskSimulationRequest(
        new Request(request.url, {
          method: "POST",
          body: JSON.stringify({ operation: "capabilities" }),
        }),
        nativeEnv,
      )
    : null;
  const defaults = (await response.json()) as {
    configured: boolean;
    profiles: unknown[];
  };
  for (const entry of ngspiceProfiles.slice(1)) {
    const additional = await routeNgspiceSimulationRequest(
      new Request(request.url, { method: "POST", body: text }),
      entry.environment,
      runnerKey,
      entry.profile,
    );
    if (additional?.ok) {
      const caps = (await additional.json()) as {
        configured: boolean;
        profiles: object[];
      };
      if (caps.configured) {
        defaults.configured = true;
        defaults.profiles.push(
          ...caps.profiles.map((p) => ({ ...p, engine: "ngspice" })),
        );
      }
    }
  }
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
