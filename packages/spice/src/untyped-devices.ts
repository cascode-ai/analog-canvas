import { deriveStableId, type ComponentDefinition } from "@icm/model";
import { deviceDescriptor } from "@icm/devices";
import { createBlockSymbol } from "@icm/symbols";

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
}

const UNTYPED_FAMILIES: Readonly<Record<string, UntypedFamily>> = {
  M: {
    deviceClass: "mos",
    label: "MOS",
    pins: { 4: ["D", "G", "S", "B"] },
    parametersOf: "nmos",
  },
  Q: {
    deviceClass: "bjt",
    label: "BJT",
    pins: { 3: ["C", "B", "E"], 4: ["C", "B", "E", "S"] },
    parametersOf: "npn",
  },
  J: {
    deviceClass: "jfet",
    label: "JFET",
    pins: { 3: ["D", "G", "S"] },
    parametersOf: "njfet",
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

/** The family label of an untyped box's Symbol, if it is one. */
export function untypedLabel(symbolId: string): string | undefined {
  for (const [letter, family] of Object.entries(UNTYPED_FAMILIES))
    for (const pins of Object.values(family.pins))
      if (untypedSymbolId(letter, pins.length) === symbolId)
        return `${family.label} (${pins.join(" ")})`;
  return undefined;
}

/** The Project's component an untyped card draws with: a box, the family's
 * pins, and the card's letter, bound to the model it names. */
export function untypedComponent(
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
