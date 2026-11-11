// RNL benchmark harness: every benchmark circuit through SPICE+RNL and
// Spectre+RNL and back into Analog Canvas, graded L0–L3 against the original.
//
// The corpus, its scoring and its results live in
// https://github.com/rich-netlist/rnl-benchmark; this harness lives here, so
// it moves with the importer it grades. Without RNL_BENCH_CORPUS it is skipped.
// Run from an analog-canvas checkout:
//   RNL_BENCH_CORPUS=<repo>/circuits RNL_BENCH_OUT=<dir> [RNL_BENCH_IDS=a,b] \
//     [RNL_BENCH_STRICT=all | hidden-absent,hidden-extra,…] \
//     [RNL_BENCH_KEEP_ORIGINAL_FORMALS=1] [RNL_BENCH_SKIP_RENDERED=1] \
//     npx vitest run apps/editor/src/features/netlist-export/rnl-benchmark.test.ts
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, it } from "vitest";

import { arrowEndStyles } from "@icm/derived";
import { reviewedExternalBindingForTerminalCount } from "@icm/devices";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import {
  compareElectricalGraphs,
  createDesignNetlistExport,
  projectElectricalGraph,
  sameElectricalCircuit,
} from "@icm/netlist";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { renderDocumentSvg } from "@icm/render-svg";
import { createRnlExport, type RnlSnapshot } from "@icm/rnl";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";

import { labelCensus, labelDifferences } from "../../../e2e/label-census";
import { createRnlTestCore } from "./rnl-core.test-support";
import { planRnlImport } from "./rnl-import";
import type { RnlRuntime } from "./rnl-runtime";

const CORPUS = process.env.RNL_BENCH_CORPUS ?? "";
const OUT = process.env.RNL_BENCH_OUT ?? "";
const IDS = process.env.RNL_BENCH_IDS
  ? process.env.RNL_BENCH_IDS.split(",").filter(Boolean)
  : CORPUS
    ? readdirSync(CORPUS)
        .filter((name) => name.endsWith(".icproj.json"))
        .map((name) => name.replace(/\.icproj\.json$/u, ""))
        .sort()
    : [];
const FORMATS = ["spice", "spectre"] as const;
// Compare against the original as stored, its external definitions left as
// they are (see withReviewedFormals).
const KEEP_ORIGINAL_FORMALS =
  process.env.RNL_BENCH_KEEP_ORIGINAL_FORMALS === "1";

// The runtime starts only for a run with a corpus.
const core = CORPUS ? await createRnlTestCore() : undefined;
afterAll(() => core?.terminate());
const runtime: RnlRuntime = {
  write: (request) =>
    core!.write(
      request as unknown as Parameters<NonNullable<typeof core>["write"]>[0],
    ),
  snapshot: (request) =>
    core!.snapshot(request) as unknown as Promise<RnlSnapshot>,
};

type Diagnostic = { severity: string; code: string; message: string };
const tally = (items: readonly Diagnostic[]) => {
  const out: Record<string, number> = {};
  for (const item of items)
    out[`${item.severity} ${item.code}`] =
      (out[`${item.severity} ${item.code}`] ?? 0) + 1;
  return out;
};

/** Mirror "horizontal" is "vertical" turned 180°, "both" is a 180° turn. */
function orientation(rotation: number, mirror: string) {
  if (mirror === "horizontal") return `r${(rotation + 180) % 360} vertical`;
  if (mirror === "both") return `r${(rotation + 180) % 360} none`;
  return `r${rotation} ${mirror}`;
}

const cellKey = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/gu, "_");

function documentPairs(a: CircuitProject, b: CircuitProject) {
  const byKey = new Map(b.documents.map((item) => [cellKey(item.name), item]));
  const topB = b.documents.find((item) => item.id === b.topDocumentId);
  return a.documents.map((document) => ({
    a: document,
    b:
      document.id === a.topDocumentId
        ? topB
        : byKey.get(cellKey(document.name)),
  }));
}

function symbolOf(
  project: CircuitProject,
  instance: SchematicDocument["instances"][number],
) {
  const binding = instance.netlist?.binding;
  if (binding?.kind === "subcircuit") {
    const child = project.documents.find(
      (item) => item.id === binding.childDocumentId,
    );
    return `cell:${cellKey(child?.name ?? "?")}`;
  }
  return instance.symbolId;
}

