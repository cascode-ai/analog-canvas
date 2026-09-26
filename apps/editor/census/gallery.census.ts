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
} from "@icm/derived";
import { executeTransaction, type SchematicEdit } from "@icm/edit-engine";
import {
  createEmptyProject,
  type CircuitProject,
  type Instance,
  type SchematicDocument,
} from "@icm/model";
import { createDesignNetlistExport } from "@icm/netlist";
import { parseProject } from "@icm/project-protocol";
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

const OK = "ok";

type Selection = Parameters<typeof encodeCircuitClipboard>[2];

interface CensusEntry {
  id: string;
  name: string;
  /** "ok", or what went wrong. The comparison reads only these. */
  checks: Record<string, string>;
  netlistHash?: string;
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
): void {
  const text = encodeCircuitClipboard(project, document, selection);
  if (!text) throw new Error("Nothing was copied");
  const clipboard = decodeCircuitClipboard(text);
  if (!clipboard) throw new Error("The clipboard text did not decode");
  const target = createEmptyProject("census-target", "Census");
  applyProjectCopyPlacement(
    planProjectCopyPlacement(
      target,
      target.documents[0]!,
      clipboard,
      { x: 0, y: 0 },
      1,
    ),
  );
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
 * their own size, or of the default size, for their part.
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
      annotation.binding?.kind === "instance-value"
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
    const atDefault = [...new Set([annotation.sizeScale ?? 1, 1])].some(
      (sizeScale) => {
        const expected = defaultInstanceLabelPlacement(
          instance,
          resolved,
          profile,
          document.presentation.grid,
          annotation.kind === "instance-value" ? "value" : "reference",
          sizeScale,
        );
        return (
          expected !== null &&
          expected.alignment === annotation.alignment &&
          expected.position.x === placement.position.x + anchor.localOffset.x &&
          expected.position.y === placement.position.y + anchor.localOffset.y
        );
      },
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

  // Every supply marker on its own, as a copied VDD or ground usually travels.
  const markers = document.instances.filter(
    (instance) =>
      instance.symbolId === "vdd-port" || instance.symbolId === "ground",
  );
  entry.markerCopies = markers.length;
  const markerFailures = markers.flatMap((marker) => {
    const outcome = attempt(() =>
      pasteIntoNewProject(project, document, {
        instanceIds: [marker.id],
        routeIds: [],
        junctionIds: [],
        annotationIds: [],
        draftingIds: [],
      }),
    );
    return outcome === OK ? [] : [`${marker.id}: ${outcome}`];
  });
  entry.checks.markers = markerFailures.length
    ? markerFailures.sort().join("; ").slice(0, 480)
    : OK;

  entry.checks.copyToProject = attempt(() =>
    pasteIntoNewProject(project, document, everything(document)),
  );

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
  return entry;
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
