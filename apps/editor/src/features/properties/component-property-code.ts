import type { SchematicDocument } from "@icm/model";

type Instance = SchematicDocument["instances"][number];

export type ComponentPropertyColor = "auto" | `#${string}`;

export interface ComponentPropertyPlacementCode {
  at: [number, number];
  rotation: 0 | 90 | 180 | 270;
  mirror: "none" | "x";
}

export interface ComponentPropertyDisplayCode {
  reference?: boolean;
  value?: boolean;
}

export interface ComponentPropertyCodeValue {
  placement: ComponentPropertyPlacementCode | null;
  display?: ComponentPropertyDisplayCode;
  appearance: {
    foreground: ComponentPropertyColor;
    background: ComponentPropertyColor;
  };
}

export interface ComponentPropertyCodeContext {
  instance: Instance;
  referenceVisible: boolean | null;
  valueVisible: boolean | null;
}

export type ComponentPropertyCodeParseResult =
  | { ok: true; value: ComponentPropertyCodeValue }
  | { ok: false; message: string };

const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/u;
const ROOT_KEYS = new Set(["placement", "display", "appearance"]);
const PLACEMENT_KEYS = new Set(["at", "rotation", "mirror"]);
const APPEARANCE_KEYS = new Set(["foreground", "background"]);

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

function parseColor(value: unknown, path: string): ComponentPropertyColor {
  if (value === "auto") return value;
  if (typeof value === "string" && COLOR_PATTERN.test(value)) {
    return value as `#${string}`;
  }
  throw new Error(`${path} must be "auto" or a #RRGGBB color`);
}

function parsePlacement(
  value: unknown,
  currentlyPlaced: boolean,
): ComponentPropertyPlacementCode | null {
  if (value === null) {
    if (currentlyPlaced) {
      throw new Error(
        "placement cannot be changed to null here; use Return to tray",
      );
    }
    return null;
  }
  if (!currentlyPlaced) {
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
  if (![0, 90, 180, 270].includes(rotation as number)) {
    throw new Error("placement.rotation must be 0, 90, 180, or 270");
  }
  const mirror = value.mirror;
  if (mirror !== "none" && mirror !== "x") {
    throw new Error('placement.mirror must be "none" or "x"');
  }
  return {
    at: [at[0] as number, at[1] as number],
    rotation: rotation as 0 | 90 | 180 | 270,
    mirror,
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

export function componentPropertyCodeValue(
  context: ComponentPropertyCodeContext,
): ComponentPropertyCodeValue {
  const { instance } = context;
  const display: ComponentPropertyDisplayCode = {};
  if (context.referenceVisible !== null) {
    display.reference = context.referenceVisible;
  }
  if (context.valueVisible !== null) display.value = context.valueVisible;
  return {
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
      background: formattedColor(instance.styleOverride?.background),
    },
  };
}

export function serializeComponentPropertyCode(
  value: ComponentPropertyCodeValue,
): string {
  return JSON.stringify(value, null, 2);
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
    const appearanceUnknown = unexpectedKey(
      decoded.appearance,
      APPEARANCE_KEYS,
      "appearance",
    );
    if (appearanceUnknown) throw new Error(appearanceUnknown);
    if (!("foreground" in decoded.appearance)) {
      throw new Error("appearance.foreground is required");
    }
    if (!("background" in decoded.appearance)) {
      throw new Error("appearance.background is required");
    }
    const display = parseDisplay(decoded.display, context);
    return {
      ok: true,
      value: {
        placement: parsePlacement(
          decoded.placement,
          context.instance.placement !== null,
        ),
        ...(display ? { display } : {}),
        appearance: {
          foreground: parseColor(
            decoded.appearance.foreground,
            "appearance.foreground",
          ),
          background: parseColor(
            decoded.appearance.background,
            "appearance.background",
          ),
        },
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
