import type { RichTextDocument } from "@icm/model";
import { deviceDescriptor, type DeviceParameterDefinition } from "@icm/devices";

export type InstanceValueDisplay =
  | { readonly kind: "displayable"; readonly content: RichTextDocument }
  | { readonly kind: "undisplayable"; readonly reason: string };

/**
 * Structural input: a full Instance satisfies it, and callers can project a
 * not-yet-committed parameter draft without inventing netlist fields the
 * formatter never reads.
 */
export interface InstanceValueSource {
  readonly symbolId: string;
  readonly netlist?:
    { readonly parameters: Record<string, string> } | undefined;
}

function effectiveParameterValue(
  instance: InstanceValueSource,
  parameter: DeviceParameterDefinition,
): string {
  const netlist = instance.netlist?.parameters[parameter.name];
  if (netlist !== undefined) return netlist.trim();
  return "";
}

function displayUnit(parameter: DeviceParameterDefinition): string {
  // `Ohm` remains the form's familiar text hint, while the existing Razavi
  // value annotation uses its conventional glyph. This is a general display
  // spelling rule, not a second device registry.
  return parameter.unitHint === "Ohm" ? "Ω" : (parameter.unitHint ?? "");
}

function withUnit(raw: string, unit: string): string {
  // Values are typed as bare SPICE numbers; append the physical unit unless
  // the author already ended with it.
  return raw.endsWith(unit) ? raw : `${raw}${unit}`;
}

function boldText(value: string): RichTextDocument["runs"][number] {
  return {
    kind: "span",
    style: "bold",
    children: [{ kind: "text", value }],
  };
}

function boldDocument(value: string): RichTextDocument {
  return { runs: [boldText(value)] };
}

/**
 * One pure authority for the optional Value annotation beside an instance.
 * Electrical truth stays in the typed netlist parameters; this only projects
 * it to display text and never
 * writes back. Display is Razavi textbook style: upright bold text with the
 * engineering unit, and a stacked fraction bar for MOS W/L.
 */
export function displayableInstanceValue(
  instance: InstanceValueSource,
): InstanceValueDisplay {
  const definition = deviceDescriptor(instance.symbolId);
  if (!definition) {
    return {
      kind: "undisplayable",
      reason: `Symbol ${instance.symbolId} has no netlist device class`,
    };
  }
  const width = definition.parameters.find(
    (parameter) => parameter.displayRole === "width",
  );
  const length = definition.parameters.find(
    (parameter) => parameter.displayRole === "length",
  );
  if (width || length) {
    const widthValue = width ? effectiveParameterValue(instance, width) : "";
    const lengthValue = length ? effectiveParameterValue(instance, length) : "";
    if (!widthValue || !lengthValue || !width || !length) {
      return {
        kind: "undisplayable",
        reason:
          definition.deviceClass === "mos"
            ? "MOS value needs both W and L"
            : `${definition.deviceClass} value needs both width and length`,
      };
    }
    // A parallel multiplier changes the device the drawing stands for, so it
    // is part of the value rather than a hidden parameter. One is the
    // implicit default and stays unwritten.
    const multiplier = definition.parameters.find(
      (parameter) => parameter.displayRole === "multiplier",
    );
    const multiplierValue = multiplier
      ? effectiveParameterValue(instance, multiplier)
      : "";
    const showsMultiplier =
      multiplierValue !== "" && Number(multiplierValue) !== 1;
    return {
      kind: "displayable",
      content: {
        runs: [
          {
            kind: "fraction",
            numerator: boldDocument(withUnit(widthValue, displayUnit(width))),
            denominator: boldDocument(
              withUnit(lengthValue, displayUnit(length)),
            ),
          },
          ...(showsMultiplier
            ? [
                {
                  kind: "span" as const,
                  style: "bold" as const,
                  children: [
                    { kind: "text" as const, value: ` ×${multiplierValue}` },
                  ],
                },
              ]
            : []),
        ],
      },
    };
  }
  const value = definition.parameters.find(
    (parameter) => parameter.displayRole === "value",
  );
  const valueText = value ? effectiveParameterValue(instance, value) : "";
  if (!value) {
    return {
      kind: "undisplayable",
      reason: `${definition.deviceClass} has no defined value display`,
    };
  }
  if (!valueText) {
    return {
      kind: "undisplayable",
      reason: `${definition.deviceClass} value parameter is empty`,
    };
  }
  return {
    kind: "displayable",
    content: boldDocument(withUnit(valueText, displayUnit(value))),
  };
}
