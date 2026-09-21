import type { SubmissionGateFailure } from "@icm/derived";
import type { GalleryEntryContext } from "./gallery-example-commands";
import type { CloudProjectBinding } from "./cloud-projects";
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

export function galleryPublicationBinding(binding: CloudProjectBinding | null) {
  return binding
    ? {
        cloudProjectId: binding.id,
        expectedGalleryEntryId: binding.galleryEntryId ?? null,
      }
    : {};
}

export function canUpdateGalleryPublication(
  context: GalleryEntryContext | null,
  user: { id: string; isAdmin: boolean; role?: string } | null,
): boolean {
  return !!(
    context &&
    user &&
    (user.isAdmin ||
      user.role === "moderator" ||
      context.ownerUserId === user.id)
  );
}

export async function loadGalleryPublicationContext(
  id: string,
  projectId: string,
  fetchLike: typeof fetch = fetch,
): Promise<GalleryEntryContext | null> {
  const response = await fetchLike(`/api/gallery/${encodeURIComponent(id)}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(
      "Could not load the linked publication. Retry before publishing.",
    );
  const payload = (await response.json()) as {
    entry: {
      name: string;
      author: string;
      description?: string;
      tags?: string[];
    };
    ownerUserId?: string | null;
  };
  return {
    id,
    projectId,
    name: payload.entry.name,
    ownerUserId: payload.ownerUserId ?? null,
    author: payload.entry.author,
    description: payload.entry.description ?? "",
    tags: payload.entry.tags ?? [],
  };
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
  | { status: "published"; id: string; previewRevision?: string }
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
  binding: CloudProjectBinding | null,
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
        ...galleryPublicationBinding(binding),
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
      previewRevision?: unknown;
    } | null;
    const previewRevision =
      typeof payload?.previewRevision === "string" &&
      payload.previewRevision.length > 0
        ? payload.previewRevision
        : undefined;
    return {
      status: "published",
      id: typeof payload?.id === "string" ? payload.id : "",
      ...(previewRevision === undefined ? {} : { previewRevision }),
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
  binding: CloudProjectBinding | null = null,
): Promise<GalleryPublishOutcome> {
  return sendGalleryProject(
    "/api/gallery/submissions",
    "POST",
    project,
    fields,
    fetchLike,
    binding,
  );
}

/** Owner or moderator update of an existing entry. */
export function updateGalleryEntry(
  entryId: string,
  project: CircuitProject,
  fields: GalleryPublishFields,
  fetchLike: typeof fetch = fetch,
  binding: CloudProjectBinding | null = null,
): Promise<GalleryPublishOutcome> {
  return sendGalleryProject(
    `/api/gallery/${entryId}`,
    "PUT",
    project,
    fields,
    fetchLike,
    binding,
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
      return outcome.message === "publication-link-conflict"
        ? "This Project’s publication link changed elsewhere. Reopen the saved Project before publishing."
        : outcome.message === "cloud-project-not-found"
          ? "This Shelf draft no longer exists or belongs to a different account. Your canvas has not been changed."
          : outcome.message === "invalid-fields"
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
