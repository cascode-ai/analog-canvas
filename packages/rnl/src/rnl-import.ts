import {
  portableCellIdentifier,
  resolveSchematicStyleProfile,
} from "@icm/derived";
import {
  bindsProjectCell,
  deviceDescriptor,
  reviewedExternalBindingForMaster,
} from "@icm/devices";
import { callOnlyBlock, createDesignNetlistExport } from "@icm/netlist";
import {
  flattenRichText,
  plainNameDocument,
  type CircuitProject,
  type SchematicDocument,
  type StableId,
} from "@icm/model";
import {
  hierarchicalSymbolId,
  type PdkSymbolMappingOverride,
} from "@icm/symbols";

import { callSymbolFromDefinition } from "./call-symbols.js";
import { inverseOrient as inverse, orientPoint } from "./orientation.js";
import { RNL_SYMBOLS, symbolModelType } from "./symbol-map.js";
import { matchesInlineRnlSymbol } from "./inline-symbols.js";
import {
  CANVAS_PACKAGE,
  CANVAS_PACKAGE_VERSION,
  RNL_LANGUAGE_VERSION,
  RNL_STD_VERSION,
  RNL_TOOLS_RELEASE,
} from "./rnl-packages.js";
import {
  type RnlSnapshot,
  type RnlLevelSnapshot,
  type LevelModel,
  hasCanvasTypesetting,
  readableLevel,
  type RnlObjectView,
  isOrient,
} from "./rnl-snapshot.js";
import { family } from "./import-symbols.js";
import { rnlLength } from "./shapes.js";
import { importTexts } from "./import-texts.js";
import {
  removeAddedPins,
  printsFileCircuit,
  unpinUndrawnPorts,
  groundTiedPins,
  type RnlPowerLabelPort,
  withPowerLabelPorts,
} from "./import-pins.js";
import {
  levelScope,
  type ImportRecords,
  type RnlImportDiagnostic,
  type RnlHiddenLabels,
  type RnlParameterText,
  type KeptParameter,
} from "./import-scope.js";
import { placeParts, hideClockLabels } from "./import-parts.js";
import { reclaimGroundPins, readGlyphs, drawnPins } from "./import-glyphs.js";
import { readCanvasRecords } from "./import-records.js";
import { routeWires } from "./import-routes.js";
import { readMarks, LATER } from "./import-marks.js";
import { runtimeFindings } from "./import-findings.js";
import { importDrawings } from "./import-drawings.js";
import { FILE_LEVEL_CELL } from "./rnl-export.js";

export type {
  RnlLevelSnapshot,
  RnlObjectView,
  RnlSnapshot,
} from "./rnl-snapshot.js";
export { withPowerLabelPorts } from "./import-pins.js";

export type {
  RnlHiddenLabels,
  RnlImportDiagnostic,
  RnlParameterText,
} from "./import-scope.js";

export type RnlAppearance = "canvas" | "source";

/** The package versions the mapping table is for, by package. */
const mappedVersion = (name: string) =>
  name.startsWith("rnl-std")
    ? RNL_STD_VERSION
    : name === CANVAS_PACKAGE
      ? CANVAS_PACKAGE_VERSION
      : undefined;

/**
 * Why a rich netlist's drawing is not read, or null: Analog Canvas reads the
 * language 0.4 only (16.1), so the drawing of a file of another version, with
 * records written in it, is left out and its circuit comes in undrawn; `rnl
 * upgrade` raises the file to 0.4, and an older Analog Canvas file's package
 * to the one Analog Canvas writes. A netlist with no records is no drawing of
 * any version.
 */
