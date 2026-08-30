import type { DeviceDescriptor } from "../contract.js";

export const pnpDevice = {
  id: "pnp",
  symbolId: "pnp",
  deviceClass: "bjt",
  referencePrefix: "Q",
  pinOrder: ["C", "B", "E"],
  seriesInsertionPinPair: ["C", "E"],
  targetPolicy: "required-model",
  parameters: [],
  dialects: ["spice", "spectre"],
  capabilities: {
    supportsModel: true,
    supportsBulkBinding: false,
    supportsValueAnnotation: true,
  },
} satisfies DeviceDescriptor;
