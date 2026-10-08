import type { AgentDiagnostic, AgentSessionSnapshot } from "@icm/agent-adapter";
import type { CachedSnapshot, ApplyActionsReport } from "@icm/agent-client";
import { RichTextDocumentSchema, flattenRichText } from "@icm/model";

/**
 * Compact result projections (Agent rationale): every tool answer is bounded to what
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

/**
 * Information `verify` names rather than counts: the netlist gives a MOS body
 * a supply nobody wired, as a Cell Pin nobody drew or on another supply than
 * its source. The circuit stays ready with no warning, so a count alone hid
 * it (#1302). A generated Net name only says what an unnamed node is called;
 * those stay in `total`.
 */
const VERIFY_NAMED_INFORMATION = new Set([
  "MOS_BODY_DEFAULT_SUPPLY",
  "MOS_BODY_OTHER_SUPPLY",
]);
/** A milestone check stays small; `inspect` of diagnostics lists the rest. */
const VERIFY_INFORMATION_LIMIT = 10;
const VERIFY_OBJECT_ID_LIMIT = 8;

export interface VerifyInformation {
  code: string;
  message: string;
  objectIds: string[];
  /** How many objects the finding names, when `objectIds` holds the first. */
  objectCount?: number;
  /** The Cell the finding is about, when that is not the Cell verified. */
  documentId?: string;
}

export function verifyInformation(entry: CachedSnapshot): {
  information: VerifyInformation[];
  omitted: number;
} {
  const named = entry.diagnostics.filter(
    (d) => d.severity === "info" && VERIFY_NAMED_INFORMATION.has(d.code),
  );
  const information = named.slice(0, VERIFY_INFORMATION_LIMIT).map((d) => {
    const objectIds = d.objectIds ?? [];
    const documentId = d.parameters?.["documentId"];
    return {
      code: d.code,
      message: d.message,
      objectIds: objectIds.slice(0, VERIFY_OBJECT_ID_LIMIT),
      ...(objectIds.length > VERIFY_OBJECT_ID_LIMIT
        ? { objectCount: objectIds.length }
        : {}),
      ...(typeof documentId === "string" && documentId !== entry.documentId
        ? { documentId }
        : {}),
    };
  });
  return { information, omitted: named.length - information.length };
}

/** Successful edit receipts: all errors, one example per warning/info code.
 * Complete diagnostic derivation and the explicit full response are unchanged.
 */
