// The Gallery census puts every drawing of a private Gallery snapshot through
// the paths tests exercise only on tidy fixtures: loading, the netlist,
// copying, and turning parts with their labels. Real drawings carry states
// earlier versions left behind that no fixture thought of. It reads user
// drawings, so it runs only on request, through `pnpm gallery:census`
// (scripts/gallery-census.mjs), and never in CI.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import {
  defaultInstanceLabelPlacement,
  defaultInstanceParameterLabelPlacement,
  defaultVddPowerLabelPlacement,
  resolveDocumentStyleProfile,
  resolveRouteGeometry,
} from "@icm/derived";
import { executeTransaction, type SchematicEdit } from "@icm/edit-engine";
import {
  createEmptyProject,
  type CircuitProject,
  type Instance,
  type SchematicDocument,
} from "@icm/model";
import {
  NETLIST_MARK_RULE_VERSION,
  compareElectricalGraphs,
  createDesignNetlistExport,
  designExtractsNetlist,
  projectElectricalGraph,
} from "@icm/netlist";
import { parseProject } from "@icm/project-protocol";
import { renderDocumentSvg } from "@icm/render-svg";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  type SymbolResolver,
} from "@icm/symbols";
import {
  applyProjectCopyPlacement,
  captureProjectCopy,
  planProjectCopyPlacement,
} from "../src/features/clipboard/project-copy";
import {
  decodeCircuitClipboard,
  encodeCircuitClipboard,
} from "../src/features/clipboard/system-clipboard";
import { createSelectionTransformController } from "../src/features/selection/selection-transform-controller";

const OK = "ok";

/**
 * What a census can check, in groups a change selects (`--checks`):
 * extraction with the Gallery's netlist mark, copying and placement with
 * supply markers, and a quarter turn and mirror with the labels that follow.
 */
const CHECK_GROUPS = ["netlist", "copy", "transform"] as const;
type CheckGroup = (typeof CHECK_GROUPS)[number];
const requestedGroups = (process.env.ICM_GALLERY_CENSUS_CHECKS ?? "")
  .split(",")
  .filter(Boolean);
for (const group of requestedGroups)
  if (!(CHECK_GROUPS as readonly string[]).includes(group))
    throw new Error(`Unknown census check group: ${group}`);
const checkGroups: readonly CheckGroup[] = requestedGroups.length
  ? CHECK_GROUPS.filter((group) => requestedGroups.includes(group))
  : CHECK_GROUPS;
const runs = (group: CheckGroup) => checkGroups.includes(group);

type Selection = Parameters<typeof encodeCircuitClipboard>[2];

interface CensusEntry {
  id: string;
  name: string;
  /** "ok", or what went wrong. The comparison reads only these. */
  checks: Record<string, string>;
  netlistHash?: string;
  /** The Gallery's netlist mark for the drawing (designExtractsNetlist). */
  netlistMark?: boolean;
  /** Name and value labels that followed their part through a quarter turn. */
  labelsFollowing?: string[];
  markerCopies?: number;
}

function failure(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\s+/gu, " ")
    .slice(0, 240);
}

function attempt(run: () => string | void): string {
  try {
    return run() ?? OK;
  } catch (error) {
    return failure(error);
  }
}

function everything(document: SchematicDocument): Selection {
  return {
    instanceIds: document.instances.map((item) => item.id),
    routeIds: document.routes.map((item) => item.id),
    junctionIds: document.junctions.map((item) => item.id),
    annotationIds: document.annotations.map((item) => item.id),
    draftingIds: (document.drafting?.objects ?? []).map((item) => item.id),
  };
}

function objectIds(document: SchematicDocument): Set<string> {
  return new Set(
    [
      ...document.instances,
      ...document.nets,
      ...document.routes,
      ...document.junctions,
      ...document.annotations,
      ...document.connectivityEvidence,
    ].map((item) => item.id),
  );
}

