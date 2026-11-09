import type { CircuitProject } from "@icm/model";
import {
  createDesignNetlistExport,
  projectElectricalGraph,
  sameElectricalCircuit,
} from "@icm/netlist";
import { serializeProject } from "@icm/project-protocol";
import {
  applyRnlSnapshot,
  type RnlAppearance,
  canvasTopDocument,
  drawnCalledBlocks,
  drawnExternalSymbolMappings,
  drawnModelTypes,
  undrawnBodies,
  withPowerLabelPorts,
  rnlBodyPortOrder,
  type RnlHiddenLabels,
  type RnlParameterText,
  type RnlImportDiagnostic,
  type RnlSnapshot,
} from "@icm/rnl";
import {
  importSpiceSources,
  type SpiceCompileOptions,
  type SpiceDiagnostic,
  type SpiceSourceInput,
} from "@icm/spice";

import { withImportedInstanceDisplays } from "../instance-display/imported-instance-displays";

import {
  givenModelTypesUsed,
  isSpectreSource,
  prepareImportSources,
} from "./convert-import-sources";
import type { RnlRuntime } from "./rnl-runtime";

export type RnlImportPlan =
  | {
      status: "ready";
      project: CircuitProject;
      /** The netlist import's findings, then what the drawing could not say. */
      diagnostics: SpiceDiagnostic[];
      drawing: "preserved" | "partial" | "discarded";
      /** Of the device types the caller gave, those that typed a part. */
      modelTypesUsed: [string, string][];
    }
  | { status: "failed"; message: string; diagnostics: SpiceDiagnostic[] };

/** An RNL finding as the import report lists findings. */
const reported = (item: RnlImportDiagnostic): SpiceDiagnostic => ({
  code: item.code,
  severity: item.severity,
  stage: "import",
  message: item.message,
});

/**
 * The labels the editor gives each imported part by default, hidden where
 * the drawing places the part without them: what RNL draws is what shows,
 * and a hidden label keeps its usual place for when it is shown. A Cell Pin
 * the drawing names by a net label beside it keeps its own name label
 * hidden, so the name shows once.
 */
function hideLabels(
  project: CircuitProject,
  hidden: readonly RnlHiddenLabels[],
): CircuitProject {
  if (!hidden.length) return project;
  const next = structuredClone(project);
  for (const { documentId, instanceId, name, values } of hidden) {
    const document = next.documents.find((item) => item.id === documentId);
    for (const annotation of document?.annotations ?? []) {
      const binding = annotation.binding;
      if (
        (name &&
          binding?.kind === "instance-reference" &&
          binding.instanceId === instanceId) ||
        // A Cell Pin's name, when the drawing gives it no label of its own.
        (name &&
          binding?.kind === "cell-terminal-name" &&
          document?.netlist?.terminals.some(
            (terminal) =>
              terminal.id === binding.terminalId &&
              terminal.interfaceInstanceIds.includes(instanceId),
          )) ||
        (values &&
          binding?.kind === "instance-value" &&
          binding.instanceId === instanceId)
      )
        annotation.visible = false;
    }
  }
  return next;
}

/** Why a drawing is left out, as the import report says it. */
type OmittedDrawing = { code: string; message: string };

/**
 * The runtime's drawing applied to the imported circuit, or why it could not
 * be: the circuit then comes in undrawn (#1792).
 */
function drawingOf(
  imported: CircuitProject,
  snapshot: RnlSnapshot,
  appearance: RnlAppearance,
): ReturnType<typeof applyRnlSnapshot> | OmittedDrawing {
  try {
    return applyRnlSnapshot(imported, snapshot, appearance);
  } catch (error) {
    return {
      code: "RNL_IMPORT_INVALID_DRAWING",
      message: `The RNL drawing could not be read, so the circuit comes in undrawn: ${reason(error)}`,
    };
  }
}

/**
 * The drawn Project, or why it is left out: it would change the netlist, or
 * it is not a Project the editor can save (RNL never connects by position, so
 * a wire can join what the netlist keeps apart). The circuit the file's
 * netlist imports as is the reference, and so, where the two differ, is the
 * file's netlist itself (`writesFileNetlist`); nothing else counts as the
 * same netlist.
 *
 */