export function compactActionReport(report: ApplyActionsReport) {
  if (!report.ok || !report.diagnostics) return report;
  const byCode: Record<string, number> = {};
  const seen = new Set<string>();
  const diagnostics = report.diagnostics.filter((d) => {
    const key = `${d.severity}:${d.code}`;
    byCode[key] = (byCode[key] ?? 0) + 1;
    if (d.severity === "error") return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const { diagnosticDelta, ...rest } = report;
  return {
    ...rest,
    diagnostics,
    diagnosticSummary: {
      total: report.diagnostics.length,
      omitted: report.diagnostics.length - diagnostics.length,
      byCode,
      details: {
        tool: "inspect",
        target: { kind: "diagnostics" },
        detail: "full",
        ...(report.documentId ? { documentId: report.documentId } : {}),
      },
    },
    ...(diagnosticDelta
      ? {
          diagnosticDelta: {
            projection: "summary",
            addedCount: diagnosticDelta.added.length,
            removedCount:
              diagnosticDelta.removed.length +
              (diagnosticDelta.removedIds?.length ?? 0),
          },
        }
      : {}),
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

type SnapshotDocument = AgentSessionSnapshot["document"];
type SnapshotInstance = SnapshotDocument["instances"][number];
type SnapshotNet = SnapshotDocument["nets"][number];
interface NameCandidate {
  kind: "instance" | "net";
  id: string;
  name: string | null;
}

/** A part's name as actions take it: its Reference, or a Cell Pin's name. */
function partName(instance: SnapshotInstance): string | null {
  return instance.reference ?? instance.cellTerminal?.name ?? null;
}

function candidate(item: SnapshotInstance | SnapshotNet): NameCandidate {
  return "pins" in item
    ? { kind: "instance", id: item.id, name: partName(item) }
    : { kind: "net", id: item.id, name: item.name };
}

/** A refusal in the shape every tool answers with (#1525). */
function lookupRefusal(
  code: "OBJECT_NOT_FOUND" | "NAME_AMBIGUOUS",
  message: string,
  reference: string,
  candidates: readonly NameCandidate[],
): Record<string, unknown> {
  return {
    ok: false,
    error: {
      code,
      message,
      recovery: "fix-input",
      reference,
      ...(candidates.length ? { candidates } : {}),
    },
  };
}

/**
 * Names that differ from one only in case, offered when nothing has it:
 * names are matched exactly, as actions match them.
 */
function nearNames(
  document: SnapshotDocument,
  reference: string,
  only?: "net",
): NameCandidate[] {
  const folded = reference.toLowerCase();
  return [...(only ? [] : document.instances), ...document.nets]
    .filter((item) => {
      const name = "pins" in item ? partName(item) : item.name;
      return name?.toLowerCase() === folded;
    })
    .slice(0, 10)
    .map(candidate);
}

function notFound(
  document: SnapshotDocument,
  reference: string,
  only?: "net",
): Record<string, unknown> {
  const near = nearNames(document, reference, only);
  return lookupRefusal(
    "OBJECT_NOT_FOUND",
    reference
      ? `Nothing in Cell "${document.name}" has the ID or name "${reference}"${
          near.length
            ? "; names differ from these only in case"
            : `; search {"query":"${reference}"} finds partial and label matches`
        }`
      : "Give the object's id or name",
    reference,
    near,
  );
}

/**
 * Ground by the names people and netlists give it (#1515). The Snapshot
 * calls it "0", SPICE's global node, while a Cell's netlist names its
 * ground pin VSS, or GND when VSS names another Net. A Net or part that
 * really has the name, in any case, is that one instead.
 */
const GROUND_NAMES = new Set(["0", "gnd", "vss", "ground"]);
const GROUND_NOTE =
  'Ground is Net "0" here; a Cell\'s netlist names its ground pin VSS, or GND when VSS names another Net.';

/** A Net by ID or exact name, else ground by one of its names. */
function netNamed(
  document: SnapshotDocument,
  reference: string,
):
  { net: SnapshotNet; ground?: true } | { grounds: SnapshotNet[] } | undefined {
  const net = document.nets.find(
    (candidate) => candidate.id === reference || candidate.name === reference,
  );
  if (net) return { net };
  const folded = reference.toLowerCase();
  if (
    !GROUND_NAMES.has(folded) ||
    document.nets.some((item) => item.name?.toLowerCase() === folded) ||
    document.instances.some((item) => partName(item)?.toLowerCase() === folded)
  )
    return undefined;
  const grounds = document.nets.filter((item) => item.powerDomain === "ground");
  if (grounds.length === 1) return { net: grounds[0]!, ground: true };
  return grounds.length ? { grounds } : undefined;
}

/** What a Net lookup found, said as inspect says it. */
function netAnswer(
  reference: string,
  found: NonNullable<ReturnType<typeof netNamed>>,
  value: (net: SnapshotNet) => Record<string, unknown>,
): Record<string, unknown> {
  if ("grounds" in found)
    return lookupRefusal(
      "NAME_AMBIGUOUS",
      `"${reference}" could mean any of ${found.grounds.length} ground Nets; inspect one by its id`,
      reference,
      found.grounds.map(candidate),
    );
  return found.ground
    ? { ...value(found.net), matchedAs: "ground", note: GROUND_NOTE }
    : value(found.net);
}

/**
 * Entries of a `pins` read that are not part IDs (#1525): each a part's
 * Reference, or a Cell Pin marker's Pin name, resolved exactly as actions
 * resolve it, or the reason it is not one, with the IDs it could mean.
 */
export function resolvePartNames(
  document: SnapshotDocument,
  names: readonly string[],
): {
  ids: Record<string, string>;
  unresolved: { name: string; reason: string; candidates?: NameCandidate[] }[];
} {
  const ids: Record<string, string> = {};
  const unresolved: {
    name: string;
    reason: string;
    candidates?: NameCandidate[];
  }[] = [];
  for (const name of new Set(names)) {
    const named = document.instances.filter(
      (instance) => partName(instance) === name,
    );
    if (named.length === 1) {
      ids[name] = named[0]!.id;
      continue;
    }
    const near = named.length
      ? named.map(candidate)
      : nearNames(document, name).filter((item) => item.kind === "instance");
    unresolved.push({
      name,
      reason: named.length
        ? `"${name}" names ${named.length} parts; ask for one by its id`
        : `No part has the ID, Reference or Pin name "${name}"`,
      ...(near.length ? { candidates: near } : {}),
    });
  }
  return { ids, unresolved };
}

export function inspectObject(
  entry: CachedSnapshot,
  target: OptionalReference,
): Record<string, unknown> {
  const document = entry.snapshot.document;
  const reference = target.id ?? target.name ?? "";
  const byId = document.instances.find(
    (candidate) => candidate.id === reference,
  );
  if (byId) return inspectInstanceValue(byId);
  const named = document.instances.filter(
    (candidate) => candidate.reference === reference,
  );
  if (named.length > 1)
    return lookupRefusal(
      "NAME_AMBIGUOUS",
      `"${reference}" names ${named.length} parts; inspect one by its id`,
      reference,
      [...named, ...document.nets.filter((net) => net.name === reference)].map(
        candidate,
      ),
    );
  if (named[0]) return inspectInstanceValue(named[0]);
  const net = netNamed(document, reference);
  if (net) return netAnswer(reference, net, inspectNetValue);
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
  return notFound(document, reference);
}

/** A Net target: a Net only, by ID or name; a part's name never stands in. */
export function inspectNet(
  entry: CachedSnapshot,
  target: OptionalReference,
): Record<string, unknown> {
  const document = entry.snapshot.document;
  const reference = target.id ?? target.name ?? "";
  const net = netNamed(document, reference);
  return net
    ? netAnswer(reference, net, inspectNetValue)
    : notFound(document, reference, "net");
}

export function inspectConnectivity(
  entry: CachedSnapshot,
  target: OptionalReference | undefined,
): Record<string, unknown> {
  const document = entry.snapshot.document;
  const reference = target?.id ?? target?.name;
  if (reference) {
    const named = document.instances.filter(
      (candidate) =>
        candidate.id === reference || candidate.reference === reference,
    );
    if (named.length > 1)
      return lookupRefusal(
        "NAME_AMBIGUOUS",
        `"${reference}" names ${named.length} parts; inspect one by its id`,
        reference,
        named.map(candidate),
      );
    const instance = named[0];
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
    const net = netNamed(document, reference);
    if (net)
      return netAnswer(reference, net, (found) => ({
        ...inspectNetValue(found),
        terminalsResolved: found.terminals.map((terminal) => {
          const owner = document.instances.find(
            (candidate) => candidate.id === terminal.instanceId,
          );
          return {
            instance: owner?.reference ?? terminal.instanceId,
            pin: terminal.pinName,
          };
        }),
      }));
    return notFound(document, reference);
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
    const text =
      annotation.resolvedText ?? richTextToPlainText(annotation.content);
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