function placed(
  project: CircuitProject,
  document: SchematicDocument,
  equivalences: ReadonlySet<Equivalence> = ENABLED,
) {
  const named = new Map<string, string>();
  const unnamed: string[] = [];
  for (const instance of document.instances) {
    const at = instance.placement
      ? `${instance.placement.position.x},${instance.placement.position.y} ${orientation(instance.placement.rotation, instance.placement.mirror)}`
      : "unplaced";
    const symbol = symbolOf(project, instance);
    if (instance.reference)
      named.set(
        instance.reference,
        `${symbol} @ ${at} ${JSON.stringify(
          Object.fromEntries(
            Object.entries(instance.netlist?.parameters ?? {})
              .filter(
                ([name, value]) =>
                  !(
                    equivalences.has("default-ac-phase") &&
                    name === "acPhase" &&
                    Number(value) === 0
                  ),
              )
              .sort(),
          ),
        )}`,
      );
    else unnamed.push(`${symbol} @ ${at}`);
  }
  return { named, unnamed: unnamed.sort() };
}

function multisetDiff(a: readonly string[], b: readonly string[]) {
  const left = new Map<string, number>();
  for (const item of a) left.set(item, (left.get(item) ?? 0) + 1);
  const added: string[] = [];
  for (const item of b) {
    const n = left.get(item) ?? 0;
    if (n > 0) left.set(item, n - 1);
    else added.push(item);
  }
  const missing = [...left].flatMap(([item, n]) => Array(n).fill(item));
  return { missing, added };
}

/**
 * Differences that draw the same, each counted as none unless named in
 * RNL_BENCH_STRICT (or `all`):
 * - hidden-absent: a hidden label the import does not bring back is still
 *   hidden; only one that comes back shown counts;
 * - hidden-extra: annotations are counted as shown, so a hidden one the
 *   import adds, which draws nothing, does not count;
 * - text-styles: a drawing object's text is compared by the characters it
 *   shows and the styles of each, as Analog Canvas compares styled text
 *   (sameStyledText), not by how its spans are nested or split;
 * - arrow-ends: an arrow's heads are compared as Analog Canvas draws them
 *   (arrowEndStyles), so the legacy fields and the defaults they mean match
 *   the explicit ends;
 * - style-defaults: a style flag set false, or a size scale of 1, is the
 *   same as one left unset;
 * - unused-anchor: the anchor of an arrow, construction line, rectangle or
 *   circle, which Analog Canvas draws from its own points (resolveDraftingGeometry
 *   reads the anchor only of texts, leaders, callouts and floating symbols);
 * - orphan-junction: a junction no wire touches, which draws nothing (a dot
 *   is drawn only where wires meet);
 * - default-ac-phase: a source's AC phase of 0, the default, the same as one
 *   left unset, as Analog Canvas compares circuits (comparedParameters); the
 *   netlist prints 0 either way;
 * - empty-note: a drawing text with no characters and no polarity mark, which
 *   draws nothing.
 */
const EQUIVALENCES = [
  "hidden-absent",
  "hidden-extra",
  "text-styles",
  "arrow-ends",
  "style-defaults",
  "unused-anchor",
  "orphan-junction",
  "default-ac-phase",
  "empty-note",
] as const;
type Equivalence = (typeof EQUIVALENCES)[number];
const STRICT = (process.env.RNL_BENCH_STRICT ?? "").split(",").filter(Boolean);
/** RNL_BENCH_SKIP_RENDERED=1: grade by the compared fields alone, as before the drawn check. */
const SKIP_RENDERED = Boolean(process.env.RNL_BENCH_SKIP_RENDERED);
const ENABLED = new Set<Equivalence>(
  EQUIVALENCES.filter(
    (name) => !STRICT.includes("all") && !STRICT.includes(name),
  ),
);

/** A rich text as the characters it shows, each with its sorted styles. */
function styledCharacters(
  value: unknown,
  styles: readonly string[] = [],
): string[] {
  if (Array.isArray(value))
    return value.flatMap((item) => styledCharacters(item, styles));
  if (!value || typeof value !== "object") return [];
  const run = value as Record<string, unknown>;
  if (run.kind === "text" && typeof run.value === "string")
    return [...run.value].map(
      (character) => `${character}|${[...new Set(styles)].sort().join(",")}`,
    );
  // A script is upright inside italic, as Analog Canvas draws it: only an
  // italic span inside the script slants it.
  if (run.kind === "span")
    return styledCharacters(run.children, [
      ...(run.style === "subscript" || run.style === "superscript"
        ? styles.filter((style) => style !== "italic")
        : styles),
      String(run.style),
    ]);
  if (run.kind === "line-break") return ["<br>"];
  return Object.entries(run)
    .filter(([key]) => key !== "kind")
    .flatMap(([key, item]) => styledCharacters(item, [...styles, key]));
}

