import type { CircuitProject } from "@icm/model";
import { compareElectricalGraphs, projectElectricalGraph } from "@icm/netlist";
import { applyRnlSnapshot, type RnlImportDiagnostic } from "@icm/rnl";
import {
  importSpiceSources,
  type SpiceDiagnostic,
  type SpiceSourceInput,
} from "@icm/spice";

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
 * A rich netlist as a Project (Analog Canvas `docs/specs/rnl-interchange.md`,
 * Import): the SPICE / SCS import builds the circuit, unchanged, and the rnl
 * runtime's reading of the same files draws it. A drawing that would change
 * the netlist is left out, and the circuit comes in as the plain import
 * would bring it.
 */
export async function planRnlImport({
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
  const entry = inputs.find((input) => input.path === entryPath)!;
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
  const before = projectElectricalGraph(imported.project);
  const after = projectElectricalGraph(drawn.project);
  const changed =
    before.status === "ready" &&
    (after.status !== "ready" ||
      compareElectricalGraphs(before.graph, after.graph) !== "equal");
  const diagnostics = [
    ...imported.diagnostics,
    ...drawn.diagnostics.map(reported),
    ...(changed
      ? [
          reported({
            severity: "error",
            code: "RNL_IMPORT_CHANGES_NETLIST",
            message:
              "The RNL drawing would change the netlist, so the circuit comes in undrawn",
          }),
        ]
      : []),
  ];
  return {
    status: "ready",
    project: changed ? imported.project : drawn.project,
    diagnostics,
  };
}
