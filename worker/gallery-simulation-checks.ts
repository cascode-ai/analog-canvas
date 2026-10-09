// Who sees a circuit's simulation check, and the Owner's routes that start
// and read the checks (#1545). The runs themselves:
// gallery-simulation-check-runs.ts.

import simulationCheckConfig from "../config/gallery-sim.json";
import { sessionUserOf, type SessionUser } from "./auth";
import { callGallery, readsTestbench } from "./gallery-requests";
import type { GalleryEnv } from "./gallery-store";
import {
  simulationCheckPasses,
  type SimulationCheck,
} from "./gallery-store-simulation-checks";
import { sameOrigin } from "./same-origin";

/** Entries one request may name for a check. */
const MAX_CHECK_IDS = 500;

/**
 * Whether the Sim mark is public. From `publicFrom` in
 * config/gallery-sim.json on, every reader sees it; until then (null, or a
 * date to come) only the readers of an entry's testbench do, and the API
 * sends nobody else a word of it.
 */
export function simulationMarkPublic(
  publicFrom: string | null | undefined = simulationCheckConfig.publicFrom,
  now = Date.now(),
): boolean {
  if (typeof publicFrom !== "string") return false;
  const from = Date.parse(publicFrom);
  return Number.isFinite(from) && from <= now;
}

/**
 * Whether a viewer sees an entry's Sim mark: anyone once it is public;
 * before, a reader of the entry's testbench (readsTestbench) — an Owner
 * account, the entry's owner, an AI account for an AI account's entry.
 */
function seesSimulationMark(
  viewer: SessionUser | null,
  entry: {
    ownerUserId?: string | null | undefined;
    author?: string | undefined;
  },
  markPublic: boolean,
): boolean {
  return markPublic || readsTestbench(viewer, entry);
}

/** A feed page with the Sim mark kept only where its viewer may see it. */
export function gateSimulationMarks<
  T extends {
    simVerified?: boolean;
    ownerUserId?: string | null;
    author?: string;
  },
>(entries: T[], viewer: SessionUser | null, markPublic: boolean): T[] {
  return entries.map((entry) => {
    if (!entry.simVerified || seesSimulationMark(viewer, entry, markPublic))
      return entry;
    const { simVerified: _hidden, ...rest } = entry;
    return rest as T;
  });
}

/** One entry's Sim mark, for a viewer who may see it; else nothing. */
export function simulationMarkOf(
  check: SimulationCheck | null | undefined,
  viewer: SessionUser | null,
  entry: {
    ownerUserId?: string | null | undefined;
    author?: string | undefined;
  },
  markPublic: boolean,
): { simVerified?: true } {
  return simulationCheckPasses(check ?? null) &&
    seesSimulationMark(viewer, entry, markPublic)
    ? { simVerified: true }
    : {};
}

function noStore(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

/** The ids a request names, or null for a request that names them wrongly. */
function requestedIds(value: unknown): string[] | null {
  return Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_CHECK_IDS &&
    value.every(
      (id) => typeof id === "string" && id.length > 0 && id.length <= 64,
    )
    ? [...new Set(value as string[])]
    : null;
}

/**
 * `POST /api/gallery/simulation-checks` queues checks (the Owner's accounts
 * only, same-origin): `{ids}` for the entries named, `{all: true}` for every
 * public entry with a testbench. `GET` on it reads the queue and the latest
 * verdicts. `GET /api/gallery/<id>/simulation-check` gives one entry's
 * verdict to a reader of its testbench.
 */
export async function routeSimulationChecks(
  request: Request,
  env: GalleryEnv,
  segments: readonly string[],
): Promise<Response | null> {
  if (segments.length === 1 && segments[0] === "simulation-checks") {
    if (request.method !== "GET" && request.method !== "POST")
      return noStore({ error: "method-not-allowed" }, 405);
    if (request.method === "POST" && !sameOrigin(request))
      return noStore({ error: "forbidden" }, 403);
    const user = await sessionUserOf(request, env);
    if (!user) return noStore({ error: "unauthorized" }, 401);
    if (!user.isOwner) return noStore({ error: "owner-only" }, 403);
    if (request.method === "GET") {
      const { payload } = await callGallery(
        env,
        "simulation-checks-progress",
        {},
      );
      return noStore(payload);
    }
    const body = (await request.json().catch(() => null)) as {
      ids?: unknown;
      all?: unknown;
    } | null;
    const ids = body?.all === undefined ? requestedIds(body?.ids) : null;
    if (!(body?.all === true && body.ids === undefined) && !ids)
      return noStore({ error: "invalid-fields" }, 400);
    const { payload } = await callGallery(env, "simulation-checks-queue", {
      ...(ids ? { ids } : { all: true }),
      requestedBy: user.id,
      at: new Date().toISOString(),
    });
    return noStore(payload, 202);
  }
  if (
    segments.length === 2 &&
    segments[1] === "simulation-check" &&
    request.method === "GET"
  ) {
    const { status, payload } = await callGallery<{
      entry?: { author?: string };
      ownerUserId?: string | null;
      simulationCheck?: SimulationCheck | null;
      simulationCheckWaiting?: boolean;
    }>(env, "any-entry", { id: segments[0] });
    const viewer = await sessionUserOf(request, env);
    // Private like the testbench it ran: anyone else learns nothing of it,
    // not even that the entry exists.
    if (
      status !== 200 ||
      !readsTestbench(viewer, {
        ownerUserId: payload.ownerUserId,
        author: payload.entry?.author,
      })
    )
      return noStore({ error: "not-found" }, 404);
    return noStore({
      check: payload.simulationCheck ?? null,
      waiting: payload.simulationCheckWaiting === true,
    });
  }
  return null;
}
