import type { DeviceDescriptor } from "../contract.js";

/**
 * The textbook two-terminal switch, drawn closed.
 *
 * Same contract as its open sibling: no netlist target, because SPICE's
 * `S<ref> n+ n- nc+ nc- MODEL` wants four nodes and a model card that this
 * two-terminal drawing cannot supply. It exists to be designated and read.
 *
 * Shares the `S` prefix with the other switches so a schematic numbers its
 * switches in one sequence.
 */
export const closedSwitchDevice = {
  id: "closed-switch",
  symbolId: "closed-switch",
  deviceClass: "switch",
  referencePrefix: "S",
  pinOrder: ["1", "2"],
  targetPolicy: "none",
  parameters: [],
  dialects: ["spice", "spectre"],
  capabilities: {
    supportsModel: false,
    supportsBulkBinding: false,
    supportsValueAnnotation: false,
  },
} satisfies DeviceDescriptor;
