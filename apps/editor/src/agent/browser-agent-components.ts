import {
  AGENT_API_VERSION,
  type AgentComponentLibraryAction,
  type AgentProjectResourceRequest,
  type AgentProjectResourceResponse,
  componentAuthoringCapability,
} from "@icm/agent-adapter";
import {
  buildCircuitComponentPackage,
  componentDraftCatalog,
} from "@icm/edit-engine";
import { deleteComponentDrafts } from "../features/user-components/component-draft-management";
import type { CircuitProject } from "@icm/model";
import { externalSubcircuitSymbolId } from "@icm/symbols";
import {
  ComponentLibraryError,
  loadSharedComponents,
  loadSharedComponentSummaries,
  readSharedComponent,
  changeComponentLifecycle,
  readSharedComponentRecord,
  readComponentVersions,
} from "../features/user-components/component-library-client";
import { publicationRequest } from "../features/user-components/component-publication-journal";
import {
  parseSharedComponentPayload,
  type SharedComponent,
} from "../features/user-components/component-library-contract";
import { planComponentPlacement } from "../features/user-components/component-placement";
import {
  componentLibraryCapture,
  componentLibraryAssociation,
} from "../features/user-components/component-library-origin";
import {
  executeComponentPublication,
  publicationAccount,
  sameNameTarget,
} from "../features/user-components/component-publication-operation";
import { publicationFromOrigin } from "../features/user-components/component-publication";
import type { BrowserAgentProjectHostOptions } from "./browser-agent-project-host";
import {
  currentComponentAuthoring,
  ComponentAuthoringError,
} from "../features/user-components/component-authoring-workspace";

type Request = Extract<
  AgentProjectResourceRequest,
  { operation: "components" }
