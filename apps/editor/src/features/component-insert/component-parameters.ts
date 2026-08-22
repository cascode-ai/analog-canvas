import type { Instance } from "@icm/model";
import { deviceDescriptor } from "@icm/devices";

export interface ComponentParameter {
  key: string;
  label: string;
  unit?: string;
  placeholder: string;
  defaultValue?: string;
  help: string;
  inputMode?: "decimal" | "text";
}

export function componentParameters(
  symbolId: string,
): readonly ComponentParameter[] {
  return (deviceDescriptor(symbolId)?.parameters ?? []).map((parameter) => ({
    key: parameter.name,
    label: parameter.label,
    ...(parameter.unitHint ? { unit: parameter.unitHint } : {}),
    placeholder: parameter.placeholder,
    ...(parameter.defaultValue ? { defaultValue: parameter.defaultValue } : {}),
    help: parameter.help,
    inputMode: parameter.editor,
  }));
}

/**
 * An external subcircuit call carries geometry and its finger count, but not
 * the parallel multiplier — that belongs to the primitive device. NF is an
 * ordinary MOS parameter now, so this only drops the multiplier.
 */
export function externalMosComponentParameters(
  symbolId: "nmos" | "pmos",
): readonly ComponentParameter[] {
  return componentParameters(symbolId).filter(
    (parameter) => parameter.key !== "m",
  );
}

/**
 * Placement seeds each parameter with its device default. A MOS placed with no
 * geometry could not display a value at all, so its Value toggle stayed
 * disabled until every field was typed by hand.
 */
export function initialComponentParameterValues(
  symbolId: string,
): Record<string, string> {
  return Object.fromEntries(
    componentParameters(symbolId).map((parameter) => [
      parameter.key,
      parameter.defaultValue ?? "",
    ]),
  );
}

export function effectiveComponentParameterValue(
  instance: Instance,
  parameter: ComponentParameter,
): string {
  const netlist = instance.netlist?.parameters[parameter.key];
  if (netlist !== undefined) return netlist;
  return "";
}
