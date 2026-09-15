import type { CircuitProject } from "@icm/model";
import type { SimulationPresentationOutput as SimulationOutputSpec } from "./source-presentation";
import type {
  Prepared,
  SimulationOutputData,
} from "@icm/simulation-service/contract";

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
 * The mapping uses authored anchors or the immutable Prepare signal targets.
 * Raw names are never matched back to current project labels: that would
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
  signalTargets?: Prepared["signalTargets"],
): OperatingPointCanvasProjection {
  const authored = new Map(outputs.map((output) => [output.id, output]));
  const values = new Map<string, OperatingPointCanvasValue>();
  for (const { analysis } of data
    ? selectedResultRecords(
        data,
        opRecordIndex === undefined ? {} : { op: opRecordIndex },
      )
    : []) {
    if (analysis.analysis !== "op" || analysis.postprocessor) continue;
    for (const result of analysis.outputs) {
      // Exact native identity captured at Prepare, not a display-name lookup.
      // VACASK raw nodes may be `notype`; the prepared electrical address proves
      // voltage, while declared expressions and terminal currents cannot do so.
      if (
        result.id.startsWith("native:") &&
        result.semantics?.origin === "raw" &&
        result.semantics.valueKind === "real" &&
        ["", "V"].includes(result.unit) &&
        ["notype", "voltage"].includes(result.semantics.quantity) &&
        result.values.length === 1 &&
        !result.imaginary?.some((value) => value !== 0)
      ) {
        const volts = result.values[0];
        if (volts !== null && volts !== undefined && Number.isFinite(volts)) {
          for (const target of signalTargets?.[
            result.id.slice("native:".length)
          ] ?? []) {
            if (
              target.terminal ||
              target.rootDocumentId !== rootDocumentId ||
              !project.documents
                .find((d) => d.id === target.documentId)
                ?.nets.some((n) => n.id === target.netId)
            )
              continue;
            const occurrence = [...target.occurrence];
            values.set(
              `${target.documentId}\u0000${occurrence.join("\u0000")}\u0000${target.netId}`,
              {
                documentId: target.documentId,
                occurrence,
                netId: target.netId,
                volts,
              },
            );
          }
        }
      }
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