/** What another tab receives: the system clipboard text, pasted into a new Project. */
function pasteIntoNewProject(
  project: CircuitProject,
  document: SchematicDocument,
  selection: Selection,
): CircuitProject {
  const text = encodeCircuitClipboard(project, document, selection);
  if (!text) throw new Error("Nothing was copied");
  const clipboard = decodeCircuitClipboard(text);
  if (!clipboard) throw new Error("The clipboard text did not decode");
  const target = createEmptyProject("census-target", "Census");
  return applyProjectCopyPlacement(
    planProjectCopyPlacement(
      target,
      target.documents[0]!,
      clipboard,
      { x: 0, y: 0 },
      1,
    ),
  );
}

/**
 * Every stroke width, text size and dot radius a drawing shows, counted. A
 * copy must read the same: it looks exactly like what was copied. No Connect
 * marks are left out because a selection copy does not carry them.
 */
function look(project: CircuitProject, document: SchematicDocument): string[] {
  const svg = renderDocumentSvg(
    document,
    createProjectSymbolResolver(project, builtInSymbols),
  ).replace(/<path [^>]*data-role="no-connect"[^>]*\/>/gu, "");
  return [...svg.matchAll(/(?<=\s)(stroke-width|font-size|r)="([^"]+)"/gu)]
    .map((match) => `${match[1]}=${match[2]}`)
    .sort();
}

/**
 * A copy joins exactly what its source joins. A link that lives only in the
 * record, with no wire or touching pin, is lost; geometry that touches but was
 * never connected gains one. Both are contradictions in the source drawing.
 * Drawings neither side can analyse are not judged.
 */
function connectionDifference(
  source: CircuitProject,
  copy: CircuitProject,
): string {
  const before = projectElectricalGraph(source);
  const after = projectElectricalGraph(copy);
  if (before.status === "ready" && after.status === "ready") {
    const comparison = compareElectricalGraphs(before.graph, after.graph);
    return comparison === "equal" ? "" : `connections ${comparison}`;
  }
  if (before.status === "ready" && after.status !== "ready")
    return `copy: ${after.reason}`;
  if (before.status !== "ready" && after.status === "ready")
    return `source: ${before.reason}`;
  return "";
}

function lookDifference(before: string[], after: string[]): string {
  const count = (values: string[]) => {
    const counts = new Map<string, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return counts;
  };
  const was = count(before);
  const is = count(after);
  return [...new Set([...was.keys(), ...is.keys()])]
    .filter((key) => was.get(key) !== is.get(key))
    .sort()
    .map((key) => `${key} ×${was.get(key) ?? 0}→${is.get(key) ?? 0}`)
    .join(", ");
}

/** C within the drawing: the copy lands clear of everything already there. */
function pasteInPlace(
  project: CircuitProject,
  document: SchematicDocument,
  selection: Selection,
  offsetX: number,
  sequence: number,
): { project: CircuitProject; document: SchematicDocument } {
  const clipboard = captureProjectCopy(project, document, selection);
  if (!clipboard) throw new Error("Nothing was copied");
  const pasted = applyProjectCopyPlacement(
    planProjectCopyPlacement(
      project,
      document,
      clipboard,
      { x: offsetX, y: 0 },
      sequence,
    ),
  );
  return {
    project: pasted,
    document: pasted.documents.find((item) => item.id === document.id)!,
  };
}

