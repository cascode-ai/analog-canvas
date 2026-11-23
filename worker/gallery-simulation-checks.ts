// Who sees a circuit's simulation check, and the Owner's routes that start,
// read and record the checks (#1545). The hosted runs:
// gallery-simulation-check-runs.ts; the Owner's local runs:
// scripts/gallery-sim-verify.mjs.

import { parseProject } from "@icm/project-protocol";
import {
  simulationCheckFolderName,
  simulationCheckVerdict,
  type SimulationCheck,
  type SimulationCheckFolder,
} from "@icm/simulation-service";
import simulationCheckConfig from "../config/gallery-sim.json";
import { sessionUserOf, type SessionUser } from "./auth";
import { ownerToolRefusal } from "./gallery-datasets";
import { callGallery, readsTestbench } from "./gallery-requests";
import { isRecord, type GalleryEnv } from "./gallery-store";
import { simulationCheckPasses } from "./gallery-store-simulation-checks";
import { sameOrigin } from "./same-origin";

/** Entries one request may name for a check. */
const MAX_CHECK_IDS = 500;

/** How far ahead of the server's clock a local check's time may be. */
const MAX_CLOCK_SKEW_MS = 10 * 60_000;

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

/**
 * Whether a viewer sees every entry's Sim mark, and so may narrow the wall
 * by it and read its count: anyone once it is public, else an Owner
 * account. Anyone else's `sim=1` would tell which entries pass, so it is
 * ignored and no count is sent.
 */
