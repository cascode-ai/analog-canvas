import { ACCOUNT_CHANGED_EVENT } from "../../components/account";
import type { CircuitProject } from "@icm/model";
import {
  createIndependentProject,
  parseProject,
  serializeProject,
} from "@icm/project-protocol";
import {
  OFFLINE_FAILURE,
  requestFailureOf,
  UNREADABLE_REPLY,
} from "../../request-failure";

/** Private formal Project storage. One id owns one mutable current revision. */
export const CLOUD_PROJECT_LIMIT = 20;

export interface CloudProjectSummary {
  conflicted?: boolean;
  saveToken?: string;
  id: string;
  name: string;
  updatedAt: string;
  revision: number;
  schemaVersion: number;
  galleryEntryId?: string | null;
  favorite?: boolean;
}

export interface CloudProjectBinding {
  saveToken?: string;
  id: string;
  revision: number;
  galleryEntryId?: string | null;
}

export type CloudProjectSaveOutcome =
  | { status: "saved"; project: CloudProjectSummary }
  | { status: "signed-out" }
  | { status: "too-large" }
  | { status: "limit"; projects: readonly CloudProjectSummary[] }
  | { status: "conflict"; project: CloudProjectSummary }
  | { status: "not-found" }
  | { status: "rejected"; message: string }
  | { status: "unreachable"; message: string };

export type CloudProjectOpenOutcome =
  | {
      status: "opened";
      project: CloudProjectSummary & { projectText: string };
    }
  | { status: "signed-out" }
  | { status: "not-found" }
  | { status: "unreachable"; message: string };

export type CloudProjectListOutcome =
  | { status: "listed"; projects: readonly CloudProjectSummary[] }
  | { status: "signed-out" }
  | { status: "unreachable"; message: string };

const ENDPOINT = "/api/projects";
interface PendingCreate {
  key: string;
  body: string;
  state: "pending" | "rejected" | "ambiguous";
  binding?: CloudProjectBinding;
}
const pendingCreates = new WeakMap<typeof fetch, Map<string, PendingCreate>>();

function pendingCreate(
  fetchLike: typeof fetch,
  projectId: string,
  body: string,
): PendingCreate {
  let pending = pendingCreates.get(fetchLike);
  if (!pending) {
    pending = new Map();
    pendingCreates.set(fetchLike, pending);
  }
  let creation = pending.get(projectId);
  if (!creation) {
    creation = { key: crypto.randomUUID(), body, state: "pending" };
    pending.set(projectId, creation);
  } else if (creation.state === "rejected") {
    creation.body = body;
    creation.state = "pending";
  }
  return creation;
}

/**
 * The shelf thumbnail for one Cloud Project. The revision names the bytes, so
 * a saved change shows immediately while an unchanged tile stays cached.
 */
export function cloudProjectPreviewUrl(
  projectId: string,
  revision: number,
): string {
  const id = encodeURIComponent(projectId);
  return `${ENDPOINT}/${id}/preview.svg?v=${revision}&render=formula-label-v5`;
}

function summaryOf(value: unknown): CloudProjectSummary | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.updatedAt === "string" &&
    typeof record.revision === "number" &&
    typeof record.schemaVersion === "number"
    ? {
        id: record.id,
        name: record.name,
        updatedAt: record.updatedAt,
        revision: record.revision,
        ...(typeof record.saveToken === "string"
          ? { saveToken: record.saveToken }
          : {}),
        schemaVersion: record.schemaVersion,
        ...(record.conflicted === true ? { conflicted: true } : {}),
        favorite: record.favorite === true,
        galleryEntryId:
          typeof record.galleryEntryId === "string"
            ? record.galleryEntryId
            : null,
      }
    : null;
}

