import { describe, expect, it } from "vitest";

import type { SchematicDocument } from "@icm/model";

import {
  formatComponentPropertyCode,
  parseComponentPropertyCode,
} from "./component-property-code";

type Instance = SchematicDocument["instances"][number];

const instance: Instance = {
  id: "instance-1",
  symbolId: "resistor",
  reference: "R1",
  placement: {
    position: { x: 360, y: 240 },
    rotation: 90,
    mirror: "none",
  },
  netlist: {
    binding: { kind: "primitive", deviceClass: "resistor" },
    parameters: { value: "10k" },
  },
};

const context = {
  instance,
  referenceVisible: true,
  valueVisible: false,
};

describe("component property code", () => {
  it("formats placement as one coordinate and makes display/style explicit", () => {
    expect(formatComponentPropertyCode(context)).toBe(`{
  "placement": {
    "at": [
      360,
      240
    ],
    "rotation": 90,
    "mirror": "none"
  },
  "display": {
    "reference": true,
    "value": false
  },
  "appearance": {
    "foreground": "auto",
    "background": "auto"
  }
}`);
  });

  it("round-trips edited coordinates, orientation, display, and colors", () => {
    const source = formatComponentPropertyCode(context)
      .replace("360", "420")
      .replace('"rotation": 90', '"rotation": 180')
      .replace('"mirror": "none"', '"mirror": "x"')
      .replace('"value": false', '"value": true')
      .replace('"foreground": "auto"', '"foreground": "#DC2626"');
    expect(parseComponentPropertyCode(source, context)).toEqual({
      ok: true,
      value: {
        placement: { at: [420, 240], rotation: 180, mirror: "x" },
        display: { reference: true, value: true },
        appearance: { foreground: "#DC2626", background: "auto" },
      },
    });
  });

  it("rejects unsupported and malformed properties instead of guessing", () => {
    const source = formatComponentPropertyCode(context).replace(
      '"rotation": 90',
      '"rotation": 45',
    );
    expect(parseComponentPropertyCode(source, context)).toEqual({
      ok: false,
      message: "placement.rotation must be 0, 90, 180, or 270",
    });

    const extra = formatComponentPropertyCode(context).replace(
      '"background": "auto"',
      '"background": "auto", "opacity": 0.5',
    );
    expect(parseComponentPropertyCode(extra, context)).toEqual({
      ok: false,
      message: "appearance.opacity is not a supported property",
    });
  });

  it("omits display for a component with no display capability", () => {
    const noDisplayContext = {
      instance: { ...instance, reference: undefined },
      referenceVisible: null,
      valueVisible: null,
    };
    const source = formatComponentPropertyCode(noDisplayContext);
    expect(source).not.toContain('"display"');
    expect(parseComponentPropertyCode(source, noDisplayContext).ok).toBe(true);
  });

  it("keeps tray membership outside free-form property edits", () => {
    const source = formatComponentPropertyCode(context).replace(
      /"placement": \{[\s\S]*?\n  \},\n  "display"/u,
      '"placement": null,\n  "display"',
    );
    expect(parseComponentPropertyCode(source, context)).toEqual({
      ok: false,
      message: "placement cannot be changed to null here; use Return to tray",
    });
  });
});
