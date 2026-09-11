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
        placement: { at: [123, 177], rotation: 90, mirror: "x" },
        display: { reference: true, value: false },
        appearance: { foreground: "#DC2626", background: "auto" },
      }),
    ).toEqual([
      {
        kind: "move_instance",
        instanceId: "R1",
        position: { x: 120, y: 180 },
      },
      { kind: "rotate_instance", instanceId: "R1", rotation: 90 },
      { kind: "mirror_instance", instanceId: "R1", mirror: "x" },
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
        display: { reference: true, value: false },
        appearance: { foreground: "auto", background: "auto" },
      }),
    ).toEqual([]);
  });
});
