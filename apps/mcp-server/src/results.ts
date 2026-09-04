import type { AgentDiagnostic, AgentSessionSnapshot } from "@icm/agent-adapter";
import type { CachedSnapshot } from "@icm/agent-client";
import { RichTextDocumentSchema, flattenRichText } from "@icm/model";

/**
 * Compact result projections (ADR 0020): every tool answer is bounded to what
 * the task needs. The full Snapshot stays in the Helper cache and is reachable
 * through `inspect` with `detail: "full"` on a document target.
 */

export interface InspectTarget {
  kind: "document" | "object" | "net" | "connectivity" | "diagnostics";
  id?: string;
  name?: string;
}

export const InspectTargetSchemaShape = {
  kind: "document | object | net | connectivity | diagnostics",
} as const;

export type SearchKind =
  | "instance"
  | "net"
  | "route"
  | "junction"
  | "annotation"
  | "drafting"
  | "property"
  | "diagnostic";

export interface SearchHit {
  kind: SearchKind;
  id: string;
  name: string | null;
  detail: string;
}

function diagnosticCompact(
  diagnostic: AgentDiagnostic,
): Record<string, unknown> {
  return { ...diagnostic };
}

export interface DiagnosticsReport {
  revision: number;
  counts: { errors: number; warnings: number; total: number };
  items: Record<string, unknown>[];
}

export function diagnosticsCompact(entry: CachedSnapshot): DiagnosticsReport {
  const all = entry.diagnostics;
  const errors = all.filter((d) => d.severity === "error");
  const warnings = all.filter((d) => d.severity === "warning");
  return {
    revision: entry.revision,
    counts: {
      errors: errors.length,
      warnings: warnings.length,
      total: all.length,
    },
    items: all.map(diagnosticCompact),
  };
}

export function inspectDocument(
  entry: CachedSnapshot,
  detail: "compact" | "full",
): Record<string, unknown> {
  const document = entry.snapshot.document;
  const compact = {
    projectId: entry.snapshot.project.id,
    projectName: entry.snapshot.project.name,
    documentId: document.id,
    documentName: document.name,
    revision: entry.revision,
    sourceStatus: document.sourceStatus,
    counts: {
      instances: document.instances.length,
      nets: document.nets.length,
      routes: document.routes.length,
      junctions: document.junctions.length,
      annotations: document.annotations.length,
      draftingObjects: document.drafting.objects.length,
      noConnects: document.noConnects.length,
    },
    ...(document.bounds ? { bounds: document.bounds } : {}),
    documents: entry.snapshot.project.documents.map((doc) => ({
      id: doc.id,
      name: doc.name,
      instanceCount: doc.instanceCount,
      netCount: doc.netCount,
    })),
  };
  if (detail === "compact") return compact;
  return {
    ...compact,
    project: entry.snapshot.project,
    ...document,
  };
}

export function inspectInstanceValue(
  instance: AgentSessionSnapshot["document"]["instances"][number],
): Record<string, unknown> {
  return {
    id: instance.id,
    ...(instance.styleOverride
      ? { styleOverride: instance.styleOverride }
      : {}),
    ...(instance.signalFlowParameters
      ? { signalFlowParameters: instance.signalFlowParameters }
      : {}),
    reference: instance.reference,
    masterName: instance.masterName,
    symbolId: instance.symbolId,
    ...(instance.symbolVariantId
      ? { symbolVariantId: instance.symbolVariantId }
      : {}),
    placement: instance.placement,
    pins: instance.pins.map((pin) => ({
      name: pin.name,
      direction: pin.direction,
      netId: pin.netId,
      ...(pin.connection ? { connection: pin.connection } : {}),
    })),
    ...(Object.keys(instance.parameters).length > 0
      ? { parameters: instance.parameters }
      : {}),
    ...(instance.mosBulk ? { mosBulk: instance.mosBulk } : {}),
    ...(instance.netlist ? { netlist: instance.netlist } : {}),
    ...(instance.bounds ? { bounds: instance.bounds } : {}),
  };
}

export function inspectNetValue(
  net: AgentSessionSnapshot["document"]["nets"][number],
): Record<string, unknown> {
  return {
    id: net.id,
    name: net.name,
    scope: net.scope,
    powerDomain: net.powerDomain,
    terminals: net.terminals,
    routeIds: net.routeIds,
    junctionIds: net.junctionIds,
  };
}

type OptionalReference = {
  id?: string | undefined;
  name?: string | undefined;
};

export function inspectObject(
  entry: CachedSnapshot,
  target: OptionalReference,
): Record<string, unknown> {
  const document = entry.snapshot.document;
  const reference = target.id ?? target.name ?? "";
  const instance = document.instances.find(
    (candidate) =>
      candidate.id === reference || candidate.reference === reference,
  );
  if (instance) return inspectInstanceValue(instance);
  const net = document.nets.find(
    (candidate) => candidate.id === reference || candidate.name === reference,
  );
  if (net) return inspectNetValue(net);
  const route = document.routes.find((candidate) => candidate.id === reference);
  if (route) {
    return {
      id: route.id,
      netId: route.netId,
      start: route.start,
      legs: route.legs,
      ...(route.presentation ? { presentation: route.presentation } : {}),
      bendCount: route.legs.filter((leg) => leg.to.kind === "bend").length,
      polyline: route.polyline,
    };
  }
  const junction = document.junctions.find(
    (candidate) => candidate.id === reference,
  );
  if (junction) {
    return {
      id: junction.id,
      netId: junction.netId,
      position: junction.position,
      ...(junction.role ? { role: junction.role } : {}),
    };
  }
  const annotation = document.annotations.find(
    (candidate) => candidate.id === reference,
  );
  if (annotation) {
    return { ...annotation } as unknown as Record<string, unknown>;
  }
  const noConnect = document.noConnects.find(
    (candidate) => candidate.id === reference,
  );
  if (noConnect) return { ...noConnect };
  const drafting = document.drafting.objects.find(
    (candidate) => candidate.object.id === reference,
  );
  if (drafting) {
    return {
      object: drafting.object,
      bounds: drafting.resolvedGeometry.bounds,
      diagnosticCount: drafting.diagnostics.length,
    } as unknown as Record<string, unknown>;
  }
  return {
    error: "no object matches the reference in the cached snapshot",
    reference,
  };
}