/** Turn every placed part a quarter, the way R does. */
function quarterTurn(
  document: SchematicDocument,
  resolver: SymbolResolver,
  step: number,
): SchematicDocument {
  const edits: SchematicEdit[] = document.instances.flatMap((instance) =>
    instance.placement
      ? [
          {
            kind: "rotate_instance" as const,
            instanceId: instance.id,
            rotation: ((instance.placement.rotation + 90) % 360) as NonNullable<
              Instance["placement"]
            >["rotation"],
          },
        ]
      : [],
  );
  let current = document;
  for (let start = 0; start < edits.length; start += 500) {
    const result = executeTransaction(
      current,
      {
        transactionId: `gallery-census-turn-${step}-${start}`,
        documentId: current.id,
        expectedRevision: current.revision,
        actor: { kind: "human", id: "gallery-census" },
        edits: edits.slice(start, start + 500),
      },
      { symbolResolver: resolver },
    );
    if (!result.ok)
      throw new Error(result.diagnostics[0]?.message ?? result.error.message);
    current = result.document;
  }
  return current;
}

/**
 * Name and value labels that sit where the current rule puts a label of
 * their own size, or of the default size, for their part. A value, or a
 * Cell's name, may sit in the Reference's slot while no Reference is shown.
 * A named parameter's value has a rule of its own (ruleLabelsAtDefault).
 */
function labelsAtDefault(
  document: SchematicDocument,
  resolver: SymbolResolver,
): string[] {
  const profile = resolveDocumentStyleProfile(document.presentation);
  return document.annotations.flatMap((annotation) => {
    if (
      annotation.anchor.kind !== "object" ||
      (annotation.kind !== "instance-label" &&
        annotation.kind !== "instance-value") ||
      (annotation.binding?.kind === "instance-value" &&
        annotation.binding.parameter)
    )
      return [];
    const anchor = annotation.anchor;
    const instance = document.instances.find(
      (item) => item.id === anchor.objectId,
    );
    const resolved =
      instance && resolver.resolve(instance.symbolId, instance.symbolVariantId);
    if (!instance?.placement || !resolved) return [];
    const placement = instance.placement;
    // Above its part a name over its value stands a row further out (#1384).
    const slots =
      annotation.kind === "instance-value"
        ? ([
            ["value", false],
            ["reference", false],
          ] as const)
        : ([
            ["reference", false],
            ["reference", true],
          ] as const);
    const atDefault = [...new Set([annotation.sizeScale ?? 1, 1])].some(
      (sizeScale) =>
        slots.some(([slot, overValue]) => {
          const expected = defaultInstanceLabelPlacement(
            instance,
            resolved,
            profile,
            document.presentation.grid,
            slot,
            sizeScale,
            overValue,
          );
          return (
            expected !== null &&
            expected.alignment === annotation.alignment &&
            expected.position.x ===
              placement.position.x + anchor.localOffset.x &&
            expected.position.y === placement.position.y + anchor.localOffset.y
          );
        }),
    );
    return atDefault ? [annotation.id] : [];
  });
}

/**
 * Labels with rules of their own that sit where the current rule puts them:
 * a VDD Port's supply label and a named parameter's value (a T-coil's k).
 * A label at an older default moves onto the current one the first time its
 * part turns; such a label has settled, not drifted.
 */
function ruleLabelsAtDefault(
  document: SchematicDocument,
  resolver: SymbolResolver,
): string[] {
  const profile = resolveDocumentStyleProfile(document.presentation);
  const grid = document.presentation.grid;
  return document.annotations.flatMap((annotation) => {
    if (annotation.anchor.kind !== "object") return [];
    const anchor = annotation.anchor;
    const instance = document.instances.find(
      (item) => item.id === anchor.objectId,
    );
    const resolved =
      instance && resolver.resolve(instance.symbolId, instance.symbolVariantId);
    if (!instance?.placement || !resolved) return [];
    const placement = instance.placement;
    const binding = annotation.binding;
    const expected =
      annotation.kind === "power-label"
        ? defaultVddPowerLabelPlacement(instance, resolved, grid)
        : binding?.kind === "instance-value" && binding.parameter
          ? defaultInstanceParameterLabelPlacement(
              instance,
              resolved,
              profile,
              grid,
              binding.parameter,
            )
          : null;
    return expected &&
      expected.alignment === annotation.alignment &&
      expected.position.x === placement.position.x + anchor.localOffset.x &&
      expected.position.y === placement.position.y + anchor.localOffset.y
      ? [annotation.id]
      : [];
  });
}

