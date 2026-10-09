// A primitive device as its card: model target, parameters, the controls
// of a controlled source, and the built-in Zener model's name.
import { drawnMagneticNetwork, drawnSwitchControl } from "@icm/derived";
import type {
  CircuitProject,
  Instance,
  SchematicDocument,
  StableId,
} from "@icm/model";
import {
  deviceDescriptor,
  milliScaleReading,
  requiredParameterNames,
  reviewedExternalBindingForMaster,
} from "@icm/devices";
import { parseSpiceNumber } from "@icm/spice";
import type { DesignNetlistInstance, NetlistDiagnostic } from "./ir.js";
import { normalizeIndependentSource } from "./source-waveform.js";
import {
  type ResolvedDesignNetlistAnalysisOptions,
  isIdentifier,
  compareText,
  diagnostic,
} from "./extract-common.js";
import { type CellNetContext, terminalNetName } from "./extract-nets.js";
import { extractDrawnSwitch } from "./extract-switch.js";
import { extractDrawnMagnetic } from "./extract-magnetic.js";

export function builtInZenerModelName(reference: string): string {
  return `icm_zener_${reference}`;
}

export function zenerParameter(
  instance: Instance,
  name: "bv" | "ibv",
): string | undefined {
  return Object.entries(instance.netlist?.parameters ?? {}).find(
    ([candidate]) => candidate.toLowerCase() === name,
  )?.[1];
}

