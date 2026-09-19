import { describe, expect, it } from "vitest";

import type { SchematicDocument } from "@icm/model";

import {
  defaultComponentPropertyCode,
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
  "placement": {
    "coordinate": [360, 240],
    "rotation": 90,
    "mirror": "none"
  },
  "appearance": {
    "color": "auto"
  },
  "display": {
    "visualAnnotation": true,
    "value": false
  }
}`);
  });

  it("rejects the former ambiguous Reference surface names", () => {
    const identityContext = { ...context, details: { parameters: [] } };
    const source = formatComponentPropertyCode(identityContext);
    expect(source).toContain('"netlistName": "R1"');
    expect(source).toContain('"visualAnnotation": true');
    expect(source).not.toMatch(/"reference"/u);
    expect(
      parseComponentPropertyCode(
        source.replace('"netlistName"', '"reference"'),
        identityContext,
      ),
    ).toEqual({
      ok: false,
      message: "component.reference is not a supported property",
    });
    expect(
      parseComponentPropertyCode(
        source.replace('"visualAnnotation"', '"reference"'),
        identityContext,
      ),
    ).toEqual({
      ok: false,
      message: "display.reference is not a supported property",
    });
  });

  it("round-trips edited coordinates, orientation, display, and colors", () => {
    const source = formatComponentPropertyCode(context)
      .replace("360", "420")
      .replace('"rotation": 90', '"rotation": 180')
      .replace('"mirror": "none"', '"mirror": "horizontal"')
      .replace('"value": false', '"value": true')
      .replace('"color": "auto"', '"color": "#DC2626"');
    expect(parseComponentPropertyCode(source, context)).toEqual({
      ok: true,
      value: {
        placement: {
          coordinate: [420, 240],
          rotation: 180,
          mirror: "horizontal",
        },
        display: { visualAnnotation: true, value: true },
        appearance: { color: "#DC2626" },
      },
    });
  });

  it("keeps the visual display name independent from the netlist name", () => {
    const namedContext = {
      ...context,
      displayName: "RL",
      details: { parameters: [] },
    };
    const source = formatComponentPropertyCode(namedContext);
    const decoded = JSON.parse(source);
    expect(decoded.displayName).toBe("RL");
    expect(decoded.netlistName).toBe("R1");
    decoded.displayName = "load";
    expect(
      parseComponentPropertyCode(JSON.stringify(decoded), namedContext),
    ).toMatchObject({
      ok: true,
      value: { displayName: "load", netlistName: "R1" },
    });
    delete decoded.displayName;
    expect(
      parseComponentPropertyCode(JSON.stringify(decoded), namedContext),
    ).toEqual({
      ok: false,
      message: "displayName is required for this component",
    });
  });

  it("rejects the retired placement.at key", () => {
    const decoded = JSON.parse(formatComponentPropertyCode(context));
    decoded.placement.at = decoded.placement.coordinate;
    delete decoded.placement.coordinate;
    expect(
      parseComponentPropertyCode(JSON.stringify(decoded), context),
    ).toEqual({
      ok: false,
      message: "placement.at is not a supported property",
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

    for (const retired of ["foreground", "background", "fillColor"]) {
      const extra = formatComponentPropertyCode(context).replace(
        '"color": "auto"',
        `"color": "auto", "${retired}": "#ffffff"`,
      );
      expect(parseComponentPropertyCode(extra, context)).toEqual({
        ok: false,
        message: `appearance.${retired} is not a supported property`,
      });
    }
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

  it("keeps a supply marker's connection and Net name in the same editable code surface", () => {
    const supplyContext = {
      instance: { ...instance, symbolId: "vdd-port", reference: undefined },
      referenceVisible: null,
      valueVisible: null,
      connection: "global" as const,
      netName: "VDD",
    };
    const decoded = JSON.parse(formatComponentPropertyCode(supplyContext));
    expect(decoded.connection).toBe("global");
    expect(decoded.netName).toBe("VDD");
    decoded.connection = "cell-pin";
    decoded.netName = " AVDD ";
    expect(
      parseComponentPropertyCode(JSON.stringify(decoded), supplyContext),
    ).toMatchObject({
      ok: true,
      value: { connection: "cell-pin", netName: "AVDD" },
    });

    decoded.connection = "project";
    expect(
      parseComponentPropertyCode(JSON.stringify(decoded), supplyContext),
    ).toEqual({
      ok: false,
      message: 'connection must be "cell-pin" or "global"',
    });
    decoded.connection = "global";

    delete decoded.netName;
    expect(
      parseComponentPropertyCode(JSON.stringify(decoded), supplyContext),
    ).toEqual({
      ok: false,
      message: "netName is required for this component",
    });
    decoded.netName = "VDD";
    delete decoded.connection;
    expect(
      parseComponentPropertyCode(JSON.stringify(decoded), supplyContext),
    ).toEqual({
      ok: false,
      message: "connection is required for this component",
    });

    const cellPinContext = {
      ...supplyContext,
      connection: "cell-pin" as const,
      netName: null,
    };
    const cellPinCode = JSON.parse(formatComponentPropertyCode(cellPinContext));
    expect(cellPinCode.connection).toBe("cell-pin");
    expect(cellPinCode).not.toHaveProperty("netName");
    expect(
      parseComponentPropertyCode(JSON.stringify(cellPinCode), cellPinContext),
    ).toMatchObject({ ok: true, value: { connection: "cell-pin" } });
  });

  it("refuses to take a drawn device off the sheet", () => {
    const source = formatComponentPropertyCode(context).replace(
      /"placement": \{[\s\S]*?\n  \},\n  "appearance"/u,
      '"placement": null,\n  "appearance"',
    );
    expect(parseComponentPropertyCode(source, context)).toEqual({
      ok: false,
      message:
        "placement cannot be changed to null; a Cell never holds a device its drawing does not show",
    });
  });

  it("accepts RGB authoring, persists hex, and displays fixed colors as compact RGB", () => {
    const decoded = JSON.parse(formatComponentPropertyCode(context));
    decoded.appearance.color = [255, 0, 128];
    const parsed = parseComponentPropertyCode(JSON.stringify(decoded), context);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.message);
    expect(parsed.value.appearance).toEqual({ color: "#ff0080" });
    const formatted = serializeComponentPropertyCode(parsed.value);
    expect(formatted).toContain('"color": [255, 0, 128]');
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
    decoded.appearance.color = channels;
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
      color: "auto",
      internalMark: "G",
      inputsSwapped: false,
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

  it.each([
    ["opamp-differential", false, false],
    ["opamp-differential-inputs-swapped", true, false],
    ["opamp-differential-crossed", false, true],
    ["opamp-differential-crossed-lettered-inputs-swapped", true, true],
    ["opamp-lettered-inputs-swapped", true, undefined],
    ["comparator-unmarked-inputs-swapped", true, undefined],
    ["differential-transconductance", false, undefined],
    ["resistor", undefined, undefined],
  ] as const)(
    "round-trips independent polarity state for %s",
    (symbolId, inputsSwapped, outputsSwapped) => {
      const swapContext = {
        ...context,
        instance: { ...instance, symbolId, netlist: undefined },
        details: { parameters: [] },
      };
      const source = formatComponentPropertyCode(swapContext);
      const decoded = JSON.parse(source);
      expect(decoded.appearance.inputsSwapped).toBe(inputsSwapped);
      expect(decoded.appearance.outputsSwapped).toBe(outputsSwapped);
      expect(decoded).not.toHaveProperty("symbol");
      const parsed = parseComponentPropertyCode(source, swapContext);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) throw new Error(parsed.message);
      expect(serializeComponentPropertyCode(parsed.value)).toBe(source);
      const defaults = JSON.parse(defaultComponentPropertyCode(swapContext));
      expect(defaults.appearance.inputsSwapped).toBe(
        inputsSwapped === undefined ? undefined : false,
      );
      expect(defaults.appearance.outputsSwapped).toBe(
        outputsSwapped === undefined ? undefined : false,
      );
      expect(
        parseComponentPropertyCode(JSON.stringify(defaults), swapContext).ok,
      ).toBe(true);
    },
  );

  it.each(["inputsSwapped", "outputsSwapped"])(
    "rejects missing, malformed or unsupported %s",
    (key) => {
      const swapContext = {
        ...context,
        instance: { ...instance, symbolId: "opamp-differential" },
      };
      for (const invalid of [undefined, "true", 1, null]) {
        const decoded = JSON.parse(formatComponentPropertyCode(swapContext));
        decoded.appearance[key] = invalid;
        expect(
          parseComponentPropertyCode(JSON.stringify(decoded), swapContext),
        ).toEqual({
          ok: false,
          message: `appearance.${key} ${invalid === undefined ? "is required" : "must be true or false"}`,
        });
      }
      const unsupported = JSON.parse(formatComponentPropertyCode(context));
      unsupported.appearance[key] = true;
      expect(
        parseComponentPropertyCode(JSON.stringify(unsupported), context),
      ).toEqual({
        ok: false,
        message: `appearance.${key} is not a supported property`,
      });
    },
  );
});

describe("independent parameter visibility code", () => {
  const magneticContext = {
    ...context,
    instance: { ...instance, symbolId: "xfmr" },
    valueVisible: null,
    parameterVisibility: { k: true, lp: false, ls: false },
  };
  it("exposes named switches without an aggregate Value", () => {
    const source = formatComponentPropertyCode(magneticContext);
    expect(parseComponentPropertyCode(source, magneticContext)).toMatchObject({
      ok: true,
      value: {
        display: {
          visualAnnotation: true,
          parameters: { k: true, lp: false, ls: false },
        },
      },
    });
    expect(JSON.parse(source).display).not.toHaveProperty("value");
  });
  it("rejects unsupported keys and nonboolean visibility", () => {
    const source = formatComponentPropertyCode(magneticContext);
    expect(
      parseComponentPropertyCode(
        source.replace('"k": true', '"k": "yes"'),
        magneticContext,
      ),
    ).toMatchObject({
      ok: false,
      message: "display.parameters.k must be true or false",
    });
    expect(
      parseComponentPropertyCode(
        source.replace('"k": true', '"unknown": true'),
        magneticContext,
      ),
    ).toMatchObject({
      ok: false,
      message: "display.parameters.unknown is not a supported property",
    });
  });
});
