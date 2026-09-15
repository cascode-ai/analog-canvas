import type {
  CircuitProject,
  SimulationCircuitScope,
  SimulationSourceInput,
} from "@icm/model";
import { reviewedExternalDeviceBindings } from "@icm/devices";
import { mosBulkKind, sha256Hex } from "@icm/derived";
import type {
  CompiledSimulationDeviceOperatingPoint,
  CompiledSimulationVector,
} from "./simulation-compile.js";
import { analyzeDesignNetlist } from "./extract.js";
import type { DesignNetlistCell, DesignNetlistInstance } from "./ir.js";
import { inspectVacaskSourceGraph } from "./vacask-source.js";
import { vacaskCircuitScopes } from "./vacask-source-scopes.js";
import { vacaskIdentifier, vacaskProjectValue } from "./vacask-printer.js";
import {
  resolveNativeModelLibraries,
  type NativeModelLibrarySymbols,
} from "./vacask-model-symbols.js";

export interface NativeSimulationDevice {
  documentId: string;
  instanceId: string;
  occurrence: string[];
  circuit: SimulationCircuitScope;
  reference: string;
  card: DesignNetlistInstance;
  /** Exact native primitive path, never a guessed primitive inside a wrapper. */
  nativeDevice?: string;
  modelPrimitives: { reference: string; module: string }[];
  polarity?: "nmos" | "pmos";
}

/** Derived from the same authored call scopes and Canvas IR as voltage naming. */
export function nativeSimulationDevices(
  project: CircuitProject,
  input: SimulationSourceInput,
  libraries: readonly NativeModelLibrarySymbols[] = [],
): NativeSimulationDevice[] {
  const graph = inspectVacaskSourceGraph(input);
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
    const scopes = vacaskCircuitScopes(
      graph,
      binding,
      ir,
      resolveNativeModelLibraries(input, libraries),
    );
    for (const circuit of scopes.list()) {
      const resolved = scopes.resolve(circuit);
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
          const reference = [...path, card.reference].join(":");
          const authored = document.instances.find((i) => i.id === card.id);
          const polarity = authored ? mosBulkKind(authored) : undefined;
          const nativeDevice =
            card.invocationKind === "primitive" ? reference : undefined;
          const child =
            card.deviceClass === "hierarchical"
              ? ir!.cells.find((c) => c.name === card.target)
              : undefined;
          const modelPrimitives = (
            card.target && !child ? scopes.primitiveModels(card.target) : []
          ).map((primitive) => ({
            reference: [reference, ...primitive.path].join(":"),
            module: primitive.module,
          }));
          result.push({
            documentId: cell.id,
            instanceId: card.id,
            occurrence,
            circuit,
            reference,
            card,
            modelPrimitives,
            ...(nativeDevice ? { nativeDevice } : {}),
            ...(polarity ? { polarity } : {}),
          });
          if (child)
            visit(
              child,
              [...path, card.reference],
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

/** Raw model output selectors. No sign, multiplicity, or terminal-gm aliasing.
 * sp_bsim4v8 output names are declared by the pinned spice/bsim4v8 OSDI model;
 * similarly named modules and opaque PDK dependencies are not interchangeable. */
export function nativeDeviceOpAcquisitions(device: NativeSimulationDevice) {
  if (!device.polarity) return [];
  return device.modelPrimitives.flatMap((primitive) =>
    primitive.module === "sp_bsim4v8" && !/\s/u.test(primitive.reference)
      ? NATIVE_MOS_OP_PARAMETERS.map((parameter) => ({
          parameter,
          reference: primitive.reference,
          vector: `${primitive.reference}.${parameter}`,
          save: `p(${vacaskIdentifier(primitive.reference)},${parameter})`,
          semantics: "model-native" as const,
        }))
      : [],
  );
}

/** Native save selectors for source generators; raw result keys are available
 * separately from nativeDeviceOpAcquisitions, never reconstructed from text. */
export function nativeDeviceOpVectors(
  device: NativeSimulationDevice,
): string[] {
  return nativeDeviceOpAcquisitions(device).map(
    (acquisition) => acquisition.save,
  );
}

/** Potential mappings only: Code owns saves, and the result reader displays
 * only quantities actually returned by an OP record. Each wrapper primitive
 * keeps its own model values; never sum gm/id or infer terminal semantics. */
export function compileNativeDeviceOperatingPoints(
  devices: readonly NativeSimulationDevice[],
): {
  vectors: CompiledSimulationVector[];
  deviceOperatingPoints: CompiledSimulationDeviceOperatingPoint[];
} {
  const vectors: CompiledSimulationVector[] = [];
  const deviceOperatingPoints: CompiledSimulationDeviceOperatingPoint[] = [];
  for (const device of devices) {
    if (!device.polarity) continue;
    const acquisitions = nativeDeviceOpAcquisitions(device);
    for (const reference of new Set(acquisitions.map((a) => a.reference))) {
      const id = `native-op:${sha256Hex(
        JSON.stringify([
          device.circuit,
          device.documentId,
          device.occurrence,
          device.instanceId,
          reference,
        ]),
      )}`;
      const values = acquisitions
        .filter((a) => a.reference === reference)
        .map((a) => {
          const probeId = `${id}:${a.parameter}`;
          vectors.push({ probeId, vector: a.vector, quantity: "native" });
          return {
            parameter: a.parameter,
            label: `${a.parameter} (model)`,
            unit: (a.parameter === "id"
              ? "A"
              : ["gm", "gds", "gmbs"].includes(a.parameter)
                ? "S"
                : "V") as "A" | "S" | "V",
            expression: {
              kind: "acquisition" as const,
              acquisitionId: probeId,
              quantity: "native" as const,
            },
          };
        });
      deviceOperatingPoints.push({
        id,
        documentId: device.documentId,
        instanceId: device.instanceId,
        occurrence: [...device.occurrence],
        reference,
        polarity: device.polarity,
        values,
      });
    }
  }
  return { vectors, deviceOperatingPoints };
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
  return {
    ok: false,
    message: `Terminal current at ${device.reference}.${pinName} requires a zero-volt sense source. Native model id is not a signed terminal-total current, and VACASK does not accept the old .probe directive. Insert an explicit sense source and save its branch current; automatic terminal instrumentation remains a migration gap.`,
  };
}
