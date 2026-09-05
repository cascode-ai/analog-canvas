import type { DeviceDescriptor } from "../contract.js";
import { independentSourceParameters } from "./independent-source-parameters.js";

export const currentSourceDevice = {
  id: "current-source",
  symbolId: "current-source",
  deviceClass: "current-source",
  referencePrefix: "I",
  pinOrder: ["+", "-"],
  targetPolicy: "builtin",
  sourceWaveformDefault: "dc",
  parameters: independentSourceParameters("A", "1m"),
  dialects: ["spice", "spectre"],
  capabilities: {
    supportsModel: false,
    supportsBulkBinding: false,
    supportsValueAnnotation: true,
  },
} satisfies DeviceDescriptor;
