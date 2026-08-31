import type { DeviceDescriptor } from "../contract.js";

/**
 * The plain two-terminal switch.
 *
 * Drawing only, for the same reason as its open and closed siblings: SPICE's
 * `S<ref> n+ n- nc+ nc- MODEL` wants four nodes and a model card that two
 * terminals and no control cannot supply. It designates `S` so a sheet counts
 * all of its switches in one series.
 */
export const simpleSwitchDevice = {
  id: "simple-switch",
  symbolId: "simple-switch",
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
