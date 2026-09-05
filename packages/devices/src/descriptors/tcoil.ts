import type { DeviceDescriptor } from "../contract.js";

/**
 * Three-terminal bridged T-coil presentation.
 *
 * The artwork is a reviewed compound magnetic symbol, but no portable SPICE
 * primitive can preserve its coupled-inductor and bridge-capacitor semantics.
 * It therefore owns an X designator while remaining deliberately non-emitting
 * until an explicit subcircuit binding is authored.
 */
export const tcoilDevice = {
  id: "tcoil",
  symbolId: "tcoil",
  deviceClass: "inductor",
  referencePrefix: "X",
  pinOrder: ["1", "2", "3"],
  targetPolicy: "none",
  parameters: [],
  dialects: ["spice", "spectre"],
  capabilities: {
    supportsModel: false,
    supportsBulkBinding: false,
    supportsValueAnnotation: false,
  },
} satisfies DeviceDescriptor;
