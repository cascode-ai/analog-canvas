import {
  AGENT_API_VERSION,
  type AgentProjectResourceRequest,
  type AgentProjectResourceResponse,
} from "@icm/agent-adapter";
import type { CircuitProject } from "@icm/model";

import type { CloudProjectBinding } from "../features/editor-shell/cloud-projects";
import type { GalleryEntryContext } from "../features/editor-shell/gallery-example-commands";
import {
  describePublishOutcome,
  loadGalleryPublicationContext,
  publishProjectToGallery,
  updateGalleryEntry,
  type GalleryPublishFields,
} from "../features/editor-shell/gallery-publish";

export type AgentGalleryPublishRequest = Extract<
  AgentProjectResourceRequest,
  { operation: "publish-gallery-entry" | "update-gallery-entry" }
>;

/** The working copy as Publish to Gallery sees it. */
export interface AgentGalleryPublication {
  project: CircuitProject;
  /** The entry the working copy was published as or opened from. */
  linked: GalleryEntryContext | null;
  cloudBinding: CloudProjectBinding | null;
}

/** What the Publish dialog's success records, for the same bookkeeping. */
export interface AgentGalleryPublished {
  id: string;
  name: string;
  description: string;
  tags: readonly string[];
  aiGenerated: boolean;
  updated: boolean;
  previewRevision?: string;
}

export interface AgentGalleryPublisherOptions<
  State extends AgentGalleryPublication,
> {
  /** The bound working copy, or null when its tab is not the one shown. */
  current: () => State | null;
  /** Records a publication as the Publish dialog's success does. */
  published: (outcome: AgentGalleryPublished, state: State) => void;
  fetch?: typeof fetch;
}

/**
 * An Agent's Publish and Update to Gallery (#1415): the Publish dialog's own
 * client, under the signed-in Editor session, on the working copy its tab
 * shows. A new entry an Agent publishes carries the AI mark unless the request
 * says otherwise; an update keeps the entry's fields, mark included, unless it
 * names new ones.
 */
export function createAgentGalleryPublisher<
  State extends AgentGalleryPublication,
>(options: AgentGalleryPublisherOptions<State>) {
  return async (
    request: AgentGalleryPublishRequest,
  ): Promise<AgentProjectResourceResponse> => {
    const fail = (
      code: string,
      message: string,
      recovery: "sign-in" | "refresh" | "fix-input" | "retry",
    ): AgentProjectResourceResponse => ({
      apiVersion: AGENT_API_VERSION,
      requestId: request.requestId,
      operation: request.operation,
      ok: false,
      error: { code, message, recovery },
    });
    const state = options.current();
    if (!state)
      return fail(
        "WORKSPACE_NOT_SHOWN",
        "Publishing takes the Project its tab shows: activate this working copy first (workspace activate)",
        "fix-input",
      );
    const fetchLike = options.fetch ?? fetch;
    let target: GalleryEntryContext | null = null;
    if (request.operation === "update-gallery-entry") {
      const entryId = request.galleryEntryId ?? state.linked?.id;
      if (!entryId)
        return fail(
          "NO_LINKED_GALLERY_ENTRY",
          "This working copy was not published as or opened from a Gallery entry: give galleryEntryId, or publish it as a new entry",
          "fix-input",
        );
      // The entry's stored fields are the defaults, not a copy held locally.
      try {
        target = await loadGalleryPublicationContext(
          entryId,
          state.project.id,
          fetchLike,
        );
      } catch {
        return fail(
          "GALLERY_UNAVAILABLE",
          `Gallery entry ${entryId} could not be read; nothing was published`,
          "retry",
        );
      }
      if (!target)
        return fail(
          "GALLERY_ENTRY_NOT_FOUND",
          `Gallery entry ${entryId} does not exist`,
          "fix-input",
        );
    }
    const fields: GalleryPublishFields = target
      ? {
          name: request.name ?? target.name,
          description: request.description ?? target.description,
          tags: request.tags ?? target.tags,
          ...(request.aiGenerated === undefined
            ? {}
            : { aiGenerated: request.aiGenerated }),
        }
      : {
          name: request.name ?? state.project.name,
          description: request.description ?? "",
          tags: request.tags ?? [],
          aiGenerated: request.aiGenerated ?? true,
        };
    // The Shelf draft's link follows its own publication, as in the dialog.
    const binding =
      !target || target.id === state.linked?.id ? state.cloudBinding : null;
    const outcome = target
      ? await updateGalleryEntry(
          target.id,
          state.project,
          fields,
          fetchLike,
          binding,
        )
      : await publishProjectToGallery(
          state.project,
          fields,
          fetchLike,
          binding,
        );
    if (outcome.status !== "published")
      return fail(
        outcome.status === "unauthorized"
          ? "SIGN_IN_REQUIRED"
          : outcome.status === "rate-limited"
            ? "GALLERY_DAILY_LIMIT"
            : outcome.status === "too-large"
              ? "GALLERY_TOO_LARGE"
              : outcome.status === "gate-failed"
                ? "GALLERY_QUALITY_GATES"
                : outcome.status === "unreachable"
                  ? "GALLERY_UNAVAILABLE"
                  : "GALLERY_REJECTED",
        describePublishOutcome(outcome),
        outcome.status === "unauthorized"
          ? "sign-in"
          : outcome.status === "rate-limited" ||
              outcome.status === "unreachable"
            ? "retry"
            : "fix-input",
      );
    options.published(
      {
        id: outcome.id,
        name: fields.name.trim(),
        description: fields.description.trim(),
        tags: fields.tags,
        aiGenerated: fields.aiGenerated ?? target?.aiGenerated === true,
        updated: target !== null,
        ...(outcome.previewRevision === undefined
          ? {}
          : { previewRevision: outcome.previewRevision }),
      },
      state,
    );
    return {
      apiVersion: AGENT_API_VERSION,
      requestId: request.requestId,
      operation: request.operation,
      ok: true,
      galleryEntryId: outcome.id,
      url: `/g/${outcome.id}`,
      ...(outcome.previewRevision === undefined
        ? {}
        : { previewRevision: outcome.previewRevision }),
    };
  };
}