/**
 * The whole sheet mirrored left to right as one selection, the way Shift+R
 * does it: the committed document, or why nothing was committed.
 */
function mirrorEverything(
  document: SchematicDocument,
  resolver: SymbolResolver,
): SchematicDocument | string {
  const routeGeometryRecords = document.routes.flatMap((route) => {
    const geometry = resolveRouteGeometry(document, resolver, route);
    return geometry ? [{ route, geometry }] : [];
  });
  const selection = {
    instanceIds: document.instances
      .filter((item) => item.placement)
      .map((item) => item.id),
    routeIds: document.routes.map((item) => item.id),
    junctionIds: document.junctions.map((item) => item.id),
    annotationIds: document.annotations.map((item) => item.id),
    draftingIds: (document.drafting?.objects ?? []).map((item) => item.id),
  };
  let edits: SchematicEdit[] = [];
  let status = "";
  createSelectionTransformController({
    document,
    resolver,
    styleProfile: resolveDocumentStyleProfile(document.presentation),
    routeGeometryRecords,
    annotationGrid: 1,
    selectedInstanceIds: selection.instanceIds,
    selection,
    transact: (next) => {
      edits = next;
      return { ok: true };
    },
    setStatus: (next) => {
      status = next;
    },
  }).mirror("left-right");
  if (edits.length === 0) return `nothing mirrored: ${status}`;
  const result = executeTransaction(
    document,
    {
      transactionId: "gallery-census-mirror",
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "human", id: "gallery-census" },
      edits,
    },
    { symbolResolver: resolver },
  );
  return result.ok
    ? result.document
    : `rejected: ${result.diagnostics[0]?.message ?? result.error.message}`;
}

/**
 * What the sheet shows: part placements and the unit steps its wires cover,
 * so wires the Edit Engine merges or splits at a dotless Junction still
 * compare equal.
 */
function drawnSheet(document: SchematicDocument, resolver: SymbolResolver) {
  const steps = new Set<string>();
  const key = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    [a, b]
      .map((point) => `${point.x},${point.y}`)
      .sort()
      .join("|");
  for (const route of document.routes) {
    const centerline = resolveRouteGeometry(
      document,
      resolver,
      route,
    )?.centerline;
    if (!centerline) continue;
    for (let index = 1; index < centerline.length; index += 1) {
      const from = centerline[index - 1]!;
      const to = centerline[index]!;
      const dx = Math.sign(to.x - from.x);
      const dy = Math.sign(to.y - from.y);
      const count = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
      if (
        to.x !== from.x &&
        to.y !== from.y &&
        Math.abs(to.x - from.x) !== Math.abs(to.y - from.y)
      ) {
        steps.add(key(from, to));
        continue;
      }
      for (let step = 0; step < count; step += 1)
        steps.add(
          key(
            { x: from.x + dx * step, y: from.y + dy * step },
            { x: from.x + dx * (step + 1), y: from.y + dy * (step + 1) },
          ),
        );
    }
  }
  return JSON.stringify({
    parts: document.instances
      .map((item) => `${item.id}:${JSON.stringify(item.placement)}`)
      .sort(),
    steps: [...steps].sort(),
  });
}

function censusEntry(row: {
  id: string;
  name: string;
  project_text: string;
}): CensusEntry {
  const entry: CensusEntry = { id: row.id, name: row.name, checks: {} };
  let project: CircuitProject;
  try {
    project = parseProject(row.project_text);
  } catch (error) {
    entry.checks.load = failure(error);
    return entry;
  }
  entry.checks.load = OK;
  const document = project.documents.find(
    (item) => item.id === project.topDocumentId,
  )!;
  const resolver = createProjectSymbolResolver(project, builtInSymbols);

  if (runs("netlist")) netlistChecks(entry, project);
  if (runs("copy")) copyChecks(entry, project, document);
  if (runs("transform")) transformChecks(entry, project, document, resolver);
  return entry;
}

