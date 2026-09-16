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
export type {
  SimulationRequestBody,
  SimulationRunner,
} from "./simulation-vacask";

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
  const reader = request.clone().body?.getReader();
  let text = "";
  const decoder = new TextDecoder();
  let bytes = 0;
  try {
    while (reader) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > 8 * 1024 * 1024) {
        void reader.cancel();
        return Response.json({ error: "request-too-large" }, { status: 413 });
      }
      text += decoder.decode(item.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader?.releaseLock();
  }
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