>;
type Recovery = "sign-in" | "refresh" | "fix-input" | "retry";
class ComponentOperationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly recovery: Recovery = "fix-input",
  ) {
    super(message);
  }
}
function expectProject(
  project: CircuitProject,
  action: Extract<
    AgentComponentLibraryAction,
    { projectId: string; expectedStructureRevision: number }
  >,
) {
  if (project.id !== action.projectId)
    throw new ComponentOperationError(
      "PROJECT_REPLACED",
      "Select the currently bound Project before retrying",
      "refresh",
    );
  if (project.structureRevision !== action.expectedStructureRevision)
    throw new ComponentOperationError(
      "STALE_STRUCTURE_REVISION",
      `Project revision is ${project.structureRevision}; reread before retrying`,
      "refresh",
    );
}
function expectLibrary(entry: SharedComponent, expected: number) {
  if (entry.revision !== expected)
    throw new ComponentOperationError(
      "COMPONENT_REVISION_CONFLICT",
      `Component ${entry.id} is revision ${entry.revision}; read it before selecting a new revision`,
      "refresh",
    );
}
async function digest(entry: SharedComponent) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify({
        definition: entry.definition,
        ...(entry.circuit ? { circuit: entry.circuit } : {}),
      }),
    ),
  );
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Public service permissions and native package rules are shared with the GUI. */
export async function handleAgentComponents(
  request: Request,
  options: BrowserAgentProjectHostOptions,
  isBound: () => boolean,
): Promise<AgentProjectResourceResponse> {
  const base = {
    apiVersion: AGENT_API_VERSION,
    requestId: request.requestId,
    operation: "components" as const,
  };
  const fetchLibrary: typeof fetch = async (input, init) => {
    try {
      return await (options.fetch ?? fetch)(input, init);
    } catch (error) {
      const write = init?.method === "PUT";
      throw new ComponentOperationError(
        write ? "COMPONENT_WRITE_UNKNOWN" : "COMPONENT_LIBRARY_FAILED",
        write
          ? "Publication outcome is unknown. Retry with the same component ID, payload and idempotency key."
          : error instanceof Error
            ? error.message
            : "Component library request failed",
        "retry",
      );
    }
  };
  const assertBound = () => {
    if (!isBound() || options.isProjectAvailable?.() === false)
      throw new ComponentOperationError(
        "PROJECT_REPLACED",
        "The bound Project is no longer available",
        "refresh",
      );
  };
  try {
    assertBound();
    const action = request.request;
    if (action.action === "versions") {
      const { revision, versions } = await readComponentVersions(
        { id: action.componentId },
        undefined,
        fetchLibrary,
      );
      assertBound();
      return {
        ...base,
        ok: true,
        result: {
          action: "versions",
          componentId: action.componentId,
          revision,
          versions,
        },
      };
    }
    if (
      action.action === "delete" ||
      action.action === "restore" ||
      action.action === "make-public" ||
      action.action === "make-private"
    ) {
      const result = await changeComponentLifecycle(
        { id: action.componentId, revision: action.expectedLibraryRevision },
        action.action,
        fetchLibrary,
      );
      assertBound();
      return {
        ...base,
        ok: true,
        result: { action: action.action, ...result },
      };
    }
    if (action.action === "record") {
      const record = await readSharedComponentRecord(
        {
          id: action.componentId,
          revision: action.expectedLibraryRevision,
          status: action.deleted ? "deleted" : "shared",
        },
        undefined,
        fetchLibrary,
      );
      assertBound();
      return { ...base, ok: true, result: { action: "record", record } };
    }
    if (action.action === "drafts" || action.action === "delete-drafts") {
      const project = options.getProject();
      if (
        action.projectId !== project.id ||
        action.projectSessionId !== options.getProjectSessionId()
      )
        throw new ComponentOperationError(
          "PROJECT_REPLACED",
          "Read the current Project session.",
          "refresh",
        );
      let reclaimBytes = 0;
      if (action.action === "delete-drafts") {
        expectProject(project, action);
        reclaimBytes = deleteComponentDrafts(
          project,
          action.projectSessionId,
          action.targets,
          (edits) => {
            assertBound();
            const result = options.dispatchProjectTransaction({
              transactionId: request.requestId,
              projectId: project.id,
              expectedStructureRevision: action.expectedStructureRevision,
              actor: { kind: "agent", id: "component-drafts" },
              edits,
            });
            return result.ok ? null : result.error.message;
          },
          action.dryRun,
        );
      }
      const current = options.getProject();
      const result = {
        projectId: current.id,
        projectSessionId: action.projectSessionId,
        structureRevision: current.structureRevision,
        catalog: componentDraftCatalog(current),
      };
      return {
        ...base,
        ok: true,
        result:
          action.action === "drafts"
            ? { action: "drafts", ...result }
            : {
                action: "delete-drafts",
                ...result,
                reclaimBytes,
                dryRun: action.dryRun,
              },
      };
    }
    if (action.action === "authoring-read") {
      const workspace = currentComponentAuthoring(
        options.getProjectSessionId(),
      );
      return {
        ...base,
        ok: true,
        result: {
          action: "authoring-read",
          capabilities: componentAuthoringCapability,
          workspace:
            workspace?.target.projectId === options.getProject().id
              ? workspace.snapshot()
              : null,
        },
      };
    }
    if (
      action.action === "authoring-update" ||
      action.action === "authoring-save" ||
      action.action === "authoring-apply"
    ) {
      const workspace = currentComponentAuthoring(
        options.getProjectSessionId(),
      );
      if (!workspace || workspace.target.projectId !== options.getProject().id)
        throw new ComponentAuthoringError(
          "AUTHORING_TARGET_CLOSED",
          "Open the component editor and read its current authoring workspace.",
        );
      if (action.action === "authoring-update") {
        const before = workspace.getRevision();
        const updated = workspace.update(
          action.target,
          action.expectedCandidateRevision,
          action.candidate,
        );
        if (before !== workspace.getRevision()) workspace.noteAgentEdit();
        return {
          ...base,
          ok: true,
          result: {
            action: action.action,
            workspace: updated,
          },
        };
      }
      const result = workspace.run(
        action.target,
        action.expectedCandidateRevision,
        action.action === "authoring-save" ? "save" : "apply",
        action.action === "authoring-apply" && action.dryRun,
      );
      if (action.action === "authoring-save" || !action.dryRun)
        workspace.noteAgentEdit();
      return {
        ...base,
        ok: true,
        result:
          action.action === "authoring-save"
            ? { action: action.action, workspace: result }
            : {
                action: action.action,
                dryRun: action.dryRun,
                applied: !action.dryRun,
                workspace: result,
              },
      };
    }
    if (action.action === "browse") {
      const page = await loadSharedComponentSummaries(
        action.query ?? "",
        action.cursor ?? null,
        action.deleted ?? false,
        undefined,
        fetchLibrary,
        action.catalog,
        action.ifCatalogRevision,
        action.includePrivate ?? false,
      );
      assertBound();
      return { ...base, ok: true, result: { action: "browse", ...page } };
    }
    if (action.action === "list") {
      const page = await loadSharedComponents(
        action.query ?? "",
        action.cursor ?? null,
        false,
        undefined,
        fetchLibrary,
      );
      assertBound();
      if (page.rejected?.length)
        throw new ComponentOperationError(
          "COMPONENT_INVALID",
          page.rejected
            .map((entry) => `${entry.id} (${entry.name}): ${entry.message}`)
            .join("; "),
        );
      return { ...base, ok: true, result: { action: "list", ...page } };
    }
    let entry: SharedComponent;
    let publication:
      | {
          version: 1;
          outcome: "created" | "updated" | "unchanged";
          recovered: boolean;
          association: "associated" | "pending" | "not-requested";
          diagnostic?: string;
        }
      | undefined;
    if (action.action === "inspect") {
      const project = options.getProject();
      expectProject(project, action);
      const definition = project.componentDefinitions?.find(
        (item) => item.symbol.id === action.selection.symbolId,
      );
      const selection = action.selection;
      const automatic =
        selection.kind === "circuit"
          ? project.externalSubcircuitDefinitions.find(
              (item) =>
                item.id === selection.definitionId &&
                !item.symbolId &&
                externalSubcircuitSymbolId(item.id) === selection.symbolId,
            )
          : undefined;
      if (!definition && !automatic)
        throw new ComponentOperationError(
          "COMPONENT_SYMBOL_MISSING",
          "Select an applied captured component.",
        );
      const origin = definition?.libraryOrigin ?? automatic?.libraryOrigin;
      const account = await publicationAccount(fetchLibrary);
      const current = origin
        ? await readSharedComponent(origin.componentId, fetchLibrary)
        : undefined;
      const destination =
        origin && current && account
          ? publicationFromOrigin(origin, current, account)
          : { kind: "new" as const, componentId: crypto.randomUUID() };
      assertBound();
      return {
        ...base,
        ok: true,
        result: {
          action: "inspect",
          ...(origin ? { origin } : {}),
          destination,
          stale: !!origin && current?.revision !== origin.revision,
        },
      };
    }
    if (action.action === "publish" || action.action === "update") {
      const project = options.getProject();
      // A retry resends its first request: the destination it chose included.
      const account = await publicationAccount(fetchLibrary);
      const keyed = account
        ? await publicationRequest(account.id, action.idempotencyKey)
        : undefined;
      // Only a publish may have been sent to another record of its name;
      // any other mismatch is refused by the publication journal.
      const prior =
        keyed &&
        (keyed.componentId === action.componentId ||
          (action.action === "publish" && action.onSameName !== "new"))
          ? keyed
          : undefined;
      let componentId = prior?.componentId ?? action.componentId;
      let revision =
        prior?.revision ??
        (action.action === "publish" ? 0 : action.expectedLibraryRevision);
      // Omitted on publish: public, as before; on update: unchanged.
      let visibility = prior ? prior.visibility : action.visibility;
      const snapshot = prior ? structuredClone(prior.payload) : undefined;
      if (snapshot && project.id !== action.projectId)
        throw new ComponentOperationError(
          "PROJECT_REPLACED",
          "Select the original publication Project.",
          "refresh",
        );
      if (!snapshot) expectProject(project, action);
      let payload = snapshot;
      if (!payload && action.selection.kind === "circuit") {
        const selection = action.selection;
        const owner = project.externalSubcircuitDefinitions.find(
          (item) => item.id === selection.definitionId,
        );
        const source =
          owner?.implementation?.kind === "source"
            ? project.modelSources?.find(
                (item) => item.id === owner.implementation!.sourceId,
              )
            : undefined;
        if (!source || source.revision !== selection.sourceRevision)
          throw new ComponentOperationError(
            "COMPONENT_SOURCE_CONFLICT",
            "Read the native source revision before publishing",
            "refresh",
          );
        const applied = selection.appliedVersion
          ? {
              ...project,
              modelSources: project.modelSources?.map(
                ({ draft: _draft, ...source }) => source,
              ),
            }
          : project;
        payload = buildCircuitComponentPackage(
          applied,
          selection.definitionId,
          selection.symbolId,
        );
      } else if (!payload) {
        const definition = project.componentDefinitions?.find(
          (item) => item.symbol.id === action.selection.symbolId,
        );
        if (!definition)
          throw new ComponentOperationError(
            "COMPONENT_SYMBOL_MISSING",
            "Select an applied, captured component symbol",
          );
        payload = parseSharedComponentPayload({ definition });
      }
      if (
        !prior &&
        account &&
        action.action === "publish" &&
        action.onSameName !== "new"
      ) {
        // A name the author already uses gets a new version, not a new card.
        // An older call (no visibility) only ever versions a public record.
        const same = await sameNameTarget(payload, {
          publicOnly: !action.visibility,
          fetch: fetchLibrary,
        });
        if (same) {
          componentId = same.id;
          revision = same.revision;
          // Saving privately never withdraws a public record.
          visibility = action.visibility === "public" ? "public" : undefined;
        }
      }
      const receipt = await executeComponentPublication({
        componentId,
        revision,
        payload,
        fetch: fetchLibrary,
        idempotencyKey: action.idempotencyKey,
        ...(visibility ? { visibility } : {}),
      });
      entry = receipt.entry;
      publication = {
        version: 1,
        outcome: receipt.outcome,
        recovered: receipt.recovered,
        association: "pending",
      };
      try {
        assertBound();
        const current = options.getProject();
        const captured = await componentLibraryCapture(entry);
        assertBound();
        const edits = componentLibraryAssociation(
          current,
          action.selection.symbolId,
          captured,
        );
        if (edits.length) {
          const result = options.dispatchProjectTransaction({
            transactionId: `${request.requestId}-association`,
            projectId: current.id,
            expectedStructureRevision: current.structureRevision,
            actor: { kind: "agent", id: "agent-components" },
            edits,
          });
          if (!result.ok) throw Error(result.error.message);
        }
        publication.association = "associated";
      } catch (error) {
        publication.diagnostic =
          error instanceof Error ? error.message : String(error);
      }
    } else if (action.action === "fork") {
      const account = await publicationAccount(fetchLibrary);
      const prior = account
        ? await publicationRequest(account.id, action.idempotencyKey)
        : undefined;
      let payload =
        prior?.componentId === action.newComponentId
          ? structuredClone(prior.payload)
          : undefined;
      if (!payload) {
        const source = await readSharedComponent(
          action.componentId,
          fetchLibrary,
        );
        assertBound();
        expectLibrary(source, action.expectedLibraryRevision);
        payload = {
          definition: source.definition,
          ...(source.circuit ? { circuit: source.circuit } : {}),
        };
      }
      const receipt = await executeComponentPublication({
        componentId: action.newComponentId,
        revision: 0,
        payload,
        fetch: fetchLibrary,
        idempotencyKey: action.idempotencyKey,
      });
      entry = receipt.entry;
      publication = {
        version: 1,
        outcome: receipt.outcome,
        recovered: receipt.recovered,
        association: "not-requested",
      };
    } else {
      entry = await readSharedComponent(
        action.componentId,
        fetchLibrary,
        action.action === "read",
      );
      assertBound();
      if (action.action === "insert") {
        expectLibrary(entry, action.expectedLibraryRevision);
        const project = options.getProject();
        expectProject(project, action);
        const document = project.documents.find(
          (item) => item.id === action.targetDocumentId,
        );
        if (!document)
          throw new ComponentOperationError(
            "DOCUMENT_NOT_FOUND",
            "Select an existing target Cell",
          );
        if (document.revision !== action.expectedRevision)
          throw new ComponentOperationError(
            "STALE_DOCUMENT_REVISION",
            `Cell revision is ${document.revision}; reread before inserting`,
            "refresh",
          );
        const { definitionId, symbolId, instance, edits } =
          planComponentPlacement(
            project,
            document.id,
            await componentLibraryCapture(entry),
            `library-${entry.id}-r${entry.revision}`,
            { position: action.position, rotation: 0, mirror: "none" },
            { ...(action.reference ? { reference: action.reference } : {}) },
          );
        assertBound();
        const result = options.dispatchProjectTransaction({
          transactionId: request.requestId,
          projectId: project.id,
          expectedStructureRevision: action.expectedStructureRevision,
          actor: { kind: "agent", id: "agent-components" },
          edits,
        });
        if (!result.ok)
          throw new ComponentOperationError(
            "COMPONENT_INSERT_REJECTED",
            result.error.message,
            "refresh",
          );
        return {
          ...base,
          ok: true,
          result: {
            action: "insert",
            componentId: entry.id,
            libraryRevision: entry.revision,
            instanceId: instance.id,
            symbolId,
            ...(definitionId ? { definitionId } : {}),
            structureRevision: result.project.structureRevision,
            revision: result.project.documents.find(
              (item) => item.id === document.id,
            )!.revision,
          },
        };
      }
    }
    const contentDigest = await digest(entry);
    if (!publication) assertBound();
    return {
      ...base,
      ok: true,
      result: {
        action: action.action as "read" | "publish" | "update" | "fork",
        entry,
        digest: contentDigest,
        ...(publication &&
        "publicationVersion" in action &&
        action.publicationVersion === 1
          ? { publication }
          : {}),
      },
    };
  } catch (error) {
    const failure =
      error instanceof ComponentAuthoringError
        ? new ComponentOperationError(
            error.code,
            error.message,
            error.code === "AUTHORING_INVALID" ? "fix-input" : "refresh",
          )
        : error instanceof ComponentOperationError
          ? error
          : error instanceof ComponentLibraryError
            ? new ComponentOperationError(
                error.code === "COMPONENT_ALREADY_PUBLISHED"
                  ? error.code
                  : error.outcomeUnknown
                    ? "COMPONENT_WRITE_UNKNOWN"
                    : error.status === 401
                      ? "SIGN_IN_REQUIRED"
                      : error.status === 403
                        ? "COMPONENT_PERMISSION_DENIED"
                        : error.status === 409
                          ? "COMPONENT_REVISION_CONFLICT"
                          : error.status === 404
                            ? "COMPONENT_NOT_FOUND"
                            : "COMPONENT_LIBRARY_FAILED",
                error.existing
                  ? `${error.message} Existing component: ${error.existing.id}, revision ${error.existing.revision}.`
                  : error.message,
                error.status === 401
                  ? "sign-in"
                  : error.status === 409
                    ? "refresh"
                    : error.status >= 500 || error.status === 408
                      ? "retry"
                      : "fix-input",
              )
            : new ComponentOperationError(
                "COMPONENT_INVALID",
                `${"componentId" in request.request ? request.request.componentId + ": " : ""}${error instanceof Error ? error.message : String(error)}. Use browse diagnostics to locate definition repairs.`,
              );
    return {
      ...base,
      ok: false,
      error: {
        code: failure.code,
        message: failure.message,
        recovery: failure.recovery,
        ...(error instanceof ComponentLibraryError &&
        error.existing &&
        "publicationVersion" in request.request &&
        request.request.publicationVersion === 1
          ? { component: error.existing }
          : {}),
      },
    };
  }
}