/** A drawing object as its drawing compares, the equivalences applied. */
function comparable(
  object: Record<string, unknown>,
  equivalences: ReadonlySet<Equivalence>,
) {
  let next: Record<string, unknown> = { ...object };
  const style = {
    ...((next.styleOverride as Record<string, unknown> | undefined) ?? {}),
  };
  if (
    equivalences.has("text-styles") &&
    next.content &&
    typeof next.content === "object"
  )
    next.content = styledCharacters((next.content as { runs?: unknown }).runs);
  if (equivalences.has("arrow-ends") && next.kind === "arrow") {
    next.arrowEnds = arrowEndStyles(
      next as Parameters<typeof arrowEndStyles>[0],
    );
    for (const key of [
      "arrowHead",
      "arrowHeadAt",
      "arrowHeadScale",
      "arrowStart",
      "arrowEnd",
    ])
      delete style[key];
  }
  if (equivalences.has("style-defaults"))
    for (const [key, item] of Object.entries(style))
      if (item === false || (key === "sizeScale" && item === 1))
        delete style[key];
  // A polarity mark with no words: RNL has no text to hold its role, and
  // `label` draws it at the size unset does.
  if (
    equivalences.has("style-defaults") &&
    next.polarity &&
    next.typographyToken === "label" &&
    styledCharacters(
      (object.content as { runs?: unknown } | undefined)?.runs,
    ).every((character) => character === "<br>")
  )
    delete next.typographyToken;
  if (
    equivalences.has("unused-anchor") &&
    ["arrow", "construction-line", "rectangle", "circle"].includes(
      String(next.kind),
    )
  )
    delete next.anchor;
  next.styleOverride = style;
  return next;
}

const byKind = (items: readonly { kind?: string }[]) => {
  const out: Record<string, number> = {};
  for (const item of items)
    out[item.kind ?? "?"] = (out[item.kind ?? "?"] ?? 0) + 1;
  return JSON.stringify(Object.fromEntries(Object.entries(out).sort()));
};

const withoutIds = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(withoutIds)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .filter(
              ([key, item]) =>
                key !== "id" &&
                key !== "zIndex" &&
                item !== undefined &&
                !(
                  item &&
                  typeof item === "object" &&
                  !Array.isArray(item) &&
                  Object.keys(item).length === 0
                ),
            )
            .sort(([x], [y]) => x.localeCompare(y))
            .map(([key, item]) => [key, withoutIds(item)]),
        )
      : value;

/** Where two JSON values differ, as "path: before -> after". */
function changedPaths(a: unknown, b: unknown, path = ""): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((key) =>
      changedPaths(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
        path ? `${path}.${key}` : key,
      ),
    );
  }
  return [`${path}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`];
}

