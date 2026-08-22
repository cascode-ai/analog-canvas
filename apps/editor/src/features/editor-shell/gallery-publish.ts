import type { SubmissionGateFailure } from "@icm/derived";
import type { CircuitProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";

/**
 * Client for the documented gallery submissions endpoint
 * (docs/specs/community-gallery.md). Phase G1 gates publishing behind the
 * owner's admin passphrase; the same call path later carries the signed-in
 * session instead. The fetch seam keeps the mapping testable offline.
 */

export interface GalleryPublishFields {
  name: string;
  author: string;
  description: string;
  /** Owner passphrase; empty when an admin session authenticates instead. */
  token: string;
}

/** What the dialog needs to know about the signed-in user (phase G2). */
export interface PublishSessionUser {
  displayName: string;
  isAdmin: boolean;
  /** "user" or "moderator"; moderators publish directly (phase G3). */
  role?: string;
}

export type GalleryPublishOutcome =
  | { status: "published"; id: string }
  | { status: "pending-review"; id: string }
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
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  // Without a passphrase the session cookie authenticates instead.
  if (fields.token) headers.authorization = `Bearer ${fields.token}`;
  let response: Response;
  try {
    response = await fetchLike(url, {
      method,
      credentials: "same-origin",
      headers,
      body: JSON.stringify({
        name: fields.name.trim(),
        author: fields.author.trim(),
        description: fields.description.trim(),
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
      status?: unknown;
    } | null;
    const id = typeof payload?.id === "string" ? payload.id : "";
    return payload?.status === "pending"
      ? { status: "pending-review", id }
      : { status: "published", id };
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

/** Owner/reviewer update of an existing entry (phase G3 completion). */
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
    case "pending-review":
      return "Submitted — your circuit is waiting for review";
    case "gate-failed":
      return "The submission did not pass the quality gates";
    case "unauthorized":
      return "The passphrase was not accepted, so it was forgotten — ask the gallery owner for the current one";
    case "too-large":
      return "This Project exceeds the gallery's 2 MB limit";
    case "rate-limited":
      return "Daily publish limit reached — try again tomorrow";
    case "rejected":
      return outcome.message === "invalid-fields"
        ? "Check the fields: a name is required; author and description have length caps"
        : outcome.message === "invalid-project"
          ? "The Project failed strict validation on the server"
          : outcome.message === "forbidden"
            ? "Only the entry's owner or a reviewer can update it"
            : `The gallery rejected the submission (${outcome.message})`;
    case "unreachable":
      return `Could not reach the gallery: ${outcome.message}`;
  }
}

const TOKEN_STORAGE_KEY = "icm.gallery-publish-token.v1";
const AUTHOR_STORAGE_KEY = "icm.gallery-publish-author.v1";

type TokenStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function sessionStorageOrNull(): TokenStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function localStorageOrNull(): TokenStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The author byline used last time, prefill for the next publish. */
export function rememberedPublishAuthor(
  storage: TokenStorage | null = localStorageOrNull(),
): string {
  try {
    return storage?.getItem(AUTHOR_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Remember (non-empty) or forget (empty) the author byline. */
export function rememberPublishAuthor(
  author: string,
  storage: TokenStorage | null = localStorageOrNull(),
): void {
  try {
    const trimmed = author.trim();
    if (trimmed) storage?.setItem(AUTHOR_STORAGE_KEY, trimmed);
    else storage?.removeItem(AUTHOR_STORAGE_KEY);
  } catch {
    // Local storage may be unavailable; the byline is just not remembered.
  }
}

/** The passphrase remembered for this browser session, if any. */
export function rememberedPublishToken(
  storage: TokenStorage | null = sessionStorageOrNull(),
): string {
  try {
    return storage?.getItem(TOKEN_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

/** A 401 forgets the remembered passphrase; reports whether it did. */
export function forgetOnUnauthorized(
  outcome: GalleryPublishOutcome,
  storage: TokenStorage | null = sessionStorageOrNull(),
): boolean {
  if (outcome.status !== "unauthorized") return false;
  rememberPublishToken("", storage);
  return true;
}

/** Remember (non-empty) or forget (empty) the passphrase for this session. */
export function rememberPublishToken(
  token: string,
  storage: TokenStorage | null = sessionStorageOrNull(),
): void {
  try {
    if (token) storage?.setItem(TOKEN_STORAGE_KEY, token);
    else storage?.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Session storage may be unavailable (private mode); publishing still
    // works, the passphrase is just not remembered.
  }
}
