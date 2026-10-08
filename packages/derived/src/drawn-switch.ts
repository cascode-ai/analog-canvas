import type { DeviceDescriptor } from "@icm/devices";
import {
  flattenRichText,
  type Instance,
  type RichTextRun,
  type SchematicDocument,
} from "@icm/model";

/**
 * How a drawn switch is controlled: a two-terminal switch by the clock phase
 * its label names, a single-ended switch by its CTRL pin. Both are read
 * against ground. Switches bound to a model of their own, and selectors SPICE
 * has no primitive for, are not drawn switches.
 */
export function drawnSwitchControl(
  definition: DeviceDescriptor,
): "phase" | "pin" | null {
  if (definition.deviceClass !== "switch" || definition.targetPolicy !== "none")
    return null;
  if (definition.pinOrder.length === 2) return "phase";
  return definition.pinOrder.length === 3 &&
    definition.pinOrder.includes("CTRL")
    ? "pin"
    : null;
}

/** A bar drawn over text: COMBINING OVERLINE or COMBINING MACRON. */
const BAR = /[\u0304\u0305]/u;

function overbarred(runs: readonly RichTextRun[]): boolean {
  return runs.some(
    (run) =>
      run.kind === "span" &&
      (run.style === "overbar" || overbarred(run.children)),
  );
}

/**
 * The clock phase a switch's label names — Φ1 for a label drawn Φ₁ — or null
 * while the label shows the switch's own name. A bar over the label (E̅N̅,
 * Φ̄₁), drawn as the overbar style or typed with combining bars, names the
 * phase's complement: the switch closes while that phase is low (#1475).
 */
export function drawnSwitchPhase(
  document: SchematicDocument,
  instance: Instance,
): { phase: string; complement: boolean } | null {
  const label = document.annotations.find(
    (annotation) =>
      annotation.kind === "instance-label" &&
      annotation.anchor.kind === "object" &&
      annotation.anchor.objectId === instance.id &&
      !annotation.binding &&
      annotation.content,
  );
  if (!label?.content) return null;
  const text = flattenRichText(label.content).normalize("NFD");
  const phase = text
    .replace(/[\u0304\u0305]/gu, "")
    .normalize("NFKC")
    .replace(/\s+/gu, "");
  if (!phase) return null;
  return {
    phase,
    complement: BAR.test(text) || overbarred(label.content.runs),
  };
}
