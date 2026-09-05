import type { NetlistDeviceClass, StableId } from "@icm/model";

export type DeviceNetlistTargetPolicy =
  "builtin" | "required-model" | "child-cell" | "none";

/** Cell-default body binding follows channel polarity, not Symbol spelling. */
export type MosBulkClass = "nmos" | "pmos";

export interface DeviceCapabilities {
  readonly supportsModel: boolean;
  readonly supportsBulkBinding: boolean;
  readonly supportsValueAnnotation: boolean;
}

export interface DeviceParameterDefinition {
  readonly name: string;
  readonly label: string;
  readonly required: boolean;
  readonly editor: "text" | "decimal";
  readonly unitHint?: string;
  readonly placeholder: string;
  readonly help: string;
  /**
   * Compatibility parameters remain persisted and exported but are not part
   * of the ordinary component authoring surface. An absent value is primary.
   */
  readonly authoringVisibility?: "primary" | "compatibility";
  /**
   * Value a newly placed instance starts with. It is written into the typed
   * netlist like any authored value — the schematic and the exported netlist
   * must never disagree — so a device that needs geometry to be meaningful
   * arrives complete instead of blocking its own value display.
   */
  readonly defaultValue?: string;
  readonly displayRole:
    "value" | "width" | "length" | "multiplier" | "finger-count" | "none";
}

/**
 * Device-owned terminal meaning that is recovered from a stable Symbol pin.
 * This is descriptor metadata, never Project JSON or a dialect parameter.
 */
export type DevicePinSemanticRole =
  "capacitor-top-plate" | "capacitor-bottom-plate";

export interface DevicePinSemantic {
  readonly pinName: string;
  readonly role: DevicePinSemanticRole;
}

export interface DeviceDescriptor {
  /** Stable device-protocol identity; it is not persisted in Project JSON. */
  readonly id: string;
  /** The exact current Symbol artwork this device uses. */
  readonly symbolId: StableId;
  readonly deviceClass: NetlistDeviceClass;
  /** Present for every built-in MOS family, including expanded DMOS artwork. */
  readonly mosBulkClass?: MosBulkClass;
  readonly referencePrefix: string | null;
  readonly pinOrder: readonly string[];
  /**
   * The two stable terminals that may replace a conductor span when both
   * exact pin contacts land on one ordinary Route. Multi-pin devices must
   * declare this explicitly so placement never guesses from symbol bounds or
   * from whichever two pins happen to be near a wire.
   */
  readonly seriesInsertionPinPair?: readonly [string, string];
  /** Optional fixed semantics for canonical pins; pin order remains electrical authority. */
  readonly pinSemantics?: readonly DevicePinSemantic[];
  readonly targetPolicy: DeviceNetlistTargetPolicy;
  /** Default transient intent projected when an older source has no explicit waveform. */
  readonly sourceWaveformDefault?: "dc" | "pulse" | "sin";
  /** Ordered authoring metadata; placeholders never create persisted values. */
  readonly parameters: readonly DeviceParameterDefinition[];
  readonly dialects: readonly ["spice", "spectre"];
  readonly capabilities: DeviceCapabilities;
}

export function requiredParameterNames(
  descriptor: DeviceDescriptor,
): readonly string[] {
  return descriptor.parameters
    .filter((parameter) => parameter.required)
    .map((parameter) => parameter.name);
}

/** Look up a device-owned semantic role without copying it into Project state. */
export function devicePinSemanticRole(
  descriptor: DeviceDescriptor,
  pinName: string,
): DevicePinSemanticRole | undefined {
  return descriptor.pinSemantics?.find(
    (semantic) => semantic.pinName === pinName,
  )?.role;
}

export interface DeviceDescriptorIssue {
  readonly deviceId: string;
  readonly message: string;
}

/** Minimal visual contract used only to validate registry/Symbol parity. */
export interface DeviceSymbolContract {
  readonly id: string;
  readonly pins: readonly { readonly name: string }[];
}

export interface DeviceRegistry {
  readonly descriptors: readonly DeviceDescriptor[];
  byId(id: string): DeviceDescriptor | undefined;
  bySymbolId(symbolId: string): DeviceDescriptor | undefined;
}
