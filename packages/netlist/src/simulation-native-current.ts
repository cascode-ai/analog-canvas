import type { CircuitProject, SimulationSourceInput } from "@icm/model";
import { reviewedExternalDeviceBindings } from "@icm/devices";
import type { SimulationSignalTarget } from "./simulation-signal-names.js";
import { sha256Hex } from "@icm/derived";
import type { DesignNetlistCell, DesignNetlistInstance } from "./ir.js";
import type { NativeSimulationDevice } from "./simulation-native-devices.js";
import { inspectVacaskSourceGraph } from "./vacask-source.js";
import { isVacaskStatement } from "./vacask-statement.js";
import { vacaskIdentifier, vacaskProjectValue } from "./vacask-printer.js";
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

export function nativeTerminalCurrent(
  device: NativeSimulationDevice,
  pinName: string,
):
  | { ok: true; vectors: string[]; directives: string[] }
  | { ok: false; message: string } {
  const reviewed = reviewedExternalDeviceBindings.find(
    (item) => item.id === device.card.reviewedExternalBindingId,
  );
  const pin =
    reviewed?.terminals.find((t) => t.pinName === pinName)?.targetName ??
    pinName;
  const index = device.card.nodes.findIndex((node) => node.pinName === pin);
  if (index < 0)
    return {
      ok: false,
      message: `No mapped terminal ${device.reference}.${pinName}`,
    };
  if (
    device.card.deviceClass === "voltage-source" &&
    device.nativeDevice &&
    !/\s/u.test(device.nativeDevice) &&
    index === 0
  ) {
    const factor = device.card.parameters.find((p) =>
      ["m", "$mfactor"].includes(p.name.toLowerCase()),
    );
    // The generated printer does not forward inherited m to ideal voltage
    // sources. An explicit non-unit factor still makes flow(br) per-instance.
    let unitFactor = !factor;
    if (factor) {
      try {
        unitFactor = vacaskProjectValue(factor.rawValue) === "1";
      } catch {
        /* A symbolic/invalid factor cannot prove terminal-total meaning. */
      }
    }
    if (unitFactor)
      return {
        ok: true,
        vectors: [`i(${vacaskIdentifier(device.nativeDevice)})`],
        directives: [],
      };
  }
  const sense = device.currentSenses.find((s) => s.pinName === pin);
  if (!sense || sense.collision)
    return {
      ok: false,
      message: `Cannot allocate a collision-free zero-volt sense source for ${device.reference}.${pinName}; rename the colliding object and select again.`,
    };
  return { ok: true, vectors: [sense.save], directives: [] };
}

/** Captured display/navigation evidence. Model output parameters are deliberately
 * absent: only a proven terminal-total branch has this meaning. */
export function nativeTerminalSignals(
  project: CircuitProject,
  input: SimulationSourceInput,
  devices: readonly NativeSimulationDevice[],
  instrumentations: ReadonlyMap<string, TerminalCurrentInstrumentation>,
): Record<string, { label: string; targets: SimulationSignalTarget[] }> {
  const result: Record<
    string,
    { label: string; targets: SimulationSignalTarget[] }
  > = {};
  for (const device of devices) {
    const document = project.documents.find((d) => d.id === device.documentId);
    const instance = document?.instances.find(
      (i) => i.id === device.instanceId,
    );
    const binding = input.circuitBindings.find(
      (b) => b.id === device.circuit.bindingId,
    );
    if (!document || !instance || !binding) continue;
    const reviewed = reviewedExternalDeviceBindings.find(
      (r) => r.id === device.card.reviewedExternalBindingId,
    );
    for (const sense of device.currentSenses) {
      const pinName =
        reviewed?.terminals.find((p) => p.targetName === sense.pinName)
          ?.pinName ?? sense.pinName;
      const selected = nativeTerminalCurrent(device, pinName);
      const direct =
        selected.ok &&
        device.nativeDevice &&
        selected.vectors[0] === `i(${vacaskIdentifier(device.nativeDevice)})`;
      if (
        !direct &&
        (sense.collision || !instrumentations.has(instrumentationKey(sense)))
      )
        continue;
      const vector = direct ? `${device.nativeDevice}:flow(br)` : sense.vector;
      const net = document.nets.find((n) =>
        n.terminals.some(
          (p) => p.instanceId === instance.id && p.pinName === pinName,
        ),
      );
      if (!net) continue;
      const path = [
        ...device.reference.split(":").slice(0, -1),
        `${instance.reference ?? instance.id}.${pinName}`,
      ];
      result[vector] = {
        label: `I(${path.join("/")})`,
        targets: [
          {
            rootDocumentId: binding.documentId,
            documentId: document.id,
            netId: net.id,
            occurrence: [...device.occurrence],
            terminal: { instanceId: instance.id, pinName },
          },
        ],
      };
    }
  }
  return result;
}