export function seesEverySimulationMark(
  viewer: SessionUser | null,
  markPublic: boolean,
): boolean {
  return markPublic || viewer?.isOwner === true;
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

const SHA256 = /^[0-9a-f]{64}$/u;

function text(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.length <= limit;
}

function optionalText(value: unknown, limit: number): boolean {
  return value === undefined || text(value, limit);
}

/** One folder of a local check as the shared judgment makes it, or null. */
function checkFolder(value: unknown): SimulationCheckFolder | null {
  if (!isRecord(value)) return null;
  const { name, status, code, message, simulator, profileId, specs } = value;
  if (
    !text(name, 80) ||
    (status !== "pass" && status !== "fail" && status !== "error") ||
    !optionalText(code, 120) ||
    !optionalText(message, 300) ||
    !optionalText(simulator, 120) ||
    !optionalText(profileId, 120) ||
    !Array.isArray(specs) ||
    specs.length > 24 ||
    !specs.every(
      (spec) =>
        isRecord(spec) &&
        text(spec.name, 80) &&
        text(spec.expected, 300) &&
        (spec.value === null ||
          (typeof spec.value === "number" && Number.isFinite(spec.value))) &&
        text(spec.unit, 24) &&
        text(spec.judgment, 40) &&
        optionalText(spec.reason, 80),
    )
  )
    return null;
  // A folder passes with no reason and every Spec it states met; else it
  // says why.
  const passed = specs.every((spec) => spec.judgment === "pass");
  if (status === "pass" ? code !== undefined || !passed : code === undefined)
    return null;
  return value as unknown as SimulationCheckFolder;
}

/**
 * The verdict a local check reports, made again from its folders by the
 * rule the hosted check judges by, or why it cannot stand: the folders must
 * be the testbench's own, in order, each passing until the one that ends the
 * check, and the status the folders give.
 */
function localVerdict(
  body: Record<string, unknown>,
  projectText: string,
  now: number,
): SimulationCheck | string {
  const checkedAt = Date.parse(String(body.checkedAt));
  if (
    typeof body.checkedAt !== "string" ||
    !Number.isFinite(checkedAt) ||
    checkedAt > now + MAX_CLOCK_SKEW_MS
  )
    return "invalid-fields";
  if (!Array.isArray(body.folders) || body.folders.length === 0)
    return "invalid-fields";
  const folders = body.folders.map(checkFolder);
  if (folders.some((folder) => folder === null)) return "invalid-fields";
  const checked = folders as SimulationCheckFolder[];
  let testbench: string[];
  try {
    testbench = parseProject(projectText).simulationFolders.map(
      (folder) => folder.name,
    );
  } catch {
    return "project-unreadable";
  }
  const last = checked.length - 1;
  if (
    checked.length > testbench.length ||
    checked.some(
      (folder, index) =>
        folder.name !== simulationCheckFolderName(testbench[index]!) ||
        (index < last && folder.status !== "pass"),
    ) ||
    (checked[last]!.status === "pass" && checked.length !== testbench.length)
  )
    return "folders-mismatch";
  const verdict = simulationCheckVerdict(
    checked,
    testbench.length,
    new Date(checkedAt).toISOString(),
  );
  if (verdict.status !== body.status) return "inconsistent-verdict";
  return { ...verdict, origin: "local" };
}

/**
 * The Owner's local check (#1545), by Owner token or the Owner's session:
 * `GET /api/gallery/simulation-checks/inputs` lists the entries to check,
 * `GET /api/gallery/<id>/simulation-check/input` gives one entry's Project
 * Code with its testbench and their digests, and `POST
 * /api/gallery/<id>/simulation-check` records the verdict for those digests.
 */
async function routeLocalSimulationChecks(
  request: Request,
  env: GalleryEnv,
  segments: readonly string[],
): Promise<Response | null> {
  const inputs =
    segments.length === 2 &&
    segments[0] === "simulation-checks" &&
    segments[1] === "inputs";
  const input =
    segments.length === 3 &&
    segments[1] === "simulation-check" &&
    segments[2] === "input";
  const record =
    segments.length === 2 &&
    segments[1] === "simulation-check" &&
    request.method === "POST";
  if (!inputs && !input && !record) return null;
  if ((inputs || input) && request.method !== "GET")
    return noStore({ error: "method-not-allowed" }, 405);
  const owner = await ownerToolRefusal(request, env);
  if (owner instanceof Response) return owner;
  if (inputs) {
    const { payload } = await callGallery(env, "simulation-check-inputs", {});
    return noStore(payload);
  }
  const id = segments[0]!;
  const current = await callGallery<{
    error?: string;
    projectText?: string;
    projectDigest?: string;
    testbenchDigest?: string | null;
  }>(env, "simulation-check-input", { id });
  if (input || current.status !== 200)
    return noStore(current.payload, current.status);
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (
    !body ||
    !text(body.projectDigest, 64) ||
    !SHA256.test(body.projectDigest) ||
    !text(body.testbenchDigest, 64) ||
    !SHA256.test(body.testbenchDigest)
  )
    return noStore({ error: "invalid-fields" }, 400);
  if (current.payload.testbenchDigest === null)
    return noStore({ error: "no-testbench" }, 409);
  if (
    body.projectDigest !== current.payload.projectDigest ||
    body.testbenchDigest !== current.payload.testbenchDigest
  )
    return noStore({ error: "stale-content" }, 409);
  const check = localVerdict(
    body,
    current.payload.projectText ?? "",
    Date.now(),
  );
  if (typeof check === "string")
    return noStore(
      { error: check },
      check === "project-unreadable" ? 409 : 400,
    );
  // The store compares the digests again as it writes, so an edit since
  // the read above refuses the verdict too.
  const { status, payload } = await callGallery(
    env,
    "simulation-check-record-local",
    {
      id,
      projectDigest: body.projectDigest,
      testbenchDigest: body.testbenchDigest,
      check,
    },
  );
  return status === 200
    ? noStore({ recorded: true, check })
    : noStore(payload, status);
}

/**
 * `POST /api/gallery/simulation-checks` queues checks (the Owner's accounts
 * only, same-origin): `{ids}` for the entries named, `{all: true}` for every
 * public entry with a testbench. `GET` on it reads the queue and the latest
 * verdicts. `GET /api/gallery/<id>/simulation-check` gives one entry's
 * verdict to a reader of its testbench. The local check's routes:
 * routeLocalSimulationChecks.
 */
export async function routeSimulationChecks(
  request: Request,
  env: GalleryEnv,
  segments: readonly string[],
): Promise<Response | null> {
  const local = await routeLocalSimulationChecks(request, env, segments);
  if (local) return local;
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
