import type {
  DeviceDescriptor,
  DeviceDescriptorIssue,
  DeviceRegistry,
  DeviceSymbolContract,
} from "./contract.js";

export function validateDeviceDescriptors(
  descriptors: readonly DeviceDescriptor[],
): DeviceDescriptorIssue[] {
  const issues: DeviceDescriptorIssue[] = [];
  const seenIds = new Set<string>();
  const seenSymbolIds = new Set<string>();
  for (const descriptor of descriptors) {
    if (seenIds.has(descriptor.id)) {
      issues.push({
        deviceId: descriptor.id,
        message: "Duplicate device descriptor ID",
      });
    }
    seenIds.add(descriptor.id);
    if (seenSymbolIds.has(descriptor.symbolId)) {
      issues.push({
        deviceId: descriptor.id,
        message: `Duplicate device Symbol: ${descriptor.symbolId}`,
      });
    }
    seenSymbolIds.add(descriptor.symbolId);
    if (
      descriptor.referencePrefix !== null &&
      !/^[A-Z][A-Z0-9_]*$/u.test(descriptor.referencePrefix)
    ) {
      issues.push({
        deviceId: descriptor.id,
        message: `Invalid reference prefix: ${descriptor.referencePrefix}`,
      });
    }
    if (descriptor.pinOrder.length === 0) {
      issues.push({
        deviceId: descriptor.id,
        message: "A device descriptor requires at least one pin",
      });
    }
    const pinNames = new Set<string>();
    for (const pinName of descriptor.pinOrder) {
      if (pinNames.has(pinName)) {
        issues.push({
          deviceId: descriptor.id,
          message: `Duplicate device pin: ${pinName}`,
        });
      }
      pinNames.add(pinName);
    }
    if (descriptor.seriesInsertionPinPair) {
      const [first, second] = descriptor.seriesInsertionPinPair;
      if (first === second) {
        issues.push({
          deviceId: descriptor.id,
          message: "Series insertion pin pair must contain two distinct pins",
        });
      }
      for (const pinName of descriptor.seriesInsertionPinPair) {
        if (!pinNames.has(pinName)) {
          issues.push({
            deviceId: descriptor.id,
            message: `Series insertion references unknown pin: ${pinName}`,
          });
        }
      }
    }
    const semanticPins = new Set<string>();
    const semanticRoles = new Set<string>();
    for (const semantic of descriptor.pinSemantics ?? []) {
      if (!pinNames.has(semantic.pinName)) {
        issues.push({
          deviceId: descriptor.id,
          message: `Device pin semantic references unknown pin: ${semantic.pinName}`,
        });
      }
      if (semanticPins.has(semantic.pinName)) {
        issues.push({
          deviceId: descriptor.id,
          message: `Duplicate device pin semantic: ${semantic.pinName}`,
        });
      }
      semanticPins.add(semantic.pinName);
      if (semanticRoles.has(semantic.role)) {
        issues.push({
          deviceId: descriptor.id,
          message: `Duplicate device pin semantic role: ${semantic.role}`,
        });
      }
      semanticRoles.add(semantic.role);
    }
    if (descriptor.deviceClass !== "capacitor" && semanticRoles.size > 0) {
      issues.push({
        deviceId: descriptor.id,
        message: "Only capacitor devices may declare plate semantics",
      });
    }
    if (
      descriptor.deviceClass === "capacitor" &&
      (semanticPins.size !== 2 ||
        !semanticRoles.has("capacitor-top-plate") ||
        !semanticRoles.has("capacitor-bottom-plate"))
    ) {
      issues.push({
        deviceId: descriptor.id,
        message:
          "Capacitor devices must declare one top-plate and one bottom-plate pin semantic",
      });
    }
    const parameterNames = new Set<string>();
    const displayRoles = new Set<string>();
    for (const parameter of descriptor.parameters) {
      const parameterName = parameter.name;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(parameterName)) {
        issues.push({
          deviceId: descriptor.id,
          message: `Invalid parameter name: ${parameterName}`,
        });
      } else if (parameterNames.has(parameterName.toLowerCase())) {
        issues.push({
          deviceId: descriptor.id,
          message: `Duplicate parameter: ${parameterName}`,
        });
      }
      parameterNames.add(parameterName.toLowerCase());
      if (!parameter.label || !parameter.placeholder || !parameter.help) {
        issues.push({
          deviceId: descriptor.id,
          message: `Parameter ${parameterName} requires label, placeholder, and help`,
        });
      }
      if (
        (parameter.editor === "select" && !parameter.options?.length) ||
        (parameter.editor !== "select" && parameter.options !== undefined)
      ) {
        issues.push({
          deviceId: descriptor.id,
          message: `Parameter ${parameterName} select options must match its editor`,
        });
      }
      if (
        parameter.visibleForSourceWaveforms !== undefined &&
        descriptor.deviceClass !== "voltage-source" &&
        descriptor.deviceClass !== "current-source"
      ) {
        issues.push({
          deviceId: descriptor.id,
          message: `Only independent-source parameters may be waveform-specific: ${parameterName}`,
        });
      }
      if (
        parameter.displayRole !== "none" &&
        displayRoles.has(parameter.displayRole)
      ) {
        issues.push({
          deviceId: descriptor.id,
          message: `Duplicate display role: ${parameter.displayRole}`,
        });
      }
      if (parameter.displayRole !== "none") {
        displayRoles.add(parameter.displayRole);
      }
    }
    if (
      (descriptor.targetPolicy === "required-model") !==
      descriptor.capabilities.supportsModel
    ) {
      issues.push({
        deviceId: descriptor.id,
        message: "Model capability must match the target policy",
      });
    }
    if (
      descriptor.capabilities.supportsBulkBinding &&
      descriptor.deviceClass !== "mos"
    ) {
      issues.push({
        deviceId: descriptor.id,
        message: "Only MOS devices may support bulk binding",
      });
    }
    if (
      descriptor.sourceWaveformDefault !== undefined &&
      descriptor.deviceClass !== "voltage-source" &&
      descriptor.deviceClass !== "current-source"
    ) {
      issues.push({
        deviceId: descriptor.id,
        message: "Only independent sources may declare a waveform default",
      });
    }
    if (
      (descriptor.deviceClass === "voltage-source" ||
        descriptor.deviceClass === "current-source") &&
      descriptor.sourceWaveformDefault === undefined
    ) {
      issues.push({
        deviceId: descriptor.id,
        message: "Independent sources require a waveform default",
      });
    }
    if (
      descriptor.mosBulkClass !== undefined &&
      descriptor.deviceClass !== "mos"
    ) {
      issues.push({
        deviceId: descriptor.id,
        message: "Only MOS devices may declare a MOS bulk class",
      });
    }
    if (
      descriptor.deviceClass === "mos" &&
      descriptor.mosBulkClass === undefined
    ) {
      issues.push({
        deviceId: descriptor.id,
        message: "MOS devices must declare their bulk class",
      });
    }
    if (
      descriptor.capabilities.supportsBulkBinding &&
      !descriptor.pinOrder.includes("B")
    ) {
      issues.push({
        deviceId: descriptor.id,
        message: "A bulk-binding MOS device must expose the B pin",
      });
    }
    if (descriptor.deviceClass === "net-marker") {
      if (
        descriptor.referencePrefix !== null ||
        descriptor.capabilities.supportsModel ||
        descriptor.capabilities.supportsBulkBinding ||
        descriptor.capabilities.supportsValueAnnotation
      ) {
        issues.push({
          deviceId: descriptor.id,
          message: "Net markers cannot emit, model, bulk-bind, or own values",
        });
      }
    }
    if (
      descriptor.dialects.length !== 2 ||
      descriptor.dialects[0] !== "spice" ||
      descriptor.dialects[1] !== "spectre"
    ) {
      issues.push({
        deviceId: descriptor.id,
        message: "Built-in devices must declare SPICE and Spectre support",
      });
    }
  }
  return issues;
}

export function validateDeviceRegistry(
  registry: DeviceRegistry,
  symbols: readonly DeviceSymbolContract[],
): DeviceDescriptorIssue[] {
  const issues = validateDeviceDescriptors(registry.descriptors);
  const symbolsById = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  for (const descriptor of registry.descriptors) {
    const symbol = symbolsById.get(descriptor.symbolId);
    if (!symbol) {
      issues.push({
        deviceId: descriptor.id,
        message: `Device descriptor references an unknown Symbol: ${descriptor.symbolId}`,
      });
      continue;
    }
    const symbolPins = symbol.pins.map((pin) => pin.name);
    if (
      symbolPins.length !== descriptor.pinOrder.length ||
      symbolPins.some(
        (pinName, index) => pinName !== descriptor.pinOrder[index],
      )
    ) {
      issues.push({
        deviceId: descriptor.id,
        message: `Device pin order ${descriptor.pinOrder.join(",")} does not match Symbol pin order ${symbolPins.join(",")}`,
      });
    }
  }
  return issues;
}
