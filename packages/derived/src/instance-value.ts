import type { CircuitProject, Instance, RichTextDocument } from "@icm/model";
import {
  parameterDisplayContract,
  type InstanceParameterResolver,
  type ParameterOwner,
  referencePolicyForInstance,
  type DeviceParameterDefinition,
} from "@icm/devices";

export type InstanceValueDisplay =
  | { readonly kind: "displayable"; readonly content: RichTextDocument }
  | { readonly kind: "undisplayable"; readonly reason: string };

/**
 * Structural input: a full Instance satisfies it, and callers can project a
 * not-yet-committed parameter draft without inventing netlist fields the
 * formatter never reads.
 */
export interface InstanceValueSource extends ParameterOwner {
  readonly symbolId: string;
  readonly netlist?:
    | {
        readonly parameters: Record<string, string>;
        readonly binding?: NonNullable<ParameterOwner["netlist"]>["binding"];
      }
    | undefined;
}

function effectiveParameterValue(
  instance: InstanceValueSource,
  parameter: DeviceParameterDefinition,
): string {
  const netlist = instance.netlist?.parameters[parameter.name];
  if (netlist !== undefined) return netlist.trim();
  return "";
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
 * A magnetic device's parameter under its textbook name: the letter, then
 * the rest as its subscript (L₁, L₂, C_B, L_p), followed by any value. A
 * one-letter name such as K stays as it is.
 */
function magneticParameterDocument(label: string, rest = ""): RichTextDocument {
  const match = /^([A-Za-z])([A-Za-z0-9]+)$/u.exec(label);
  if (!match) return boldDocument(`${label}${rest}`);
  return {
    runs: [
      {
        kind: "span",
        style: "bold",
        children: [
          { kind: "text", value: match[1]! },
          {
            kind: "span",
            style: "subscript",
            children: [{ kind: "text", value: match[2]! }],
          },
          ...(rest ? [{ kind: "text" as const, value: rest }] : []),
        ],
      },
    ],
  };
}

/** Whether the actual model has a summary, even when its values are still empty. */
export function instanceSupportsValueAnnotation(
  instance: ParameterOwner,
  resolver?: InstanceParameterResolver,
): boolean {
  return parameterDisplayContract(instance, resolver).summary !== "none";
}

export function magneticDisplayParameters(
  symbolId: string,
): readonly DeviceParameterDefinition[] {
  const contract = parameterDisplayContract({ symbolId });
  return contract.magnetic ? contract.individual : [];
}

export function instanceDisplayParameters(
  instance: ParameterOwner,
  resolver?: InstanceParameterResolver,
): readonly DeviceParameterDefinition[] {
  return parameterDisplayContract(instance, resolver).individual;
}

/** Preserve authored values and units while identifying which parameter is shown. */
export function displayableInstanceParameter(
  instance: InstanceValueSource,
  name: string,
  options: { showValue?: boolean } = {},
  resolver?: InstanceParameterResolver,
): InstanceValueDisplay {
  const contract = parameterDisplayContract(instance, resolver);
  const parameter = contract.definitions.find(
    (candidate) => candidate.name.toLowerCase() === name.toLowerCase(),
  );
  if (!parameter)
    return {
      kind: "undisplayable",
      reason: `Parameter ${name} is not declared by this model`,
    };
  const label = parameter.label;
  const multiplier = parameter?.displayRole === "multiplier";
  const magnetic = contract.magnetic;
  const named = (rest = "") =>
    magnetic
      ? magneticParameterDocument(label, rest)
      : boldDocument(`${label}${rest}`);
  // A multiplier reads as a count of devices, "×8", not "M = 8".
  const counted = (value: string) =>
    multiplier ? boldDocument(`×${value}`) : named(` = ${value}`);
  if (options.showValue === false) {
    return {
      kind: "displayable",
      content: named(),
    };
  }
  const value = Object.entries(instance.netlist?.parameters ?? {})
    .find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]
    .trim();
  if (!value)
    return { kind: "undisplayable", reason: `Parameter ${name} is empty` };
  return {
    kind: "displayable",
    content: counted(value),
  };
}

/**
 * Whether this Instance gets a reference designator, by the policy that
 * names it. A placed Cell's block is derived per Project, so its Symbol has
 * no designator of its own, yet the Cell instance is X1 in the netlist; a
 * person probing `v(xdut.x1.net0)` needs to show it (#1317).
 */
export function instanceCarriesReference(
  instance: Instance,
  project?: Pick<CircuitProject, "componentDefinitions">,
): boolean {
  return referencePolicyForInstance(instance, project).kind !== "none";
}

/**
 * Whether a part's value prints this parameter as its ×m: a MOS's W/L does
 * (#752), so its own ×m label is wanted only while the W/L is hidden.
 */
export function valuePrintsMultiplier(
  instance: ParameterOwner | undefined,
  parameterName: string,
  resolver?: InstanceParameterResolver,
): boolean {
  const parameters = instance
    ? parameterDisplayContract(instance, resolver).definitions
    : [];
  return (
    parameters.some(
      (parameter) =>
        parameter.displayRole === "multiplier" &&
        parameter.name.toLowerCase() === parameterName.toLowerCase(),
    ) && parameters.some((parameter) => parameter.displayRole === "width")
  );
}

/**
 * The multiplier a part's W/L prints after its fraction once it has W and
 * L, or undefined. A parallel multiplier changes the device the drawing
 * stands for, so it is part of the value rather than a hidden parameter.
 * One is the implicit default and stays unwritten.
 */
export function printedValueMultiplier(
  instance: InstanceValueSource,
  resolver?: InstanceParameterResolver,
): string | undefined {
  const multiplier = parameterDisplayContract(
    instance,
    resolver,
  ).definitions.find((parameter) => parameter.displayRole === "multiplier");
  if (
    !multiplier ||
    !valuePrintsMultiplier(instance, multiplier.name, resolver)
  )
    return undefined;
  const value = effectiveParameterValue(instance, multiplier);
  return value !== "" && Number(value) !== 1 ? value : undefined;
}

export function displayableInstanceValue(
  instance: InstanceValueSource,
  resolver?: InstanceParameterResolver,
): InstanceValueDisplay {
  const contract = parameterDisplayContract(instance, resolver);
  const definition = {
    parameters: contract.definitions,
    deviceClass: instance.symbolId,
  };
  if (!contract.definitions.length) {
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
    const multiplierValue = printedValueMultiplier(instance, resolver);
    if (contract.summary === "geometry")
      return {
        kind: "displayable",
        content: boldDocument(
          `W=${widthValue} L=${lengthValue}${multiplierValue !== undefined ? ` ×${multiplierValue}` : ""}`,
        ),
      };
    return {
      kind: "displayable",
      content: {
        runs: [
          {
            kind: "fraction",
            numerator: boldDocument(widthValue),
            denominator: boldDocument(lengthValue),
          },
          ...(multiplierValue !== undefined
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
    content: boldDocument(valueText),
  };
}
