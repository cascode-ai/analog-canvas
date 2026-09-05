import type { DeviceDescriptor } from "../contract.js";

export const currentSourceDevice = {
  id: "current-source",
  symbolId: "current-source",
  deviceClass: "current-source",
  referencePrefix: "I",
  pinOrder: ["+", "-"],
  targetPolicy: "builtin",
  sourceWaveformDefault: "dc",
  parameters: [
    {
      name: "dc",
      label: "Value",
      required: true,
      editor: "text",
      unitHint: "A",
      placeholder: "1m",
      help: "DC current",
      displayRole: "value",
    },
    {
      name: "acMagnitude",
      label: "AC magnitude",
      required: false,
      editor: "text",
      unitHint: "A",
      placeholder: "1u",
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