export function rnlVersionRefusal(
  snapshot: Pick<RnlSnapshot, "language">,
  hasRecords: boolean,
): RnlImportDiagnostic | null {
  if (!hasRecords || snapshot.language === RNL_LANGUAGE_VERSION) return null;
  return {
    severity: "error",
    code: "RNL_IMPORT_VERSION",
    message: `The file's drawing is written in RNL ${snapshot.language}; Analog Canvas reads RNL ${RNL_LANGUAGE_VERSION} only, so the circuit comes in without it. Raise the file with \`rnl upgrade\` (rnl ${RNL_TOOLS_RELEASE} or later), which also moves an older Analog Canvas file (${CANVAS_PACKAGE} 0.1–0.6) to ${CANVAS_PACKAGE} ${CANVAS_PACKAGE_VERSION}, then import it again`,
  };
}

/** The Cell a level draws: a subcircuit by its name, the file level by the flat Cell. */
function documentOf(
  project: CircuitProject,
  level: RnlLevelSnapshot,
): SchematicDocument | undefined {
  const name =
    level.kind === "file" ? FILE_LEVEL_CELL : level.name.toLowerCase();
  return project.documents.find(
    (document) => document.netlist?.name.toLowerCase() === name,
  );
}

/**
 * The Cell the file names as the editor's top (`$CANVAS_TOP`),
 * which the netlist need not show: a Cell that calls it may be printed too.
 */
export function canvasTopDocument(
  project: CircuitProject,
  snapshot: RnlSnapshot,
): StableId | undefined {
  const level = snapshot.levels.find((item) =>
    item.model?.objects.some(
      (object) =>
        object.kind === "usage" &&
        object.definition === "$CANVAS_TOP" &&
        object.attach?.["level"] === "#",
    ),
  );
  return level ? documentOf(project, level)?.id : undefined;
}

/**
 * A Project the SPICE / SCS importer made from a rich netlist, drawn as the
 * netlist's RNL draws it: parts placed, turned and in the variant their RNL
 * symbol stands for; wires with every bend, split where they run through a
 * pin or point; and junction points. The electrical part is the importer's, unchanged.
 * Callers without an appearance retain the legacy projection.
 */