export function inspectConnectivity(
  entry: CachedSnapshot,
  target: OptionalReference | undefined,
): Record<string, unknown> {
  const document = entry.snapshot.document;
  const reference = target?.id ?? target?.name;
  if (reference) {
    const instance = document.instances.find(
      (candidate) =>
        candidate.id === reference || candidate.reference === reference,
    );
    if (instance) {
      return {
        instanceId: instance.id,
        reference: instance.reference,
        connections: instance.pins.map((pin) => ({
          pin: pin.name,
          netId: pin.netId,
        })),
        ...(instance.mosBulk ? { mosBulk: instance.mosBulk } : {}),
      };
    }
    const net = document.nets.find(
      (candidate) => candidate.id === reference || candidate.name === reference,
    );
    if (net) {
      return {
        ...inspectNetValue(net),
        terminalsResolved: net.terminals.map((terminal) => {
          const owner = document.instances.find(
            (candidate) => candidate.id === terminal.instanceId,
          );
          return {
            instance: owner?.reference ?? terminal.instanceId,
            pin: terminal.pinName,
          };
        }),
      };
    }
  }
  return {
    nets: document.nets.map((net) => ({
      id: net.id,
      name: net.name,
      powerDomain: net.powerDomain,
      terminalCount: net.terminals.length,
    })),
  };
}

function richTextToPlainText(content: unknown): string {
  const parsed = RichTextDocumentSchema.safeParse(content);
  return parsed.success ? flattenRichText(parsed.data) : "";
}
export function searchSnapshot(
  entry: CachedSnapshot,
  query: string,
  kinds: readonly SearchKind[] | undefined,
  limit: number,
): SearchHit[] {
  const needle = query.toLowerCase();
  const activeKinds = kinds?.length ? kinds : null;
  const matches: SearchHit[] = [];
  const consider = (kind: SearchKind, hit: SearchHit): void => {
    if (activeKinds && !activeKinds.includes(kind)) return;
    if (matches.length >= limit) return;
    matches.push(hit);
  };
  const document = entry.snapshot.document;

  for (const instance of document.instances) {
    if (instance.reference?.toLowerCase().includes(needle)) {
      consider("instance", {
        kind: "instance",
        id: instance.id,
        name: instance.reference,
        detail: `symbol ${instance.symbolId}`,
      });
    } else if (instance.symbolId.toLowerCase().includes(needle)) {
      consider("instance", {
        kind: "instance",
        id: instance.id,
        name: instance.reference,
        detail: `symbol ${instance.symbolId}`,
      });
    }
    for (const [key, value] of Object.entries(instance.parameters)) {
      if (
        key.toLowerCase().includes(needle) ||
        String(value).toLowerCase().includes(needle)
      ) {
        consider("property", {
          kind: "property",
          id: instance.id,
          name: instance.reference,
          detail: `${key} = ${String(value)}`,
        });
        break;
      }
    }
  }
  for (const net of document.nets) {
    if (
      net.id.toLowerCase().includes(needle) ||
      (net.name ?? "").toLowerCase().includes(needle)
    ) {
      consider("net", {
        kind: "net",
        id: net.id,
        name: net.name,
        detail: `powerDomain ${net.powerDomain}, ${net.terminals.length} terminals`,
      });
    }
  }
  for (const route of document.routes) {
    if (route.id.toLowerCase().includes(needle)) {
      consider("route", {
        kind: "route",
        id: route.id,
        name: null,
        detail: `net ${route.netId}`,
      });
    }
  }
  for (const junction of document.junctions) {
    if (junction.id.toLowerCase().includes(needle)) {
      consider("junction", {
        kind: "junction",
        id: junction.id,
        name: null,
        detail: `net ${junction.netId} at (${junction.position.x}, ${junction.position.y})`,
      });
    }
  }
  for (const annotation of document.annotations) {
    const text = richTextToPlainText(annotation.content);
    if (
      annotation.id.toLowerCase().includes(needle) ||
      text.toLowerCase().includes(needle)
    ) {
      consider("annotation", {
        kind: "annotation",
        id: annotation.id,
        name: text.slice(0, 64) || null,
        detail: `kind ${annotation.kind}`,
      });
    }
  }
  for (const { object } of document.drafting.objects) {
    if (object.kind === "text") {
      const text = richTextToPlainText(
        (object as { content?: unknown }).content,
      );
      if (
        object.id.toLowerCase().includes(needle) ||
        text.toLowerCase().includes(needle)
      ) {
        consider("drafting", {
          kind: "drafting",
          id: object.id,
          name: text.slice(0, 64) || null,
          detail: "text object",
        });
      }
    }
  }
  for (const diagnostic of entry.diagnostics) {
    if (
      diagnostic.code.toLowerCase().includes(needle) ||
      diagnostic.message.toLowerCase().includes(needle)
    ) {
      consider("diagnostic", {
        kind: "diagnostic",
        id: diagnostic.code,
        name: null,
        detail: diagnostic.message.slice(0, 160),
      });
    }
  }
  return matches.slice(0, limit);
}
