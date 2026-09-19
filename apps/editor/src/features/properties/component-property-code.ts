import { magneticDisplayParameters } from "@icm/derived";
import type { Rotation, SchematicDocument } from "@icm/model";
import {
  componentPropertyDetailsValue,
  parseComponentPropertyDetails,
  type ComponentPropertyDetailsContext,
  type ComponentPropertyDetailsValue,
} from "./component-property-details";
import {
  CANVAS_PROPERTY_FIELDS,
  ROTATION_OPTIONS,
  MIRROR_OPTIONS,
  colorToRgb,
  parseCanvasColor,
} from "./component-property-fields";
import {
  componentInputPolarity,
  componentInputsSwapped,
  componentInternalMark,
  componentOutputsSwapped,
  NO_INTERNAL_MARK,
} from "./component-visual-variants";

type Instance = SchematicDocument["instances"][number];

export type ComponentPropertyColor = "auto" | `#${string}`;

export interface ComponentPropertyPlacementCode {
  coordinate: [number, number];
  rotation: Rotation;
  mirror: "none" | "horizontal" | "vertical" | "both";
}

export interface ComponentPropertyDisplayCode {
  visualAnnotation?: boolean;
  value?: boolean;
  parameters?: Record<string, boolean>;
}

export interface ComponentPropertyCodeValue extends ComponentPropertyDetailsValue {
  /** Electrical role of VDD Power; absent for every other component. */
  connection?: "cell-pin" | "global";
  /** Global Net name owned by a supply marker. */
  netName?: string;
  /** Visual instance annotation, independent from the exported netlist name. */
  displayName?: string;
  placement: ComponentPropertyPlacementCode | null;
  display?: ComponentPropertyDisplayCode;
  appearance: {
    color: ComponentPropertyColor;
    internalMark?: string;
    inputPolarity?: boolean;
    inputsSwapped?: boolean;
    outputsSwapped?: boolean;
  };
}

export interface ComponentPropertyCodeContext {
  instance: Instance;
  /** Null when this component has no independently editable instance label. */
  displayName?: string | null;
  referenceVisible: boolean | null;
  valueVisible: boolean | null;
  parameterVisibility?: Record<string, boolean>;
  /** Null when this component is not VDD Power. */
  connection?: "cell-pin" | "global" | null;
  /** Null when this component does not own an editable electrical marker name. */
  netName?: string | null;
  details?: ComponentPropertyDetailsContext;
}

export type ComponentPropertyCodeParseResult =
  | { ok: true; value: ComponentPropertyCodeValue }
  | { ok: false; message: string };

const ROOT_KEYS = new Set([
  "placement",
  "display",
  "displayName",
  "appearance",
  "connection",
  "netName",
  "netlistName",
  "parameters",
  "netlistTarget",
  "symbol",
  "signalFlow",
]);
const fieldKeys = (group: string) =>
  new Set(
    CANVAS_PROPERTY_FIELDS.filter((field) =>
      field.path.startsWith(`${group}.`),
    ).map((field) => field.path.split(".")[1]!),
  );
const PLACEMENT_KEYS = fieldKeys("placement");
const APPEARANCE_KEYS = fieldKeys("appearance");

