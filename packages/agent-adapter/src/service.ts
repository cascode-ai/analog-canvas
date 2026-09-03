import { resolveDocumentRoutingGeometry, sha256Hex } from "@icm/derived";
import {
  executeTransaction,
  executeProjectTransaction,
  proposeWireIntent,
  SchematicEditSchema,
} from "@icm/edit-engine";
import type { SchematicEdit } from "@icm/edit-engine";
import { flattenRichText } from "@icm/model";
import type { CircuitProject, Point, SchematicDocument } from "@icm/model";
import { buildSvgScene, renderDocumentSvg } from "@icm/render-svg";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  type SymbolResolver,
} from "@icm/symbols";

import { base64EncodeUtf8, utf8ByteLength } from "./platform.js";
import {
  agentDiagnosticIdentity,
  agentProjectDiagnostics,
  agentVisualDiagnostics,
} from "./diagnostics.js";
import type { AgentOperationHost } from "./host.js";
import { parseAgentCircuitRequest } from "./request-contract.js";
import {
  AGENT_API_VERSION,
  AGENT_SNAPSHOT_VERSION,
  AgentCircuitResponseSchema,
} from "./schema.js";
import type {
  AgentCircuitResponse,
  AgentDiagnostic,
  AgentDiff,
  AgentLimits,
  AgentFileResourceCapability,
  AgentPermissions,
  AgentRenderRequest,
  AgentSessionSnapshot,
  AgentTransactRequest,
} from "./schema.js";
import { AgentAuthoringCommandSchema } from "./authoring-command.js";
import { buildProjectConnectivityIndex, traceHierarchyNet } from "@icm/derived";
import {
  buildAgentSessionSnapshot,
  canonicalSnapshotContent,
} from "./snapshot.js";

const OPERATIONS = ["capabilities", "snapshot", "transact", "render"] as const;
/**
 * The Edit Engine schema is the sole list of typed edit kinds. `wire` is the
 * one deliberate extra capability: it advertises the mutually-exclusive
 * high-level `wireIntent` transaction form, not a SchematicEdit member.
 */
export const AGENT_EDIT_KINDS = Object.freeze([
  ...SchematicEditSchema.options
    .map((option) => option.shape.kind.value)
    .filter((kind) => agentEditCategory(kind) !== "unsupported"),
  "wire",
]);

export const DEFAULT_AGENT_LIMITS: AgentLimits = {
  maxSnapshotBytes: 4_000_000,
  maxTransactionEdits: 64,
  maxRenderBytes: 1_000_000,
  maxRequestBytes: 256_000,
  changeHistoryEntries: 32,
};

export interface AgentDocumentStore {
  getDocument(documentId?: string): SchematicDocument;
  commitDocument(document: SchematicDocument): void;
  getProject?(): CircuitProject;
  commitProject?(project: CircuitProject): void;
}

export interface AgentCircuitServiceOptions {
  agentId: string;
  store: AgentDocumentStore;
  resolver: SymbolResolver;
  permissions: AgentPermissions;
  limits?: Partial<AgentLimits>;
}

/**
 * Editor/browser host mode: the service reads the live Project/resolver and
 * dispatches `transact` through the host's unified controller/history path
 * (ADR 0016 / WP-WA2) instead of invoking `executeTransaction` + a private
 * commit. Use this in the browser; use {@link AgentCircuitServiceOptions} for
 * the in-process/loopback host.
 */
export interface AgentCircuitHostServiceOptions {
  agentId: string;
  host: AgentOperationHost;
  permissions: AgentPermissions;
  limits?: Partial<AgentLimits>;
  /** Advertised independently from the four Circuit operations. */
  fileResource?: AgentFileResourceCapability;
}

export interface AgentCircuitService {
  readonly limits: AgentLimits;
  handle(input: unknown): AgentCircuitResponse;
}

function errorResponse(
  apiVersion: typeof AGENT_API_VERSION,
  requestId: string,
  operation: "error" | "snapshot" | "transact" | "render",
  code: string,
  message: string,
  revision?: number,
  diagnostics: AgentDiagnostic[] = [],
): AgentCircuitResponse {
  return AgentCircuitResponseSchema.parse({
    apiVersion,
    requestId,
    operation,
    ok: false,
    ...(revision === undefined ? {} : { revision }),
    error: { code, message },
    diagnostics,
  });
}