export async function saveCloudProject(
  project: CircuitProject,
  binding: CloudProjectBinding | null,
  fetchLike: typeof fetch = fetch,
  galleryEntryId?: string,
  serialize: (project: CircuitProject) => string = serializeProject,
): Promise<CloudProjectSaveOutcome> {
  cloudLists.delete(fetchLike);
  let response: Response;
  let creation: PendingCreate | undefined;
  let body: string;
  try {
    binding ??= pendingCreates.get(fetchLike)?.get(project.id)?.binding ?? null;
    body = JSON.stringify({
      name: project.name,
      projectText: serialize(project),
      ...(!binding && galleryEntryId ? { galleryEntryId } : {}),
    });
    creation = binding ? undefined : pendingCreate(fetchLike, project.id, body);
    response = await fetchLike(
      binding ? `${ENDPOINT}/${encodeURIComponent(binding.id)}` : ENDPOINT,
      {
        method: binding ? "PUT" : "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          ...(creation ? { "idempotency-key": creation.key } : {}),
          ...(binding
            ? {
                "if-match": binding.saveToken ?? `revision-${binding.revision}`,
              }
            : {}),
        },
        body: creation?.body ?? body,
      },
    );
  } catch (error) {
    if (creation) creation.state = "ambiguous";
    return {
      status: "unreachable",
      message: error instanceof Error ? error.message : "Network error",
    };
  }
  cloudLists.delete(fetchLike);
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
    project?: unknown;
    projects?: unknown[];
  } | null;
  const returnedProject = summaryOf(payload?.project);
  if (response.ok && returnedProject) {
    if (creation && creation.body !== body) {
      // An ambiguous create keeps its exact payload. Recover that binding
      // before acknowledging newer edits, even if their follow-up save fails.
      creation.binding = returnedProject;
      return saveCloudProject(
        project,
        returnedProject,
        fetchLike,
        undefined,
        serialize,
      );
    }
    pendingCreates.get(fetchLike)?.delete(project.id);
    return { status: "saved", project: returnedProject };
  }
  if (creation && creation.state !== "ambiguous") {
    // Only a definite refusal can release the payload for correction. A later
    // refusal cannot disprove that an earlier ambiguous request committed.
    creation.state =
      [400, 401, 403, 404, 413, 429].includes(response.status) ||
      (response.status === 409 && payload?.error === "project-limit")
        ? "rejected"
        : "ambiguous";
  }
  if (response.status === 401) return { status: "signed-out" };
  if (response.status === 413) return { status: "too-large" };
  if (response.status === 404) {
    return binding
      ? { status: "not-found" }
      : {
          status: "unreachable",
          message: "Cloud Project service is unavailable (404)",
        };
  }
  if (response.status === 409 && payload?.error === "revision-conflict") {
    return returnedProject
      ? { status: "conflict", project: returnedProject }
      : {
          status: "rejected",
          message: binding?.saveToken
            ? "This Project changed in another region. Keep your local draft and review the versions in My shelf."
            : "Cloud revision conflict",
        };
  }
  if (response.status === 409 && payload?.error === "project-limit") {
    return {
      status: "limit",
      projects: (payload.projects ?? [])
        .map(summaryOf)
        .filter((item): item is CloudProjectSummary => item !== null),
    };
  }
  return {
    status: "rejected",
    message: `Cloud Project save was refused (${response.status})`,
  };
}

// Share only concurrent reads. Later callers always consult server authority.
const cloudLists = new WeakMap<
  typeof fetch,
  Promise<CloudProjectListOutcome>
>();
if (!import.meta.env?.ICM_DESKTOP && typeof window !== "undefined")
  window.addEventListener(ACCOUNT_CHANGED_EVENT, () => {
    cloudLists.delete(fetch);
    pendingCreates.delete(fetch);
  });
export function listCloudProjects(
  fetchLike: typeof fetch = fetch,
): Promise<CloudProjectListOutcome> {
  const pending = cloudLists.get(fetchLike);
  if (pending) return pending;
  const request = requestCloudProjects(fetchLike).finally(() => {
    if (cloudLists.get(fetchLike) === request) cloudLists.delete(fetchLike);
  });
  cloudLists.set(fetchLike, request);
  return request;
}

async function requestCloudProjects(
  fetchLike: typeof fetch = fetch,
): Promise<CloudProjectListOutcome> {
  try {
    const response = await fetchLike(ENDPOINT, {
      credentials: "same-origin",
    });
    if (response.status === 401) return { status: "signed-out" };
    if (!response.ok) {
      return {
        status: "unreachable",
        message: `Cloud Project list is unavailable (${response.status})`,
      };
    }
    const payload = (await response.json().catch(() => null)) as {
      projects?: unknown[];
    } | null;
    return {
      status: "listed",
      projects: (payload?.projects ?? [])
        .map(summaryOf)
        .filter((item): item is CloudProjectSummary => item !== null),
    };
  } catch (error) {
    return {
      status: "unreachable",
      message: error instanceof Error ? error.message : "Network error",
    };
  }
}

