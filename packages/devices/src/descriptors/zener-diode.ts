import type { DeviceDescriptor } from "../contract.js";

// A Zener diode uses the same two-terminal SPICE/Spectre D primitive as an
// ordinary diode.  The distinct descriptor preserves the selected schematic
// presentation while retaining model-bound netlist round trips.
export const zenerDiodeDevice = {
  id: "zener-diode",
  symbolId: "zener-diode",
  deviceClass: "diode",
  referencePrefix: "D",
  pinOrder: ["A", "K"],
  targetPolicy: "required-model",
  parameters: [],
  dialects: ["spice", "spectre"],
  capabilities: {
    supportsModel: true,
    supportsBulkBinding: false,
    supportsValueAnnotation: true,
  },
} satisfies DeviceDescriptor;