export async function drawnProject(
  imported: CircuitProject,
  drawn: ReturnType<typeof applyRnlSnapshot>,
  writesFileNetlist: (project: CircuitProject) => Promise<boolean>,
): Promise<{ project: CircuitProject } | OmittedDrawing> {
  try {
    const before = projectElectricalGraph(imported);
    if (
      !sameCircuits(imported, drawn.project) &&
      !(await writesFileNetlist(drawn.project))
    )
      return {
        code: "RNL_IMPORT_CHANGES_NETLIST",
        // A circuit the comparison cannot check comes in undrawn too (#1932).
        message:
          before.status === "ready"
            ? "The RNL drawing would change the netlist, so the circuit comes in undrawn"
            : `The RNL drawing may change a netlist that cannot be compared (${before.reason}), so the circuit comes in undrawn`,
      };
    // A port the drawing shows only as its power label is that label again
    // (#1783): the circuit is the same, only who owns the port changes.
    const project = withPowerLabelPorts(
      hideLabels(
        withImportedInstanceDisplays(drawn.project),
        drawn.hiddenLabels,
      ),
      drawn.powerLabelPorts,
    );
    serializeProject(project);
    return { project };
  } catch (error) {
    return {
      code: "RNL_IMPORT_INVALID_DRAWING",
      message: `The RNL drawing does not make a Project the editor can save, so the circuit comes in undrawn: ${reason(error)}`,
    };
  }
}

/**
 * Whether the drawn circuit writes the file's own netlist: its netlist,
 * written as the RNL export writes it and read back as the file was, is the
 * same circuit as the file's (`sameElectricalCircuit`), and nothing less,
 * the top's and each uncalled Cell's (`sameCircuits`).
 * The file's netlist read alone does not always write what it read: a
 * ground pin the export named VSS reads as a port, and writes a GND pin
 * beside it, where the drawing, which shows that pin as ground, writes the
 * file's netlist again.
 *
 */
export async function writesFileNetlist(
  project: CircuitProject,
  fileImported: CircuitProject,
  inputs: SpiceSourceInput[],
  entryPath: string,
  libraryBodies: readonly string[] = [],
  compileOptions: SpiceCompileOptions = {},
  symbolMappings: NonNullable<
    Parameters<typeof importSpiceSources>[3]
  >["externalSymbolMappings"] = [],
  externalSubcircuitNames: readonly string[] = [],
): Promise<boolean> {
  const entry = inputs.find((input) => input.path === entryPath)!;
  const written = createDesignNetlistExport(project, {
    format: isSpectreSource(entry) ? "spectre" : "spice",
    bodyPortOrder: rnlBodyPortOrder(project),
    uncalledCells: true,
  });
  if (written.status !== "ready") return false;
  const rewritten = inputs.map((input) =>
    input === entry
      ? { ...input, bytes: new TextEncoder().encode(written.file.text) }
      : input,
  );
  const prepared = prepareImportSources(rewritten, externalSubcircuitNames);
  const again = await importSpiceSources(
    prepared.inputs,
    entryPath,
    compileOptions,
    {
      namingProfile: "native",
      originalSources: rewritten,
      builtInBodies: prepared.builtInBodies,
      modelTypes: prepared.modelTypes,
      libraryBodies,
      externalSymbolMappings: symbolMappings,
    },
  );
  if (!again.project || !again.successful) return false;
  return sameCircuits(fileImported, again.project, true);
}

/**
 * Each circuit a Project holds, as its root Cell's id: the top's, then each
 * Cell no Cell calls, which the import keeps as well (#1954).
 */
function circuitRoots(project: CircuitProject): string[] {
  const called = new Set(
    project.documents.flatMap((document) =>
      document.instances.flatMap((instance) =>
        instance.netlist?.binding?.kind === "subcircuit"
          ? [instance.netlist.binding.childDocumentId]
          : [],
      ),
    ),
  );
  return [
    project.topDocumentId,
    ...project.documents.flatMap((document) =>
      document.netlist &&
      document.id !== project.topDocumentId &&
      !called.has(document.id)
        ? [document.id]
        : [],
    ),
  ];
}

/**
 * Whether a Project keeps the reference's circuits: rooted at each of the
 * reference's roots, the same circuit as the reference's
 * (`sameElectricalCircuit`). The two Cells of a root are the same Document,
 * or, across an import (`byName`), the two tops or the Cells of one name.
 */
