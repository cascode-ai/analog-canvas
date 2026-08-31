import type { DeviceDescriptor } from "../contract.js";

/**
 * The single-pole double-throw switch: one common terminal that selects
 * between two throws.
 *
 * Drawing only. SPICE has no three-terminal switch primitive — the usual
 * netlist form is a pair of controlled switches sharing a node, which is a
 * different circuit than this one Symbol, and inventing it here would be
 * guessing at the person's intent. It designates `S` alongside the rest of
 * the family.
 */
export const spdtSwitchDevice = {
  id: "spdt-switch",
  symbolId: "spdt-switch",
  deviceClass: "switch",
  referencePrefix: "S",
  pinOrder: ["COM", "A", "B"],
  targetPolicy: "none",
  parameters: [],
  dialects: ["spice", "spectre"],
  capabilities: {
    supportsModel: false,
    supportsBulkBinding: false,
    supportsValueAnnotation: false,
  },
} satisfies DeviceDescriptor;
