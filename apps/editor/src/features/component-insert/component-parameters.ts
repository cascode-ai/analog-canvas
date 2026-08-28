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
  compatibilityOnly?: boolean;
}

const TIME_SCALE_PS: Readonly<Record<string, number>> = {
  fs: 0.001,
  ps: 1,
  ns: 1_000,
  us: 1_000_000,
  ms: 1_000_000_000,
  s: 1_000_000_000_000,
};

function parseTimePs(raw: string | undefined): number | null {
  const match = /^([+]?(?:\d+(?:\.\d*)?|\.\d+))\s*(fs|ps|ns|us|ms|s)$/iu.exec(
    raw?.trim() ?? "",
  );
  if (!match) return null;
  const value = Number(match[1]) * TIME_SCALE_PS[match[2]!.toLowerCase()]!;
  const rounded = Math.round(value);
  return Number.isSafeInteger(rounded) && rounded > 0 ? rounded : null;
}

function legacyDutyCycle(parameters: Readonly<Record<string, string>>): string {
  const periodPs = parseTimePs(parameters.period);
  const widthPs = parseTimePs(parameters.width);
  if (!periodPs || !widthPs || widthPs >= periodPs) return "50";
  const percent = (widthPs / periodPs) * 100;
  return Number(percent.toFixed(6)).toString();
}

function synchronizeDigitalClockCompatibility(
  parameters: Record<string, string>,
): Record<string, string> {
  const periodPs = parseTimePs(parameters.period);
  const dutyCycle = Number(parameters.dutyCycle);
  const initial = parameters.initial;
  if (
    !periodPs ||
    !Number.isFinite(dutyCycle) ||
    dutyCycle <= 0 ||
    dutyCycle >= 100 ||
    (initial !== "0" && initial !== "1")
  ) {
    return parameters;
  }
  const highTimePs = Math.max(
    1,
    Math.min(periodPs - 1, Math.round((periodPs * dutyCycle) / 100)),
  );
  const lowTimePs = periodPs - highTimePs;
  return {
    ...parameters,
    low: initial,
    high: initial === "0" ? "1" : "0",
    delay: `${initial === "0" ? lowTimePs : highTimePs}ps`,
    rise: parameters.rise || "1ps",
    fall: parameters.fall || "1ps",
    width: `${initial === "0" ? highTimePs : lowTimePs}ps`,
  };
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
    ...(parameter.authoringVisibility === "compatibility"
      ? { compatibilityOnly: true }
      : {}),
  }));
}

export function updateComponentParameterValues(
  symbolId: string,
  current: Readonly<Record<string, string>>,
  key: string,
  value: string,
): Record<string, string> {
  const next = { ...current, [key]: value };
  return symbolId === "pulse-voltage-source"
    ? synchronizeDigitalClockCompatibility(next)
    : next;
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
  if (instance.symbolId === "pulse-voltage-source") {
    const parameters = instance.netlist?.parameters ?? {};
    if (parameter.key === "dutyCycle") return legacyDutyCycle(parameters);
    if (parameter.key === "initial") return parameters.low === "1" ? "1" : "0";
  }
  return "";
}