export function applyRnlSnapshot(
  project: CircuitProject,
  snapshot: RnlSnapshot,
  appearance?: RnlAppearance,
): {
  project: CircuitProject;
  diagnostics: RnlImportDiagnostic[];
  hiddenLabels: RnlHiddenLabels[];
  parameterTexts: RnlParameterText[];
  powerLabelPorts: RnlPowerLabelPort[];
} {
  const diagnostics: RnlImportDiagnostic[] = [];
  const hiddenLabels: RnlHiddenLabels[] = [];
  const parameterTexts: RnlParameterText[] = [];
  const cellNames: { documentId: StableId; name: string }[] = [];
  const keptParameters: KeptParameter[] = [];
  const canvasPackage = snapshot.packages.some(
    ({ name }) => name === CANVAS_PACKAGE,
  );
  const canvasDocuments = new Set<string>();
  const powerLabelPorts: RnlPowerLabelPort[] = [];
  if (snapshot.failed) {
    diagnostics.push({
      severity: "error",
      code: "RNL_IMPORT_UNREADABLE",
      message: `RNL could not read the file: ${snapshot.failed}`,
    });
    return {
      project,
      diagnostics,
      hiddenLabels,
      parameterTexts,
      powerLabelPorts,
    };
  }
  const refused = rnlVersionRefusal(
    snapshot,
    snapshot.levels.some((level) => writesRecords(level, [])),
  );
  if (refused) {
    diagnostics.push(refused);
    return {
      project,
      diagnostics,
      hiddenLabels,
      parameterTexts,
      powerLabelPorts,
    };
  }
  diagnostics.push(...runtimeFindings(snapshot.diagnostics));
  for (const { name, version } of snapshot.packages) {
    const wanted = mappedVersion(name);
    if (wanted && version && version !== wanted)
      diagnostics.push({
        severity: "warning",
        code: "RNL_IMPORT_PACKAGE_VERSION",
        message: `${name} ${version} is not a version Analog Canvas maps (${wanted}); its symbols may read back wrong`,
      });
  }
  const next = structuredClone(project);
  const undrawnPins = new Set<string>();
  const records: ImportRecords = {
    diagnostics,
    hiddenLabels,
    parameterTexts,
    undrawnPins,
    powerLabelPorts,
    cellNames,
    keptParameters,
  };
  const tiedToGround = groundTiedPins(project);
  for (const read of snapshot.levels) {
    if (!read.model) continue;
    const level = readableLevel(read);
    if (!level.model) continue;
    const document = documentOf(next, level);
    if (!document) {
      if (level.model.objects.some((object) => object.at.value))
        diagnostics.push({
          severity: "warning",
          code: "RNL_IMPORT_NO_CELL",
          message: `RNL draws ${level.name}, which the netlist import made no Cell for`,
        });
      continue;
    }
    // Canvas writes a marker on each level. An external level can use the
    // package's symbols without having been written by Canvas.
    const canvasWritten =
      canvasPackage &&
      (appearance === undefined || hasCanvasTypesetting(level.model));
    if (canvasWritten) canvasDocuments.add(document.id);
    applyLevel(
      {
        project: next,
        document,
        level,
        model: level.model,
        format: snapshot.dialect === "spectre" ? "spectre" : "spice",
        wiresNamed: canvasWritten,
        tiedToGround,
        canvasLooks: canvasWritten || appearance === "source",
        nativeAppearance: !canvasWritten && appearance === "canvas",
      },
      records,
    );
  }
  for (const { documentId, name } of cellNames)
    if (!renameCell(next, documentId, name))
      diagnostics.push({
        severity: "warning",
        code: "RNL_IMPORT_CELL_NAME_REFUSED",
        message: `A Cell is named ${JSON.stringify(name.slice(0, 40))} in Analog Canvas, which another Cell is or which would print as another subcircuit; it keeps the netlist's name`,
      });
  if (!restoreKeptParameters(next, keptParameters))
    diagnostics.push({
      severity: "warning",
      code: "RNL_IMPORT_PARAMETERS_IGNORED",
      message: `${keptParameters.length} parameters the file keeps for its parts would change the netlist, so none is given back`,
    });
  removeAddedPins(next, undrawnPins, (trial) =>
    printsFileCircuit(withPowerLabelPorts(trial, powerLabelPorts), snapshot),
  );
  // A file Canvas wrote draws every Pin a Cell has.
  if (canvasPackage)
    unpinUndrawnPorts(next, canvasDocuments, undrawnPins, powerLabelPorts);
  trimCallMappings(next);
  return {
    project: next,
    diagnostics,
    hiddenLabels,
    parameterTexts,
    powerLabelPorts,
  };
}

/**
 * Gives back the parameters the file keeps for its parts, all
 * or none: only where the netlist then prints as it does without them, so
 * a stale or forged record (a field the card now prints) changes nothing,
 * or adds only model cards the file itself holds. That is the built-in
 * Zener's: its bv and ibv print in a card of its own (`icm_zener_D1`), which
 * the netlist import reads as a card the part calls and leaves out, so the
 * part given them back is the editor's Zener again and prints that card.
 * False when some were kept and none could be given back.
 */
function restoreKeptParameters(
  project: CircuitProject,
  kept: readonly KeptParameter[],
): boolean {
  if (!kept.length) return true;
  const trial = structuredClone(project);
  for (const { documentId, instanceId, name, text } of kept) {
    const instance = trial.documents
      .find((document) => document.id === documentId)
      ?.instances.find((item) => item.id === instanceId);
    const parameters = instance?.netlist?.parameters;
    if (!parameters) continue;
    parameters[name] = text;
    if (/^i?bv$/iu.test(name) && callsBuiltInZenerCard(instance))
      delete instance.netlist!.binding;
  }
  const printed = (from: CircuitProject) => {
    const result = createDesignNetlistExport(from, { format: "spice" });
    return result.status === "ready" ? result.file.text : null;
  };
  const now = printed(project);
  const restored = printed(trial);
  if (
    now === null ||
    restored === null ||
    (restored !== now && !addsOnlyFileCards(now, restored, project))
  )
    return false;
  project.documents = trial.documents;
  return true;
}

