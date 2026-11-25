import type { CircuitProject, Instance } from "@icm/model";
import { deviceDescriptor, instanceParameterContract } from "@icm/devices";

export interface ComponentParameter {
  key: string;
  label: string;
  unit?: string;
  placeholder: string;
  defaultValue?: string;
  help: string;
  inputMode?: "decimal" | "text";
  options?: readonly { readonly value: string; readonly label: string }[];
  visibleForSourceWaveforms?: readonly ("pulse" | "sin" | "pwl")[];
  compatibilityOnly?: boolean;
  /** The value belongs to the called definition unless this instance overrides it. */
  definitionParameter?: boolean;
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
  instance?: Instance,
  project: Partial<
    Pick<
      CircuitProject,
      "componentDefinitions" | "externalSubcircuitDefinitions" | "documents"
    >
  > = {},
): readonly ComponentParameter[] {
  return (
    instanceParameterContract(project, instance ?? { symbolId })?.definitions ??
    []
  ).map((parameter) => ({
    key: parameter.name,
    label: parameter.label,
    ...(parameter.unitHint ? { unit: parameter.unitHint } : {}),
    placeholder: parameter.placeholder,
    ...(parameter.defaultValue ? { defaultValue: parameter.defaultValue } : {}),
    help: parameter.help,
    ...(parameter.editor === "select"
      ? parameter.options
        ? { options: parameter.options }
        : {}
      : { inputMode: parameter.editor }),
    ...(parameter.visibleForSourceWaveforms
      ? { visibleForSourceWaveforms: parameter.visibleForSourceWaveforms }
      : {}),
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

const IC_PDK_PATTERN = /(?:sky130|sg13g2|gpdk045|ics55)/iu;

/**
 * Default DC bias current when placing a `current-source` into an IC MOSFET /
 * PDK Project (#2614). Discrete and legacy Projects retain the catalog `"1m"`.
 */
export const IC_MOS_CURRENT_SOURCE_DEFAULT_DC = "10u";

export type PlacementProjectContext = Partial<
  Pick<CircuitProject, "documents" | "simulationFolders" | "modelSources">
>;

/** Whether a Project draws MOSFETs or references an integrated-circuit PDK. */
export function projectUsesIcMosfets(
  project?: PlacementProjectContext,
): boolean {
  if (!project) return false;
  if (
    project.documents?.some((document) =>
      document.instances.some(
        (instance) =>
          deviceDescriptor(instance.symbolId)?.deviceClass === "mos",
      ),
    )
  ) {
    return true;
  }
  if (
    project.simulationFolders?.some((folder) => {
      const configPath = folder.input.configPath ?? "experiment.json";
      const configFile = folder.input.files.find(
        (file) => file.path === configPath,
      );
      return Boolean(configFile && IC_PDK_PATTERN.test(configFile.text));
    })
  ) {
    return true;
  }
  return (
    project.modelSources?.some(
      (source) =>
        IC_PDK_PATTERN.test(source.entry) ||
        source.files.some((file) => IC_PDK_PATTERN.test(file.path)),
    ) ?? false
  );
}

/**
 * Placement seeds each parameter with its device default. A MOS placed with no
 * geometry could not display a value at all, so its Value toggle stayed
 * disabled until every field was typed by hand. When placing a current source
 * into an IC MOSFET / PDK Project, seed `dc` at 10u instead of 1m (#2614)
 * without migrating existing saved drawings.
 */
export function initialComponentParameterValues(
  symbolId: string,
  project?: PlacementProjectContext,
): Record<string, string> {
  const values = Object.fromEntries(
    componentParameters(symbolId).map((parameter) => [
      parameter.key,
      parameter.defaultValue ?? "",
    ]),
  );
  if (symbolId === "current-source" && projectUsesIcMosfets(project)) {
    values.dc = IC_MOS_CURRENT_SOURCE_DEFAULT_DC;
  }
  return values;
}

export function effectiveComponentParameterValue(
  instance: Instance,
  parameter: ComponentParameter,
): string {
  const netlist = instance.netlist?.parameters[parameter.key];
  if (netlist !== undefined) return netlist;
  const modelParameter = instanceParameterContract(
    {},
    instance,
  )?.definitions.find((p) => p.name === parameter.key);
  if (
    modelParameter?.defaultValue !== undefined &&
    !deviceDescriptor(instance.symbolId)
  )
    return modelParameter.defaultValue;
  if (parameter.key === "waveform")
    return deviceDescriptor(instance.symbolId)?.sourceWaveformDefault ?? "";
  if (instance.symbolId === "pulse-voltage-source") {
    const parameters = instance.netlist?.parameters ?? {};
    if (parameter.key === "dutyCycle") return legacyDutyCycle(parameters);
    if (parameter.key === "initial") return parameters.low === "1" ? "1" : "0";
  }
  return "";
}
