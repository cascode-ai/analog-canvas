import type { StyleOverrides } from "@icm/model";

/** Preset scale factors offered by every knob; 1 is the profile default. */
export const STYLE_SCALE_OPTIONS = [
  0.5, 0.65, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2,
] as const;

export interface StyleKnob {
  key: keyof StyleOverrides;
  label: string;
  description: string;
}

/** The five document knobs, in display order. */
export const STYLE_KNOBS: readonly StyleKnob[] = [
  {
    key: "fontScale",
    label: "Font size",
    description: "All schematic text and labels",
  },
  {
    key: "wireStrokeScale",
    label: "Wire thickness",
    description: "Drawn wire strokes",
  },
  {
    key: "symbolStrokeScale",
    label: "Symbol thickness",
    description: "Device artwork, supplies, and rails",
  },
  {
    key: "annotationStrokeScale",
    label: "Drawing thickness",
    description: "Rectangles, arrows, and annotation strokes",
  },
  {
    key: "junctionRadiusScale",
    label: "Junction dot size",
    description: "Connection dot radius",
  },
];

/**
 * Normalize a draft into the persisted shape: factors equal to 1 are the
 * profile default and stay unwritten; an all-default draft clears the
 * persisted overrides entirely (returns null for the typed edit).
 */
export function normalizedStyleOverrides(
  draft: Readonly<Record<keyof StyleOverrides, number>>,
): StyleOverrides | null {
  const overrides: Record<string, number> = {};
  for (const knob of STYLE_KNOBS) {
    const value = draft[knob.key];
    if (value !== 1) overrides[knob.key] = value;
  }
  return Object.keys(overrides).length > 0
    ? (overrides as StyleOverrides)
    : null;
}

/** Current knob values with absent factors normalized to 1. */
export function styleOverrideDraft(
  overrides: StyleOverrides | undefined,
): Record<keyof StyleOverrides, number> {
  return {
    fontScale: overrides?.fontScale ?? 1,
    wireStrokeScale: overrides?.wireStrokeScale ?? 1,
    symbolStrokeScale: overrides?.symbolStrokeScale ?? 1,
    annotationStrokeScale: overrides?.annotationStrokeScale ?? 1,
    junctionRadiusScale: overrides?.junctionRadiusScale ?? 1,
  };
}
