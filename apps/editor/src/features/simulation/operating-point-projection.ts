import type { CircuitProject } from "@icm/model";
import type { SimulationPresentationOutput as SimulationOutputSpec } from "./source-presentation";
import type { SimulationOutputData } from "@icm/simulation-service/contract";

import type { OperatingPointDisplay } from "./operating-point-labels";
import { resolveSimulationVoltageProbeNetId } from "./simulation-probe-options";
import { selectedResultRecords } from "./simulation-result-records";

export interface OperatingPointCanvasValue {
  readonly documentId: string;
  /** Instance ids from the simulation root to this concrete Cell occurrence. */
  readonly occurrence: readonly string[];
  readonly netId: string;
  readonly volts: number;
}

/**
 * Session-only values that may be painted back onto the schematic.
 *
 * The mapping is deliberately based on authored voltage anchors. Raw ngspice
 * names are never matched back to project objects after execution: that would
 * collapse repeated hierarchy occurrences and turn a spelling coincidence
 * into an electrical claim.
 */
export interface OperatingPointCanvasProjection {
  readonly rootDocumentId: string;
  readonly inputRevision: string;
  readonly display: OperatingPointDisplay;
  readonly values: readonly OperatingPointCanvasValue[];
}

export function deriveOperatingPointCanvasProjection(
  project: CircuitProject,
  rootDocumentId: string,
  inputRevision: string,
  data: SimulationOutputData | undefined,
  outputs: readonly SimulationOutputSpec[],
  display: OperatingPointDisplay,
  opRecordIndex?: number,
): OperatingPointCanvasProjection {
  const authored = new Map(outputs.map((output) => [output.id, output]));
  const values = new Map<string, OperatingPointCanvasValue>();
  for (const { analysis } of data
    ? selectedResultRecords(
        data,
        opRecordIndex === undefined ? {} : { op: opRecordIndex },
      )
    : []) {
    if (analysis.analysis !== "op") continue;
    for (const result of analysis.outputs) {
      const output = authored.get(result.id);
      const expression = output?.expression;
      const volts = result.values[0];
      if (
        expression?.kind !== "voltage" ||
        result.unit !== "V" ||
        volts === null ||
        volts === undefined ||
        !Number.isFinite(volts)
      )
        continue;
      const netId = resolveSimulationVoltageProbeNetId(project, expression);
      if (!netId) continue;
      const occurrence = [...expression.occurrence];
      values.set(
        `${expression.documentId}\u0000${occurrence.join("\u0000")}\u0000${netId}`,
        {
          documentId: expression.documentId,
          occurrence,
          netId,
          volts,
        },
      );
    }
  }
  return {
    rootDocumentId,
    inputRevision,
    display,
    values: [...values.values()],
  };
}
