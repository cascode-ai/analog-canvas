import type { DraftingObject, Point } from "@icm/model";

type Arrow = Extract<DraftingObject, { kind: "arrow" }>;
export interface ArrowPreset {
  id: string;
  label: string;
  family: "line" | "outline";
  head: "filled" | "open" | "none";
  at: "end" | "start" | "both";
}

/** UI presets, not another persisted style protocol. */
export const ARROW_PRESETS: readonly ArrowPreset[] = [
  ...(["filled", "open"] as const).flatMap((head) =>
    (["end", "start", "both"] as const).map((at) => ({
      id: `${head}-${at}`,
      family: "line" as const,
      head,
      at,
      label: `${head === "filled" ? "Filled" : "Open"} ${at === "both" ? "double arrow" : at === "start" ? "start arrow" : "end arrow"}`,
    })),
  ),
  { id: "line", label: "No head", family: "line", head: "none", at: "end" },
  ...(["end", "start", "both"] as const).map((at) => ({
    id: `outline-${at}`,
    label: `Outline ${at === "both" ? "double arrow" : at === "start" ? "start arrow" : "end arrow"}`,
    family: "outline" as const,
    head: "open" as const,
    at,
  })),
];
export const DEFAULT_ARROW_PRESET = ARROW_PRESETS[0]!;
export const DEFAULT_OUTLINE_WIDTH = 30;
const DEFAULT_OUTLINE_LENGTH = 44;

function canApplyArrowPreset(object: Arrow, preset: ArrowPreset): boolean {
  return (
    !object.locked &&
    !(
      preset.family === "outline" &&
      (object.waypoints?.length || object.curveControls?.some(Boolean))
    )
  );
}

export function applyArrowPreset(
  object: Arrow,
  preset: ArrowPreset,
): Arrow | null {
  if (!canApplyArrowPreset(object, preset)) return null;
  const { outline, ...base } = object;
  const {
    arrowStart: _start,
    arrowEnd: _end,
    ...style
  } = object.styleOverride ?? {};
  return {
    ...base,
    ...(preset.family === "outline"
      ? { outline: outline ?? { width: DEFAULT_OUTLINE_WIDTH } }
      : {}),
    // Preserve historical head scales and all unrelated color/weight overrides.
    styleOverride: {
      ...style,
      arrowHead: preset.head,
      arrowHeadAt: preset.at,
    },
  };
}

/** Bounds-based downward block creation; a click stamps a centered default. */
export function outlinePlacement(
  start: Point | null,
  hover: Point,
): { from: Point; to: Point; width: number } {
  if (!start)
    return {
      from: { x: hover.x, y: hover.y - DEFAULT_OUTLINE_LENGTH / 2 },
      to: { x: hover.x, y: hover.y + DEFAULT_OUTLINE_LENGTH / 2 },
      width: DEFAULT_OUTLINE_WIDTH,
    };
  const x = Math.round((start.x + hover.x) / 2);
  const top = Math.min(start.y, hover.y);
  return {
    from: { x, y: top },
    to: { x, y: top + Math.max(4, Math.abs(hover.y - start.y)) },
    width: Math.max(4, Math.abs(hover.x - start.x)),
  };
}
