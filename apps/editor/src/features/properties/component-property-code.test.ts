import { describe, expect, it } from "vitest";

import type { SchematicDocument } from "@icm/model";

import {
  formatComponentPropertyCode,
  parseComponentPropertyCode,
  serializeComponentPropertyCode,
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
  "display": {
    "reference": true,
    "value": false
  },
  "placement": {
    "at": [360, 240],
    "rotation": 90,
    "mirror": "none"
  },
  "appearance": {
    "foreground": "auto"
  }
}`);
  });

  it("round-trips edited coordinates, orientation, display, and colors", () => {
    const source = formatComponentPropertyCode(context)
      .replace("360", "420")
      .replace('"rotation": 90', '"rotation": 180')
      .replace('"mirror": "none"', '"mirror": "horizontal"')
      .replace('"value": false', '"value": true')
      .replace('"foreground": "auto"', '"foreground": "#DC2626"');
    expect(parseComponentPropertyCode(source, context)).toEqual({
      ok: true,
      value: {
        placement: { at: [420, 240], rotation: 180, mirror: "horizontal" },
        display: { reference: true, value: true },
        appearance: { foreground: "#DC2626" },
      },
    });
  });

  it("rejects unsupported and malformed properties instead of guessing", () => {
    const source = formatComponentPropertyCode(context).replace(
      '"rotation": 90',
      '"rotation": 30',
    );
    expect(parseComponentPropertyCode(source, context)).toEqual({
      ok: false,
      message: "placement.rotation must be 0, 45, 90, 135, 180, 225, 270, 315",
    });

    const extra = formatComponentPropertyCode(context).replace(
      '"foreground": "auto"',
      '"foreground": "auto", "background": "#ffffff"',
    );
    expect(parseComponentPropertyCode(extra, context)).toEqual({
      ok: false,
      message: "appearance.background is not a supported property",
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

  it("keeps a supply marker's Net name in the same editable code surface", () => {
    const supplyContext = {
      instance: { ...instance, symbolId: "vdd-port", reference: undefined },
      referenceVisible: null,
      valueVisible: null,
      netName: "VDD",
    };
    const decoded = JSON.parse(formatComponentPropertyCode(supplyContext));
    expect(decoded.netName).toBe("VDD");
    decoded.netName = " AVDD ";
    expect(
      parseComponentPropertyCode(JSON.stringify(decoded), supplyContext),
    ).toMatchObject({ ok: true, value: { netName: "AVDD" } });

    delete decoded.netName;
    expect(
      parseComponentPropertyCode(JSON.stringify(decoded), supplyContext),
    ).toEqual({
      ok: false,
      message: "netName is required for this component",
    });
  });

  it("keeps tray membership outside free-form property edits", () => {
    const source = formatComponentPropertyCode(context).replace(
      /"placement": \{[\s\S]*?\n  \},\n  "appearance"/u,
      '"placement": null,\n  "appearance"',
    );
    expect(parseComponentPropertyCode(source, context)).toEqual({
      ok: false,
      message: "placement cannot be changed to null here; use Return to tray",
    });
  });

  it("accepts RGB authoring, persists hex, and displays fixed colors as compact RGB", () => {
    const decoded = JSON.parse(formatComponentPropertyCode(context));
    decoded.appearance.foreground = [255, 0, 128];
    const parsed = parseComponentPropertyCode(JSON.stringify(decoded), context);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.message);
    expect(parsed.value.appearance).toEqual({ foreground: "#ff0080" });
    const formatted = serializeComponentPropertyCode(parsed.value);
    expect(formatted).toContain('"foreground": [255, 0, 128]');
    expect(parseComponentPropertyCode(formatted, context)).toEqual(parsed);
  });

  it.each([
    [256, 0, 0],
    [-1, 0, 0],
    [0.5, 0, 0],
    ["0", 0, 0],
    [0, 0],
    [0, 0, 0, 0],
    [null, 0, 0],
  ])("rejects invalid RGB channels %j", (...channels) => {
    const decoded = JSON.parse(formatComponentPropertyCode(context));
    decoded.appearance.foreground = channels;
    expect(
      parseComponentPropertyCode(JSON.stringify(decoded), context).ok,
    ).toBe(false);
  });

  it("projects merged amplifier marks through appearance instead of duplicate signal-flow code", () => {
    const opamp = {
      ...instance,
      symbolId: "opamp-lettered",
      reference: "A1",
      netlist: undefined,
      signalFlowParameters: { formula: "G" },
    };
    const opampContext = {
      instance: opamp,
      referenceVisible: true,
      valueVisible: null,
      details: { parameters: [], signalFlow: true },
    };
    const decoded = JSON.parse(formatComponentPropertyCode(opampContext));
    expect(decoded.appearance).toEqual({
      foreground: "auto",
      internalMark: "G",
    });
    expect(decoded).not.toHaveProperty("signalFlow");
    expect(
      parseComponentPropertyCode(JSON.stringify(decoded), opampContext),
    ).toMatchObject({
      ok: true,
      value: { appearance: { internalMark: "G" } },
    });

    const plainContext = {
      ...opampContext,
      instance: {
        ...opamp,
        symbolId: "opamp",
        signalFlowParameters: undefined,
      },
    };
    expect(
      JSON.parse(formatComponentPropertyCode(plainContext)).appearance
        .internalMark,
    ).toBe("none");
  });

  it("projects comparator polarity as one inline-editable appearance state", () => {
    for (const [symbolId, inputPolarity] of [
      ["comparator", true],
      ["comparator-unmarked", false],
    ] as const) {
      const comparatorContext = {
        ...context,
        instance: { ...instance, symbolId, netlist: undefined },
      };
      const decoded = JSON.parse(
        formatComponentPropertyCode(comparatorContext),
      );
      expect(decoded.appearance.inputPolarity).toBe(inputPolarity);
      expect(
        parseComponentPropertyCode(JSON.stringify(decoded), comparatorContext)
          .ok,
      ).toBe(true);
    }
  });

  it("rejects unavailable or malformed merged appearance fields", () => {
    const resistor = JSON.parse(formatComponentPropertyCode(context));
    resistor.appearance.internalMark = "A";
    expect(
      parseComponentPropertyCode(JSON.stringify(resistor), context),
    ).toEqual({
      ok: false,
      message: "appearance.internalMark is not a supported property",
    });

    const opampContext = {
      ...context,
      instance: { ...instance, symbolId: "opamp", netlist: undefined },
    };
    for (const internalMark of ["", " ", "x".repeat(65)]) {
      const decoded = JSON.parse(formatComponentPropertyCode(opampContext));
      decoded.appearance.internalMark = internalMark;
      expect(
        parseComponentPropertyCode(JSON.stringify(decoded), opampContext).ok,
      ).toBe(false);
    }
  });
});
