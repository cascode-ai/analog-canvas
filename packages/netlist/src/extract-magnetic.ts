// Drawn T-coils and transformers: the call each one makes, and the
// coupled-winding subcircuit it calls.
import {
  drawnMagneticParameters,
  type DrawnMagneticNetwork,
} from "@icm/derived";
import type { Instance, SchematicDocument } from "@icm/model";
import type { DeviceDescriptor } from "@icm/devices";
import { parseSpiceNumber } from "@icm/spice";
import type {
  DesignNetlistInstance,
  DesignNetlistMagneticSubcircuit,
  NetlistDiagnostic,
} from "./ir.js";
import { isIdentifier, diagnostic } from "./extract-common.js";
import { type CellNetContext, terminalNetName } from "./extract-nets.js";

/**
 * A drawn T-coil or transformer as the call it means: an `X` card on the
 * library's coupled-winding subcircuit, its pins in the Symbol's pin order,
 * passing the Instance's own inductances, coupling and bridge capacitance.
 * The subcircuit declares exactly those parameters, so a value it cannot
 * take is refused here rather than by the simulator.
 */
export function extractDrawnMagnetic(
  document: SchematicDocument,
  instance: Instance,
  definition: DeviceDescriptor,
  network: DrawnMagneticNetwork,
  context: CellNetContext,
  diagnostics: NetlistDiagnostic[],
): DesignNetlistInstance | null {
  const reference = instance.reference!;
  if (!isIdentifier(reference)) {
    diagnostic(
      diagnostics,
      document.id,
      "INVALID_INSTANCE_REFERENCE",
      `Instance reference is outside the portable identifier subset: ${reference}`,
      [instance.id],
    );
  }
  const accepted = drawnMagneticParameters(network);
  const authored = new Map<string, { name: string; rawValue: string }>();
  for (const [name, rawValue] of Object.entries(
    instance.netlist?.parameters ?? {},
  )) {
    const folded = name.toLowerCase();
    const prior = authored.get(folded);
    if (prior) {
      diagnostic(
        diagnostics,
        document.id,
        "DUPLICATE_PARAMETER_NAME",
        `Parameter ${name} duplicates parameter ${prior.name} under case folding`,
        [instance.id],
      );
      continue;
    }
    authored.set(folded, { name, rawValue });
    if (!accepted.includes(folded)) {
      diagnostic(
        diagnostics,
        document.id,
        "MAGNETIC_PARAMETER_NOT_ACCEPTED",
        `${reference} takes only ${accepted.join(", ")}; remove parameter ${name}`,
        [instance.id],
        "error",
        name,
      );
    }
  }
  const parameters = accepted.flatMap((name) => {
    const value = authored.get(name);
    if (!value?.rawValue.trim()) {
      diagnostic(
        diagnostics,
        document.id,
        "MISSING_REQUIRED_PARAMETER",
        `Instance ${reference} requires parameter ${name}`,
        [instance.id],
        "error",
        name,
      );
      return [];
    }
    return [{ name, rawValue: value.rawValue }];
  });
  const coupling = authored.get(network.coupling.parameter);
  const k = coupling ? parseSpiceNumber(coupling.rawValue.trim()) : null;
  if (k && Math.abs(k.value) > 1) {
    diagnostic(
      diagnostics,
      document.id,
      "MAGNETIC_COUPLING_OUT_OF_RANGE",
      `${reference}'s coupling ${coupling!.name}=${coupling!.rawValue} lies outside -1 to 1`,
      [instance.id],
      "error",
      coupling!.name,
    );
  }
  return {
    id: instance.id,
    reference,
    invocationKind: "subcircuit",
    deviceClass: "hierarchical",
    target: network.subcircuit,
    nodes: definition.pinOrder.map((pinName) => ({
      pinName,
      netName:
        terminalNetName(document, instance, pinName, context, diagnostics) ??
        `<unconnected:${pinName}>`,
    })),
    parameters,
  };
}

/**
 * The coupled-winding subcircuit a drawn magnetic device calls, written from
 * its network with the library's own values as defaults.
 */
export function magneticSubcircuit(
  network: DrawnMagneticNetwork,
  definition: DeviceDescriptor,
): DesignNetlistMagneticSubcircuit {
  return {
    kind: "magnetic",
    name: network.subcircuit,
    ports: network.ports.map((port) => port.port),
    formalParameters: drawnMagneticParameters(network).map((name) => ({
      name,
      defaultValue:
        definition.parameters.find(
          (parameter) => parameter.name.toLowerCase() === name,
        )?.defaultValue ?? "0",
    })),
    inductors: network.windings.map((winding) => ({
      name: winding.element,
      nodes: [winding.dotted, winding.undotted],
      parameter: winding.parameter,
    })),
    coupling: {
      name: network.coupling.element,
      inductors: [network.windings[0].element, network.windings[1].element],
      parameter: network.coupling.parameter,
    },
    capacitors: network.capacitors.map((capacitor) => ({
      name: capacitor.element,
      nodes: [capacitor.from, capacitor.to],
      parameter: capacitor.parameter,
    })),
  };
}