/** Every drawing difference between two projects, as "category: detail". */
function drawingDifferences(
  a: CircuitProject,
  b: CircuitProject,
  equivalences: ReadonlySet<Equivalence> = ENABLED,
): string[] {
  const out: string[] = [];
  const counted = <T extends { kind?: string; visible?: unknown }>(
    items: readonly T[],
  ) =>
    equivalences.has("hidden-extra")
      ? items.filter((item) => item.visible !== false)
      : items;
  if (a.documents.length !== b.documents.length)
    out.push(`document: ${a.documents.length} Cells -> ${b.documents.length}`);
  for (const { a: da, b: db } of documentPairs(a, b)) {
    const cell = da.name;
    if (!db) {
      out.push(`document: ${cell} not found after import`);
      continue;
    }
    // A Cell's name the netlist had to write otherwise ("Bootstrap switch" as
    // bootstrap_switch) is lost, however its Cell is paired.
    const nameOf = (document: SchematicDocument) =>
      document.netlist?.name ?? document.name;
    if (nameOf(da) !== nameOf(db))
      out.push(`cell-name: ${nameOf(da)} rewritten as ${nameOf(db)}`);
    const pa = placed(a, da, equivalences);
    const pb = placed(b, db, equivalences);
    for (const [reference, value] of pa.named) {
      const after = pb.named.get(reference) ?? pb.named.get(`X${reference}`);
      if (!pb.named.has(reference) && pb.named.has(`X${reference}`))
        out.push(`reference: ${cell} ${reference} -> X${reference}`);
      if (!after) out.push(`instance: ${cell} ${reference} missing`);
      else if (after !== value)
        out.push(`instance: ${cell} ${reference} ${value} -> ${after}`);
    }
    for (const reference of pb.named.keys())
      if (
        !pa.named.has(reference) &&
        !pa.named.has(reference.replace(/^X/u, ""))
      )
        out.push(`instance: ${cell} ${reference} added`);
    const pins = multisetDiff(pa.unnamed, pb.unnamed);
    for (const item of pins.missing)
      out.push(`pin-or-glyph: ${cell} missing ${item}`);
    for (const item of pins.added)
      out.push(`pin-or-glyph: ${cell} added ${item}`);
    if (da.routes.length !== db.routes.length)
      out.push(`route: ${cell} ${da.routes.length} -> ${db.routes.length}`);
    const touched = (document: SchematicDocument) =>
      document.junctions.filter(
        (junction) =>
          !equivalences.has("orphan-junction") ||
          document.routes.some((route) =>
            JSON.stringify(route).includes(`"${junction.id}"`),
          ),
      );
    const junctions = multisetDiff(
      touched(da).map((item) => `${item.position.x},${item.position.y}`),
      touched(db).map((item) => `${item.position.x},${item.position.y}`),
    );
    if (junctions.missing.length || junctions.added.length)
      out.push(
        `junction: ${cell} -${junctions.missing.length} +${junctions.added.length}`,
      );
    const ka = byKind(counted(da.annotations));
    const kb = byKind(counted(db.annotations));
    if (ka !== kb) out.push(`annotation: ${cell} ${ka} -> ${kb}`);
    // Ids are not compared, and so neither is the id an anchor names: the
    // part it names is, by its name or its symbol and place.
    const anchoredTo = (document: SchematicDocument) => (item: unknown) => {
      const object = item as Record<string, unknown>;
      const anchor = object.anchor as
        { kind?: string; objectId?: string } | undefined;
      const part =
        anchor?.kind === "object"
          ? document.instances.find(
              (instance) => instance.id === anchor.objectId,
            )
          : undefined;
      if (!part) return object;
      const at = part.placement?.position;
      return {
        ...object,
        anchor: {
          ...anchor,
          objectId: part.reference ?? `${part.symbolId}@${at?.x},${at?.y}`,
        },
      };
    };
    const drawn = (document: SchematicDocument) =>
      (document.drafting?.objects ?? [])
        .filter(
          (item) => !(equivalences.has("empty-note") && isEmptyNote(item)),
        )
        .map(anchoredTo(document))
        .map((item) =>
          JSON.stringify(
            withoutIds(
              comparable(item as Record<string, unknown>, equivalences),
            ),
          ),
        );
    const drafting = multisetDiff(drawn(da), drawn(db));
    const unmatched = [...drafting.added];
    for (const item of drafting.missing) {
      const before = JSON.parse(item) as Record<string, unknown>;
      const index = unmatched.findIndex(
        (candidate) =>
          (JSON.parse(candidate) as Record<string, unknown>).kind ===
          before.kind,
      );
      if (index < 0) {
        out.push(`drafting: ${cell} ${String(before.kind)} lost`);
        continue;
      }
      const after = JSON.parse(unmatched.splice(index, 1)[0]!) as unknown;
      out.push(
        `drafting: ${cell} ${String(before.kind)} ${changedPaths(before, after).join("; ")}`,
      );
    }
    for (const item of unmatched)
      out.push(
        `drafting: ${cell} ${String((JSON.parse(item) as Record<string, unknown>).kind)} added`,
      );
  }
  // The census knows a Cell by its netlist name, which the netlist may have to
  // spell otherwise ("Bootstrap switch" prints as bootstrap_switch): the
  // original's labels go by the name of the Cell it is paired with above.
  const censusName = (document: SchematicDocument) =>
    (document.netlist?.name ?? document.name).toLowerCase();
  const renamed = new Map(
    documentPairs(a, b).flatMap(({ a: da, b: db }) =>
      db ? [[censusName(da), censusName(db)] as const] : [],
    ),
  );
  const before = labelCensus(a).map((label) => ({
    ...label,
    cell: renamed.get(label.cell) ?? label.cell,
  }));
  const after = labelCensus(b);
  const owner = (label: { cell: string; kind: string; owner: string }) =>
    `${label.cell} ${label.kind} ${label.owner}`;
  const back = new Set(
    after.map((label) => `${owner(label)} ${label.parameter}`),
  );
  for (const line of labelDifferences(before, after)) {
    const hidden = /^(.*): hidden before, shown$/u.exec(line);
    if (
      equivalences.has("hidden-absent") &&
      hidden &&
      !before.some(
        (label) =>
          label.hidden &&
          owner(label) === hidden[1] &&
          back.has(`${owner(label)} ${label.parameter}`),
      )
    )
      continue;
    out.push(`label: ${line}`);
  }
  return out;
}

const netlistLines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("*") && !line.startsWith("//"))
    .sort();
const definitions = (text: string) =>
  new Set(
    [...text.matchAll(/^\s*\.?(?:model|subckt)\s+(\S+)/gimu)].map((match) =>
      match[1]!.toLowerCase(),
    ),
  );