/** A Zener drawn as the editor's that calls the card the editor writes for it. */
function callsBuiltInZenerCard(
  instance: SchematicDocument["instances"][number],
): boolean {
  const binding = instance.netlist?.binding;
  return (
    instance.symbolId === "zener-diode" &&
    binding?.kind === "model" &&
    binding.name.toLowerCase() ===
      `icm_zener_${instance.reference ?? ""}`.toLowerCase()
  );
}

/**
 * Whether a netlist prints every line of another and adds only `.model`
 * cards one of the Project's source files holds, read as SPICE reads them:
 * case and the punctuation of `D(BV=6.2)` aside.
 */
function addsOnlyFileCards(
  before: string,
  after: string,
  project: CircuitProject,
): boolean {
  const card = (line: string) =>
    line
      .toLowerCase()
      .replace(/[()=,]/gu, " ")
      .trim()
      .split(/\s+/u)
      .join(" ");
  const held = new Set(
    project.source.files.flatMap((file) =>
      (file.content?.text ?? "").split(/\r?\n/u).map(card),
    ),
  );
  const added = after.split("\n");
  for (const line of before.split("\n")) {
    const index = added.indexOf(line);
    if (index < 0) return false;
    added.splice(index, 1);
  }
  return added.every(
    (line) => /^\.model\s/iu.test(line) && held.has(card(line)),
  );
}

/**
 * A Cell named as the editor renames one: its title too where that was its
 * name, each call of it drawn with the block of its new name (a Library gate
 * keeps its own symbol), and a call's master label that showed the old name.
 */
function renameCell(
  project: CircuitProject,
  documentId: StableId,
  name: string,
): boolean {
  const document = project.documents.find((item) => item.id === documentId);
  if (!document?.netlist || document.netlist.name === name) return true;
  const previous = document.netlist.name;
  // A name another Cell has, or one that would print as another subcircuit,
  // would change the netlist; the Cell keeps the netlist's name.
  const folded = name.trim().toLowerCase();
  if (
    portableCellIdentifier(name, documentId) !==
      portableCellIdentifier(previous, documentId) ||
    project.documents.some(
      (other) =>
        other.id !== documentId &&
        [other.name, other.netlist?.name].some(
          (taken) => taken?.trim().toLowerCase() === folded,
        ),
    )
  )
    return false;
  if (document.name === previous) document.name = name;
  document.netlist.name = name;
  for (const parent of project.documents)
    for (const instance of parent.instances) {
      const binding = instance.netlist?.binding;
      if (
        binding?.kind !== "subcircuit" ||
        binding.childDocumentId !== documentId
      )
        continue;
      if (!bindsProjectCell(instance.symbolId))
        instance.symbolId = hierarchicalSymbolId(name);
      const master = parent.annotations.find(
        (annotation) =>
          annotation.id === `instance-master-${instance.id}` &&
          annotation.kind === "instance-value" &&
          annotation.content &&
          flattenRichText(annotation.content) === previous,
      );
      if (master) master.content = plainNameDocument(name);
    }
  return true;
}

/** The device types a model card can give, as the netlist import reads them. */
const MODEL_TYPES = new Set(["nmos", "pmos", "npn", "pnp", "njf", "pjf", "d"]);

/**
 * The device type of each model the file's parts call, as the file declares
 * it (`@DEVICE(model=…, type=…)`, 6.12) or its card gives it, for a netlist
 * that calls a model no model card declares: a part drawn with its own
 * artwork or not drawn at all is still that kind of device. A model whose
 * parts are of different types has none.
 */
