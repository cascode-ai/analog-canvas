/** Canvas-layer authoring metadata shared by validation and inline assistance. */
export const ROTATION_OPTIONS = [
  { value: 0, label: "0°" },
  { value: 90, label: "90°" },
  { value: 180, label: "180°" },
  { value: 270, label: "270°" },
] as const;

export const MIRROR_OPTIONS = [
  { value: "none", label: "No mirror" },
  { value: "x", label: "Local X flip" },
] as const;

export const RGB_CHANNEL_MAX = 255;
export const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/u;

export interface CanvasPropertyField {
  path: string;
  label: string;
  kind:
    | "coordinate"
    | "rotation"
    | "mirror"
    | "boolean"
    | "color"
    | "text"
    | "choice";
  options?: readonly { value: string; label: string }[];
  description: string;
  /** Expanded help only; short descriptions remain the default line comments. */
  help?: string;
}

export const CANVAS_PROPERTY_FIELDS: readonly CanvasPropertyField[] = [
  {
    path: "placement.at",
    label: "Position",
    kind: "coordinate",
    description: "[x, y] · grid snapped",
    help: "Canvas coordinates [x, y]. Valid changes update immediately and snap to the grid.",
  },
  {
    path: "placement.rotation",
    label: "Rotation",
    kind: "rotation",
    description: "",
    help: "Clockwise rotation: 0°, 90°, 180° or 270°.",
  },
  {
    path: "placement.mirror",
    label: "Mirror",
    kind: "mirror",
    description: "",
    help: "The two icons flip left/right or top/bottom in canvas coordinates. The stored mirror is applied before rotation.",
  },
  {
    path: "display.reference",
    label: "Reference",
    kind: "boolean",
    description: "Show name",
    help: "Show or hide the instance reference label without renaming its electrical identity.",
  },
  {
    path: "display.value",
    label: "Value",
    kind: "boolean",
    description: "Show value",
    help: "Show or hide the value or MOS W/L label without changing its parameters.",
  },
  {
    path: "appearance.foreground",
    label: "Foreground",
    kind: "color",
    description: "RGB visualization",
    help: "Use the swatch to open presets and a custom color picker. RGB channels are 0–255; hex is accepted. Global inherits document ink.",
  },
  {
    path: "appearance.background",
    label: "Background",
    kind: "color",
    description: "RGB visualization",
    help: "Use the swatch to choose a background preset or custom color. No fill removes only the independent background override.",
  },
];

export function colorToRgb(value: string): [number, number, number] {
  const expanded = /^#[0-9a-f]{3}$/iu.test(value)
    ? `#${[...value.slice(1)].map((channel) => channel + channel).join("")}`
    : value;
  return [1, 3, 5].map((offset) =>
    Number.parseInt(expanded.slice(offset, offset + 2), 16),
  ) as [number, number, number];
}

/** RGB is an editor notation; persisted instance colors stay #RRGGBB. */
export function parseCanvasColor(
  value: unknown,
  path: string,
): "auto" | `#${string}` {
  if (value === "auto") return value;
  if (typeof value === "string" && HEX_COLOR_PATTERN.test(value))
    return value as `#${string}`;
  if (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every(
      (channel) =>
        typeof channel === "number" &&
        Number.isInteger(channel) &&
        channel >= 0 &&
        channel <= RGB_CHANNEL_MAX,
    )
  )
    return `#${value.map((channel: number) => channel.toString(16).padStart(2, "0")).join("")}`;
  throw new Error(
    `${path} must be "auto", #RRGGBB, or [R, G, B] with integer channels 0–${RGB_CHANNEL_MAX}`,
  );
}