function netlistComparison(
  a: CircuitProject,
  b: CircuitProject,
  format: "spice" | "spectre",
) {
  const before = createDesignNetlistExport(a, { format });
  const after = createDesignNetlistExport(b, { format });
  if (before.status !== "ready" || after.status !== "ready")
    return {
      identical: false,
      note: `${before.status}/${after.status}`,
      lostDefinitions: [] as string[],
    };
  const ta = before.file.text;
  const tb = after.file.text;
  const lines = multisetDiff(netlistLines(ta), netlistLines(tb));
  const kept = definitions(tb);
  return {
    identical: lines.missing.length === 0 && lines.added.length === 0,
    linesMissing: lines.missing.slice(0, 20),
    linesAdded: lines.added.slice(0, 20),
    lostDefinitions: [...definitions(ta)].filter((name) => !kept.has(name)),
  };
}

/**
 * The original as Analog Canvas declares its external definitions now, for
 * comparing only: a definition of a reviewed device (a SKY130 transistor or
 * BJT) that declares no formal parameters takes the ones the reviewed
 * interface gives it, with their defaults. Older Gallery projects lack them,
 * while Canvas's placement and import both declare them today, so the
 * definition read back has them and the electrical comparison sets the two
 * apart. Every call gives the values, so the circuit is the same. The
 * definitions brought up this way are listed in the report
 * (`normalizedDefinitions`); RNL_BENCH_KEEP_ORIGINAL_FORMALS=1 turns it off.
 */
function withReviewedFormals(project: CircuitProject): {
  project: CircuitProject;
  normalized: string[];
} {
  const normalized: string[] = [];
  if (KEEP_ORIGINAL_FORMALS) return { project, normalized };
  const next = structuredClone(project);
  for (const definition of next.externalSubcircuitDefinitions ?? []) {
    if (definition.implementation || definition.formalParameters.length)
      continue;
    const reviewed = reviewedExternalBindingForTerminalCount(
      definition.name,
      definition.terminals.length,
    );
    if (!reviewed?.parameters.length) continue;
    definition.formalParameters = reviewed.parameters.map((parameter) => ({
      name: parameter.name,
      ...(parameter.targetDefaultValue === undefined
        ? {}
        : { defaultValue: parameter.targetDefaultValue }),
    }));
    normalized.push(definition.name);
  }
  return { project: normalized.length ? next : project, normalized };
}

async function roundTrip(
  id: string,
  project: CircuitProject,
  format: "spice" | "spectre",
) {
  const result: Record<string, unknown> = { level: 0 };
  const exported = createRnlExport(project, { format });
  result.exportStatus = exported.status;
  result.exportDiagnostics = tally(exported.diagnostics as Diagnostic[]);
  if (exported.status !== "ready") {
    result.failure = "export-blocked";
    // A netlist the design itself cannot write blocks RNL too; say why.
    result.netlistDiagnostics = tally(
      (
        (exported as { netlistDiagnostics?: Diagnostic[] })
          .netlistDiagnostics ?? []
      ).filter((item) => item.severity === "error"),
    );
    result.errors = (
      (exported as { netlistDiagnostics?: Diagnostic[] }).netlistDiagnostics ??
      []
    )
      .filter((item) => item.severity === "error")
      .map((item) => `${item.code}: ${item.message}`);
    return result;
  }
  let text: string;
  try {
    text = (await runtime.write({ write: exported.request, svg: false })).text;
  } catch (error) {
    result.failure = "write-threw";
    result.error = String(error).slice(0, 2000);
    return result;
  }
  writeFileSync(join(OUT, "rnl", `${id}.${format}.rnl`), text);
  const path = format === "spice" ? "circuit.sp" : "circuit.scs";
  let plan: Awaited<ReturnType<typeof planRnlImport>>;
  try {
    plan = await planRnlImport({
      inputs: [{ path, bytes: new TextEncoder().encode(text) }],
      entryPath: path,
      runtime,
    });
  } catch (error) {
    result.failure = "import-threw";
    result.error = String(error).slice(0, 2000);
    return result;
  }
  result.importStatus = plan.status;
  result.importDiagnostics = tally(plan.diagnostics as Diagnostic[]);
  if (plan.status !== "ready") {
    result.failure = "import-failed";
    return result;
  }
  const errors = (plan.diagnostics as Diagnostic[]).filter(
    (item) => item.severity === "error",
  );
  if (errors.length > 0) {
    result.failure = "import-errors";
    result.errors = errors.map((item) => `${item.code}: ${item.message}`);
    return result;
  }
  // A Project the editor could not save is no import.
  try {
    serializeProject(plan.project);
  } catch (error) {
    result.failure = "import-unsaveable";
    result.errors = [
      String(error instanceof Error ? error.message : error).slice(0, 2000),
    ];
    return result;
  }
  result.level = 1;
  const back = plan.project;
  const compared = withReviewedFormals(project);
  if (compared.normalized.length)
    result.normalizedDefinitions = compared.normalized;
  project = compared.project;
  const a = projectElectricalGraph(project);
  const b = projectElectricalGraph(back);
  // Equal as the import's own guard reads it (`sameElectricalCircuit`): the
  // comparison's "equal", or, past its size limit or with no devices, the
  // same printed cards, which only ever prove it.
  result.electrical =
    a.status === "ready" && b.status === "ready"
      ? compareElectricalGraphs(a.graph, b.graph)
      : sameElectricalCircuit(a, b)
        ? "equal"
        : `${a.status}/${b.status}`;
  if (a.status !== "ready") result.electricalReason = a.reason;
  const netlist = netlistComparison(project, back, format);
  result.netlist = netlist;
  // Listed at every level that imported, so a circuit failing L2 still shows
  // what its drawing lost.
  const differences = drawingDifferences(project, back);
  result.drawingDifferences = differences;
  // What the equivalences count as none, listed so a reader sees each.
  if (ENABLED.size) {
    const strict = drawingDifferences(project, back, new Set());
    const kept = new Set(differences);
    const absorbed = strict.filter((line) => !kept.has(line));
    if (absorbed.length) result.equivalentDifferences = absorbed;
  }
  const rendered = SKIP_RENDERED ? [] : renderedDifferences(project, back);
  if (rendered.length) result.renderedDifferences = rendered;
  if (result.electrical !== "equal" || !netlist.identical) return result;
  result.level = differences.length === 0 && rendered.length === 0 ? 3 : 2;
  return result;
}