export function declaredModelTypes(snapshot: RnlSnapshot): Map<string, string> {
  const seen = new Map<string, Set<string>>();
  for (const level of snapshot.levels)
    for (const instance of level.host?.instances ?? []) {
      const type = instance.type?.toLowerCase();
      if (!instance.master || !type || !MODEL_TYPES.has(type)) continue;
      const key = instance.master.toLowerCase();
      seen.set(key, new Set([...(seen.get(key) ?? []), type]));
    }
  return new Map(
    [...seen].flatMap(([master, types]) =>
      types.size === 1 ? [[master, [...types][0]!] as const] : [],
    ),
  );
}

/**
 * The device type of each model the drawing's parts call, as the symbols it
 * draws them with say it (`$NMOS` an nmos, `$NPN` an npn, `$DIODE` a diode),
 * for a netlist that calls a model no model card declares. A model whose
 * parts are drawn as different types has none.
 */
export function drawnModelTypes(snapshot: RnlSnapshot): Map<string, string> {
  const seen = new Map<string, Set<string>>();
  for (const level of snapshot.levels) {
    if (!level.model || !level.host) continue;
    const symbols = new Map(
      level.model.symbols.map((symbol) => [symbol.id, symbol]),
    );
    const masters = new Map(
      level.host.instances.map((instance) => [instance.id, instance.master]),
    );
    for (const object of level.model.objects) {
      if (object.kind !== "instance") continue;
      const master = masters.get(object.host[0] ?? object.id);
      const symbol = object.symbol.value
        ? symbols.get(object.symbol.value)
        : undefined;
      if (!master || !symbol || symbol.default) continue;
      const types = new Set(
        RNL_SYMBOLS.filter(
          (row) =>
            row.ac !== null &&
            !row.inline &&
            row.symbol === symbol.name &&
            family(row.package) === family(symbol.package),
        ).flatMap((row) => {
          const type = symbolModelType(row.ac!);
          return type ? [type] : [];
        }),
      );
      if (types.size !== 1) continue;
      const key = master.toLowerCase();
      seen.set(key, new Set([...(seen.get(key) ?? []), ...types]));
    }
  }
  return new Map(
    [...seen].flatMap(([master, types]) =>
      types.size === 1 ? [[master, [...types][0]!] as const] : [],
    ),
  );
}

/**
 * An external call keeps its actual master and ordered terminals. Use a
 * standard device symbol only when the runtime's resolved pin positions
 * identify every terminal on that symbol, consistently across its calls.
 */
