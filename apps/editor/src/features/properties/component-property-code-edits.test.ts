import { describe, expect, it } from "vitest";

import { createEmptyDocument } from "@icm/model";

import { planComponentPropertyCodeEdits } from "./component-property-code-edits";

describe("planComponentPropertyCodeEdits", () => {
  it("plans snapped placement, orientation, and appearance as typed edits", () => {
    const document = createEmptyDocument("main", "Main");
    const instance = {
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
      reference: "R1",
    };
    document.instances.push(instance);
    expect(
      planComponentPropertyCodeEdits(document, instance, {
        placement: { at: [123, 177], rotation: 90, mirror: "horizontal" },
        display: { visualAnnotation: true, value: false },
        appearance: { foreground: "#DC2626" },
      }),
    ).toEqual([
      {
        kind: "move_instance",
        instanceId: "R1",
        position: { x: 120, y: 180 },
      },
      { kind: "rotate_instance", instanceId: "R1", rotation: 90 },
      { kind: "mirror_instance", instanceId: "R1", mirror: "horizontal" },
      {
        kind: "set_instance_style_override",
        instanceId: "R1",
        styleOverride: { foreground: "#DC2626" },
      },
    ]);
  });

  it("emits no edit for the current presentation", () => {
    const document = createEmptyDocument("main", "Main");
    const instance = {
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
      reference: "R1",
    };
    document.instances.push(instance);
    expect(
      planComponentPropertyCodeEdits(document, instance, {
        placement: { at: [100, 100], rotation: 0, mirror: "none" },
        display: { visualAnnotation: true, value: false },
        appearance: { foreground: "auto" },
      }),
    ).toEqual([]);
  });

  it("clears a retired component background on the next appearance edit", () => {
    const document = createEmptyDocument("main", "Main");
    const instance = {
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
      styleOverride: { background: "#ffffff" },
    };
    document.instances.push(instance);
    expect(
      planComponentPropertyCodeEdits(document, instance, {
        placement: { at: [100, 100], rotation: 0, mirror: "none" },
        appearance: { foreground: "auto" },
      }),
    ).toEqual([
      {
        kind: "set_instance_style_override",
        instanceId: "R1",
        styleOverride: null,
      },
    ]);
  });

  it("switches a merged amplifier between no mark, A, and custom text", () => {
    const document = createEmptyDocument("main", "Main");
    const plain = {
      id: "A1",
      symbolId: "opamp",
      placement: null,
    };
    document.instances.push(plain);
    expect(
      planComponentPropertyCodeEdits(document, plain, {
        placement: null,
        appearance: { foreground: "auto", internalMark: "A" },
      }),
    ).toEqual([
      {
        kind: "set_instance_symbol",
        instanceId: "A1",
        symbolId: "opamp-lettered",
      },
    ]);
    expect(
      planComponentPropertyCodeEdits(document, plain, {
        placement: null,
        appearance: { foreground: "auto", internalMark: "G" },
      }),
    ).toEqual([
      {
        kind: "set_instance_symbol",
        instanceId: "A1",
        symbolId: "opamp-lettered",
      },
      {
        kind: "set_instance_signal_flow_parameters",
        instanceId: "A1",
        parameters: { formula: "G" },
      },
    ]);

    const marked = {
      ...plain,
      symbolId: "opamp-lettered",
      signalFlowParameters: { formula: "G" },
    };
    expect(
      planComponentPropertyCodeEdits(document, marked, {
        placement: null,
        appearance: { foreground: "auto", internalMark: "none" },
      }),
    ).toEqual([
      {
        kind: "set_instance_symbol",
        instanceId: "A1",
        symbolId: "opamp",
      },
      {
        kind: "set_instance_signal_flow_parameters",
        instanceId: "A1",
        parameters: null,
      },
    ]);
  });

  it("keeps comparator polarity independent from its input-swap state", () => {
    const document = createEmptyDocument("main", "Main");
    const instance = {
      id: "A1",
      symbolId: "comparator-inputs-swapped",
      placement: null,
    };
    document.instances.push(instance);
    expect(
      planComponentPropertyCodeEdits(document, instance, {
        placement: null,
        appearance: { foreground: "auto", inputPolarity: false },
      }),
    ).toEqual([
      {
        kind: "set_instance_symbol",
        instanceId: "A1",
        symbolId: "comparator-unmarked-inputs-swapped",
      },
    ]);
  });
});