function netlistChecks(entry: CensusEntry, project: CircuitProject): void {
  entry.checks.netlist = attempt(() => {
    const result = createDesignNetlistExport(project, { format: "spice" });
    if (result.status === "ready") {
      entry.netlistHash = createHash("sha256")
        .update(result.file.text)
        .digest("hex")
        .slice(0, 16);
      return OK;
    }
    const codes = [...new Set(result.diagnostics.map((item) => item.code))];
    return `blocked: ${codes.sort().join(", ")}`;
  });
  try {
    entry.netlistMark = designExtractsNetlist(project);
  } catch {
    // The netlist check above already reports what failed.
  }
}

function copyChecks(
  entry: CensusEntry,
  project: CircuitProject,
  document: SchematicDocument,
): void {
  // Every supply marker on its own, as a copied VDD or ground usually travels.
  const markers = document.instances.filter(
    (instance) =>
      instance.symbolId === "vdd-port" || instance.symbolId === "ground",
  );
  entry.markerCopies = markers.length;
  const markerFailures = markers.flatMap((marker) => {
    const outcome = attempt(() => {
      pasteIntoNewProject(project, document, {
        instanceIds: [marker.id],
        routeIds: [],
        junctionIds: [],
        annotationIds: [],
        draftingIds: [],
      });
    });
    return outcome === OK ? [] : [`${marker.id}: ${outcome}`];
  });
  entry.checks.markers = markerFailures.length
    ? markerFailures.sort().join("; ").slice(0, 480)
    : OK;

  let copied: CircuitProject | undefined;
  entry.checks.copyToProject = attempt(() => {
    copied = pasteIntoNewProject(project, document, everything(document));
  });
  entry.checks.copyLooksAlike = copied
    ? attempt(
        () =>
          lookDifference(
            look(project, document),
            look(copied!, copied!.documents[0]!),
          ) || OK,
      )
    : "no copy";
  entry.checks.copyKeepsConnections = copied
    ? attempt(() => connectionDifference(project, copied!) || OK)
    : "no copy";

  let once: ReturnType<typeof pasteInPlace> | undefined;
  entry.checks.copyInPlace = attempt(() => {
    once = pasteInPlace(project, document, everything(document), 5000, 1);
  });
  entry.checks.copyOfCopies = once
    ? attempt(() => {
        // A drawing of drafting objects and wires alone, such as a block
        // diagram, has no parts whose identities could chain.
        if (once!.document.instances.length === 0) return OK;
        // Sources and their copies together: identities that share a stem.
        const before = objectIds(once!.document);
        const twice = pasteInPlace(
          once!.project,
          once!.document,
          {
            instanceIds: once!.document.instances.map((item) => item.id),
            routeIds: [],
            junctionIds: [],
            annotationIds: [],
            draftingIds: [],
          },
          10000,
          2,
        );
        const grown = [...objectIds(twice.document)].filter(
          (id) =>
            !before.has(id) && (/_\d+_\d+$/u.test(id) || /-copy-\d/u.test(id)),
        );
        return grown.length
          ? `identities grew: ${grown.sort().slice(0, 4).join(", ")}`
          : OK;
      })
    : "not reached";
}

