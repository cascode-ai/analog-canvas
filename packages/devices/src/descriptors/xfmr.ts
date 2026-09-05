import type { DeviceDescriptor } from "../contract.js";

/**
 * Four-terminal transformer presentation.
 *
 * A transformer requires coupling and winding parameters that the primitive
 * device protocol does not yet express. It still owns an X designator so a
 * placed symbol has the same editable identity annotation as other devices.
 */
export const xfmrDevice = {
  id: "xfmr",
  symbolId: "xfmr",
  deviceClass: "inductor",
  referencePrefix: "X",
  pinOrder: ["P-", "P+", "S-", "S+"],
  targetPolicy: "none",
  parameters: [],
  dialects: ["spice", "spectre"],
  capabilities: {
    supportsModel: false,
    supportsBulkBinding: false,
    supportsValueAnnotation: false,
  },
} satisfies DeviceDescriptor;