export function extractDeviceInstance(
  project: CircuitProject,
  document: SchematicDocument,
  instance: Instance,
  context: CellNetContext,
  options: ResolvedDesignNetlistAnalysisOptions,
  diagnostics: NetlistDiagnostic[],
): DesignNetlistInstance | null {
  const definition = deviceDescriptor(instance.symbolId, project);
  if (!definition) {
    diagnostic(
      diagnostics,
      document.id,
      "MISSING_DEVICE_DEFINITION",
      `Symbol ${instance.symbolId} has no reviewed netlist definition`,
      [instance.id],
    );
    return null;
  }
  if (definition.deviceClass === "net-marker") {
    const markerNet = context.netByTerminal.get(
      `${instance.id}\u0000${definition.pinOrder[0]}`,
    );
    if (!markerNet || !markerNet.name) {
      diagnostic(
        diagnostics,
        document.id,
        "INVALID_NET_MARKER",
        `Net marker ${instance.id} must connect to one valid Net`,
        [instance.id],
      );
    } else if (
      instance.symbolId === "ground" &&
      (markerNet.scope !== "global" || markerNet.name !== "0")
    ) {
      diagnostic(
        diagnostics,
        document.id,
        "GROUND_NAME_MISMATCH",
        `Ground marker must connect to global Net 0, not ${markerNet.scope} Net ${markerNet.name}`,
        [instance.id, markerNet.id],
      );
    } else if (
      instance.symbolId === "vdd-port" &&
      markerNet.powerDomain !== "vdd"
    ) {
      diagnostic(
        diagnostics,
        document.id,
        "INVALID_NET_MARKER",
        `VDD Port ${instance.id} must connect to an explicitly classified VDD Net`,
        [instance.id, markerNet.id],
      );
    }
    return null;
  }
  const switchControl = drawnSwitchControl(definition);
  if (switchControl)
    return extractDrawnSwitch(
      document,
      instance,
      definition,
      switchControl,
      context,
      options,
      diagnostics,
    );
  const magnetic = drawnMagneticNetwork(definition);
  if (magnetic)
    return extractDrawnMagnetic(
      document,
      instance,
      definition,
      magnetic,
      context,
      diagnostics,
    );
  // A device the registry designates but gives no netlist target is drawing
  // only, such as a single-pole double-throw selector, which SPICE has no
  // primitive for. Say so and emit nothing. Falling through would reach the
  // printer with a null target where the model name belongs, and it throws
  // there.
  if (definition.targetPolicy === "none") {
    diagnostic(
      diagnostics,
      document.id,
      "NON_NETLISTABLE_DEVICE",
      `Symbol ${instance.symbolId} is drawing-only and has no netlist form`,
      [instance.id],
    );
    return null;
  }
  // A device whose authoring data was never written binds nothing and sets no
  // parameter — which is what an empty record says. Older Projects, imports
  // and Agent-authored instances reach here without one. Reading that state as
  // empty lets extraction report the specific missing model and parameters.
  const netlist = instance.netlist ?? { parameters: {} };
  if (!isIdentifier(instance.reference!)) {
    diagnostic(
      diagnostics,
      document.id,
      "INVALID_INSTANCE_REFERENCE",
      `Instance reference is outside the portable identifier subset: ${instance.reference!}`,
      [instance.id],
    );
  }
  if (definition.targetPolicy === "required-model") {
    const hasBuiltInZener =
      definition.symbolId === "zener-diode" &&
      netlist.binding === undefined &&
      Boolean(zenerParameter(instance, "bv")?.trim());
    if (netlist.binding?.kind !== "model" && !hasBuiltInZener) {
      diagnostic(
        diagnostics,
        document.id,
        "MISSING_MODEL_TARGET",
        definition.symbolId === "zener-diode"
          ? `Instance ${instance.reference!} requires an external model or a positive BV for a built-in Zener model`
          : `Instance ${instance.reference!} requires an explicit model target`,
        [instance.id],
      );
    } else if (
      netlist.binding?.kind === "model" &&
      netlist.binding.deviceClass !== definition.deviceClass
    ) {
      diagnostic(
        diagnostics,
        document.id,
        "DEVICE_CLASS_MISMATCH",
        `Binding class ${netlist.binding.deviceClass} does not match ${definition.deviceClass}`,
        [instance.id],
      );
    } else if (
      netlist.binding?.kind === "model" &&
      reviewedExternalBindingForMaster(netlist.binding.name)
    ) {
      // SKY130's devices are subcircuits called on X lines. A model card of
      // that name, which older placements and imports wrote, is one the
      // SKY130 simulation profile cannot run (#1249).
      const name = netlist.binding.name;
      diagnostic(
        diagnostics,
        document.id,
        "REVIEWED_DEVICE_AS_MODEL_CARD",
        `${instance.reference!} names ${name} as a model card, but ${name} is a subcircuit in its process library, so the SKY130 simulation cannot run this line. Choose the model again in Properties, or Apply process, to call it as X${instance.reference!}.`,
        [instance.id],
        "warning",
      );
    }
  } else if (
    definition.targetPolicy === "builtin" &&
    netlist.binding !== undefined &&
    (netlist.binding.kind !== "primitive" ||
      netlist.binding.deviceClass !== definition.deviceClass)
  ) {
    diagnostic(
      diagnostics,
      document.id,
      "DEVICE_CLASS_MISMATCH",
      `Instance ${instance.reference!} requires primitive class ${definition.deviceClass}`,
      [instance.id],
    );
  }
  const parameterByFoldedName = new Map<
    string,
    { name: string; rawValue: string }
  >();
  for (const [parameter, rawValue] of Object.entries(netlist.parameters)) {
    const folded = parameter.toLowerCase();
    const prior = parameterByFoldedName.get(folded);
    if (prior) {
      diagnostic(
        diagnostics,
        document.id,
        "DUPLICATE_PARAMETER_NAME",
        `Parameter ${parameter} duplicates parameter ${prior.name} under case folding`,
        [instance.id],
      );
    } else {
      parameterByFoldedName.set(folded, { name: parameter, rawValue });
    }
  }
  for (const parameter of requiredParameterNames(definition)) {
    if (!parameterByFoldedName.get(parameter.toLowerCase())?.rawValue.trim()) {
      diagnostic(
        diagnostics,
        document.id,
        "MISSING_REQUIRED_PARAMETER",
        `Instance ${instance.reference!} requires parameter ${parameter}`,
        [instance.id],
        "error",
        parameter,
      );
    }
  }
  for (const parameter of Object.keys(netlist.parameters)) {
    if (!isIdentifier(parameter)) {
      diagnostic(
        diagnostics,
        document.id,
        "INVALID_PARAMETER_NAME",
        `Parameter name is outside the portable identifier subset: ${parameter}`,
        [instance.id],
      );
    }
  }
  // A value SPICE reads as milli where mega was almost surely meant (#1409):
  // it exports as written, and the netlist says so.
  for (const [parameter, rawValue] of Object.entries(netlist.parameters)) {
    const reading = milliScaleReading(rawValue);
    if (reading)
      diagnostic(
        diagnostics,
        document.id,
        "MILLI_SCALE_VALUE",
        `${instance.reference!}'s ${parameter} "${rawValue.trim()}" ${reading}`,
        [instance.id],
        "warning",
        parameter,
      );
  }
  const nodes = definition.pinOrder.flatMap((pinName) => {
    const netName = terminalNetName(
      document,
      instance,
      pinName,
      context,
      diagnostics,
    );
    return [{ pinName, netName: netName ?? `<unconnected:${pinName}>` }];
  });
  const controlled = definition.deviceClass;
  let controlSourceInstanceId: StableId | undefined;
  let controlTerminal: DesignNetlistInstance["controlTerminal"];
  if (controlled === "vcvs" || controlled === "vccs") {
    const control = netlist.control;
    if (
      control?.kind !== "voltage" ||
      !control.positiveNetId ||
      !control.negativeNetId
    ) {
      diagnostic(
        diagnostics,
        document.id,
        "MISSING_CONTROL_NET",
        `Instance ${instance.reference!} requires two selected control Nets`,
        [instance.id],
      );
    } else {
      for (const [pinName, side, netId] of [
        ["CTRL+", "+", control.positiveNetId],
        ["CTRL-", "−", control.negativeNetId],
      ] as const) {
        const netName = context.nameByNetId.get(netId);
        if (!netName)
          diagnostic(
            diagnostics,
            document.id,
            "INVALID_CONTROL_NET",
            `${instance.reference!} senses a control Net (${side}) that is no longer in this Cell (${netId}); select ${instance.reference!}'s control Nets again`,
            [instance.id, netId],
          );
        nodes.push({ pinName, netName: netName ?? `<unconnected:${pinName}>` });
      }
    }
  } else if (controlled === "cccs" || controlled === "ccvs") {
    const control = netlist.control;
    if (control?.kind === "terminal-current") {
      if (!control.instanceId || !control.pinName) {
        diagnostic(
          diagnostics,
          document.id,
          "MISSING_CONTROL_TERMINAL",
          `Instance ${instance.reference!} requires a selected device terminal`,
          [instance.id],
        );
      } else {
        controlTerminal = {
          instanceId: control.instanceId,
          pinName: control.pinName,
          direction: control.direction,
        };
      }
    } else if (control?.kind !== "current" || !control.sensorInstanceId) {
      diagnostic(
        diagnostics,
        document.id,
        "MISSING_CONTROL_SENSOR",
        `Instance ${instance.reference!} requires a selected voltage-source current sensor`,
        [instance.id],
      );
    } else {
      const sensor = document.instances.find(
        (candidate) => candidate.id === control.sensorInstanceId,
      );
      if (
        !sensor ||
        deviceDescriptor(sensor.symbolId, project)?.deviceClass !==
          "voltage-source"
      )
        diagnostic(
          diagnostics,
          document.id,
          "INVALID_CONTROL_SENSOR",
          `Control sensor ${control.sensorInstanceId} must be a voltage source in this Cell`,
          [instance.id, control.sensorInstanceId],
        );
      else controlSourceInstanceId = sensor.id;
    }
  }
  const target =
    netlist.binding?.kind === "model"
      ? netlist.binding.name
      : definition.symbolId === "zener-diode" &&
          netlist.binding === undefined &&
          zenerParameter(instance, "bv")?.trim()
        ? builtInZenerModelName(instance.reference!)
        : null;
  if (target && !isIdentifier(target)) {
    diagnostic(
      diagnostics,
      document.id,
      "INVALID_TARGET_NAME",
      `Model target is outside the portable identifier subset: ${target}`,
      [instance.id],
    );
  }
  const authoredParameters = Object.entries(netlist.parameters)
    .sort(([a], [b]) => compareText(a, b))
    .map(([name, rawValue]) => ({ name, rawValue }));
  if (definition.symbolId === "zener-diode") {
    const modelParameters = authoredParameters.filter((parameter) =>
      ["bv", "ibv"].includes(parameter.name.toLowerCase()),
    );
    if (netlist.binding?.kind === "model" && modelParameters.length) {
      diagnostic(
        diagnostics,
        document.id,
        "ZENER_MODEL_PARAMETER_CONFLICT",
        `Instance ${instance.reference!} cannot set BV or IBV alongside an external model; put those values in that model instead`,
        [instance.id],
      );
    }
    if (netlist.binding?.kind !== "model") {
      if (target && options.format !== "spice") {
        diagnostic(
          diagnostics,
          document.id,
          "ZENER_BUILTIN_SPICE_ONLY",
          `Instance ${instance.reference!} uses a generated ngspice Zener model; select SPICE or bind a Spectre model explicitly`,
          [instance.id],
        );
      }
      for (const parameter of modelParameters) {
        const parsed = parseSpiceNumber(parameter.rawValue.trim());
        if (
          parsed !== null &&
          Number.isFinite(parsed.value) &&
          parsed.value > 0
        )
          continue;
        diagnostic(
          diagnostics,
          document.id,
          "INVALID_ZENER_MODEL_PARAMETER",
          `Instance ${instance.reference!} requires positive numeric ${parameter.name.toUpperCase()}`,
          [instance.id],
          "error",
          parameter.name,
        );
      }
    }
  }
  const projectedParameters =
    definition.deviceClass === "voltage-source" ||
    definition.deviceClass === "current-source"
      ? normalizeIndependentSource(
          authoredParameters,
          definition.sourceWaveformDefault ?? "dc",
        )
      : null;
  for (const issue of projectedParameters?.issues ?? []) {
    diagnostic(
      diagnostics,
      document.id,
      issue.code,
      `Instance ${instance.reference!}: ${issue.message}`,
      [instance.id],
    );
  }
  return {
    id: instance.id,
    reference: instance.reference!,
    invocationKind: "primitive",
    deviceClass: definition.deviceClass,
    target,
    nodes,
    parameters: projectedParameters
      ? [...projectedParameters.parameters]
      : definition.symbolId === "zener-diode"
        ? authoredParameters.filter(
            (parameter) =>
              !["bv", "ibv"].includes(parameter.name.toLowerCase()),
          )
        : authoredParameters,
    ...(controlSourceInstanceId ? { controlSourceInstanceId } : {}),
    ...(controlTerminal ? { controlTerminal } : {}),
  };
}
