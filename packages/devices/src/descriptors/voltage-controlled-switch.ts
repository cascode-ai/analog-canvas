import type { DeviceDescriptor } from "../contract.js";

/**
 * The SPICE voltage-controlled switch, `S<ref> n+ n- nc+ nc- MODEL`.
 *
 * The two switched nodes come first, then the two control nodes, then the
 * model card that says when it closes — the same order the simulator reads,
 * so pin order needs no translation on the way out.
 *
 * It is a device of its own rather than netlist behaviour added to the
 * textbook two-terminal switch, which has no control terminals to emit and
 * whose artwork answers to the reviewed visual reference.
 */
export const voltageControlledSwitchDevice = {
  id: "voltage-controlled-switch",
  symbolId: "voltage-controlled-switch",
  deviceClass: "switch",
  referencePrefix: "S",
  pinOrder: ["P", "N", "CP", "CN"],
  targetPolicy: "required-model",
  parameters: [],
  dialects: ["spice", "spectre"],
  capabilities: {
    supportsModel: true,
    supportsBulkBinding: false,
    supportsValueAnnotation: false,
  },
} satisfies DeviceDescriptor;