function formattedColor(value: string | undefined): ComponentPropertyColor {
  return (value ?? "auto") as ComponentPropertyColor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unexpectedKey(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
): string | null {
  const key = Object.keys(value).find((candidate) => !allowed.has(candidate));
  return key ? `${path}.${key} is not a supported property` : null;
}

function parsePlacement(
  value: unknown,
  currentlyPlaced: boolean,
): ComponentPropertyPlacementCode | null {
  if (value === null) {
    // A drawn device never leaves the sheet: the schematic is what it shows.
    // An Instance that is already off-sheet keeps reading back as null, so
    // editing its other properties stays possible.
    if (currentlyPlaced) {
      throw new Error(
        "placement cannot be changed to null; a Cell never holds a device its drawing does not show",
      );
    }
    return null;
  }
  if (!isRecord(value)) throw new Error("placement must be an object");
  const unknown = unexpectedKey(value, PLACEMENT_KEYS, "placement");
  if (unknown) throw new Error(unknown);
  const coordinate = value.coordinate;
  if (
    !Array.isArray(coordinate) ||
    coordinate.length !== 2 ||
    coordinate.some((entry) =>
      typeof entry === "number" ? !Number.isFinite(entry) : true,
    )
  ) {
    throw new Error("placement.coordinate must be a finite [x, y] coordinate");
  }
  const rotation = value.rotation;
  if (!ROTATION_OPTIONS.some((option) => option.value === rotation)) {
    throw new Error(
      `placement.rotation must be ${ROTATION_OPTIONS.map((option) => option.value).join(", ")}`,
    );
  }
  const mirror = value.mirror;
  if (!MIRROR_OPTIONS.some((option) => option.value === mirror)) {
    throw new Error(
      `placement.mirror must be ${MIRROR_OPTIONS.map((option) => JSON.stringify(option.value)).join(" or ")}`,
    );
  }
  return {
    coordinate: [coordinate[0] as number, coordinate[1] as number],
    rotation: rotation as Rotation,
    mirror: mirror as ComponentPropertyPlacementCode["mirror"],
  };
}

function parseDisplay(
  value: unknown,
  context: ComponentPropertyCodeContext,
): ComponentPropertyDisplayCode | undefined {
  const supported = new Set<string>();
  if (context.referenceVisible !== null) supported.add("visualAnnotation");
  if (context.valueVisible !== null) supported.add("value");
  const parameters = magneticDisplayParameters(context.instance.symbolId);
  if (parameters.length) supported.add("parameters");
  if (supported.size === 0) {
    if (value !== undefined) {
      throw new Error("display is not available for this component");
    }
    return undefined;
  }
  if (!isRecord(value)) throw new Error("display must be an object");
  const unknown = unexpectedKey(value, supported, "display");
  if (unknown) throw new Error(unknown);
  const display: ComponentPropertyDisplayCode = {};
  for (const key of supported) {
    if (key === "parameters") {
      if (!isRecord(value.parameters))
        throw new Error("display.parameters must be an object");
      const unknownParameter = unexpectedKey(
        value.parameters,
        new Set(parameters.map((parameter) => parameter.name)),
        "display.parameters",
      );
      if (unknownParameter) throw new Error(unknownParameter);
      display.parameters = {};
      for (const parameter of parameters) {
        const visible = value.parameters[parameter.name];
        if (typeof visible !== "boolean")
          throw new Error(
            `display.parameters.${parameter.name} must be true or false`,
          );
        display.parameters[parameter.name] = visible;
      }
      continue;
    }
    if (typeof value[key] !== "boolean") {
      throw new Error(`display.${key} must be true or false`);
    }
    display[key as "visualAnnotation" | "value"] = value[key] as boolean;
  }
  return display;
}

function parseAppearance(
  value: Record<string, unknown>,
  context: ComponentPropertyCodeContext,
): ComponentPropertyCodeValue["appearance"] {
  const internalMark = componentInternalMark(context.instance);
  const inputPolarity = componentInputPolarity(context.instance.symbolId);
  const booleanStates = {
    inputPolarity,
    inputsSwapped: componentInputsSwapped(context.instance.symbolId),
    outputsSwapped: componentOutputsSwapped(context.instance.symbolId),
  };
  const supported = new Set<string>(["color"]);
  if (internalMark !== undefined) supported.add("internalMark");
  for (const [key, state] of Object.entries(booleanStates))
    if (state !== undefined) supported.add(key);
  const unknown = unexpectedKey(value, supported, "appearance");
  if (unknown) throw new Error(unknown);
  if (!("color" in value)) throw new Error("appearance.color is required");
  const appearance: ComponentPropertyCodeValue["appearance"] = {
    color: parseCanvasColor(value.color, "appearance.color"),
  };
  if (internalMark !== undefined) {
    if (!("internalMark" in value))
      throw new Error("appearance.internalMark is required");
    if (
      typeof value.internalMark !== "string" ||
      !value.internalMark.trim() ||
      value.internalMark.length > 64
    )
      throw new Error(
        'appearance.internalMark must be "none" or nonempty custom text of at most 64 characters',
      );
    appearance.internalMark = value.internalMark.trim();
  }
  for (const key of Object.keys(
    booleanStates,
  ) as (keyof typeof booleanStates)[]) {
    if (booleanStates[key] === undefined) continue;
    if (!(key in value)) throw new Error(`appearance.${key} is required`);
    if (typeof value[key] !== "boolean")
      throw new Error(`appearance.${key} must be true or false`);
    appearance[key] = value[key];
  }
  return appearance;
}

export function componentPropertyCodeValue(
  context: ComponentPropertyCodeContext,
): ComponentPropertyCodeValue {
  const { instance } = context;
  const internalMark = componentInternalMark(instance);
  const inputPolarity = componentInputPolarity(instance.symbolId);
  const inputsSwapped = componentInputsSwapped(instance.symbolId);
  const outputsSwapped = componentOutputsSwapped(instance.symbolId);
  const display: ComponentPropertyDisplayCode = {};
  if (context.referenceVisible !== null) {
    display.visualAnnotation = context.referenceVisible;
  }
  if (context.valueVisible !== null) display.value = context.valueVisible;
  const parameters = magneticDisplayParameters(instance.symbolId);
  if (parameters.length)
    display.parameters = Object.fromEntries(
      parameters.map((parameter) => [
        parameter.name,
        context.parameterVisibility?.[parameter.name] ?? false,
      ]),
    );
  return {
    ...(context.connection !== undefined && context.connection !== null
      ? { connection: context.connection }
      : {}),
    ...(context.netName !== undefined && context.netName !== null
      ? { netName: context.netName }
      : {}),
    ...componentPropertyDetailsValue(instance, context.details),
    ...(context.displayName !== undefined && context.displayName !== null
      ? { displayName: context.displayName }
      : {}),
    placement: instance.placement
      ? {
          coordinate: [
            instance.placement.position.x,
            instance.placement.position.y,
          ],
          rotation: instance.placement.rotation,
          mirror: instance.placement.mirror,
        }
      : null,
    ...(Object.keys(display).length > 0 ? { display } : {}),
    appearance: {
      color: formattedColor(instance.styleOverride?.foreground),
      ...(internalMark !== undefined ? { internalMark } : {}),
      ...(inputPolarity !== undefined ? { inputPolarity } : {}),
      ...(inputsSwapped !== undefined ? { inputsSwapped } : {}),
      ...(outputsSwapped !== undefined ? { outputsSwapped } : {}),
    },
  };
}

export function serializeComponentPropertyCode(
  value: ComponentPropertyCodeValue,
): string {
  const {
    placement,
    appearance,
    display,
    displayName,
    connection,
    netName,
    netlistName,
    netlistTarget,
    ...details
  } = value;
  const source = JSON.stringify(
    {
      placement,
      ...(connection !== undefined ? { connection } : {}),
      ...(netName !== undefined ? { netName } : {}),
      appearance: {
        color:
          appearance.color === "auto" ? "auto" : colorToRgb(appearance.color),
        ...(appearance.internalMark !== undefined
          ? { internalMark: appearance.internalMark }
          : {}),
        ...(appearance.inputPolarity !== undefined
          ? { inputPolarity: appearance.inputPolarity }
          : {}),
        ...(appearance.inputsSwapped !== undefined
          ? { inputsSwapped: appearance.inputsSwapped }
          : {}),
        ...(appearance.outputsSwapped !== undefined
          ? { outputsSwapped: appearance.outputsSwapped }
          : {}),
      },
      ...(display ? { display } : {}),
      ...(displayName !== undefined ? { displayName } : {}),
      ...details,
      netlistName,
      netlistTarget,
    },
    null,
    2,
  );
  // Keep coordinate and RGB tuples readable on one line; this remains strict JSON.
  return source.replace(
    /"(?:\\.|[^"\\])*"|\[\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*,\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)(?:\s*,\s*(\d+))?\s*\]/giu,
    (match, first?: string, second?: string, third?: string) =>
      first === undefined
        ? match
        : `[${first}, ${second}${third === undefined ? "" : `, ${third}`}]`,
  );
}