function sameCircuits(
  reference: CircuitProject,
  project: CircuitProject,
  byName = false,
): boolean {
  return circuitRoots(reference).every((root) => {
    const name = reference.documents.find((item) => item.id === root)?.netlist
      ?.name;
    const twin = !byName
      ? root
      : root === reference.topDocumentId
        ? project.topDocumentId
        : project.documents.find((item) => item.netlist?.name === name)?.id;
    if (!twin) return false;
    return sameElectricalCircuit(
      projectElectricalGraph({ ...reference, topDocumentId: root }),
      projectElectricalGraph({ ...project, topDocumentId: twin }),
    );
  });
}

/** An error as one line: a schema error's issue messages, not its JSON. */
const reason = (error: unknown) => {
  const issues = (error as { issues?: unknown } | null)?.issues;
  return (
    Array.isArray(issues) && issues.length
      ? issues
          .map((issue) => String((issue as { message?: unknown }).message))
          .join("; ")
      : error instanceof Error
        ? error.message
        : String(error)
  ).slice(0, 400);
};

/** An import that cannot complete, with its finding. */
const failedPlan = (message: string, finding = message): RnlImportPlan => ({
  status: "failed",
  message,
  diagnostics: [
    reported({
      severity: "error",
      code: "RNL_IMPORT_FAILED",
      message: finding,
    }),
  ],
});

/**
 * A rich netlist as a Project (Analog Canvas `docs/specs/rnl-interchange.md`,
 * Import): the SPICE / SCS import builds the circuit, unchanged, and the rnl
 * runtime's reading of the same files draws it, with the labels the editor
 * gives imported parts where the drawing shows them. A drawing that would
 * change the netlist, or that the editor could not save, is left out, and the
 * circuit comes in as the plain import would bring it. Nothing escapes as an
 * exception: a failure comes back as a failed plan with its finding.
 */
export async function planRnlImport(request: {
  inputs: SpiceSourceInput[];
  entryPath: string;
  runtime: RnlRuntime | null;
  compileOptions?: SpiceCompileOptions;
  appearance?: RnlAppearance | undefined;
  /** Device types of models no card, converted card or drawing types. */
  modelTypes?: Readonly<Record<string, string>>;
  /** How a part whose model has no type is told to recover. */
  undeclaredModels?: "add-card" | "give-type";
}): Promise<RnlImportPlan> {
  try {
    return await buildImportPlan(request);
  } catch (error) {
    return failedPlan(
      `RNL import could not be completed: ${reason(error)}`,
      reason(error),
    );
  }
}

