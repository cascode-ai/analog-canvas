import type {
  DesignNetlistCell,
  DesignNetlistIR,
  DesignNetlistInstance,
} from "./ir.js";

/**
 * Bind a design netlist to the Sky130 PDK.
 *
 * The structural netlist is the design's and says `M1 d g s b nch`. Sky130
 * ships its devices as subcircuit wrappers, so the same circuit reads
 * `XM1 d g s b sky130_fd_pr__nfet_01v8 l=… w=… nf=…`. This is a projection
 * over the extracted IR, never a second extraction: the design keeps its own
 * model names, and only the simulated copy carries the PDK's.
 *
 * Three conventions are verified against the PDK itself rather than assumed,
 * because each is silent when wrong:
 *
 * - **Terminal order is drain, gate, source, bulk**, read from the wrapper's
 *   own definition (`.subckt sky130_fd_pr__nfet_01v8 d g s b`). A wrong order
 *   simulates a different circuit and reports no error.
 * - **`l` and `w` are plain micrometre numbers**, because the model libraries
 *   set `.option scale=1u`. Passing metres would simulate a device a million
 *   times too large, and it too reports no error.
 * - **`nf` is the finger count and `w` is total width**, so `w/nf` is one
 *   finger. It changes the answer: the same device at nf=12 and nf=16 draws
 *   measurably different current.
 */
export interface Sky130BindingOptions {
  /** Design model target (`nch`, `pch`, …) to Sky130 wrapper name. */
  readonly modelByTarget: Readonly<Record<string, string>>;
}

const MICROMETRE = 1e-6;
const SPICE_SUFFIX: Readonly<Record<string, number>> = {
  t: 1e12,
  g: 1e9,
  meg: 1e6,
  k: 1e3,
  m: 1e-3,
  u: 1e-6,
  n: 1e-9,
  p: 1e-12,
  f: 1e-15,
  a: 1e-18,
};

/**
 * Read one SPICE-suffixed length in metres and print it in micrometres.
 *
 * A bare number is metres, which is what our own netlist means by `l=1e-6`.
 * Anything unreadable throws with the offending text: a geometry the binding
 * cannot understand must stop the export, because the alternative is a
 * plausible-looking netlist for a circuit nobody drew.
 */
export function sky130Micrometres(value: string): string {
  const text = value.trim().toLowerCase();
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z]*)$/u.exec(
    text,
  );
  if (!match) throw new Error(`Geometry is not a SPICE number: ${value}`);
  const magnitude = Number(match[1]);
  const suffix = match[2] ?? "";
  if (!Number.isFinite(magnitude)) {
    throw new Error(`Geometry is not a SPICE number: ${value}`);
  }
  let multiplier = 1;
  if (suffix) {
    // SPICE reads the longest known suffix and ignores trailing letters, so
    // `2uF` is 2 micro. `meg` must be tested before `m`.
    const known = suffix.startsWith("meg")
      ? "meg"
      : (suffix[0] as string | undefined);
    const factor = known ? SPICE_SUFFIX[known] : undefined;
    if (factor === undefined) {
      throw new Error(`Geometry has an unknown SPICE suffix: ${value}`);
    }
    multiplier = factor;
  }
  const metres = magnitude * multiplier;
  const micrometres = metres / MICROMETRE;
  // Print the shortest exact decimal: sky130 geometry is read by people as
  // often as by the simulator.
  return `${Number(micrometres.toPrecision(12))}`;
}

function bindInstance(
  instance: DesignNetlistInstance,
  cellName: string,
  options: Sky130BindingOptions,
): DesignNetlistInstance {
  if (instance.deviceClass !== "mos") return instance;
  const target = instance.target;
  const model = target ? options.modelByTarget[target] : undefined;
  if (!model) {
    throw new Error(
      `No Sky130 model is bound for ${cellName}.${instance.reference} (model ${target ?? "none"})`,
    );
  }
  return {
    ...instance,
    // A subcircuit call, so the reference carries SPICE's X prefix. The
    // designator stays legible: M1 becomes XM1, not X1.
    reference: instance.reference.startsWith("X")
      ? instance.reference
      : `X${instance.reference}`,
    deviceClass: "hierarchical",
    target: model,
    parameters: instance.parameters.map((parameter) =>
      parameter.name.toLowerCase() === "l" ||
      parameter.name.toLowerCase() === "w"
        ? { ...parameter, rawValue: sky130Micrometres(parameter.rawValue) }
        : parameter,
    ),
  };
}

function bindCell(
  cell: DesignNetlistCell,
  options: Sky130BindingOptions,
): DesignNetlistCell {
  return {
    ...cell,
    instances: cell.instances.map((instance) =>
      bindInstance(instance, cell.name, options),
    ),
  };
}

/** Project one extracted design netlist onto Sky130's device wrappers. */
export function bindSky130Netlist(
  ir: DesignNetlistIR,
  options: Sky130BindingOptions,
): DesignNetlistIR {
  return { ...ir, cells: ir.cells.map((cell) => bindCell(cell, options)) };
}
