import {
  AGENT_API_VERSION,
  type AgentComponentLibraryAction,
  type AgentProjectResourceRequest,
  type AgentProjectResourceResponse,
} from "@icm/agent-adapter";
import {
  buildCircuitComponentPackage,
  executeProjectTransaction,
  planCircuitComponentCapture,
  type ProjectStructureEdit,
} from "@icm/edit-engine";
import type { CircuitProject } from "@icm/model";
import { resolveDocumentStyleProfile } from "@icm/derived";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import {
  ComponentLibraryError,
  loadSharedComponents,
  readSharedComponent,
  saveSharedComponent,
} from "../features/user-components/component-library-client";
import {
  parseSharedComponentPayload,
  sharedComponentNetlist,
  type SharedComponent,
} from "../features/user-components/component-library-contract";
import { createNewInstance } from "../features/netlist-export/netlist-authoring";
import { defaultInstanceDisplayAnnotations } from "../features/instance-display/default-instance-display";
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
    if (action.action === "publish" || action.action === "update") {
      const project = options.getProject();
      expectProject(project, action);
      let payload;
      if (action.selection.kind === "circuit") {
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
      } else {
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
      entry = await saveSharedComponent(
        action.componentId,
        action.action === "publish" ? 0 : action.expectedLibraryRevision,
        payload.definition,
        payload.circuit,
        { fetch: fetchLibrary, idempotencyKey: action.idempotencyKey },
      );
    } else {
      entry = await readSharedComponent(action.componentId, fetchLibrary);
      assertBound();
      if (action.action === "fork") {
        expectLibrary(entry, action.expectedLibraryRevision);
        entry = await saveSharedComponent(
          action.newComponentId,
          0,
          entry.definition,
          entry.circuit,
          { fetch: fetchLibrary, idempotencyKey: action.idempotencyKey },
        );
      } else if (action.action === "insert") {
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
        let definitionId: string | undefined;
        let symbolId = entry.definition.symbol.id;
        let edits: ProjectStructureEdit[];
        if (entry.circuit) {
          const captured = planCircuitComponentCapture(
            project,
            { definition: entry.definition, circuit: entry.circuit },
            `library-${entry.id}-r${entry.revision}`,
          );
          ({ definitionId, symbolId } = captured);
          edits = captured.edits;
        } else
          edits = [
            {
              kind: "capture_component_definition",
              definition: entry.definition,
            },
          ];
        const preview = edits.length
          ? executeProjectTransaction(
              project,
              {
                transactionId: request.requestId + "-capture",
                projectId: project.id,
                expectedStructureRevision: project.structureRevision,
                actor: { kind: "agent", id: "agent-components" },
                edits,
              },
              options.projectTransactionOptions,
            )
          : { ok: true as const, project };
        if (!preview.ok)
          throw new ComponentOperationError(
            "COMPONENT_CAPTURE_REJECTED",
            preview.error.message,
          );
        const instance = createNewInstance(
          document,
          {
            symbolId,
            placement: {
              position: action.position,
              rotation: 0,
              mirror: "none",
            },
            netlist: definitionId
              ? {
                  parameters: {},
                  binding: { kind: "external-subcircuit", definitionId },
                }
              : sharedComponentNetlist(entry.definition),
          },
          {
            project: preview.project,
            ...(action.reference ? { reference: action.reference } : {}),
          },
        );
        const resolver = createProjectSymbolResolver(
          preview.project,
          builtInSymbols,
        );
        const annotations = defaultInstanceDisplayAnnotations(
          document,
          instance,
          resolver,
          resolveDocumentStyleProfile(document.presentation),
          { showDesignator: true, masterName: entry.definition.symbol.name },
        );
        edits.push({
          kind: "transact_document",
          documentId: document.id,
          expectedRevision: action.expectedRevision,
          edits: [
            { kind: "add_instance", instance },
            ...annotations.map((annotation) => ({
              kind: "upsert_schematic_annotation" as const,
              annotation,
            })),
          ],
        });
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
    assertBound();
    return {
      ...base,
      ok: true,
      result: {
        action: action.action as "read" | "publish" | "update" | "fork",
        entry,
        digest: contentDigest,
      },
    };
  } catch (error) {
    const failure =
      error instanceof ComponentOperationError
        ? error
        : error instanceof ComponentLibraryError
          ? new ComponentOperationError(
              error.status === 401
                ? "SIGN_IN_REQUIRED"
                : error.status === 403
                  ? "COMPONENT_PERMISSION_DENIED"
                  : error.status === 409
                    ? "COMPONENT_REVISION_CONFLICT"
                    : error.status === 404
                      ? "COMPONENT_NOT_FOUND"
                      : "COMPONENT_LIBRARY_FAILED",
              error.message,
              error.status === 401
                ? "sign-in"
                : error.status === 409
                  ? "refresh"
                  : error.status >= 500
                    ? "retry"
                    : "fix-input",
            )
          : new ComponentOperationError(
              "COMPONENT_INVALID",
              error instanceof Error ? error.message : String(error),
            );
    return {
      ...base,
      ok: false,
      error: {
        code: failure.code,
        message: failure.message,
        recovery: failure.recovery,
      },
    };
  }
}
