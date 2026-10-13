/**
 * Opening a Schematic Arena "Draw it yourself" entry (#1695) in the editor:
 * the side's project from the Arena, the Voter's own copy of it, and what
 * to say when it cannot be opened.
 */
import { createId, type CircuitProject } from "@icm/model";
import { parseProject } from "@icm/project-protocol";

import type { ArenaEntry } from "./arena-entry-address";

export type ArenaEntryFailure =
  | "sign-in"
  | "vote-required"
  | "battle-unknown"
  | "project-unknown"
  | "unreachable";

/** The side's project, or why it cannot be opened. */
export async function loadArenaEntryProject(
  entry: ArenaEntry,
  fetchLike: typeof fetch = fetch,
): Promise<
  | { ok: true; project: CircuitProject }
  | { ok: false; reason: ArenaEntryFailure }
> {
  let response: Response;
  try {
    response = await fetchLike(
      `/api/arena/battles/${encodeURIComponent(entry.battle)}/${entry.side}.icproj.json`,
      { credentials: "same-origin", cache: "no-store" },
    );
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  if (response.status === 401 || response.status === 403)
    return { ok: false, reason: "sign-in" };
  if (!response.ok) {
    const error = await response
      .json()
      .then((body: { error?: unknown }) => body?.error)
      .catch(() => undefined);
    return {
      ok: false,
      reason:
        error === "vote-required" ||
        error === "battle-unknown" ||
        error === "project-unknown"
          ? error
          : "unreachable",
    };
  }
  try {
    return { ok: true, project: parseProject(await response.text()) };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}

/** The Voter's own copy: a new identity, named for where it came from. */
export function arenaProjectCopy(project: CircuitProject): CircuitProject {
  return {
    ...structuredClone(project),
    id: createId("project"),
    name: `${project.name} (from Arena)`,
    structureRevision: 0,
  };
}

export const ARENA_ENTRY_NOTICES: Readonly<Record<ArenaEntryFailure, string>> =
  {
    "sign-in": "Sign in to open the drawing from the Schematic Arena",
    "vote-required":
      "Vote on this Arena Battle first, then open its drawing from the Arena",
    "battle-unknown":
      "This Arena Battle is not yours, or no longer exists; opened the editor instead",
    "project-unknown":
      "This side of the Arena Battle has no drawing to open; opened the editor instead",
    unreachable:
      "The Schematic Arena could not be reached; opened the editor instead",
  };