const round = (value: string, digits: number) =>
  String(Math.round(Number.parseFloat(value) * 10 ** digits) / 10 ** digits);

/** A text as drawn: where, and each character with the style it ends up with. */
function drawnText(svg: string): string {
  const head = /^<text\b([^>]*)>/u.exec(svg)![1]!;
  const attributes = (source: string) =>
    Object.fromEntries(
      [...source.matchAll(/([\w-]+)="([^"]*)"/gu)].map((match) => [
        match[1]!,
        match[2]!,
      ]),
    );
  // A size to 0.1, so 15.12 and 15.116 are one size: RNL writes four digits.
  const size = (value: string) => round(value, 1);
  const own = attributes(head);
  const place = ["x", "y", "text-anchor", "transform", "fill"].map((name) =>
    (own[name] ?? "").replace(/-?\d+\.\d+/gu, (number) => round(number, 1)),
  );
  const stack: Record<string, string>[] = [
    {
      "font-size": size(own["font-size"] ?? "0"),
      "font-style": own["font-style"] ?? "",
      "font-weight": own["font-weight"] ?? "",
    },
  ];
  const characters: string[] = [];
  // A shift moves the next character drawn, whichever span holds it.
  let shift = "0,0";
  for (const token of svg
    .slice(head.length + "<text>".length, -"</text>".length)
    .matchAll(/<tspan\b([^>]*)>|<\/tspan>|[^<]+/gu)) {
    const [text, tag] = token;
    if (text === "</tspan>") stack.pop();
    else if (tag !== undefined) {
      const span = attributes(tag);
      const style = { ...stack.at(-1)! };
      for (const item of (span.style ?? "").split(";")) {
        const [name, value] = item.split(":");
        if (name && value) style[name.trim()] = value.trim();
      }
      if (span["font-size"]) style["font-size"] = size(span["font-size"]);
      if (span.dx !== undefined || span.dy !== undefined)
        shift = `${round(span.dx ?? "0", 1)},${round(span.dy ?? "0", 1)}`;
      stack.push(style);
    } else
      for (const character of text) {
        characters.push(
          JSON.stringify([
            character,
            shift,
            Object.entries(stack.at(-1)!).sort(),
          ]),
        );
        shift = "0,0";
      }
  }
  return JSON.stringify([place, characters]);
}

