import type { DeviceDescriptor } from "@icm/devices";

/** One winding of a drawn magnetic device. */
export interface DrawnMagneticWinding {
  /** The inductor's name inside the subcircuit. */
  readonly element: string;
  /**
   * The port at the end the Symbol marks with its polarity dot. SPICE and
   * Spectre both read an inductor's first node as its dot, so the winding is
   * written from here.
   */
  readonly dotted: string;
  readonly undotted: string;
  /** The Instance parameter that sets its inductance. */
  readonly parameter: string;
}

/**
 * The network a drawn T-coil or transformer stands for.
 *
 * Both are one Symbol on the canvas, but what a simulator reads is coupled
 * windings: two inductors, the coupling between them, and for a T-coil its
 * bridge capacitor. A netlist writes that network once, as a subcircuit, and
 * every Instance calls it with its own values.
 */
export interface DrawnMagneticNetwork {
  /** The subcircuit every Instance of the Symbol calls. */
  readonly subcircuit: string;
  /** The subcircuit's ports, one per Symbol pin, in pin order. */
  readonly ports: readonly {
    readonly pinName: string;
    readonly port: string;
  }[];
  readonly windings: readonly [DrawnMagneticWinding, DrawnMagneticWinding];
  /** The coupling between the two windings and the parameter giving k. */
  readonly coupling: { readonly element: string; readonly parameter: string };
  readonly capacitors: readonly {
    readonly element: string;
    readonly from: string;
    readonly to: string;
    readonly parameter: string;
  }[];
}

/**
 * A bridged T-coil: pins 1 and 2 are the coil's ends and pin 3 its centre
 * tap. The Symbol dots L1 at pin 1 and L2 at the tap, so a current running
 * from pin 1 through to pin 2 enters both windings at their dots and the two
 * aid: end to end the coil is L1 + L2 + 2M. CB bridges the two ends.
 */
const T_COIL: DrawnMagneticNetwork = {
  subcircuit: "tcoil",
  ports: [
    { pinName: "1", port: "n1" },
    { pinName: "2", port: "n2" },
    { pinName: "3", port: "n3" },
  ],
  windings: [
    { element: "L1", dotted: "n1", undotted: "n3", parameter: "l1" },
    { element: "L2", dotted: "n3", undotted: "n2", parameter: "l2" },
  ],
  coupling: { element: "K12", parameter: "k" },
  capacitors: [{ element: "CB", from: "n1", to: "n2", parameter: "cb" }],
};

/** A transformer, whose Symbol dots both windings at their + pins. */
const TRANSFORMER: DrawnMagneticNetwork = {
  subcircuit: "xfmr",
  ports: [
    { pinName: "P-", port: "p_minus" },
    { pinName: "P+", port: "p_plus" },
    { pinName: "S-", port: "s_minus" },
    { pinName: "S+", port: "s_plus" },
  ],
  windings: [
    { element: "LP", dotted: "p_plus", undotted: "p_minus", parameter: "lp" },
    { element: "LS", dotted: "s_plus", undotted: "s_minus", parameter: "ls" },
  ],
  coupling: { element: "K1", parameter: "k" },
  capacitors: [],
};

const NETWORKS: ReadonlyMap<string, DrawnMagneticNetwork> = new Map([
  [T_COIL.subcircuit, T_COIL],
  [TRANSFORMER.subcircuit, TRANSFORMER],
]);

/** Every parameter a network reads, in the order its subcircuit declares them. */
export function drawnMagneticParameters(
  network: DrawnMagneticNetwork,
): readonly string[] {
  return [
    ...network.windings.map((winding) => winding.parameter),
    network.coupling.parameter,
    ...network.capacitors.map((capacitor) => capacitor.parameter),
  ];
}

/**
 * The coupled network a device lowers to, or null for every other device.
 * The T-coil and transformer qualify, including the copies a saved Project
 * carries of them, while they still have the library's identity, its pins in
 * its order, its parameters, and no netlist target of their own. Which end of
 * a winding is dotted belongs to the pins, as the library draws them.
 */
export function drawnMagneticNetwork(
  definition: DeviceDescriptor,
): DrawnMagneticNetwork | null {
  const network = NETWORKS.get(definition.id);
  if (
    !network ||
    definition.symbolId !== definition.id ||
    definition.deviceClass !== "inductor" ||
    definition.targetPolicy !== "none"
  )
    return null;
  const pins = network.ports.map((port) => port.pinName);
  if (
    definition.pinOrder.length !== pins.length ||
    definition.pinOrder.some((pin, index) => pin !== pins[index])
  )
    return null;
  const declared = new Set(
    definition.parameters.map((parameter) => parameter.name.toLowerCase()),
  );
  return drawnMagneticParameters(network).every((name) => declared.has(name))
    ? network
    : null;
}
