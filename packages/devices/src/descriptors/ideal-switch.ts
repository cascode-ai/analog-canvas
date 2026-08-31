import type { DeviceDescriptor } from "../contract.js";

/**
 * The textbook two-terminal switch, drawn open.
 *
 * It carries no netlist target on purpose. SPICE's switch is
 * `S<ref> n+ n- nc+ nc- MODEL` — four nodes and a model card — and this symbol
 * has two terminals and no control, so there is nothing honest to emit. That
 * is why the catalog records it as manual-only rather than mapping it to `S`.
 *
 * What it does need is a reference. Without a descriptor the numbering policy
 * is `none`, the Instance is never designated, and its label renders as empty
 * text — a blank selectable ghost above the symbol. It shares the `S` prefix
 * with the voltage-controlled switch because a reader counts switches in one
 * sequence regardless of which one can be simulated.
 */
export const idealSwitchDevice = {
  id: "ideal-switch",
  symbolId: "ideal-switch",
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
