import type { DeviceDescriptor } from "../contract.js";

export const voltageSourceDevice = {
  id: "voltage-source",
  symbolId: "voltage-source",
  deviceClass: "voltage-source",
  referencePrefix: "V",
  pinOrder: ["+", "-"],
  targetPolicy: "builtin",
  sourceWaveformDefault: "dc",
  parameters: [
    {
      name: "dc",
      label: "Value",
      required: true,
      editor: "text",
      unitHint: "V",
      placeholder: "1.8",
      help: "DC voltage",
      displayRole: "value",
    },
    {
      name: "acMagnitude",
      label: "AC magnitude",
      required: false,
      editor: "text",
      unitHint: "V",
      placeholder: "1",
      help: "Small-signal magnitude for AC analysis; leave empty for a DC-only source",
      displayRole: "none",
    },
    {
      name: "acPhase",
      label: "AC phase",
      required: false,
      editor: "text",
      unitHint: "deg",
      placeholder: "0",
      help: "Small-signal phase in degrees; printed only with an AC magnitude, 0 when empty",
      displayRole: "none",
    },
  ],
  dialects: ["spice", "spectre"],
  capabilities: {
    supportsModel: false,
    supportsBulkBinding: false,
    supportsValueAnnotation: true,
  },
} satisfies DeviceDescriptor;
