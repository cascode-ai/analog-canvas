import { foldNetName } from "./net-name.js";

/**
 * The names netlists usually give a differential-input part's inputs and
 * outputs, which a Cell implementing the part may use for its Pins (#2350).
 * Each set is read as a whole so a sign is never guessed: INP and INN are
 * IN+ and IN-, VOUT is OUT.
 */
export interface PartPinNameSet {
  /** The part's own pins, in the order of each set's names. */
  readonly pins: readonly string[];
  readonly names: readonly (readonly string[])[];
  /** How a refusal lists the sets, and what it asks to rename. */
  readonly spoken: string;
  readonly rename: string;
}

const PART_PIN_NAME_SETS: readonly PartPinNameSet[] = [
  {
    pins: ["IN+", "IN-"],
    names: [
      ["INP", "INN"],
      ["INP", "INM"],
      ["VINP", "VINN"],
      ["VINP", "VINM"],
      ["VIP", "VIN"],
      ["VIP", "VIM"],
      ["IP", "IN"],
      ["VIN+", "VIN-"],
    ],
    spoken:
      "INP and INN, VINP and VINN, VIP and VIN, or IP and IN for the inputs",
    rename: "its non-inverting input IN+ and its inverting input IN-",
  },
  {
    pins: ["OUT"],
    names: [["VOUT"], ["VO"], ["OUTPUT"]],
    spoken: "VOUT, VO or OUTPUT for OUT",
    rename: "its output OUT",
  },
  {
    pins: ["OUT+", "OUT-"],
    names: [
      ["OUTP", "OUTN"],
      ["OUTP", "OUTM"],
      ["VOUTP", "VOUTN"],
      ["VOUTP", "VOUTM"],
      ["VOP", "VON"],
      ["OP", "ON"],
      ["VOUT+", "VOUT-"],
    ],
    spoken: "OUTP and OUTN, VOUTP and VOUTN, or VOP and VON for the outputs",
    rename: "its outputs OUT+ and OUT-",
  },
];

/**
 * The name sets a part's pins take: those of a part with inputs IN+ and IN-
 * whose pins the set names. Without the part's pins, every set: a reading
 * that only asks whether a pin can meet a Pin.
 */
export function partPinNameSets(
  partPins?: readonly string[],
): readonly PartPinNameSet[] {
  if (!partPins) return PART_PIN_NAME_SETS;
  const pins = new Set(partPins);
  return pins.has("IN+") && pins.has("IN-")
    ? PART_PIN_NAME_SETS.filter((set) => set.pins.every((pin) => pins.has(pin)))
    : [];
}

/**
 * The part pins a Cell's Pins take by a usual name (#2350), by folded Pin
 * name, and the first set whose names the Pins spell more than one way. A set
 * applies only while the Cell names none of its pins by the part's own name,
 * and only one of its name pairs is complete.
 */
export function cellPinsByUsualName(
  portNames: readonly string[],
  partPins?: readonly string[],
): {
  readonly byName: ReadonlyMap<string, string>;
  readonly ambiguous?: {
    readonly set: PartPinNameSet;
    readonly portNames: readonly string[];
  };
} {
  const byName = new Map<string, string>();
  const ports = new Set(portNames.map(foldNetName));
  for (const set of partPinNameSets(partPins)) {
    if (set.pins.some((pin) => ports.has(foldNetName(pin)))) continue;
    const complete = set.names.filter((names) =>
      names.every((name) => ports.has(foldNetName(name))),
    );
    if (complete.length > 1) {
      const named = new Set(complete.flat().map(foldNetName));
      return {
        byName,
        ambiguous: {
          set,
          portNames: portNames.filter((portName) =>
            named.has(foldNetName(portName)),
          ),
        },
      };
    }
    complete[0]?.forEach((name, index) =>
      byName.set(foldNetName(name), set.pins[index]!),
    );
  }
  return { byName };
}