export function drawnExternalSymbolMappings(
  snapshot: RnlSnapshot,
): PdkSymbolMappingOverride[] {
  const found = new Map<string, PdkSymbolMappingOverride | null>();
  for (const { model, host } of snapshot.levels) {
    if (!model || !host) continue;
    const symbols = new Map(model.symbols.map((symbol) => [symbol.id, symbol]));
    const instances = new Map(
      host.instances.map((instance) => [instance.id, instance]),
    );
    for (const object of model.objects) {
      if (object.kind !== "instance") continue;
      const instance = instances.get(object.host[0] ?? object.id);
      const symbol = symbols.get(object.symbol.value ?? "");
      const at = object.at.value;
      const orient = object.orient.value;
      if (
        !instance?.master ||
        !instance.subckt ||
        reviewedExternalBindingForMaster(instance.master) ||
        !symbol ||
        symbol.default ||
        !at ||
        !isOrient(orient)
      )
        continue;
      const terminals = instance.terminals.toSorted((a, b) => a.n - b.n);
      if (!terminals.every(({ n }, index) => n === index + 1)) continue;
      const count = terminals.length;
      const key = `${instance.master.toLowerCase()}:${count}`;
      const mappings = RNL_SYMBOLS.flatMap((row) => {
        if (
          !row.ac ||
          row.inline ||
          row.definition ||
          row.symbol !== symbol.name ||
          row.package !== symbol.package ||
          row.pins.length !== count ||
          row.undrawnPins.length ||
          !deviceDescriptor(row.ac)
        )
          return [];
        const pinNames = terminals.map(({ n }) => {
          const pin = object.pins.find((item) =>
            item.terminals.includes(`${instance.id}:${n}`),
          );
          if (!pin?.at) return undefined;
          const [x, y] = orientPoint(inverse(orient), [
            pin.at[0] - at[0],
            pin.at[1] - at[1],
          ]);
          return row.pins.find(
            (item) =>
              Math.abs(item.at[0] - x) < 1e-6 &&
              Math.abs(item.at[1] - y) < 1e-6,
          )?.acPin;
        });
        return pinNames.every((pin): pin is string => pin !== undefined) &&
          new Set(pinNames).size === count
          ? [
              {
                modelName: instance.master!,
                terminalCount: count,
                symbolId: row.ac,
                pinNames,
                registryId: "rnl-standard-symbol",
              },
            ]
          : [];
      });
      const mapping = mappings.length === 1 ? mappings[0]! : null;
      const prior = found.get(key);
      found.set(
        key,
        mapping &&
          (prior === undefined ||
            (prior?.symbolId === mapping.symbolId &&
              prior.pinNames.every((pin, i) => pin === mapping.pinNames[i])))
          ? mapping
          : null,
      );
    }
  }
  return [...found.values()].filter((item) => item !== null);
}

/**
 * The library blocks the drawing's parts call where Analog Canvas writes
 * their calls without a body for `format` (`callOnlyBlock`), as the symbols
 * it draws them with say it: `$DAC` a DAC, a call symbol of the file a
 * flip-flop's artwork, the file's own stencil a differential ADC. A master
 * whose parts are drawn as anything else is none.
 */
export function drawnCalledBlocks(
  snapshot: RnlSnapshot,
  format: "spice" | "spectre",
): NonNullable<ReturnType<typeof callOnlyBlock>>[] {
  const found = new Map<string, ReturnType<typeof callOnlyBlock>>();
  for (const level of snapshot.levels) {
    if (!level.model || !level.host) continue;
    const symbols = new Map(
      level.model.symbols.map((symbol) => [symbol.id, symbol]),
    );
    const masters = new Map(
      level.host.instances.map((instance) => [instance.id, instance.master]),
    );
    for (const object of level.model.objects) {
      if (object.kind !== "instance") continue;
      const master = masters.get(object.host[0] ?? object.id);
      const symbol = object.symbol.value
        ? symbols.get(object.symbol.value)
        : undefined;
      if (!master || !symbol || symbol.default) continue;
      const drawn = [
        ...RNL_SYMBOLS.filter(
          (row) =>
            row.ac !== null &&
            row.symbol === symbol.name &&
            (row.inline
              ? symbol.package === null &&
                symbol.level !== null &&
                matchesInlineRnlSymbol(row, symbol.definition)
              : family(row.package) === family(symbol.package)),
        ),
        ...[callSymbolFromDefinition(symbol) ?? []].flat(),
      ];
      const blocks = drawn.flatMap((row) => {
        const block = row.ac ? callOnlyBlock(master, row.ac, format) : null;
        return block ? [block] : [];
      });
      const key = master.toLowerCase();
      const before = found.get(key);
      found.set(
        key,
        blocks.length === 1 &&
          (before === undefined || before?.symbolId === blocks[0]!.symbolId)
          ? blocks[0]!
          : null,
      );
    }
  }
  return [...found.values()].flatMap((block) => (block ? [block] : []));
}

/**
 * The subcircuits the files define but write no RNL of, where they write a
 * circuit: a library's bodies, such as a process's devices or the models a
 * Project's parts are bound to, which the circuit calls as written and the
 * export prints after it (#1791). A level is written where it places or
 * wires anything, shows a text of its own, or states a record of its own (a
 * named object, or one at a place in `files`), as Analog Canvas states each
 * Cell's Pins even where it places none of its parts; what a package fills
 * in is no record. Files that write nothing have none.
 */
