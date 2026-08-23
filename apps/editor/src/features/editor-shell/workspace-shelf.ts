import type { CircuitProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";

/**
 * The signed-in account's scratch shelf: the last few circuits it checked.
 *
 * This is not the Gallery and not a save. The `.icproj.json` file stays
 * canonical, and nothing here is visible to anyone else — the shelf exists so
 * a check does not leave the day's work living only in one browser tab. The
 * session cookie is the whole credential, so this handles no secret, and the
 * fetch seam keeps the mapping testable offline.
 */

/** How many circuits the shelf keeps; the server enforces the same number. */
export const WORKSPACE_SLOT_LIMIT = 3;

export interface WorkspaceSlot {
  id: string;
  name: string;
  /** ISO 8601, from the server's clock rather than the browser's. */
  savedAt: string;
  schemaVersion: number;
}

export type WorkspaceSaveOutcome =
  | { status: "saved"; slots: readonly WorkspaceSlot[] }
  | { status: "signed-out" }
  | { status: "too-large" }
  | { status: "rejected"; message: string }
  | { status: "unreachable"; message: string };

export type WorkspaceOpenOutcome =
  | { status: "opened"; name: string; projectText: string }
  | { status: "signed-out" }
  | { status: "not-found" }
  | { status: "unreachable"; message: string };

const ENDPOINT = "/api/workspace/recent";

function failureFor(
  response: Response,
): Exclude<WorkspaceSaveOutcome, { status: "saved" }> {
  if (response.status === 401) return { status: "signed-out" };
  if (response.status === 413) return { status: "too-large" };
  return {
    status: "rejected",
    message: `Shelf refused the circuit (${response.status})`,
  };
}

export async function saveToWorkspaceShelf(
  project: CircuitProject,
  fetchLike: typeof fetch = fetch,
): Promise<WorkspaceSaveOutcome> {
  let response: Response;
  try {
    response = await fetchLike(ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: project.name,
        projectText: serializeProject(project),
      }),
    });
  } catch (error) {
    return {
      status: "unreachable",
      message: error instanceof Error ? error.message : "Network error",
    };
  }
  if (!response.ok) return failureFor(response);
  const payload = (await response.json().catch(() => null)) as {
    slots?: WorkspaceSlot[];
  } | null;
  return { status: "saved", slots: payload?.slots ?? [] };
}

export async function listWorkspaceShelf(
  fetchLike: typeof fetch = fetch,
): Promise<readonly WorkspaceSlot[]> {
  try {
    const response = await fetchLike(ENDPOINT, {
      credentials: "same-origin",
    });
    if (!response.ok) return [];
    const payload = (await response.json().catch(() => null)) as {
      slots?: WorkspaceSlot[];
    } | null;
    return payload?.slots ?? [];
  } catch {
    // A shelf that cannot be reached is empty, not an error worth a dialog.
    return [];
  }
}

export async function openWorkspaceSlot(
  slotId: string,
  fetchLike: typeof fetch = fetch,
): Promise<WorkspaceOpenOutcome> {
  let response: Response;
  try {
    response = await fetchLike(`${ENDPOINT}/${encodeURIComponent(slotId)}`, {
      credentials: "same-origin",
    });
  } catch (error) {
    return {
      status: "unreachable",
      message: error instanceof Error ? error.message : "Network error",
    };
  }
  if (response.status === 401) return { status: "signed-out" };
  if (!response.ok) return { status: "not-found" };
  const payload = (await response.json().catch(() => null)) as {
    name?: string;
    projectText?: string;
  } | null;
  if (!payload?.projectText) return { status: "not-found" };
  return {
    status: "opened",
    name: payload.name ?? "Circuit",
    projectText: payload.projectText,
  };
}