async function buildImportPlan({
  inputs,
  entryPath,
  runtime,
  compileOptions = {},
  appearance = "canvas",
  modelTypes = {},
  undeclaredModels,
}: Parameters<typeof planRnlImport>[0]): Promise<RnlImportPlan> {
  if (!runtime)
    return failedPlan(
      "RNL import needs the rnl runtime, which this build lacks",
    );
  const entry = inputs.find((input) => input.path === entryPath);
  if (!entry) return failedPlan(`RNL import has no file ${entryPath}`);
  const dialect = isSpectreSource(entry) ? "spectre" : "spice";
  const snapshot = await runtime.snapshot({
    entry: entryPath,
    files: Object.fromEntries(
      inputs.map((input) => [
        input.path,
        new TextDecoder().decode(input.bytes),
      ]),
    ),
    dialect,
    parts: { drawing: false, host: true, model: true },
  });
  // The host graph reads the native circuit, independent of which symbols
  // are drawn. Its subcircuit calls retain their exact masters and order.
  const externalSubcircuitNames = [
    ...new Set(
      snapshot.levels.flatMap(
        ({ host }) =>
          host?.instances.flatMap(({ master, subckt }) =>
            subckt && master ? [master] : [],
          ) ?? [],
      ),
    ),
  ];
  const symbolMappings = drawnExternalSymbolMappings(snapshot);
  const prepared = prepareImportSources(inputs, externalSubcircuitNames);
  const libraryBodies = undrawnBodies(
    snapshot,
    inputs.map((input) => input.path),
  );
  const drawnTypes = drawnModelTypes(snapshot);
  const imported = await importSpiceSources(
    prepared.inputs,
    entryPath,
    compileOptions,
    {
      namingProfile: "native",
      originalSources: inputs,
      builtInBodies: prepared.builtInBodies,
      // A model no card declares is the type its parts are drawn as, unless
      // a native card the converter keeps out gives its type; what the
      // caller gives comes last.
      modelTypes: new Map([
        ...Object.entries(modelTypes),
        ...drawnTypes,
        ...prepared.modelTypes,
      ]),
      ...(undeclaredModels ? { undeclaredModels } : {}),
      externalSymbolMappings: symbolMappings,
      // A library block the file calls without its body is the block its
      // parts are drawn as.
      calledBlocks: drawnCalledBlocks(snapshot, dialect),
      // A library body the drawing's parts call stays the text it is.
      libraryBodies,
    },
  );
  if (!imported.project || !imported.successful)
    return {
      status: "failed",
      message:
        imported.diagnostics.find((item) => item.severity === "error")
          ?.message ?? "SPICE import failed",
      diagnostics: imported.diagnostics,
    };
  const modelTypesUsed = givenModelTypesUsed(modelTypes, imported.project, [
    ...(imported.ir?.models.map((model) => model.name) ?? []),
    ...drawnTypes.keys(),
    ...prepared.modelTypes.keys(),
  ]);
  // The editor's top where the file names it (Canvas 0.4): a Cell printed
  // beside it may call it, and so be the netlist's top in its place.
  const top = canvasTopDocument(imported.project, snapshot);
  if (top) imported.project.topDocumentId = top;
  let drawn = snapshot.failed
    ? {
        code: "RNL_IMPORT_UNREADABLE",
        message: `RNL could not read the file: ${snapshot.failed}`,
      }
    : drawingOf(imported.project, snapshot, appearance);
  const fileImported = imported.project;
  const verifyDrawing = async (drawing: typeof drawn) =>
    "code" in drawing
      ? drawing
      : drawnProject(fileImported, drawing, (project) =>
          writesFileNetlist(
            project,
            fileImported,
            inputs,
            entryPath,
            libraryBodies,
            compileOptions,
            symbolMappings,
            externalSubcircuitNames,
          ),
        );
  let kept = await verifyDrawing(drawn);
  let appearanceFinding: SpiceDiagnostic | undefined;
  if ("code" in kept && appearance === "canvas" && !snapshot.failed) {
    const source = drawingOf(fileImported, snapshot, "source");
    const verifiedSource = await verifyDrawing(source);
    if ("project" in verifiedSource) {
      appearanceFinding = reported({
        severity: "warning",
        code: "RNL_IMPORT_SOURCE_APPEARANCE",
        message:
          "Canvas appearance could not be verified. The source drawing was kept.",
      });
      drawn = source;
      kept = verifiedSource;
    }
  }
  const read = "code" in drawn ? null : drawn;
  const parameterTexts = read?.parameterTexts ?? [];
  const diagnostics = [
    ...prepared.diagnostics,
    ...imported.diagnostics,
    ...(read?.diagnostics ?? []).map(reported),
    ...(appearanceFinding ? [appearanceFinding] : []),
    ...("project" in kept
      ? []
      : [
          reported({
            severity: "error",
            code: kept.code,
            message: kept.message,
          }),
        ]),
  ];
  // The author's parameter texts belong to the parts, drawn or not.
  if ("project" in kept)
    return {
      status: "ready",
      project: withParameterTexts(kept.project, parameterTexts),
      diagnostics,
      drawing:
        appearanceFinding || read?.diagnostics.length ? "partial" : "preserved",
      modelTypesUsed,
    };
  const undrawn = withParameterTexts(
    withImportedInstanceDisplays(imported.project),
    parameterTexts,
  );
  serializeProject(undrawn);
  return {
    status: "ready",
    project: undrawn,
    diagnostics,
    drawing: "discarded",
    modelTypesUsed,
  };
}

/**
 * The author's text of each parameter the netlist writes otherwise (100fF
 * where Spectre reads 100f): the same number, so the circuit is the same,
 * whether the drawing comes in or not.
 */
function withParameterTexts(
  project: CircuitProject,
  texts: readonly RnlParameterText[],
): CircuitProject {
  if (!texts.length) return project;
  const next = structuredClone(project);
  for (const { documentId, instanceId, parameter, text } of texts) {
    const parameters = next.documents
      .find((document) => document.id === documentId)
      ?.instances.find((instance) => instance.id === instanceId)
      ?.netlist?.parameters;
    if (parameters && parameters[parameter] !== undefined)
      parameters[parameter] = text;
  }
  return next;
}
