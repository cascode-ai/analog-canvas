import {
  deriveStableId,
  type ComponentDefinition,
  type Instance,
} from "@icm/model";
import { deviceDescriptor } from "@icm/devices";
import { createBlockSymbol } from "@icm/symbols";

import { diagnostic, type SpiceDiagnostic } from "./diagnostics.js";
import type { CircuitInstanceIR } from "./ir.js";

/**
 * A SPICE device card whose model no card declares and no caller types
 * (#2294): its letter says which family it is (M a MOS, Q a BJT, J a JFET),
 * not which channel or polarity. It comes in as a box of that family, its
 * pins in the order SPICE gives them, printed as the card it was. Nothing
 * guesses n or p from a model's name.
 */
interface UntypedFamily {
  deviceClass: "mos" | "bjt" | "jfet";
  label: string;
  /** Pin names by terminal count, in SPICE's order. */
  pins: Readonly<Record<number, readonly string[]>>;
  /** The typed part whose parameters an untyped one offers. */
  parametersOf: string;
  /** The device types of this family, as a caller states one in
   * modelTypes: the letter says the family, never which of them. */
  types: readonly string[];
}

const UNTYPED_FAMILIES: Readonly<Record<string, UntypedFamily>> = {
  M: {
    deviceClass: "mos",
    label: "MOS",
    pins: { 4: ["D", "G", "S", "B"] },
    parametersOf: "nmos",
    types: ["nmos", "pmos"],
  },
  Q: {
    deviceClass: "bjt",
    label: "BJT",
    pins: { 3: ["C", "B", "E"], 4: ["C", "B", "E", "S"] },
    parametersOf: "npn",
    types: ["npn", "pnp"],
  },
  J: {
    deviceClass: "jfet",
    label: "JFET",
    pins: { 3: ["D", "G", "S"] },
    parametersOf: "njfet",
    types: ["njf", "pjf"],
  },
};

/** The untyped family a card fits, by its letter and terminal count. */
export function untypedFamily(
  instance: Pick<CircuitInstanceIR, "name" | "terminals">,
): { letter: string; family: UntypedFamily; pins: readonly string[] } | null {
  const letter = instance.name[0]!.toUpperCase();
  const family = UNTYPED_FAMILIES[letter];
  const pins = family?.pins[instance.terminals.length];
  return family && pins ? { letter, family, pins } : null;
}

/** The typed part whose parameters an untyped box of this letter offers. */
export function untypedParameterSymbol(letter: string): string {
  return UNTYPED_FAMILIES[letter]!.parametersOf;
}

export function untypedSymbolId(letter: string, pinCount: number): string {
  return deriveStableId("untyped-device-symbol", `${letter}${pinCount}`);
}

/** The components of the untyped boxes these Symbols name, one per family
 * and pin count. */
export function untypedComponents(
  symbolIds: ReadonlySet<string>,
): ComponentDefinition[] {
  return Object.entries(UNTYPED_FAMILIES).flatMap(([letter, family]) =>
    Object.values(family.pins).flatMap((pins) =>
      symbolIds.has(untypedSymbolId(letter, pins.length))
        ? [untypedComponent(letter, pins)]
        : [],
    ),
  );
}

/** The family of an untyped box's Symbol, if it is one, with its pins. */
function untypedBox(
  symbolId: string,
): { family: UntypedFamily; pins: readonly string[] } | undefined {
  for (const [letter, family] of Object.entries(UNTYPED_FAMILIES))
    for (const pins of Object.values(family.pins))
      if (untypedSymbolId(letter, pins.length) === symbolId)
        return { family, pins };
  return undefined;
}

/** Part names in reading order, five at most. */
function partNames(names: readonly string[]): string {
  const shown = names.slice(0, 5);
  const rest = names.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${rest} more`;
  return shown.length > 1
    ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`
    : (shown[0] ?? "");
}

/**
 * One finding for the parts an import drew as untyped boxes: what each came
 * in as, and how to draw it as the device it is. It never asks for a card:
 * the library that defines the model is what is missing, or, from a caller
 * that gives them, its device type.
 */
export function untypedDeviceDiagnostic(
  instances: readonly Pick<
    Instance,
    "symbolId" | "reference" | "id" | "netlist"
  >[],
  givesModelTypes: boolean,
): SpiceDiagnostic | undefined {
  const byModel = new Map<
    string,
    { names: string[]; family: UntypedFamily; pins: readonly string[] }
  >();
  for (const instance of instances) {
    const box = untypedBox(instance.symbolId);
    const binding = instance.netlist?.binding;
    if (!box || binding?.kind !== "model") continue;
    const entry = byModel.get(binding.name) ?? { names: [], ...box };
    entry.names.push(instance.reference ?? instance.id);
    byModel.set(binding.name, entry);
  }
  const [first] = byModel;
  if (!first) return undefined;
  const uses = [...byModel].map(
    ([model, { names, family, pins }]) =>
      `${partNames(names)} ${names.length === 1 ? "uses" : "use"} ${model}, which no card declares: ${names.length === 1 ? "it comes" : "they come"} in as ${family.label} (${pins.join(" ")}) of unknown type, a box with its pins as SPICE orders them`,
  );
  const typed = givesModelTypes
    ? `, or give its device type in modelTypes, such as ${first[1].family.types
        .map((type) => `{"${first[0]}":"${type}"}`)
        .join(" or ")}`
    : "";
  return diagnostic(
    "SPICE_IMPORT_UNTYPED_DEVICE",
    "warning",
    "import",
    `${uses.join("; ")}. To draw one as the device it is, include the library that defines it${typed}.`,
  );
}

/** The Project's component an untyped card draws with: a box, the family's
 * pins, and the card's letter, bound to the model it names. */
function untypedComponent(
  letter: string,
  pins: readonly string[],
): ComponentDefinition {
  const family = UNTYPED_FAMILIES[letter]!;
  const symbolId = untypedSymbolId(letter, pins.length);
  const typed = deviceDescriptor(family.parametersOf);
  return {
    symbol: createBlockSymbol({
      id: symbolId,
      name: `${family.label}, type unknown`,
      terminals: pins.map((name) => ({
        id: deriveStableId("untyped-device-pin", symbolId, name),
        name,
        direction: "passive",
      })),
    }),
    electrical: {
      id: symbolId,
      symbolId,
      deviceClass: family.deviceClass,
      referencePrefix: letter,
      pinOrder: [...pins],
      targetPolicy: "required-model",
      // The typed part's parameters, as a Project component states them.
      parameters: (typed?.parameters ?? []).map((parameter) => ({
        name: parameter.name,
        label: parameter.label,
        required: parameter.required,
        editor: parameter.editor,
        placeholder: parameter.placeholder,
        help: parameter.help,
        displayRole: parameter.displayRole,
        ...(parameter.unitHint ? { unitHint: parameter.unitHint } : {}),
        ...(parameter.defaultValue !== undefined
          ? { defaultValue: parameter.defaultValue }
          : {}),
        ...(parameter.options
          ? {
              options: parameter.options.map(({ value, label }) => ({
                value,
                label,
              })),
            }
          : {}),
      })),
      dialects: ["spice", "spectre"],
      capabilities: {
        supportsModel: true,
        supportsBulkBinding: false,
        supportsValueAnnotation: true,
      },
    },
  };
}
