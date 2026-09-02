import type { DesignNetlistInstance } from "./ir.js";

/** SPICE card designator derived from invocation, never persisted authoring. */
export function spiceEmittedReference(
  instance: Pick<DesignNetlistInstance, "reference" | "invocationKind">,
): string {
  return instance.invocationKind === "subcircuit" &&
    !instance.reference.toUpperCase().startsWith("X")
    ? `X${instance.reference}`
    : instance.reference;
}
