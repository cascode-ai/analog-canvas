import type { CircuitProject } from "@icm/model";
import { compareElectricalGraphs, projectElectricalGraph } from "@icm/netlist";
import { serializeProject } from "@icm/project-protocol";
import {
  applyRnlSnapshot,
  type RnlHiddenLabels,
  type RnlParameterText,
  type RnlImportDiagnostic,
} from "@icm/rnl";
import {
  importSpiceSources,
  type SpiceDiagnostic,
  type SpiceSourceInput,
} from "@icm/spice";

import { withImportedInstanceDisplays } from "../instance-display/imported-instance-displays";

import {
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
 * The drawn Project, or why it is left out: it would change the netlist, or
 * it is not a Project the editor can save (RNL never connects by position, so
 * a wire can join what the netlist keeps apart).
 */
function drawnProject(
  imported: CircuitProject,
  drawn: ReturnType<typeof applyRnlSnapshot>,
): { project: CircuitProject } | OmittedDrawing {
  try {
    const before = projectElectricalGraph(imported);
    const after = projectElectricalGraph(drawn.project);
    if (
      before.status === "ready" &&
      (after.status !== "ready" ||
        compareElectricalGraphs(before.graph, after.graph) !== "equal")
    )
      return {
        code: "RNL_IMPORT_CHANGES_NETLIST",
        message:
          "The RNL drawing would change the netlist, so the circuit comes in undrawn",
      };
    const project = hideLabels(
      withImportedInstanceDisplays(drawn.project),
      drawn.hiddenLabels,
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

const reason = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, 400);

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
}): Promise<RnlImportPlan> {
  try {
    return await buildImportPlan(request);
  } catch (error) {
    return {
      status: "failed",
      message: `RNL import could not be completed: ${reason(error)}`,
      diagnostics: [
        reported({
          severity: "error",
          code: "RNL_IMPORT_FAILED",
          message: reason(error),
        }),
      ],
    };
  }
}

async function buildImportPlan({
  inputs,
  entryPath,
  runtime,
}: {
  inputs: SpiceSourceInput[];
  entryPath: string;
  runtime: RnlRuntime | null;
}): Promise<RnlImportPlan> {
  if (!runtime)
    return {
      status: "failed",
      message: "RNL import needs the rnl runtime, which this build lacks",
      diagnostics: [],
    };
  const entry = inputs.find((input) => input.path === entryPath);
  if (!entry)
    return {
      status: "failed",
      message: `RNL import has no file ${entryPath}`,
      diagnostics: [],
    };
  const snapshot = await runtime.snapshot({
    entry: entryPath,
    files: Object.fromEntries(
      inputs.map((input) => [
        input.path,
        new TextDecoder().decode(input.bytes),
      ]),
    ),
    dialect: isSpectreSource(entry) ? "spectre" : "spice",
    parts: { drawing: false, host: true, model: true },
  });
  const prepared = prepareImportSources(inputs);
  const imported = await importSpiceSources(
    prepared.inputs,
    entryPath,
    {},
    {
      namingProfile: "native",
      originalSources: inputs,
      builtInBodies: prepared.builtInBodies,
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
  const drawn = applyRnlSnapshot(imported.project, snapshot);
  const kept = drawnProject(imported.project, drawn);
  const diagnostics = [
    ...imported.diagnostics,
    ...drawn.diagnostics.map(reported),
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
      project: withParameterTexts(kept.project, drawn.parameterTexts),
      diagnostics,
    };
  const undrawn = withParameterTexts(
    withImportedInstanceDisplays(imported.project),
    drawn.parameterTexts,
  );
  serializeProject(undrawn);
  return { status: "ready", project: undrawn, diagnostics };
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
