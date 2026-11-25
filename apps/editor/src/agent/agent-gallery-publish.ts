import {
  AGENT_API_VERSION,
  type AgentGalleryPublishAdvice,
  type AgentProjectResourceRequest,
  type AgentProjectResourceResponse,
} from "@icm/agent-adapter";
import type { SubmissionGateReport } from "@icm/derived";
import type { CircuitProject } from "@icm/model";

import type { CloudProjectBinding } from "../features/editor-shell/cloud-projects";
import type { GalleryEntryContext } from "../features/editor-shell/gallery-example-commands";
import {
  describePublishOutcome,
  GalleryReadError,
  loadGalleryPublicationContext,
  publishProjectToGallery,
  updateGalleryEntry,
  type GalleryPublicationRecord,
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

/**
 * The first MCP release whose parser reads `advice` on a publish response.
 * Adapters parse strictly, so an older one is never sent it.
 */
const PUBLISH_ADVICE_ADAPTER_VERSION = [0, 17, 128] as const;

/** Whether the adapter at `version` reads a publish response's `advice`. */
export function adapterReadsPublishAdvice(
  version: string | null | undefined,
): boolean {
  const parts = /^(\d+)\.(\d+)\.(\d+)/u.exec(version ?? "");
  if (!parts) return false;
  for (const [index, wanted] of PUBLISH_ADVICE_ADAPTER_VERSION.entries()) {
    const part = Number(parts[index + 1]);
    if (part !== wanted) return part > wanted;
  }
  return true;
}

/** The Publish dialog's advice, in the response's own shape. */
export function publishAdviceOf(
  report: SubmissionGateReport,
): AgentGalleryPublishAdvice[] {
  return report.failures.map((failure) => ({
    code: failure.code,
    message: failure.message,
    count: failure.count,
    examples: [...failure.examples],
    ...(failure.findings
      ? {
          findings: failure.findings.map((finding) => ({
            ...finding,
            objectIds: [...finding.objectIds],
          })),
        }
      : {}),
  }));
}

export interface AgentGalleryPublisherOptions<
  State extends AgentGalleryPublication,
> {
  /** The bound working copy, or null when its tab is not the one shown. */
  current: () => State | null;
  /** Records a publication as the Publish dialog's success does. */
  published: (outcome: GalleryPublicationRecord, state: State) => void;
  /**
   * The Publish dialog's quality advice on the copy sent, or null when the
   * connected adapter cannot read it (`adapterReadsPublishAdvice`).
   */
  advice?: (state: State) => readonly AgentGalleryPublishAdvice[] | null;
  fetch?: typeof fetch;
}

/**
 * An Agent's Publish and Update to Gallery (#1415): the Publish dialog's own
 * client, under the signed-in Editor session, on the working copy its tab
 * shows. What an Agent sends is marked AI, an update included; its author
 * changes the mark in the Editor. An update keeps the entry's fields it does
 * not name.
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
    const fetchLike = options.fetch ?? fetch;
    // A new name or description alone needs no working copy: the entry's
    // details change in place, its drawing kept (#2429).
    if (
      !state &&
      request.operation === "update-gallery-entry" &&
      request.galleryEntryId &&
      request.tags === undefined &&
      !request.takeOver &&
      (request.name !== undefined || request.description !== undefined)
    ) {
      let stored: GalleryEntryContext | null;
      try {
        stored = await loadGalleryPublicationContext(
          request.galleryEntryId,
          "",
          fetchLike,
        );
      } catch (error) {
        return error instanceof GalleryReadError && error.status === 401
          ? fail(
              "SIGN_IN_REQUIRED",
              "Sign in to the Editor to update a Gallery entry",
              "sign-in",
            )
          : fail(
              "GALLERY_UNAVAILABLE",
              `Gallery entry ${request.galleryEntryId} could not be read; nothing was changed`,
              "retry",
            );
      }
      if (!stored)
        return fail(
          "GALLERY_ENTRY_NOT_FOUND",
          `Gallery entry ${request.galleryEntryId} does not exist`,
          "fix-input",
        );
      const response = await fetchLike(
        `/api/gallery/${encodeURIComponent(request.galleryEntryId)}`,
        {
          method: "PATCH",
          credentials: "same-origin",
          headers: {
            "content-type": "application/json",
            "idempotency-key": request.requestId,
          },
          body: JSON.stringify({
            name: (request.name ?? stored.name).trim(),
            description: (request.description ?? stored.description).trim(),
          }),
        },
      );
      if (!response.ok)
        return response.status === 401
          ? fail(
              "SIGN_IN_REQUIRED",
              "Sign in to the Editor to update a Gallery entry",
              "sign-in",
            )
          : fail(
              "GALLERY_REJECTED",
              `The Gallery refused the new details (${response.status}); nothing was changed`,
              response.status >= 500 ? "retry" : "fix-input",
            );
      return {
        apiVersion: AGENT_API_VERSION,
        requestId: request.requestId,
        operation: request.operation,
        ok: true,
        galleryEntryId: request.galleryEntryId,
        url: `/g/${request.galleryEntryId}`,
      };
    }
    if (!state)
      return fail(
        "WORKSPACE_NOT_SHOWN",
        "Publishing takes the Project its tab shows: activate this working copy first (workspace activate); a new name or description alone needs only galleryEntryId",
        "fix-input",
      );
    let target: GalleryEntryContext | null = null;
    if (request.operation === "update-gallery-entry") {
      const entryId = request.galleryEntryId ?? state.linked?.id;
      if (!entryId)
        return fail(
          "NO_LINKED_GALLERY_ENTRY",
          "This working copy is not linked to a Gallery entry (one gallery_circuits open made never is): give galleryEntryId, or publish it as a new entry",
          "fix-input",
        );
      // The entry's stored fields are the defaults, not a copy held locally.
      try {
        target = await loadGalleryPublicationContext(
          entryId,
          state.project.id,
          fetchLike,
        );
      } catch (error) {
        return error instanceof GalleryReadError && error.status === 401
          ? fail(
              "SIGN_IN_REQUIRED",
              "Sign in to the Editor to update a Gallery entry",
              "sign-in",
            )
          : fail(
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
          aiGenerated: true,
          ...(request.operation === "update-gallery-entry" && request.takeOver
            ? { takeOver: true }
            : {}),
        }
      : {
          name: request.name ?? state.project.name,
          description: request.description ?? "",
          tags: request.tags ?? [],
          aiGenerated: true,
        };
    // Read before sending: advice describes the drawing as published.
    const advice = options.advice?.(state) ?? null;
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
        aiGenerated: true,
        updated: target !== null,
        ...(target
          ? {
              // A take-over moves the entry to the signed-in AI account.
              ownerUserId: outcome.ownerUserId ?? target.ownerUserId,
              author: outcome.author ?? target.author,
            }
          : {}),
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
      ...(advice?.length ? { advice: [...advice] } : {}),
    };
  };
}