export function formatComponentPropertyCode(
  context: ComponentPropertyCodeContext,
): string {
  return serializeComponentPropertyCode(componentPropertyCodeValue(context));
}

/** Parse the strict component-local JSON surface; physical connectivity stays outside it. */
export function parseComponentPropertyCode(
  source: string,
  context: ComponentPropertyCodeContext,
): ComponentPropertyCodeParseResult {
  try {
    const decoded: unknown = JSON.parse(source);
    if (!isRecord(decoded))
      throw new Error("Property code must be a JSON object");
    const unknown = unexpectedKey(decoded, ROOT_KEYS, "component");
    if (unknown) throw new Error(unknown);
    if (!("placement" in decoded)) {
      throw new Error("placement is required");
    }
    if (!isRecord(decoded.appearance)) {
      throw new Error("appearance must be an object");
    }
    // Keep the shared field registry honest, while the component-specific
    // parser below decides which of those appearance controls is available.
    const appearanceUnknown = unexpectedKey(
      decoded.appearance,
      APPEARANCE_KEYS,
      "appearance",
    );
    if (appearanceUnknown) throw new Error(appearanceUnknown);
    const display = parseDisplay(decoded.display, context);
    const displayNameAvailable =
      context.displayName !== undefined && context.displayName !== null;
    if (!displayNameAvailable && "displayName" in decoded) {
      throw new Error("displayName is not available for this component");
    }
    if (displayNameAvailable) {
      if (!("displayName" in decoded)) {
        throw new Error("displayName is required for this component");
      }
      if (
        typeof decoded.displayName !== "string" ||
        !decoded.displayName.trim() ||
        decoded.displayName.length > 256
      ) {
        throw new Error(
          "displayName must be a nonempty string of at most 256 characters",
        );
      }
    }
    const connectionAvailable =
      context.connection !== undefined && context.connection !== null;
    if (!connectionAvailable && "connection" in decoded) {
      throw new Error("connection is not available for this component");
    }
    if (connectionAvailable) {
      if (!("connection" in decoded)) {
        throw new Error("connection is required for this component");
      }
      if (
        decoded.connection !== "cell-pin" &&
        decoded.connection !== "global"
      ) {
        throw new Error('connection must be "cell-pin" or "global"');
      }
    }
    const netNameAvailable =
      context.netName !== undefined && context.netName !== null;
    if (!netNameAvailable && "netName" in decoded) {
      throw new Error("netName is not available for this component");
    }
    if (netNameAvailable) {
      if (!("netName" in decoded)) {
        throw new Error("netName is required for this component");
      }
      if (
        typeof decoded.netName !== "string" ||
        !decoded.netName.trim() ||
        decoded.netName.length > 128
      ) {
        throw new Error(
          "netName must be a nonempty string of at most 128 characters",
        );
      }
    }
    return {
      ok: true,
      value: {
        ...(connectionAvailable
          ? {
              connection: decoded.connection as "cell-pin" | "global",
            }
          : {}),
        ...(displayNameAvailable
          ? { displayName: (decoded.displayName as string).trim() }
          : {}),
        ...(netNameAvailable
          ? { netName: (decoded.netName as string).trim() }
          : {}),
        ...parseComponentPropertyDetails(
          decoded,
          context.instance,
          context.details,
        ),
        placement: parsePlacement(
          decoded.placement,
          context.instance.placement !== null,
        ),
        ...(display ? { display } : {}),
        appearance: parseAppearance(decoded.appearance, context),
      },
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Property code is invalid",
    };
  }
}

/** Reset authored defaults in the draft without moving, renaming, or rebinding the device. */
export function defaultComponentPropertyCode(
  context: ComponentPropertyCodeContext,
): string {
  const value = componentPropertyCodeValue(context);
  if (value.placement)
    value.placement = { ...value.placement, rotation: 0, mirror: "none" };
  value.appearance = {
    color: "auto",
    ...(value.appearance.internalMark !== undefined
      ? { internalMark: NO_INTERNAL_MARK }
      : {}),
    ...(value.appearance.inputPolarity !== undefined
      ? { inputPolarity: true }
      : {}),
    ...(value.appearance.inputsSwapped !== undefined
      ? { inputsSwapped: false }
      : {}),
    ...(value.appearance.outputsSwapped !== undefined
      ? { outputsSwapped: false }
      : {}),
  };
  if (value.parameters && context.details) {
    // Preserve unknown model overrides; only descriptor-owned defaults are known.
    for (const parameter of context.details.parameters)
      value.parameters[parameter.key] = parameter.defaultValue ?? "";
  }
  if (value.signalFlow) value.signalFlow = {};
  return serializeComponentPropertyCode(value);
}
