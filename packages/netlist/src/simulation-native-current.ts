import type { SimulationSourceInput } from "@icm/model";
import { sha256Hex } from "@icm/derived";
import type { DesignNetlistCell, DesignNetlistInstance } from "./ir.js";
import type { NativeSimulationDevice } from "./simulation-native-devices.js";
import { inspectVacaskSourceGraph } from "./vacask-source.js";
import { isVacaskStatement } from "./vacask-statement.js";
import { vacaskIdentifier } from "./vacask-printer.js";
import type { SimulationSourceDiagnostic } from "./source-file-graph.js";
import {
  instrumentationKey,
  type TerminalCurrentInstrumentation,
} from "./terminal-current-instrumentation.js";

export interface NativeCurrentSense extends TerminalCurrentInstrumentation {
  reference: string;
  vector: string;
  save: string;
  collision: boolean;
}

/** A compiler-owned native branch identity, stable under device/output reorder.
 * Never renumber on collision: old source must not silently measure another pin. */
export function nativeCurrentSenses(
  cell: DesignNetlistCell,
  instance: DesignNetlistInstance,
  path: readonly string[],
  occupied: ReadonlySet<string>,
): NativeCurrentSense[] {
  return instance.nodes.map(({ pinName }) => {
    const id = sha256Hex(JSON.stringify([cell.id, instance.id, pinName])).slice(
      0,
      20,
    );
    const senseReference = `__icm_sense_${id}`;
    const senseNode = `__icm_sense_node_${id}`;
    const reference = [...path, senseReference].join(":");
    return {
      cellId: cell.id,
      instanceId: instance.id,
      pinName,
      senseReference,
      senseNode,
      reference,
      vector: `${reference}:flow(br)`,
      save: `i(${vacaskIdentifier(reference)})`,
      collision: occupied.has(senseReference) || occupied.has(senseNode),
    };
  });
}

/** Native save statements are the sole request authority. No private directive
 * or persisted selection list. Physical sensing exists only in derived IR. */
export function nativeCurrentInstrumentation(
  input: SimulationSourceInput,
  devices: readonly NativeSimulationDevice[],
) {
  const known = new Map(
    devices.flatMap((d) =>
      d.currentSenses.map((s) => [s.reference, s] as const),
    ),
  );
  const instrumentations = new Map<string, TerminalCurrentInstrumentation>();
  const diagnostics: SimulationSourceDiagnostic[] = [];
  let control = false;
  for (const { path, statement } of inspectVacaskSourceGraph(input)
    .statements) {
    if (isVacaskStatement(statement, "control")) {
      control = true;
      continue;
    }
    if (isVacaskStatement(statement, "endc")) {
      control = false;
      continue;
    }
    if (!control || !isVacaskStatement(statement, "save")) continue;
    const tokens = statement.tokens;
    for (let i = 1; i + 3 < tokens.length; i++) {
      const [head, open, name, close] = tokens.slice(i, i + 4);
      if (
        head!.kind !== "word" ||
        !["i", "v"].includes(head!.value) ||
        open!.value !== "(" ||
        name!.kind !== "word" ||
        close!.value !== ")"
      )
        continue;
      // VACASK's v('instance:flow(br)') is the same native unknown as i(instance).
      if (head!.value === "v" && !name!.value.endsWith(":flow(br)")) continue;
      const ref =
        head!.value === "i"
          ? name!.value
          : name!.value.slice(0, -":flow(br)".length);
      if (!ref.split(":").at(-1)!.startsWith("__icm_sense_")) continue;
      const sense = known.get(ref);
      if (!sense || sense.collision) {
        diagnostics.push({
          code: "SIMULATION_CURRENT_SENSE_UNRESOLVED",
          severity: "error",
          message: sense
            ? `Generated current branch ${ref} collides with an authored instance or node; rename the colliding object.`
            : `Generated current branch ${ref} no longer resolves to a Canvas terminal; select that terminal again.`,
          path,
          sourceRef: statement.sourceRef,
        });
        continue;
      }
      instrumentations.set(instrumentationKey(sense), sense);
    }
  }
  return {
    instrumentations,
    diagnostics,
  };
}
