import type { CircuitProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";

/** Private formal Project storage. One id owns one mutable current revision. */
export const CLOUD_PROJECT_LIMIT = 20;

export interface CloudProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  revision: number;
  schemaVersion: number;
}

export interface CloudProjectBinding {
  id: string;
  revision: number;
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

/**
 * The shelf thumbnail for one Cloud Project. The revision names the bytes, so
 * a saved change shows immediately while an unchanged tile stays cached.
 */
export function cloudProjectPreviewUrl(
  projectId: string,
  revision: number,
): string {
  const id = encodeURIComponent(projectId);
  return `${ENDPOINT}/${id}/preview.svg?v=${revision}`;
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
        schemaVersion: record.schemaVersion,
      }
    : null;
}

export async function saveCloudProject(
  project: CircuitProject,
  binding: CloudProjectBinding | null,
  fetchLike: typeof fetch = fetch,
): Promise<CloudProjectSaveOutcome> {
  let response: Response;
  try {
    response = await fetchLike(
      binding ? `${ENDPOINT}/${encodeURIComponent(binding.id)}` : ENDPOINT,
      {
        method: binding ? "PUT" : "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          ...(binding ? { "if-match": `revision-${binding.revision}` } : {}),
        },
        body: JSON.stringify({
          name: project.name,
          projectText: serializeProject(project),
        }),
      },
    );
  } catch (error) {
    return {
      status: "unreachable",
      message: error instanceof Error ? error.message : "Network error",
    };
  }
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
    project?: unknown;
    projects?: unknown[];
  } | null;
  const returnedProject = summaryOf(payload?.project);
  if (response.ok && returnedProject) {
    return { status: "saved", project: returnedProject };
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
      : { status: "rejected", message: "Cloud revision conflict" };
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

export async function listCloudProjects(
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
  } catch (error) {
    return {
      status: "unreachable",
      message: error instanceof Error ? error.message : "Network error",
    };
  }
  if (response.status === 401) return { status: "signed-out" };
  if (!response.ok) return { status: "not-found" };
  const payload = (await response.json().catch(() => null)) as {
    project?: unknown;
  } | null;
  const summary = summaryOf(payload?.project);
  const projectText =
    typeof payload?.project === "object" && payload.project !== null
      ? (payload.project as Record<string, unknown>).projectText
      : null;
  if (!summary || typeof projectText !== "string") {
    return { status: "not-found" };
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
  try {
    const response = await fetchLike(
      `${ENDPOINT}/${encodeURIComponent(projectId)}`,
      { method: "DELETE", credentials: "same-origin" },
    );
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
