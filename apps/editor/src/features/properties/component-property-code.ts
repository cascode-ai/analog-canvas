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
  componentInternalMark,
  NO_INTERNAL_MARK,
} from "./component-visual-variants";

type Instance = SchematicDocument["instances"][number];

export type ComponentPropertyColor = "auto" | `#${string}`;

export interface ComponentPropertyPlacementCode {
  at: [number, number];
  rotation: Rotation;
  mirror: "none" | "horizontal" | "vertical" | "both";
}

export interface ComponentPropertyDisplayCode {
  reference?: boolean;
  value?: boolean;
}

export interface ComponentPropertyCodeValue extends ComponentPropertyDetailsValue {
  placement: ComponentPropertyPlacementCode | null;
  display?: ComponentPropertyDisplayCode;
  appearance: {
    foreground: ComponentPropertyColor;
    internalMark?: string;
    inputPolarity?: boolean;
  };
}

export interface ComponentPropertyCodeContext {
  instance: Instance;
  referenceVisible: boolean | null;
  valueVisible: boolean | null;
  details?: ComponentPropertyDetailsContext;
}

export type ComponentPropertyCodeParseResult =
  | { ok: true; value: ComponentPropertyCodeValue }
  | { ok: false; message: string };

const ROOT_KEYS = new Set([
  "placement",
  "display",
  "appearance",
  "reference",
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
  editableLifecycle = false,
): ComponentPropertyPlacementCode | null {
  if (value === null) {
    if (currentlyPlaced && !editableLifecycle) {
      throw new Error(
        "placement cannot be changed to null here; use Return to tray",
      );
    }
    return null;
  }
  if (!currentlyPlaced && !editableLifecycle) {
    throw new Error(
      "placement is read-only while this component is in the Placement Tray",
    );
  }
  if (!isRecord(value)) throw new Error("placement must be an object");
  const unknown = unexpectedKey(value, PLACEMENT_KEYS, "placement");
  if (unknown) throw new Error(unknown);
  const at = value.at;
  if (
    !Array.isArray(at) ||
    at.length !== 2 ||
    at.some((coordinate) =>
      typeof coordinate === "number" ? !Number.isFinite(coordinate) : true,
    )
  ) {
    throw new Error("placement.at must be a finite [x, y] coordinate");
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
    at: [at[0] as number, at[1] as number],
    rotation: rotation as Rotation,
    mirror: mirror as ComponentPropertyPlacementCode["mirror"],
  };
}

function parseDisplay(
  value: unknown,
  context: ComponentPropertyCodeContext,
): ComponentPropertyDisplayCode | undefined {
  const supported = new Set<string>();
  if (context.referenceVisible !== null) supported.add("reference");
  if (context.valueVisible !== null) supported.add("value");
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
    if (typeof value[key] !== "boolean") {
      throw new Error(`display.${key} must be true or false`);
    }
    display[key as keyof ComponentPropertyDisplayCode] = value[key] as boolean;
  }
  return display;
}

function parseAppearance(
  value: Record<string, unknown>,
  context: ComponentPropertyCodeContext,
): ComponentPropertyCodeValue["appearance"] {
  const internalMark = componentInternalMark(context.instance);
  const inputPolarity = componentInputPolarity(context.instance.symbolId);
  const supported = new Set<string>(["foreground"]);
  if (internalMark !== undefined) supported.add("internalMark");
  if (inputPolarity !== undefined) supported.add("inputPolarity");
  const unknown = unexpectedKey(value, supported, "appearance");
  if (unknown) throw new Error(unknown);
  if (!("foreground" in value))
    throw new Error("appearance.foreground is required");
  const appearance: ComponentPropertyCodeValue["appearance"] = {
    foreground: parseCanvasColor(value.foreground, "appearance.foreground"),
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
  if (inputPolarity !== undefined) {
    if (!("inputPolarity" in value))
      throw new Error("appearance.inputPolarity is required");
    if (typeof value.inputPolarity !== "boolean")
      throw new Error("appearance.inputPolarity must be true or false");
    appearance.inputPolarity = value.inputPolarity;
  }
  return appearance;
}

export function componentPropertyCodeValue(
  context: ComponentPropertyCodeContext,
): ComponentPropertyCodeValue {
  const { instance } = context;
  const internalMark = componentInternalMark(instance);
  const inputPolarity = componentInputPolarity(instance.symbolId);
  const display: ComponentPropertyDisplayCode = {};
  if (context.referenceVisible !== null) {
    display.reference = context.referenceVisible;
  }
  if (context.valueVisible !== null) display.value = context.valueVisible;
  return {
    ...componentPropertyDetailsValue(instance, context.details),
    placement: instance.placement
      ? {
          at: [instance.placement.position.x, instance.placement.position.y],
          rotation: instance.placement.rotation,
          mirror: instance.placement.mirror,
        }
      : null,
    ...(Object.keys(display).length > 0 ? { display } : {}),
    appearance: {
      foreground: formattedColor(instance.styleOverride?.foreground),
      ...(internalMark !== undefined ? { internalMark } : {}),
      ...(inputPolarity !== undefined ? { inputPolarity } : {}),
    },
  };
}

export function serializeComponentPropertyCode(
  value: ComponentPropertyCodeValue,
): string {
  const { display, placement, appearance, ...details } = value;
  const source = JSON.stringify(
    {
      ...(display ? { display } : {}),
      ...details,
      placement,
      appearance: {
        foreground:
          appearance.foreground === "auto"
            ? "auto"
            : colorToRgb(appearance.foreground),
        ...(appearance.internalMark !== undefined
          ? { internalMark: appearance.internalMark }
          : {}),
        ...(appearance.inputPolarity !== undefined
          ? { inputPolarity: appearance.inputPolarity }
          : {}),
      },
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

/** Parse the strict, component-local JSON surface. Connectivity is deliberately absent. */
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
    return {
      ok: true,
      value: {
        ...parseComponentPropertyDetails(
          decoded,
          context.instance,
          context.details,
        ),
        placement: parsePlacement(
          decoded.placement,
          context.instance.placement !== null,
          context.details !== undefined,
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
    foreground: "auto",
    ...(value.appearance.internalMark !== undefined
      ? { internalMark: NO_INTERNAL_MARK }
      : {}),
    ...(value.appearance.inputPolarity !== undefined
      ? { inputPolarity: true }
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
