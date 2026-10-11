import {
  AGENT_API_VERSION,
  type AgentComponentLibraryAction,
  type AgentProjectResourceRequest,
  type AgentProjectResourceResponse,
} from "@icm/agent-adapter";
import { buildCircuitComponentPackage } from "@icm/edit-engine";
import type { CircuitProject } from "@icm/model";
import { externalSubcircuitSymbolId } from "@icm/symbols";
import {
  ComponentLibraryError,
  loadSharedComponents,
  loadSharedComponentSummaries,
  readSharedComponent,
} from "../features/user-components/component-library-client";
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
  componentPublicationSnapshot,
  publicationAccount,
} from "../features/user-components/component-publication-operation";
import { publicationFromOrigin } from "../features/user-components/component-publication";
import type { BrowserAgentProjectHostOptions } from "./browser-agent-project-host";

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
  action: Extract<AgentComponentLibraryAction, { projectId: string }>,
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
    if (action.action === "browse") {
      const page = await loadSharedComponentSummaries(
        action.query ?? "",
        action.cursor ?? null,
        false,
        undefined,
        fetchLibrary,
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
      const snapshot = await componentPublicationSnapshot(
        action.componentId,
        action.idempotencyKey,
      );
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
      const receipt = await executeComponentPublication({
        componentId: action.componentId,
        revision:
          action.action === "publish" ? 0 : action.expectedLibraryRevision,
        payload,
        fetch: fetchLibrary,
        idempotencyKey: action.idempotencyKey,
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
      const snapshot = await componentPublicationSnapshot(
        action.newComponentId,
        action.idempotencyKey,
      );
      let payload = snapshot;
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
      entry = await readSharedComponent(action.componentId, fetchLibrary);
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
      error instanceof ComponentOperationError
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
