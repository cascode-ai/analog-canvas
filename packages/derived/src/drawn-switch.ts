import type { DeviceDescriptor } from "@icm/devices";
import {
  flattenRichText,
  type Instance,
  type RichTextDocument,
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

/** The clock phase a two-terminal switch's label names. */
export interface DrawnSwitchPhase {
  /** The phase's name, without its bar: Φ1 for Φ₁, EN for E̅N̅. */
  readonly name: string;
  /** Drawn with an overbar: the switch closes while the phase is low. */
  readonly complement: boolean;
}

/**
 * The clock phase a switch's label names — Φ1 for a label drawn Φ₁ — or null
 * while the label shows the switch's own name. An overbar over any of its
 * characters names the complement of the phase written without it.
 */
export function drawnSwitchPhase(
  document: SchematicDocument,
  instance: Instance,
): DrawnSwitchPhase | null {
  const label = document.annotations.find(
    (annotation) =>
      annotation.kind === "instance-label" &&
      annotation.anchor.kind === "object" &&
      annotation.anchor.objectId === instance.id &&
      !annotation.binding &&
      annotation.content,
  );
  if (!label?.content) return null;
  const name = phaseName(label.content);
  if (!name) return null;
  return { name, complement: barsText(label.content.runs) };
}

function phaseName(content: RichTextDocument): string {
  return flattenRichText(content).normalize("NFKC").replace(/\s+/gu, "");
}

/** Whether an overbar covers any of the phase's characters. */
function barsText(runs: readonly RichTextRun[]): boolean {
  return runs.some(
    (run) =>
      run.kind === "span" &&
      (run.style === "overbar"
        ? phaseName({ runs: run.children }) !== ""
        : barsText(run.children)),
  );
}
