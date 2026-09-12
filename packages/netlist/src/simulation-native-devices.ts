import type {
  CircuitProject,
  SimulationCircuitScope,
  SimulationSourceInput,
} from "@icm/model";
import { reviewedExternalDeviceBindings } from "@icm/devices";
import { mosBulkKind } from "@icm/derived";
import { analyzeDesignNetlist } from "./extract.js";
import type { DesignNetlistCell, DesignNetlistInstance } from "./ir.js";
import { inspectSimulationSourceGraph } from "./simulation-source-graph.js";
import {
  listAuthoredCircuitScopes,
  resolveAuthoredCircuitScope,
} from "./simulation-source-scopes.js";

export interface NativeSimulationDevice {
  documentId: string;
  instanceId: string;
  occurrence: string[];
  circuit: SimulationCircuitScope;
  reference: string;
  card: DesignNetlistInstance;
  /** ngspice's flattened primitive identity, not the display reference. */
  nativeDevice?: string;
  polarity?: "nmos" | "pmos";
}

/** Derived from the same authored call scopes and Canvas IR as voltage naming. */
export function nativeSimulationDevices(
  project: CircuitProject,
  input: SimulationSourceInput,
): NativeSimulationDevice[] {
  const graph = inspectSimulationSourceGraph(input);
  const result: NativeSimulationDevice[] = [];
  for (const binding of input.circuitBindings) {
    if (!graph.paths.includes(binding.path)) continue;
    const ir = analyzeDesignNetlist(project, {
      format: "spice",
      rootDocumentId: binding.documentId,
    }).ir;
    if (!ir) continue;
    const root = ir.cells.find((cell) => cell.id === ir.topCellId);
    if (!root) continue;
    for (const circuit of listAuthoredCircuitScopes(graph, binding, ir)) {
      const resolved = resolveAuthoredCircuitScope(graph, binding, ir, circuit);
      if (!resolved.ok) continue;
      let visits = 0;
      function visit(
        cell: DesignNetlistCell,
        path: string[],
        occurrence: string[],
        ancestors: Set<string>,
      ) {
        if (++visits > 4096 || ancestors.has(cell.id)) return;
        const document = project.documents.find((d) => d.id === cell.id)!;
        for (const card of cell.instances) {
          const reference = [...path, card.reference.toLowerCase()].join(".");
          const authored = document.instances.find((i) => i.id === card.id);
          const polarity = authored ? mosBulkKind(authored) : undefined;
          const reviewed = reviewedExternalDeviceBindings.find(
            (item) => item.id === card.reviewedExternalBindingId,
          );
          // The reviewed SKY130 MOS wrappers have one m<masterName> primitive.
          // This mapping is deliberately not applied to arbitrary external subcircuits.
          const nativeDevice =
            card.invocationKind === "primitive"
              ? path.length
                ? `${card.reference[0]!.toLowerCase()}.${reference}`
                : reference
              : reviewed?.deviceClass === "mos"
                ? `m.${reference}.m${reviewed.masterName}`
                : undefined;
          result.push({
            documentId: cell.id,
            instanceId: card.id,
            occurrence,
            circuit,
            reference,
            card,
            ...(nativeDevice ? { nativeDevice } : {}),
            ...(polarity ? { polarity } : {}),
          });
          const child =
            card.deviceClass === "hierarchical"
              ? ir!.cells.find((c) => c.name === card.target)
              : undefined;
          if (child)
            visit(
              child,
              [...path, card.reference.toLowerCase()],
              [...occurrence, card.id],
              new Set([...ancestors, cell.id]),
            );
        }
      }
      visit(root, resolved.prefix, [], new Set());
    }
  }
  return result;
}

export const NATIVE_MOS_OP_PARAMETERS = [
  "id",
  "vgs",
  "vds",
  "vbs",
  "gm",
  "gds",
  "gmbs",
  "vth",
  "vdsat",
] as const;

export function nativeDeviceOpVectors(
  device: NativeSimulationDevice,
): string[] {
  if (!device.polarity || !device.nativeDevice) return [];
  // Threshold spellings vary across primitive model families; only the reviewed
  // BSIM SKY130 wrappers advertise vth/vdsat in Helper. Exact vectors stay editable.
  return NATIVE_MOS_OP_PARAMETERS.filter(
    (p) =>
      device.card.reviewedExternalBindingId || !["vth", "vdsat"].includes(p),
  ).map((parameter) => `@${device.nativeDevice}[${parameter}]`);
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
  if (!device.reference.includes(".")) {
    if (device.card.deviceClass === "voltage-source" && index === 0)
      return { ok: true, vectors: [`i(${device.reference})`], directives: [] };
    // Native .probe owns its sense source and collection. No JSON instrumentation.
    return {
      ok: true,
      vectors: [],
      directives: [`.probe i(${device.reference},${index + 1})`],
    };
  }
  if (device.polarity && device.nativeDevice && pinName.toLowerCase() === "d")
    return {
      ok: true,
      vectors: [`@${device.nativeDevice}[id]`],
      directives: [],
    };
  if (
    device.card.deviceClass === "voltage-source" &&
    device.nativeDevice &&
    index === 0
  )
    return { ok: true, vectors: [`i(${device.nativeDevice})`], directives: [] };
  return {
    ok: false,
    message: `Native current acquisition is unavailable for ${device.reference}.${pinName}. Hierarchical terminals currently support model-native drain current and voltage-source branch current only; no hidden sense circuit is inserted.`,
  };
}
