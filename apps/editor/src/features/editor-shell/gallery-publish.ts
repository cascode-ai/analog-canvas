import type { SubmissionGateFailure } from "@icm/derived";
import type { CircuitProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";

/**
 * Client for the documented gallery submissions endpoint
 * (docs/specs/community-gallery.md). The signed-in session is the only
 * credential: it travels as a same-origin cookie, so nothing here handles a
 * secret. The fetch seam keeps the mapping testable offline.
 */

export interface GalleryPublishFields {
  name: string;
  description: string;
  /** Category tags ("amplifier", "adc", …); the server normalizes. */
  tags: readonly string[];
}

/** What the dialog needs to know about the signed-in user. */
export interface PublishSessionUser {
  /** Also the byline: the server takes it from the account, not from us. */
  displayName: string;
  isAdmin: boolean;
  /** "user" or "moderator"; moderators bypass the quality gates. */
  role?: string;
}

export type GalleryPublishOutcome =
  | { status: "published"; id: string }
  | { status: "gate-failed"; failures: readonly SubmissionGateFailure[] }
  | { status: "unauthorized" }
  | { status: "too-large" }
  | { status: "rate-limited" }
  | { status: "rejected"; message: string }
  | { status: "unreachable"; message: string };

async function sendGalleryProject(
  url: string,
  method: "POST" | "PUT",
  project: CircuitProject,
  fields: GalleryPublishFields,
  fetchLike: typeof fetch,
): Promise<GalleryPublishOutcome> {
  let response: Response;
  try {
    response = await fetchLike(url, {
      method,
      // The session cookie is the credential; there is nothing else to send.
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: fields.name.trim(),
        description: fields.description.trim(),
        tags: fields.tags,
        projectText: serializeProject(project),
      }),
    });
  } catch (error) {
    return {
      status: "unreachable",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  if (response.status === 201 || response.status === 200) {
    const payload = (await response.json().catch(() => null)) as {
      id?: unknown;
    } | null;
    return {
      status: "published",
      id: typeof payload?.id === "string" ? payload.id : "",
    };
  }
  if (response.status === 422) {
    const payload = (await response.json().catch(() => null)) as {
      failures?: SubmissionGateFailure[];
    } | null;
    return { status: "gate-failed", failures: payload?.failures ?? [] };
  }
  if (response.status === 401) return { status: "unauthorized" };
  if (response.status === 413) return { status: "too-large" };
  if (response.status === 429) return { status: "rate-limited" };
  const payload = (await response.json().catch(() => null)) as {
    error?: unknown;
  } | null;
  return {
    status: "rejected",
    message:
      typeof payload?.error === "string"
        ? payload.error
        : `HTTP ${response.status}`,
  };
}

export function publishProjectToGallery(
  project: CircuitProject,
  fields: GalleryPublishFields,
  fetchLike: typeof fetch = fetch,
): Promise<GalleryPublishOutcome> {
  return sendGalleryProject(
    "/api/gallery/submissions",
    "POST",
    project,
    fields,
    fetchLike,
  );
}

/** Owner or moderator update of an existing entry. */
export function updateGalleryEntry(
  entryId: string,
  project: CircuitProject,
  fields: GalleryPublishFields,
  fetchLike: typeof fetch = fetch,
): Promise<GalleryPublishOutcome> {
  return sendGalleryProject(
    `/api/gallery/${entryId}`,
    "PUT",
    project,
    fields,
    fetchLike,
  );
}

/** One human-readable line per outcome, shown in the dialog or status bar. */
export function describePublishOutcome(outcome: GalleryPublishOutcome): string {
  switch (outcome.status) {
    case "published":
      return "Published to the gallery";
    case "gate-failed":
      return "The submission did not pass the quality gates";
    case "unauthorized":
      return "Your sign-in has expired — sign in again to publish";
    case "too-large":
      return "This Project exceeds the gallery's 2 MB limit";
    case "rate-limited":
      return "Daily publish limit reached — try again tomorrow";
    case "rejected":
      return outcome.message === "invalid-fields"
        ? "Check the fields: a name is required, and the description has a length cap"
        : outcome.message === "invalid-project"
          ? "The Project failed strict validation on the server"
          : outcome.message === "forbidden"
            ? "Only the entry's owner or a moderator can update it"
            : `The gallery rejected the submission (${outcome.message})`;
    case "unreachable":
      return `Could not reach the gallery: ${outcome.message}`;
  }
}
