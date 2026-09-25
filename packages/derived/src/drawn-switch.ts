import type { DeviceDescriptor } from "@icm/devices";
import {
  flattenRichText,
  type Instance,
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

/**
 * The clock phase a switch's label names — Φ1 for a label drawn Φ₁ — or null
 * while the label shows the switch's own name.
 */
export function drawnSwitchPhase(
  document: SchematicDocument,
  instance: Instance,
): string | null {
  const label = document.annotations.find(
    (annotation) =>
      annotation.kind === "instance-label" &&
      annotation.anchor.kind === "object" &&
      annotation.anchor.objectId === instance.id &&
      !annotation.binding &&
      annotation.content,
  );
  if (!label?.content) return null;
  const phase = flattenRichText(label.content)
    .normalize("NFKC")
    .replace(/\s+/gu, "");
  return phase || null;
}