function transformChecks(
  entry: CensusEntry,
  project: CircuitProject,
  document: SchematicDocument,
  resolver: SymbolResolver,
): void {
  entry.checks.turn = attempt(() => {
    const turned = quarterTurn(document, resolver, 1);
    entry.labelsFollowing = labelsAtDefault(turned, resolver).sort();
    let current = turned;
    for (let step = 2; step <= 4; step += 1)
      current = quarterTurn(current, resolver, step);
    // A full turn brings every label back, or onto the current rule's place.
    const settled = new Set([
      ...labelsAtDefault(current, resolver),
      ...ruleLabelsAtDefault(current, resolver),
    ]);
    const displaced = document.annotations.flatMap((original) => {
      if (original.anchor.kind !== "object") return [];
      const after = current.annotations.find((item) => item.id === original.id);
      if (!after || after.anchor.kind !== "object") return [original.id];
      const returned =
        after.alignment === original.alignment &&
        after.rotation === original.rotation &&
        after.anchor.localOffset.x === original.anchor.localOffset.x &&
        after.anchor.localOffset.y === original.anchor.localOffset.y;
      return returned || settled.has(original.id) ? [] : [original.id];
    });
    return displaced.length
      ? `labels displaced by a full turn: ${displaced.sort().slice(0, 6).join(", ")}`
      : OK;
  });

  // The whole sheet mirrored as one selection keeps every connection, and
  // mirroring it again gives back the same drawing.
  entry.checks.mirror = attempt(() => {
    const netlistOf = (current: SchematicDocument) => {
      const result = createDesignNetlistExport(
        {
          ...project,
          documents: project.documents.map((item) =>
            item.id === current.id ? current : item,
          ),
        },
        { format: "spice" },
      );
      return result.status === "ready" ? result.file.text : null;
    };
    const once = mirrorEverything(document, resolver);
    if (typeof once === "string") return once;
    if (netlistOf(once) !== netlistOf(document)) return "netlist changed";
    const twice = mirrorEverything(once, resolver);
    if (typeof twice === "string") return `second mirror ${twice}`;
    return drawnSheet(twice, resolver) === drawnSheet(document, resolver)
      ? OK
      : "a second mirror does not restore the drawing";
  });
}

it("puts every Gallery drawing through the census", () => {
  const backup = process.env.ICM_GALLERY_CENSUS_BACKUP;
  const out = process.env.ICM_GALLERY_CENSUS_OUT;
  if (!backup || !out)
    throw new Error("Run the census through `pnpm gallery:census`");
  const statuses = (process.env.ICM_GALLERY_CENSUS_STATUS ?? "public").split(
    ",",
  );
  const only = process.env.ICM_GALLERY_CENSUS_ONLY?.split(",").filter(Boolean);
  const limit = Number(process.env.ICM_GALLERY_CENSUS_LIMIT ?? "0");
  const database = new DatabaseSync(backup, { readOnly: true });
  let rows = database
    .prepare(
      "SELECT id, name, status, project_text FROM gallery_entries ORDER BY id",
    )
    .all() as {
    id: string;
    name: string;
    status: string;
    project_text: string;
  }[];
  database.close();
  rows = rows.filter(
    (row) =>
      (statuses.includes("all") || statuses.includes(row.status)) &&
      (!only?.length || only.includes(row.id)),
  );
  if (limit > 0) rows = rows.slice(0, limit);
  const entries: CensusEntry[] = [];
  for (const [index, row] of rows.entries()) {
    entries.push(censusEntry(row));
    if ((index + 1) % 100 === 0)
      console.log(`gallery census: ${index + 1}/${rows.length}`);
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    `${JSON.stringify(
      {
        format: "analog-canvas/gallery-census",
        version: 1,
        commit: process.env.ICM_GALLERY_CENSUS_COMMIT ?? null,
        // What a later census may reuse this report for: the same tree,
        // snapshot, harness and statuses, all drawings, these checks.
        tree: process.env.ICM_GALLERY_CENSUS_TREE || null,
        harness: process.env.ICM_GALLERY_CENSUS_HARNESS || null,
        checkGroups,
        complete: !only?.length && !(limit > 0),
        netlistMarkRuleVersion: NETLIST_MARK_RULE_VERSION,
        backup,
        statuses,
        generatedAt: new Date().toISOString(),
        entries,
      },
      null,
      1,
    )}\n`,
  );
}, 3_600_000);