export function undrawnBodies(
  snapshot: RnlSnapshot,
  files: readonly string[],
): string[] {
  const written = (level: RnlLevelSnapshot) => writesRecords(level, files);
  if (!snapshot.levels.some(written)) return [];
  return snapshot.levels
    .filter((level) => level.kind === "subckt" && !written(level))
    .map(({ name }) => name);
}

/**
 * Whether a level states records of its own: it places or wires anything,
 * shows a text of its own, or names an object (or makes one at a place in
 * `files`). What a package fills in is no record.
 */
function writesRecords(
  { model }: RnlLevelSnapshot,
  files: readonly string[],
): boolean {
  return (
    !!model &&
    (model.objects.some(
      (object) =>
        object.at.value !== null ||
        (object.kind !== "instance" &&
          (object.id.startsWith("%") ||
            files.some((path) => object.id.startsWith(`@${path}:`)))),
    ) ||
      model.points.some((point) => point.at.value !== null) ||
      model.wires.length > 0 ||
      model.texts.some((text) => text.written) ||
      (model.shapes?.length ?? 0) > 0)
  );
}

/** What a level is read with besides its Cell. */
interface LevelInput {
  project: CircuitProject;
  document: SchematicDocument;
  level: RnlLevelSnapshot;
  model: LevelModel;
  /** The dialect the file is written in, which spells its names. */
  format: "spice" | "spectre";
  /** The file says which wire each net label is on. */
  wiresNamed: boolean;
  /** Each Cell's pins its calls all tie to ground (`groundTiedPins`). */
  tiedToGround: ReadonlySet<string>;
  /** Preserve authored label styling. */
  canvasLooks: boolean;
  nativeAppearance: boolean;
}

/**
 * Draws one level's Cell as its RNL draws it. The phases run in this order,
 * each on the level's Document-scoped lookups (`LevelScope`) and what the
 * phases before it return, each changing the Cell's Document: the parts,
 * the Cell's ground pins, the Canvas records and glyphs (read in the order
 * the file writes them), the wires, the marks on them, the texts, the Pins
 * the drawing leaves, the clock labels and the drawings. What reaches beyond
 * the Cell goes into `records`.
 */