/** Straight strokes of a path as drawn, merged where they overlap; null where it curves. */
function drawnStrokes(data: string): string[] | null {
  if (/[^MLZ\d\s.,e-]/u.test(data)) return null;
  const strokes: [number, number, number, number][] = [];
  const tokens = data.match(/[MLZ]|-?\d+\.?\d*(?:e-?\d+)?/gu) ?? [];
  let at: [number, number] | null = null;
  for (let index = 0; index < tokens.length;) {
    const token = tokens[index]!;
    if (token !== "M" && token !== "L") {
      index += 1;
      continue;
    }
    const next: [number, number] = [
      Number(round(tokens[index + 1]!, 2)),
      Number(round(tokens[index + 2]!, 2)),
    ];
    index += 3;
    if (token === "L" && at && (at[0] !== next[0] || at[1] !== next[1])) {
      const [from, to] =
        at[0] < next[0] || (at[0] === next[0] && at[1] < next[1])
          ? [at, next]
          : [next, at];
      strokes.push([from[0], from[1], to[0], to[1]]);
    }
    at = next;
  }
  const lines = new Map<string, [number, number][]>();
  const out: string[] = [];
  for (const [x1, y1, x2, y2] of strokes) {
    if (x1 !== x2 && y1 !== y2) out.push(`${x1},${y1} ${x2},${y2}`);
    else {
      const key = x1 === x2 ? `x=${x1}` : `y=${y1}`;
      const spans = lines.get(key) ?? [];
      spans.push(x1 === x2 ? [y1, y2] : [x1, x2]);
      lines.set(key, spans);
    }
  }
  for (const [key, spans] of lines) {
    spans.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    let [from, to] = spans[0]!;
    for (const [start, end] of spans.slice(1)) {
      if (start <= to) to = Math.max(to, end);
      else {
        out.push(`${key} ${from}..${to}`);
        [from, to] = [start, end];
      }
    }
    out.push(`${key} ${from}..${to}`);
  }
  return out;
}

/** A drawing text with no characters and no polarity mark: it draws nothing. */
function isEmptyNote(item: unknown): boolean {
  const object = item as {
    kind?: string;
    polarity?: string;
    content?: { runs?: { kind?: string }[] };
  };
  return (
    object.kind === "text" &&
    !object.polarity &&
    (object.content?.runs ?? []).every((run) => run.kind === "line-break")
  );
}

/**
 * What a drawing's SVG shows, in any order and however it is grouped: nothing
 * invisible (the hit lines), ids and data attributes gone, straight strokes
 * merged per stroke style, each text character by character.
 */
function drawnItems(svg: string): string[] {
  const body = svg
    .replace(/<title[\s\S]*?<\/title>/u, "")
    .replace(/<style[\s\S]*?<\/style>/u, "");
  const items: string[] = [];
  const strokes = new Map<string, string[]>();
  for (const [raw] of body.matchAll(
    /<(?:path|polyline|polygon|circle|ellipse|rect|line)\b[^>]*>|<text\b[\s\S]*?<\/text>/gu,
  )) {
    const item = raw
      .replace(/\s(?:data-[\w-]+|id|aria-[\w-]+|class)="[^"]*"/gu, "")
      .replace(/\s+/gu, " ");
    if (/fill="none"/u.test(item) && /stroke="none"/u.test(item)) continue;
    if (item.startsWith("<text")) {
      // A text with no characters shows nothing.
      if (!item.replace(/<[^>]*>/gu, "").trim()) continue;
      items.push(`text ${drawnText(item)}`);
      continue;
    }
    const data = /\sd="([^"]*)"/u.exec(item)?.[1];
    const lines = data === undefined ? null : drawnStrokes(data);
    if (lines) {
      const style = item.replace(/\sd="[^"]*"/u, "");
      strokes.set(style, [...(strokes.get(style) ?? []), ...lines]);
    } else
      items.push(item.replace(/-?\d+\.\d+/gu, (number) => round(number, 2)));
  }
  for (const [style, lines] of strokes)
    for (const line of lines) items.push(`stroke ${style} ${line}`);
  return items.sort();
}

/**
 * Where the two projects draw differently, as Analog Canvas renders them: the
 * check behind "draws the same", which the fields compared above cannot see all
 * of (a Cell's symbol, a wire's dash, a subscript's slant).
 */
function renderedDifferences(a: CircuitProject, b: CircuitProject): string[] {
  const out: string[] = [];
  const resolverA = createProjectSymbolResolver(a, builtInSymbols);
  const resolverB = createProjectSymbolResolver(b, builtInSymbols);
  const render = (
    document: SchematicDocument,
    resolver: ReturnType<typeof createProjectSymbolResolver>,
  ) =>
    drawnItems(
      renderDocumentSvg(document, resolver, { background: "transparent" }),
    );
  for (const { a: da, b: db } of documentPairs(a, b)) {
    if (!db) continue;
    let before: string[];
    let after: string[];
    try {
      before = render(da, resolverA);
      after = render(db, resolverB);
    } catch (error) {
      out.push(
        `rendered: ${da.name} cannot render: ${String(error).slice(0, 200)}`,
      );
      continue;
    }
    const lines = multisetDiff(before, after);
    for (const item of lines.missing)
      out.push(`rendered: ${da.name} lost ${item.slice(0, 300)}`);
    for (const item of lines.added)
      out.push(`rendered: ${da.name} added ${item.slice(0, 300)}`);
  }
  return out;
}

