import type { DeviceDescriptor } from "../contract.js";
import { independentSourceParameters } from "./independent-source-parameters.js";

export const voltageSourceDevice = {
  id: "voltage-source",
  symbolId: "voltage-source",
  deviceClass: "voltage-source",
  referencePrefix: "V",
  pinOrder: ["+", "-"],
  targetPolicy: "builtin",
  sourceWaveformDefault: "dc",
  parameters: independentSourceParameters("V", "1.8"),
  dialects: ["spice", "spectre"],
  capabilities: {
    supportsModel: false,
    supportsBulkBinding: false,
    supportsValueAnnotation: true,
  },
} satisfies DeviceDescriptor;