function applyLevel(input: LevelInput, records: ImportRecords): void {
  const { project, document, level, model, format } = input;
  const scope = levelScope(
    project,
    document,
    level,
    model,
    format,
    records.diagnostics,
  );
  const parts = placeParts(scope);
  records.hiddenLabels.push(...parts.hiddenLabels);
  const groundPins = reclaimGroundPins(scope, input.tiedToGround);
  const canvas = readCanvasRecords(scope);
  const glyphs = readGlyphs(scope, groundPins);
  /** Marks read once the wires are routes, and figures, by usage. */
  const later: RnlObjectView[] = [];
  for (const object of model.objects) {
    if (object.kind !== "usage" || !object.definition) continue;
    if (canvas.read(object)) continue;
    if (LATER.has(object.definition)) later.push(object);
    else glyphs.read(object);
  }
  document.noConnects.push(...canvas.noConnects());
  records.cellNames.push(...canvas.cellNames);
  records.keptParameters.push(...canvas.keptParameters);
  records.parameterTexts.push(...canvas.parameterTexts);

  const routes = routeWires(scope, glyphs, input.nativeAppearance);
  const consumed = readMarks(scope, routes, later, glyphs.marks);
  const { glyphOf, openGlyphs } = glyphs;
  const { openEnds, legNear } = routes;
  const { instanceOf, netOf } = scope;
  const { wiresNamed, canvasLooks } = input;
  importTexts(document, level, model, {
    consumed,
    glyphOf,
    ports: new Map(
      [...openGlyphs].flatMap(([id, { netId, label }]) =>
        label ? [[id, { netId, object: label, ...openEnds.get(id) }]] : [],
      ),
    ),
    instanceOf,
    netOf,
    legNear,
    format,
    wiresNamed,
    canvasLooks,
    called: project.documents.some((item) =>
      item.instances.some(
        (instance) =>
          instance.netlist?.binding?.kind === "subcircuit" &&
          instance.netlist.binding.childDocumentId === document.id,
      ),
    ),
  });
  const pins = drawnPins(scope, glyphs, input.nativeAppearance);
  for (const key of pins.undrawnPins) records.undrawnPins.add(key);
  records.powerLabelPorts.push(...pins.powerLabelPorts);
  records.hiddenLabels.push(...pins.hiddenLabels);
  hideClockLabels(scope, parts);
  importDrawings(scope);
  // The Document takes the grid its places need, as RNL puts them.
  if (scope.grid < document.presentation.grid)
    document.presentation.grid = scope.grid;
  // The Document's line widths, where its wires (or its parts) are all drawn
  // as wide as one another and not as Analog Canvas's own (RNL's linewidth).
  const base = resolveSchematicStyleProfile(
    document.presentation.styleProfileId,
  ).strokes;
  const wireScale = widthScale(
    model.wires
      .filter((wire) => wire.style["linestyle"] !== "bold")
      .map((wire) => wire.style["linewidth"]),
    rnlLength(base.wire),
  );
  const symbolScale = widthScale(
    model.objects
      .filter((object) => object.kind === "instance")
      .map((object) => object.style?.["linewidth"]),
    rnlLength(base.symbol),
  );
  if (wireScale !== undefined || symbolScale !== undefined)
    document.presentation.styleOverrides = {
      ...document.presentation.styleOverrides,
      ...(wireScale !== undefined ? { wireStrokeScale: wireScale } : {}),
      ...(symbolScale !== undefined ? { symbolStrokeScale: symbolScale } : {}),
    };
  if (scope.snapped)
    scope.warn(
      "RNL_IMPORT_SNAPPED",
      `${scope.snapped} places and corners RNL puts between whole units are moved to the nearest`,
    );
}

/**
 * Each call's printed terminals reduced to the pins its Cell still has,
 * once every level is read: until then a call keeps the node it passed to a
 * ground pin since undone, so a caller read after its Cell still matches
 * its card's terminals to the symbol drawn for it, such as a gate's
 * (`gateCallSymbol`). A gate's call names its pins as the gate does, which
 * meet the Cell's Pins without case (#1450).
 */
function trimCallMappings(project: CircuitProject): void {
  const pinsOf = new Map(
    project.documents.map((document) => [
      document.id,
      new Set(
        (document.netlist?.terminals ?? []).map((terminal) =>
          terminal.name.toLowerCase(),
        ),
      ),
    ]),
  );
  for (const document of project.documents)
    for (const instance of document.instances) {
      const binding = instance.netlist?.binding;
      const provenance = instance.importProvenance;
      const pins =
        binding?.kind === "subcircuit"
          ? pinsOf.get(binding.childDocumentId)
          : undefined;
      if (pins && provenance?.terminalMapping)
        provenance.terminalMapping = provenance.terminalMapping.filter((item) =>
          pins.has(item.pinName.toLowerCase()),
        );
    }
}

/**
 * How much wider than `own` every one of `widths` is, where they are all one
 * width and not `own`; undefined where any is unset or they differ.
 */
function widthScale(
  widths: readonly unknown[],
  own: number,
): number | undefined {
  const first = widths[0];
  if (
    typeof first !== "number" ||
    !(own > 0) ||
    widths.some((width) => width !== first)
  )
    return undefined;
  const scale = Math.round((first / own) * 1000) / 1000;
  return scale === 1 ? undefined : scale;
}
