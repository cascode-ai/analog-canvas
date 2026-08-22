import { parseSpiceNumber } from "@icm/spice";

const SCALE_SUFFIXES: readonly (readonly [number, string])[] = [
  [1e-15, "f"],
  [1e-12, "p"],
  [1e-9, "n"],
  [1e-6, "u"],
  [1e-3, "m"],
  [1, ""],
];

function formatEngineering(value: number): string {
  const magnitude = Math.abs(value);
  const [factor, suffix] =
    [...SCALE_SUFFIXES].reverse().find(([scale]) => magnitude >= scale) ??
    SCALE_SUFFIXES[0]!;
  const scaled = value / factor;
  // Trim to a readable precision without inventing digits the division did
  // not produce.
  const text = Number(scaled.toPrecision(6)).toString();
  return `${text}${suffix}`;
}

/**
 * Finger width derived from the authored total width and finger count, so
 * `W = FW × NF` holds by construction rather than by a second stored value
 * that could drift out of agreement with W.
 *
 * Returns null when either input is missing or not a number the schematic can
 * divide — the panel then shows nothing rather than a guess.
 */
export function derivedFingerWidth(
  totalWidth: string | undefined,
  fingerCount: string | undefined,
): string | null {
  const width = parseSpiceNumber((totalWidth ?? "").trim());
  const fingers = Number((fingerCount ?? "").trim() || "1");
  if (!width) return null;
  if (!Number.isFinite(fingers) || fingers <= 0) return null;
  return `${formatEngineering(width.value / fingers)}${width.trailingUnit}`;
}
