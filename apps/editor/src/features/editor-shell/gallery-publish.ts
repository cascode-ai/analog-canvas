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
  /**
   * The publisher's AI mark, shown as an AI tag on the card. An update that
   * leaves it out keeps the entry's mark.
   */
  aiGenerated?: boolean;
  /**
   * An AI account's update that takes another AI account's entry over
   * (#1499): the entry moves to the signed-in AI account's name.
   */
  takeOver?: boolean;
}

/**
 * The longest description the Worker accepts (`GALLERY_MAX_DESCRIPTION_LENGTH`),
 * counted after trimming.
 */
export const GALLERY_DESCRIPTION_LIMIT = 1000;

function galleryPublicationBinding(binding: CloudProjectBinding | null) {
  return binding
    ? {
        cloudProjectId: binding.id,
        expectedGalleryEntryId: binding.galleryEntryId ?? null,
      }
    : {};
}

export { canUpdateGalleryPublication } from "./gallery-publication-permission";
/** A Gallery read that failed, with the HTTP status that said so. */
export class GalleryReadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * What a publication leaves behind for the working copy, from the Publish
 * dialog or an Agent: the entry it is now bound to, as published.
 */
export interface GalleryPublicationRecord {
  id: string;
  name: string;
  description: string;
  tags: readonly string[];
  aiGenerated: boolean;
  updated: boolean;
  previewRevision?: string;
  /** The updated entry's owner and byline, when it is not the bound one. */
  ownerUserId?: string | null;
  author?: string;
}

export async function loadGalleryPublicationContext(
  id: string,
  projectId: string,
  fetchLike: typeof fetch = fetch,
): Promise<GalleryEntryContext | null> {
  // The entry's details alone: they cost no daily open.
  const response = await fetchLike(
    `/api/gallery/${encodeURIComponent(id)}?summary=1`,
    { credentials: "same-origin", cache: "no-store" },
  );
  if (response.status === 404) return null;
  if (!response.ok)
    throw new GalleryReadError(
      "Could not load the linked publication. Retry before publishing.",
      response.status,
    );
  const payload = (await response.json()) as {
    entry: {
      name: string;
      author: string;
      description?: string;
      tags?: string[];
      aiGenerated?: boolean;
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
    aiGenerated: payload.entry.aiGenerated === true,
  };
}

/** What the signed-in account may still publish today (`/api/gallery/quota`). */
export interface GalleryQuota {
  limit: number;
  used: number;
  remaining: number;
  /** The next UTC midnight: the day a submission counts in is a UTC day. */
  resetsAt: string;
  /** Curators publish without the allowance. */
  exempt: boolean;
}

/** Null when signed out or unreachable: the dialog then says nothing. */
export async function loadGalleryQuota(
  fetchLike: typeof fetch = fetch,
): Promise<GalleryQuota | null> {
  try {
    const response = await fetchLike("/api/gallery/quota", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) return null;
    const quota = (await response.json()) as Partial<GalleryQuota>;
    return typeof quota.remaining === "number" &&
      typeof quota.limit === "number" &&
      typeof quota.resetsAt === "string"
      ? {
          limit: quota.limit,
          used: quota.used ?? quota.limit - quota.remaining,
          remaining: quota.remaining,
          resetsAt: quota.resetsAt,
          exempt: quota.exempt === true,
        }
      : null;
  } catch {
    return null;
  }
}

/** What the dialog needs to know about the signed-in user. */
export interface PublishSessionUser {
  /** Also the byline: the server takes it from the account, not from us. */
  displayName: string;
  isAdmin: boolean;
  /** "user" or "moderator"; moderators bypass the quality gates. */
  role?: string;
  /** An AI account's seat: all it publishes carries the AI mark. */
  seat?: string;
}

export type GalleryPublishOutcome =
  | {
      status: "published";
      id: string;
      previewRevision?: string;
      /** After a take-over, the entry's new owner and byline. */
      ownerUserId?: string;
      author?: string;
    }
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
        ...(fields.aiGenerated === undefined
          ? {}
          : { aiGenerated: fields.aiGenerated }),
        ...(fields.takeOver ? { takeOver: true } : {}),
        // Publishing a drawing must not also publish private source comments
        // or model files. The frozen topology still supports routing guidance.
        projectText: serializeProject({
          ...project,
          source: {
            ...project.source,
            files: project.source.files.map(
              ({
                content: _content,
                originalContent: _original,
                ...metadata
              }) => metadata,
            ),
          },
        }),
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
      ownerUserId?: unknown;
      author?: unknown;
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
      // A take-over names the entry's new owner and byline.
      ...(typeof payload?.ownerUserId === "string" &&
      typeof payload.author === "string"
        ? { ownerUserId: payload.ownerUserId, author: payload.author }
        : {}),
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
      return "Daily publish limit reached — it resets at 00:00 UTC";
    case "rejected":
      return outcome.message === "publication-link-conflict"
        ? "This Project’s publication link changed elsewhere. Reopen the saved Project before publishing."
        : outcome.message === "cloud-project-not-found"
          ? "This Shelf draft no longer exists or belongs to a different account. Your canvas has not been changed."
          : outcome.message === "invalid-fields"
            ? `Check the fields: a name is required, and the description can be at most ${GALLERY_DESCRIPTION_LIMIT} characters`
            : outcome.message === "invalid-project"
              ? "The Project failed strict validation on the server"
              : outcome.message === "forbidden"
                ? "Only the entry's owner or a moderator can update it; an AI account can take over another AI account's circuit with a take-over"
                : outcome.message === "take-over-forbidden"
                  ? "Only an AI account can take over a circuit, and only another AI account's: a person's circuit is never taken over"
                  : `The gallery rejected the submission (${outcome.message})`;
    case "unreachable":
      return `Could not reach the gallery: ${outcome.message}`;
  }
}