export async function openCloudProject(
  projectId: string,
  fetchLike: typeof fetch = fetch,
): Promise<CloudProjectOpenOutcome> {
  let response: Response;
  try {
    response = await fetchLike(`${ENDPOINT}/${encodeURIComponent(projectId)}`, {
      credentials: "same-origin",
    });
  } catch {
    return { status: "unreachable", message: OFFLINE_FAILURE.message };
  }
  if (response.status === 401) return { status: "signed-out" };
  // Only a 404 says the Project is gone; a caller forgets it on "not-found",
  // so a passing limit or server error must not read as one.
  if (response.status === 404) return { status: "not-found" };
  if (!response.ok)
    return {
      status: "unreachable",
      message: (await requestFailureOf(response)).message,
    };
  const payload = (await response.json().catch(() => null)) as {
    project?: unknown;
  } | null;
  const summary = summaryOf(payload?.project);
  const projectText =
    typeof payload?.project === "object" && payload.project !== null
      ? (payload.project as Record<string, unknown>).projectText
      : null;
  if (!summary || typeof projectText !== "string") {
    return { status: "unreachable", message: UNREADABLE_REPLY.message };
  }
  return { status: "opened", project: { ...summary, projectText } };
}

export async function deleteCloudProject(
  projectId: string,
  fetchLike: typeof fetch = fetch,
): Promise<
  | { status: "deleted"; projects: readonly CloudProjectSummary[] }
  | { status: "failed"; message: string }
> {
  cloudLists.delete(fetchLike);
  try {
    const response = await fetchLike(
      `${ENDPOINT}/${encodeURIComponent(projectId)}`,
      { method: "DELETE", credentials: "same-origin" },
    );
    cloudLists.delete(fetchLike);
    const payload = (await response.json().catch(() => null)) as {
      projects?: unknown[];
    } | null;
    if (!response.ok) {
      return {
        status: "failed",
        message: `Delete failed (${response.status})`,
      };
    }
    return {
      status: "deleted",
      projects: (payload?.projects ?? [])
        .map(summaryOf)
        .filter((item): item is CloudProjectSummary => item !== null),
    };
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : "Network error",
    };
  }
}

/** Card actions load current content and use the same revision-checked Save API. */
export async function editShelfProject(
  id: string,
  action: { kind: "rename"; name: string } | { kind: "duplicate" },
  fetchLike: typeof fetch = fetch,
): Promise<CloudProjectSaveOutcome> {
  const loaded = await openCloudProject(id, fetchLike);
  if (loaded.status !== "opened") return loaded;
  try {
    const project = parseProject(loaded.project.projectText);
    if (action.kind === "duplicate") {
      // A copy is independent; it must never inherit the source's publication link.
      return saveCloudProject(
        createIndependentProject(
          project,
          crypto.randomUUID(),
          `${loaded.project.name.slice(0, 113)} (copy)`,
        ),
        null,
        fetchLike,
      );
    }
    const name = action.name.trim();
    if (!name || name.length > 120)
      return {
        status: "rejected",
        message: "Use a name between 1 and 120 characters",
      };
    project.name = name;
    return saveCloudProject(project, loaded.project, fetchLike);
  } catch (error) {
    return {
      status: "rejected",
      message:
        error instanceof Error ? error.message : "Could not read this Project",
    };
  }
}

export async function setShelfFavorite(
  id: string,
  favorite: boolean,
  fetchLike: typeof fetch = fetch,
): Promise<CloudProjectSummary> {
  cloudLists.delete(fetchLike);
  const response = await fetchLike(`${ENDPOINT}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ favorite }),
  });
  if (!response.ok)
    throw new Error(`Could not update favorite (${response.status})`);
  cloudLists.delete(fetchLike);
  const payload = (await response.json()) as { project?: unknown };
  const project = summaryOf(payload.project);
  if (!project) throw new Error("Invalid Shelf response");
  return project;
}
