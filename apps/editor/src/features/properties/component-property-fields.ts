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
}

export const CANVAS_PROPERTY_FIELDS: readonly CanvasPropertyField[] = [
  {
    path: "placement.at",
    label: "Position",
    kind: "coordinate",
    description: "[x, y] · canvas coordinates; snapped to the grid on Apply.",
  },
  {
    path: "placement.rotation",
    label: "Rotation",
    kind: "rotation",
    description: `Clockwise · ${ROTATION_OPTIONS.map((option) => option.label).join(" / ")}.`,
  },
  {
    path: "placement.mirror",
    label: "Mirror",
    kind: "mirror",
    description:
      '"none": unchanged; "x": local X flip before rotation. Buttons flip in canvas directions.',
  },
  {
    path: "display.reference",
    label: "Reference",
    kind: "boolean",
    description: "Show or hide the component name (for example, M1).",
  },
  {
    path: "display.value",
    label: "Value",
    kind: "boolean",
    description: "Show or hide the value / W/L label.",
  },
  {
    path: "appearance.foreground",
    label: "Foreground",
    kind: "color",
    description: `[R, G, B] · each 0–${RGB_CHANNEL_MAX}; #RRGGBB also accepted. Auto follows global ink.`,
  },
  {
    path: "appearance.background",
    label: "Background",
    kind: "color",
    description: `[R, G, B] · each 0–${RGB_CHANNEL_MAX}; #RRGGBB also accepted. Auto adds no independent fill.`,
  },
];

export function colorToRgb(value: string): [number, number, number] {
  return [1, 3, 5].map((offset) =>
    Number.parseInt(value.slice(offset, offset + 2), 16),
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