describe.skipIf(!CORPUS)("RNL benchmark", () => {
  it("counts an empty note as nothing drawn", () => {
    const note = (runs: unknown[], extra = {}) => ({
      kind: "text",
      content: { runs },
      ...extra,
    });
    const empty = note([{ kind: "line-break" }]);
    if (!isEmptyNote(empty)) throw new Error("a note of a line break is empty");
    if (isEmptyNote(note([{ kind: "text", value: "A" }])))
      throw new Error("a note with words is not empty");
    if (isEmptyNote(note([{ kind: "line-break" }], { polarity: "positive" })))
      throw new Error("a polarity mark draws its mark");
    if (drawnItems('<text x="1" y="2"></text>').length)
      throw new Error("a text with no characters draws nothing");
    if (!drawnItems('<text x="1" y="2">A</text>').length)
      throw new Error("a text with a character draws");
  });

  it("compares drawings as drawn", () => {
    const same = (x: string, y: string) =>
      multisetDiff(drawnItems(x), drawnItems(y)).missing.length === 0 &&
      multisetDiff(drawnItems(x), drawnItems(y)).added.length === 0;
    const path = (d: string, extra = "") =>
      `<path d="${d}" stroke="#000"${extra}/>`;
    const text = (inner: string, size = "15.116") =>
      `<text x="1" y="2" font-size="${size}">${inner}</text>`;
    const results: Record<string, boolean> = {
      "strokes split otherwise": same(
        path("M 0 0 L 10 0"),
        path("M 5 0 L 10 0 M 0 0 L 5 0"),
      ),
      "an id": same('<circle id="a" r="1"/>', '<circle id="b" r="1"/>'),
      "a hit line": same(
        "",
        '<polyline points="0,0 1,1" fill="none" stroke="none"/>',
      ),
      "a size rounded": same(
        text("<tspan>a</tspan>"),
        text("<tspan>a</tspan>", "15.12"),
      ),
      "spans nested otherwise": same(
        text(
          '<tspan style="font-style:italic"><tspan style="font-weight:700">ab</tspan></tspan>',
        ),
        text(
          '<tspan style="font-weight:700"><tspan style="font-style:italic">a</tspan><tspan style="font-style:italic">b</tspan></tspan>',
        ),
      ),
      "a shift on the span around": same(
        text('<tspan dy="5"><tspan style="font-weight:700">a</tspan></tspan>'),
        text('<tspan dy="5" style="font-weight:700">a</tspan>'),
      ),
      "a moved stroke": !same(path("M 0 0 L 10 0"), path("M 0 1 L 10 1")),
      "a dash": !same(
        path("M 0 0 L 10 0"),
        path("M 0 0 L 10 0", ' stroke-dasharray="3 3"'),
      ),
      "a dot's size": !same('<circle r="4.72"/>', '<circle r="3.78"/>'),
      "another shape": !same(
        '<polygon points="0,0 1,0 0,1"/>',
        '<polygon points="0,0 1,0 1,1 0,1"/>',
      ),
      "a slant": !same(
        text('<tspan style="font-style:normal">a</tspan>'),
        text('<tspan style="font-style:italic">a</tspan>'),
      ),
      "a shift": !same(
        text('<tspan dy="5">a</tspan>'),
        text('<tspan dy="0">a</tspan>'),
      ),
      "a character": !same(text("<tspan>a</tspan>"), text("<tspan>b</tspan>")),
    };
    const wrong = Object.entries(results)
      .filter(([, right]) => !right)
      .map(([name]) => name);
    if (wrong.length)
      throw new Error(`Drawn comparison wrong about: ${wrong.join(", ")}`);
  });

  it.each(IDS)(
    "RNL benchmark %s",
    async (id) => {
      mkdirSync(join(OUT, "rnl"), { recursive: true });
      mkdirSync(join(OUT, "reports"), { recursive: true });
      const project = parseProject(
        readFileSync(join(CORPUS, `${id}.icproj.json`), "utf8"),
      );
      const report: Record<string, unknown> = { id };
      for (const format of FORMATS) {
        const started = performance.now();
        const result = await roundTrip(id, project, format);
        result.milliseconds = Math.round(performance.now() - started);
        report[format] = result;
      }
      writeFileSync(
        join(OUT, "reports", `${id}.json`),
        `${JSON.stringify(report, null, 1)}\n`,
      );
    },
    300_000,
  );
});
