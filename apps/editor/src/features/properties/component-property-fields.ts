/** Canvas-layer authoring metadata shared by validation and external controls. */
export const ROTATION_OPTIONS = [
  { value: 0, label: "0°" },
  { value: 45, label: "45°" },
  { value: 90, label: "90°" },
  { value: 135, label: "135°" },
  { value: 180, label: "180°" },
  { value: 225, label: "225°" },
  { value: 270, label: "270°" },
  { value: 315, label: "315°" },
] as const;

export const MIRROR_OPTIONS = [
  { value: "none", label: "No mirror" },
  { value: "horizontal", label: "Horizontal" },
  { value: "vertical", label: "Vertical" },
  { value: "both", label: "Horizontal and vertical" },
] as const;

export const RGB_CHANNEL_MAX = 255;
export const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/u;

export type CanvasPropertyOptionPreview =
  | {
      kind: "label";
      first: string;
      suffix: string;
      firstItalic: boolean;
      suffixItalic: boolean;
      subscript: boolean;
    }
  | {
      kind: "scale";
      target: "font" | "wire" | "symbol" | "drawing" | "junction";
      factor: number;
    }
  | {
      kind: "bulk";
      device: "NMOS" | "PMOS";
      rail: "VSS" | "VDD";
    }
  | { kind: "grid"; enabled: boolean; spacing: 1 | 5 | 10 }
  | { kind: "angle"; mode: "free" | "45" | "orthogonal" }
  | { kind: "scroll"; mode: "auto" | "zoom" | "pan" };

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
  options?: readonly {
    value: string | number | boolean | null;
    label: string;
    /** Optional rendered example for the expanded inline choice menu. */
    preview?: CanvasPropertyOptionPreview;
  }[];
  description: string;
  /** Guidance metadata for callers that present help outside the code editor. */
  help?: string;
}

export const CANVAS_PROPERTY_FIELDS: readonly CanvasPropertyField[] = [
  {
    path: "connection",
    label: "Connection",
    kind: "choice",
    options: [
      { value: "cell-pin", label: "Cell Pin" },
      { value: "global", label: "Global" },
    ],
    description: "",
    help: "Choose whether VDD Power exposes a Cell Pin or declares a Global Net.",
  },
  {
    path: "placement.coordinate",
    label: "Coordinate",
    kind: "coordinate",
    description: "",
    help: "Canvas coordinates [x, y]. Valid changes update immediately and snap to the grid.",
  },
  {
    path: "displayName",
    label: "Display name",
    kind: "text",
    description: "",
    help: "Visual name drawn beside the component. It is independent from the exported netlist name.",
  },
  {
    path: "placement.rotation",
    label: "Rotation",
    kind: "rotation",
    description: "",
    help: "Clockwise rotation in 45° steps from 0° through 315°.",
  },
  {
    path: "placement.mirror",
    label: "Mirror",
    kind: "mirror",
    description: "",
    help: "Horizontal flips left/right; vertical flips top/bottom. Mirror directions are independent and never rewrite rotation.",
  },
  {
    path: "display.visualAnnotation",
    label: "Visual annotation",
    kind: "boolean",
    description: "",
    help: "Show or hide the visual instance annotation without changing its netlist name.",
  },
  {
    path: "display.value",
    label: "Value",
    kind: "boolean",
    description: "",
    help: "Show or hide the value or MOS W/L label without changing its parameters.",
  },
  {
    path: "appearance",
    label: "Appearance",
    kind: "text",
    description: "",
  },
  {
    path: "appearance.color",
    label: "Line",
    kind: "color",
    description: "",
    help: "Color for the component lines and text. Use the swatch for presets or a custom color. RGB channels are 0–255; hex is accepted. Auto inherits document ink.",
  },
  {
    path: "appearance.internalMark",
    label: "Internal mark",
    kind: "text",
    description: "",
    help: "Choose whether an amplifier triangle has no internal mark, the standard A, or custom body text.",
  },
  {
    path: "appearance.inputPolarity",
    label: "Input polarity",
    kind: "boolean",
    description: "",
    help: "Show or hide the comparator input polarity marks without changing its electrical pins.",
  },
  {
    path: "appearance.inputsSwapped",
    label: "Swap inputs",
    kind: "boolean",
    description: "",
    help: "Exchange the + and - input positions independently of the outputs. Connections stay attached to their named pins.",
  },
  {
    path: "appearance.outputsSwapped",
    label: "Swap outputs",
    kind: "boolean",
    description: "",
    help: "Exchange the + and - output positions independently of the inputs. Connections stay attached to their named pins.",
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