function collectResolvedRoutes(
  document: SchematicDocument,
  resolver: SymbolResolver,
  changedObjectIds: readonly string[],
): Array<{ routeId: string; polyline: Point[] }> {
  const changed = new Set(changedObjectIds);
  const routingGeometry = resolveDocumentRoutingGeometry(document, resolver);
  const result: Array<{ routeId: string; polyline: Point[] }> = [];
  for (const route of document.routes) {
    if (!changed.has(route.id)) continue;
    const polyline = routingGeometry.routes.get(route.id)?.centerline ?? null;
    if (polyline && polyline.length >= 2) {
      result.push({ routeId: route.id, polyline: [...polyline] });
    }
  }
  return result;
}

export function agentEditCategory(
  kind: SchematicEdit["kind"],
): "geometry" | "connectivity" | "presentation" | "unsupported" {
  switch (kind) {
    case "noop":
    case "add_instance":
    case "remove_instance":
    case "set_instance_symbol":
    case "place_instance":
    case "move_instance":
    case "rotate_instance":
    case "mirror_instance":
    case "move_junction":
    case "align_instances":
      return "geometry";
    case "patch_instance_netlist_parameters":
    case "set_instance_reference":
    case "set_instance_style_override":
    case "set_route_style_override":
    case "set_instance_signal_flow_parameters":
      return "presentation";
    case "set_instance_netlist":
    case "undo":
    case "redo":
    case "unplace_instance":
    case "clear_cell_drawing":
    case "reset_cell_placement":
    case "reset_cell_body":
    case "upsert_connectivity_evidence":
    case "remove_connectivity_evidence":
    case "set_property_terminal_net":
    case "set_instance_binding":
    case "bulk_patch_instance_netlist":
    case "create_cell_interface":
    case "add_cell_terminal":
    case "update_cell_terminal":
    case "remove_cell_terminal":
    case "reorder_cell_terminals":
    case "set_cell_formal_parameters":
      return "connectivity";
    case "set_route_path":
    case "route_orthogonal":
    case "add_junction":
    case "attach_endpoint_to_route":
    case "remove_junction":
    case "remove_route_geometry":
    case "cut_connection":
    case "connect_endpoints":
    case "create_base_net":
    case "add_power_rail":
    case "merge_nets":
    case "set_mos_bulk_defaults":
    case "reconcile_mos_bulk":
    case "clear_mos_bulk_default":
    case "disconnect_endpoint":
    case "add_no_connect":
    case "remove_no_connect":
      return "connectivity";
    case "upsert_schematic_annotation":
    case "remove_schematic_annotation":
    case "upsert_drafting_object":
    case "remove_drafting_object":
    case "set_presentation_style":
    case "set_cell_symbol_presentation":
    case "set_layout_group":
    case "remove_layout_group":
    case "set_layout_constraint":
    case "remove_layout_constraint":
      return "presentation";
  }
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderArtifact(
  request: AgentRenderRequest,
  document: SchematicDocument,
  resolver: SymbolResolver,
  diagnostics: AgentDiagnostic[],
): { svg: string; diagnostics: AgentDiagnostic[] } {
  const options = request.bounds ? { bounds: request.bounds } : {};
  let svg = renderDocumentSvg(document, resolver, options);
  if (request.mode === "diagnostics") {
    const scene = buildSvgScene(document, resolver, options);
    const lines = diagnostics
      .slice(0, 20)
      .map(
        (item, index) =>
          `<text x="${scene.viewBox.x + 6}" y="${scene.viewBox.y + 16 + index * 14}">${escapeXml(`${item.severity.toUpperCase()} ${item.code}: ${item.objectIds?.join(", ") ?? ""}`)}</text>`,
      )
      .join("");
    svg = svg.replace(
      "</svg>",
      `<g data-layer="agent-diagnostics" fill="#b00020" font-family="sans-serif" font-size="10px">${lines}</g></svg>`,
    );
  }
  return { svg, diagnostics };
}

export function createAgentCircuitService(
  options: AgentCircuitServiceOptions | AgentCircuitHostServiceOptions,
): AgentCircuitService {
  const limits = { ...DEFAULT_AGENT_LIMITS, ...options.limits };
  const history: AgentDiff[] = [];
  let snapshotCache:
    | {
        project: CircuitProject | undefined;
        document: SchematicDocument;
        resolver: SymbolResolver;
        includeSourceSpans: boolean;
        snapshot: AgentSessionSnapshot;
      }
    | undefined;
  const response = (input: unknown): AgentCircuitResponse =>
    AgentCircuitResponseSchema.parse(input);
  const useHost = "host" in options;
  const host = useHost
    ? (options as AgentCircuitHostServiceOptions).host
    : null;
  const fileResource = useHost
    ? (options as AgentCircuitHostServiceOptions).fileResource
    : undefined;
  const storeOptions = (
    useHost ? null : options
  ) as AgentCircuitServiceOptions | null;

  return {
    limits,
    handle(input: unknown): AgentCircuitResponse {
      const parsed = parseAgentCircuitRequest(input);
      if (!parsed.success) {
        return parsed.response;
      }
      let request = parsed.data;
      const fail = (
        operation: "error" | "snapshot" | "transact" | "render",
        code: string,
        message: string,
        revision?: number,
        diagnostics: AgentDiagnostic[] = [],
      ) =>
        errorResponse(
          request.apiVersion,
          request.requestId,
          operation,
          code,
          message,
          revision,
          diagnostics,
        );
      if (request.operation === "capabilities") {
        const snapshotPermission = options.permissions.snapshot;
        const semanticControl = Boolean(
          options.permissions.semanticControl &&
          host?.semanticControlAvailable?.(),
        );
        const productionPermissions = {
          ...options.permissions,
          snapshot: snapshotPermission,
          semanticControl,
        };
        return response({
          apiVersion: request.apiVersion,
          requestId: request.requestId,
          operation: "capabilities",
          ok: true,
          capabilities: {
            apiVersions: [AGENT_API_VERSION],
            snapshotVersions: [AGENT_SNAPSHOT_VERSION],
            operations: OPERATIONS,
            editKinds: AGENT_EDIT_KINDS,
            commandKinds: host?.planAuthoringCommand
              ? AgentAuthoringCommandSchema.options.map(
                  (option) => option.shape.kind.value,
                )
              : [],
            transactionForms: [
              "edits",
              "wireIntent",
              "structureEdits",
              ...(semanticControl ? ["semanticIntent"] : []),
              ...(host?.planAuthoringCommand ? ["command"] : []),
            ],
            permissions: productionPermissions,
            limits,
            ...(fileResource ? { resources: { file: fileResource } } : {}),
          },
        });
      }

      // Every stateful operation carries the selected documentId.
      const documentId = request.documentId!;
      const document = host
        ? host.getDocument(documentId)
        : storeOptions!.store.getDocument(documentId);
      if (!document || documentId !== document.id) {
        return fail(
          request.operation,
          "DOCUMENT_NOT_FOUND",
          `The service is not bound to Document ${documentId}`,
          document?.revision,
        );
      }
      const resolver = host ? host.getResolver() : storeOptions!.resolver;
      const project = host
        ? host.getProject?.()
        : storeOptions!.store.getProject?.();

      if (request.operation === "snapshot") {
        if (!options.permissions.snapshot) {
          return fail(
            "snapshot",
            "PERMISSION_DENIED",
            "Snapshot permission is not granted",
            document.revision,
          );
        }
        const includeSourceSpans = request.includeSourceSpans === true;
        if (includeSourceSpans && !options.permissions.sourceSpans) {
          return fail(
            "snapshot",
            "PERMISSION_DENIED",
            "Source-span permission is not granted",
            document.revision,
          );
        }
        const cachedSnapshot = snapshotCache;
        const snapshot =
          cachedSnapshot !== undefined &&
          cachedSnapshot.project === project &&
          cachedSnapshot.document === document &&
          cachedSnapshot.resolver === resolver &&
          cachedSnapshot.includeSourceSpans === includeSourceSpans
            ? cachedSnapshot.snapshot
            : buildAgentSessionSnapshot({
                ...(project ? { project } : {}),
                document,
                resolver,
                includeSourceSpans,
              });
        snapshotCache = {
          project,
          document,
          resolver,
          includeSourceSpans,
          snapshot,
        };
        if (snapshot.byteLength > limits.maxSnapshotBytes) {
          return fail(
            "snapshot",
            "SNAPSHOT_TOO_LARGE",
            `Snapshot content exceeds ${limits.maxSnapshotBytes} bytes`,
            document.revision,
          );
        }
        return response({
          apiVersion: request.apiVersion,
          requestId: request.requestId,
          operation: "snapshot",
          ok: true,
          revision: document.revision,
          snapshot,
          diagnostics: snapshot.document.diagnostics,
          ...(request.traceNet
            ? {
                trace: (() => {
                  if (!project) return null;
                  const trace = traceHierarchyNet(
                    buildProjectConnectivityIndex(project, resolver),
                    document.id,
                    request.traceNet.netId,
                    undefined,
                    request.traceNet.hierarchyPath ?? [],
                  );
                  return trace
                    ? {
                        highlights: trace.highlights.map(
                          ({
                            documentId,
                            netId,
                            hierarchyPath,
                            routes,
                            junctions,
                            visibleEndpoints,
                          }) => ({
                            documentId,
                            netId,
                            hierarchyPath,
                            routes,
                            junctions,
                            visibleEndpoints,
                          }),
                        ),
                        hops: trace.hops,
                      }
                    : null;
                })(),
              }
            : {}),
        });
      }

      if (request.operation === "transact") {
        if (request.command) {
          if (request.expectedRevision !== document.revision)
            return fail(
              "transact",
              "STALE_REVISION",
              "Refresh the document before planning",
              document.revision,
            );
          if (!host?.planAuthoringCommand)
            return fail(
              "transact",
              "COMMAND_HOST_REQUIRED",
              "This operation needs the live editor planning adapter",
              document.revision,
            );
          try {
            const planned = host.planAuthoringCommand(
              documentId,
              request.command,
            );
            const { command: _command, ...base } = request;
            if ("structureEdits" in planned) {
              if (request.expectedStructureRevision === undefined)
                return fail(
                  "transact",
                  "EDIT_PRECONDITION",
                  "Structural commands require expectedStructureRevision",
                  document.revision,
                );
              request = planned.structureEdits.length
                ? { ...base, structureEdits: [...planned.structureEdits] }
                : { ...base, edits: [{ kind: "noop" }] };
            } else {
              request = {
                ...base,
                edits: planned.edits.length
                  ? [...planned.edits]
                  : [{ kind: "noop" }],
              };
            }
          } catch (error) {
            return fail(
              "transact",
              "EDIT_PRECONDITION",
              error instanceof Error ? error.message : String(error),
              document.revision,
            );
          }
        }
        if (
          request.edits?.some(
            (edit) => edit.kind === "undo" || edit.kind === "redo",
          )
        ) {
          if (!host)
            return fail(
              "transact",
              "HISTORY_CONTEXT_REQUIRED",
              "Undo/redo requires the editor's shared history",
              document.revision,
            );
          if (!Object.values(options.permissions.edit).every(Boolean))
            return fail(
              "transact",
              "PERMISSION_DENIED",
              "Shared history requires all edit permissions",
              document.revision,
            );
        }
        if (request.semanticIntent) {
          if (!options.permissions.semanticControl) {
            return fail(
              "transact",
              "PERMISSION_DENIED",
              "Semantic editor-control permission is not granted",
              document.revision,
            );
          }
          if (
            !host?.applySemanticIntent ||
            !host.semanticControlAvailable?.()
          ) {
            return fail(
              "transact",
              "SEMANTIC_CONTROL_UNAVAILABLE",
              "This Agent host does not provide a live editor control surface",
              document.revision,
            );
          }
          if (request.expectedRevision !== document.revision) {
            return fail(
              "transact",
              "STALE_REVISION",
              `Expected revision ${request.expectedRevision}, current revision is ${document.revision}`,
              document.revision,
            );
          }
          const semantic = host.applySemanticIntent({
            documentId: request.documentId,
            intent: request.semanticIntent,
          });
          if (!semantic.ok) {
            return fail(
              "transact",
              semantic.code,
              semantic.message,
              document.revision,
            );
          }
          const diagnostics = project
            ? agentProjectDiagnostics(
                project,
                resolver,
                document.id,
                document.revision,
              )
            : agentVisualDiagnostics(document, resolver);
          return response({
            apiVersion: request.apiVersion,
            requestId: request.requestId,
            operation: "transact",
            ok: true,
            applied: false,
            revision: document.revision,
            proposedRevision: document.revision,
            diff: {
              documentId: document.id,
              fromRevision: document.revision,
              toRevision: document.revision,
              editKinds: [],
              changedObjectIds: [],
            },
            diagnostics,
            semantic: {
              kind: semantic.kind,
              documentId: semantic.documentId,
              objectIds: [...semantic.objectIds],
              ...(semantic.netId ? { netId: semantic.netId } : {}),
            },
          });
        }
        if (request.structureEdits) {
          if (!project) {
            return fail(
              "transact",
              "PROJECT_CONTEXT_REQUIRED",
              "Structural edits require a Project-aware Agent host",
              document.revision,
            );
          }
          if (!options.permissions.edit.connectivity) {
            return fail(
              "transact",
              "PERMISSION_DENIED",
              "Structural edits require connectivity edit permission",
              document.revision,
            );
          }
          const nestedEdits = request.structureEdits.flatMap((edit) =>
            edit.kind === "transact_document" ? edit.edits : [],
          );
          if (
            request.structureEdits.length + nestedEdits.length >
            limits.maxTransactionEdits
          ) {
            return fail(
              "transact",
              "LIMIT_EXCEEDED",
              `A transaction may contain at most ${limits.maxTransactionEdits} edits`,
              document.revision,
            );
          }
          for (const edit of nestedEdits) {
            const category = agentEditCategory(edit.kind);
            if (category === "unsupported") {
              return fail(
                "transact",
                "UNSUPPORTED_EDIT",
                `Edit ${edit.kind} is not exposed by Agent Circuit API ${request.apiVersion}`,
                document.revision,
              );
            }
            if (!options.permissions.edit[category]) {
              return fail(
                "transact",
                "PERMISSION_DENIED",
                `${category} edit permission is not granted`,
                document.revision,
              );
            }
          }
          const transaction = {
            transactionId: request.transactionId,
            projectId: project.id,
            expectedStructureRevision: request.expectedStructureRevision!,
            actor: { kind: "agent" as const, id: options.agentId },
            ...(request.dryRun === undefined ? {} : { dryRun: request.dryRun }),
            edits: request.structureEdits,
          };
          if (host && !host.dispatchProjectTransaction) {
            return fail(
              "transact",
              "PROJECT_COMMIT_UNAVAILABLE",
              "This Agent host cannot dispatch structural Project edits",
              document.revision,
            );
          }
          const result = host
            ? host.dispatchProjectTransaction!(transaction)
            : executeProjectTransaction(project, transaction);
          if (!result.ok) {
            return fail(
              "transact",
              result.error.code,
              result.error.message,
              document.revision,
              result.diagnostics.map((item) => ({
                code: item.code,
                severity: item.severity,
                message: item.message,
                ...(item.objectIds ? { objectIds: [...item.objectIds] } : {}),
                ...(item.path ? { path: [...item.path] } : {}),
              })),
            );
          }
          if (result.applied && !useHost) {
            if (!storeOptions!.store.commitProject) {
              return fail(
                "transact",
                "PROJECT_COMMIT_UNAVAILABLE",
                "This Agent store cannot commit structural Project edits",
                document.revision,
              );
            }
            storeOptions!.store.commitProject(result.project);
          }
          const proposedDocument =
            result.proposedProject.documents.find(
              (item) => item.id === document.id,
            ) ??
            result.proposedProject.documents.find(
              (item) => item.id === result.proposedProject.topDocumentId,
            )!;
          const documentResults = result.documentResults.filter(
            (item) => item.ok,
          );
          const changedObjectIds = [
            ...new Set([
              ...result.changedDocumentIds,
              ...documentResults.flatMap((item) => item.diff.changedObjectIds),
            ]),
          ].sort();
          const effectiveResolver = createProjectSymbolResolver(
            result.proposedProject,
            builtInSymbols,
          );
          const diagnostics = agentProjectDiagnostics(
            result.proposedProject,
            effectiveResolver,
            proposedDocument.id,
            proposedDocument.revision,
          );
          return response({
            apiVersion: request.apiVersion,
            requestId: request.requestId,
            operation: "transact",
            ok: true,
            applied: result.applied,
            revision: result.applied
              ? proposedDocument.revision
              : document.revision,
            proposedRevision: proposedDocument.revision,
            diff: {
              documentId: document.id,
              fromRevision: document.revision,
              toRevision: proposedDocument.revision,
              editKinds: request.structureEdits.map(
                (edit) => `project:${edit.kind}`,
              ),
              changedObjectIds,
            },
            diagnostics,
            projectStructure: {
              fromRevision: project.structureRevision,
              toRevision: result.proposedStructureRevision,
              changedDocumentIds: [...result.changedDocumentIds],
              documentIds: result.proposedProject.documents.map(
                (item) => item.id,
              ),
              topDocumentId: result.proposedProject.topDocumentId,
            },
          });
        }
        if (request.wireIntent) {
          if (
            !options.permissions.edit.geometry ||
            !options.permissions.edit.connectivity
          ) {
            return fail(
              "transact",
              "PERMISSION_DENIED",
              "Wire intent requires geometry and connectivity edit permissions",
              document.revision,
            );
          }
        }
        const plannedWire = request.wireIntent
          ? proposeWireIntent(document, resolver, request.wireIntent)
          : null;
        if (typeof plannedWire === "string") {
          return fail(
            "transact",
            "EDIT_PRECONDITION",
            plannedWire,
            document.revision,
          );
        }
        const edits = request.edits ?? plannedWire?.edits ?? [];
        if (edits.length > limits.maxTransactionEdits) {
          return fail(
            "transact",
            "LIMIT_EXCEEDED",
            `A transaction may contain at most ${limits.maxTransactionEdits} edits`,
            document.revision,
          );
        }
        for (const edit of edits) {
          const category = agentEditCategory(edit.kind);
          if (category === "unsupported") {
            return fail(
              "transact",
              "UNSUPPORTED_EDIT",
              `Edit ${edit.kind} is not exposed by Agent Circuit API ${request.apiVersion}`,
              document.revision,
            );
          }
          if (!options.permissions.edit[category]) {
            return fail(
              "transact",
              "PERMISSION_DENIED",
              `${category} edit permission is not granted`,
              document.revision,
            );
          }
        }
        const result = host
          ? host.dispatchTransaction({
              transactionId: request.transactionId,
              documentId: request.documentId,
              expectedRevision: request.expectedRevision,
              actor: { kind: "agent", id: options.agentId },
              ...(request.dryRun === undefined
                ? {}
                : { dryRun: request.dryRun }),
              edits,
            })
          : executeTransaction(
              document,
              {
                transactionId: request.transactionId,
                documentId: request.documentId,
                expectedRevision: request.expectedRevision,
                actor: { kind: "agent", id: options.agentId },
                ...(request.dryRun === undefined
                  ? {}
                  : { dryRun: request.dryRun }),
                edits,
              },
              { symbolResolver: resolver },
            );
        if (!result.ok) {
          return fail(
            "transact",
            result.error.code,
            result.error.message,
            result.revision,
            result.diagnostics.map((item) => ({
              code: item.code,
              severity: item.severity,
              message: item.message,
              revision: result.revision,
              ...(item.objectIds ? { objectIds: [...item.objectIds] } : {}),
              ...(item.path ? { path: [...item.path] } : {}),
              ...(item.parameters
                ? { parameters: { ...item.parameters } }
                : {}),
            })),
          );
        }
        if (result.applied) {
          // The browser host commits through the controller/history dispatch;
          // only the in-process/loopback store commits independently here.
          if (!useHost) {
            storeOptions!.store.commitDocument(result.document);
          }
          history.push({
            ...result.diff,
            editKinds: [...result.diff.editKinds],
            changedObjectIds: [...result.diff.changedObjectIds],
          });
          if (history.length > limits.changeHistoryEntries) history.shift();
        }
        // Surface the actual stored geometry for Routes this transaction
        // touched, so a caller learns the post-normalization polyline (e.g.
        // after set_route_path collapses collinear bends) without a
        // fresh Snapshot. dryRun reports the proposed geometry the same way.
        const committedResolver =
          result.applied && host ? host.getResolver() : resolver;
        const resolvedRoutes = collectResolvedRoutes(
          result.document,
          committedResolver,
          result.diff.changedObjectIds,
        );
        const committedProject = result.applied
          ? host?.getProject?.()
          : undefined;
        const proposedProject =
          committedProject ??
          (project
            ? {
                ...project,
                documents: project.documents.map((candidate) =>
                  candidate.id === result.document.id
                    ? result.document
                    : candidate,
                ),
              }
            : undefined);
        const diagnostics = proposedProject
          ? agentProjectDiagnostics(
              proposedProject,
              committedResolver,
              result.document.id,
              result.proposedRevision,
            )
          : agentVisualDiagnostics(result.document, committedResolver);
        const beforeDiagnostics = project
          ? agentProjectDiagnostics(
              project,
              resolver,
              document.id,
              document.revision,
            )
          : agentVisualDiagnostics(document, resolver);
        const beforeIds = new Set(
          beforeDiagnostics.map(agentDiagnosticIdentity),
        );
        const afterIds = new Set(diagnostics.map(agentDiagnosticIdentity));
        return response({
          apiVersion: request.apiVersion,
          requestId: request.requestId,
          operation: "transact",
          ok: true,
          applied: result.applied,
          revision: result.revision,
          proposedRevision: result.proposedRevision,
          diff: result.diff,
          ...(committedProject &&
          project &&
          committedProject.structureRevision !== project.structureRevision
            ? {
                projectStructure: {
                  fromRevision: project.structureRevision,
                  toRevision: committedProject.structureRevision,
                  documentIds: committedProject.documents.map(
                    (item) => item.id,
                  ),
                  topDocumentId: committedProject.topDocumentId,
                  changedDocumentIds: [
                    ...new Set(
                      [...project.documents, ...committedProject.documents].map(
                        (item) => item.id,
                      ),
                    ),
                  ],
                },
              }
            : {}),
          diagnostics,
          diagnosticDelta: {
            added: diagnostics.filter(
              (diagnostic) =>
                !beforeIds.has(agentDiagnosticIdentity(diagnostic)),
            ),
            removed: beforeDiagnostics.filter(
              (diagnostic) =>
                !afterIds.has(agentDiagnosticIdentity(diagnostic)),
            ),
          },
          ...(resolvedRoutes.length === 0 ? {} : { resolvedRoutes }),
        });
      }

      if (!options.permissions.render) {
        return fail(
          "render",
          "PERMISSION_DENIED",
          "Render permission is not granted",
          document.revision,
        );
      }
      try {
        const rendered = renderArtifact(
          request,
          document,
          resolver,
          project
            ? agentProjectDiagnostics(
                project,
                resolver,
                document.id,
                document.revision,
              )
            : agentVisualDiagnostics(document, resolver),
        );
        const byteLength = utf8ByteLength(rendered.svg);
        if (byteLength > limits.maxRenderBytes) {
          return fail(
            "render",
            "RENDER_TOO_LARGE",
            `Render artifact exceeds ${limits.maxRenderBytes} bytes`,
            document.revision,
          );
        }
        return response({
          apiVersion: request.apiVersion,
          requestId: request.requestId,
          operation: "render",
          ok: true,
          revision: document.revision,
          artifact: {
            mediaType: "image/svg+xml",
            encoding: "base64",
            data: base64EncodeUtf8(rendered.svg),
            sha256: sha256Hex(rendered.svg),
            byteLength,
            mode: request.mode,
          },
          diagnostics: rendered.diagnostics,
        });
      } catch (error) {
        return fail(
          "render",
          "RENDER_FAILED",
          error instanceof Error ? error.message : String(error),
          document.revision,
        );
      }
    },
  };
}
