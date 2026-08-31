import { describe, expect, it } from "vitest";

import {
  CircuitProjectSchema,
  CURRENT_PROJECT_SCHEMA_VERSION,
  HexColorSchema,
  InstanceSchema,
  InstanceStyleOverrideSchema,
  SignalFlowParametersSchema,
} from "./index.js";
import { createEmptyProject } from "../factories.js";

describe("HexColorSchema", () => {
  it("accepts valid #RRGGBB hex colors", () => {
    expect(HexColorSchema.safeParse("#000000").success).toBe(true);
    expect(HexColorSchema.safeParse("#FFFFFF").success).toBe(true);
    expect(HexColorSchema.safeParse("#ff0000").success).toBe(true);
    expect(HexColorSchema.safeParse("#AaBbCc").success).toBe(true);
    expect(HexColorSchema.safeParse("#123456").success).toBe(true);
  });

  it("rejects invalid color strings", () => {
    expect(HexColorSchema.safeParse("red").success).toBe(false);
    expect(HexColorSchema.safeParse("#FFF").success).toBe(false);
    expect(HexColorSchema.safeParse("#GGGGGG").success).toBe(false);
    expect(HexColorSchema.safeParse("#12345").success).toBe(false);
    expect(HexColorSchema.safeParse("#1234567").success).toBe(false);
    expect(HexColorSchema.safeParse("").success).toBe(false);
    expect(HexColorSchema.safeParse(123).success).toBe(false);
  });
});

describe("InstanceStyleOverrideSchema", () => {
  it("accepts independent foreground and background colors", () => {
    expect(
      InstanceStyleOverrideSchema.safeParse({
        foreground: "#FF0000",
        background: "#00FF00",
      }).success,
    ).toBe(true);
  });
  it("accepts individual and empty overrides", () => {
    expect(
      InstanceStyleOverrideSchema.safeParse({ foreground: "#FF0000" }).success,
    ).toBe(true);
    expect(
      InstanceStyleOverrideSchema.safeParse({ background: "#00FF00" }).success,
    ).toBe(true);
    expect(InstanceStyleOverrideSchema.safeParse({}).success).toBe(true);
  });
  it("rejects invalid colors and unknown keys", () => {
    expect(
      InstanceStyleOverrideSchema.safeParse({ foreground: "red" }).success,
    ).toBe(false);
    expect(
      InstanceStyleOverrideSchema.safeParse({ background: "#FFF" }).success,
    ).toBe(false);
    expect(
      InstanceStyleOverrideSchema.safeParse({ borderColor: "#000000" }).success,
    ).toBe(false);
    expect(
      InstanceStyleOverrideSchema.safeParse({
        foreground: "#FF0000",
        labelColor: "#0000FF",
      }).success,
    ).toBe(false);
  });
});

const baseInstance = {
  id: "inst-1",
  symbolId: "resistor",
  placement: {
    position: { x: 0, y: 0 },
    rotation: 0 as const,
    mirror: "none" as const,
  },
  reference: "R1",
  netlist: { parameters: {} },
};

describe("InstanceSchema presentation metadata", () => {
  it("accepts styleOverride and remains backward compatible", () => {
    expect(
      InstanceSchema.safeParse({
        ...baseInstance,
        styleOverride: { foreground: "#FF0000", background: "#00FF00" },
      }).success,
    ).toBe(true);
    const plain = InstanceSchema.safeParse(baseInstance);
    expect(plain.success).toBe(true);
    if (plain.success) expect(plain.data.styleOverride).toBeUndefined();
  });

  it("accepts signalFlowParameters independently of styleOverride", () => {
    expect(
      InstanceSchema.safeParse({
        ...baseInstance,
        signalFlowParameters: {
          formula: "z^-1",
          coefficient: "a1",
          bodyWidth: 120,
          bodyHeight: 80,
        },
      }).success,
    ).toBe(true);
  });

  it("rejects invalid Signal Flow text and dimensions", () => {
    for (const signalFlowParameters of [
      { formula: "", coefficient: "a1" },
      { formula: "ok", coefficient: "x".repeat(65) },
      { bodyWidth: 121 },
      { bodyWidth: 1010 },
      { bodyHeight: 19 },
      { bodyHeight: 510 },
    ]) {
      expect(
        InstanceSchema.safeParse({ ...baseInstance, signalFlowParameters })
          .success,
      ).toBe(false);
    }
  });
});

describe("SignalFlowParametersSchema", () => {
  it("accepts text-only, size-only, combined, and empty objects", () => {
    expect(
      SignalFlowParametersSchema.safeParse({ formula: "s/(s+1)" }).success,
    ).toBe(true);
    expect(
      SignalFlowParametersSchema.safeParse({ coefficient: "k1" }).success,
    ).toBe(true);
    expect(
      SignalFlowParametersSchema.safeParse({ bodyWidth: 160, bodyHeight: 90 })
        .success,
    ).toBe(true);
    expect(SignalFlowParametersSchema.safeParse({}).success).toBe(true);
  });

  it("rejects unknown keys and invalid lengths", () => {
    expect(
      SignalFlowParametersSchema.safeParse({ extra: "nope" }).success,
    ).toBe(false);
    expect(
      SignalFlowParametersSchema.safeParse({ formula: "x".repeat(257) })
        .success,
    ).toBe(false);
  });
});

describe("CircuitProject schema version", () => {
  it("current schema version is 35", () => {
    expect(CURRENT_PROJECT_SCHEMA_VERSION).toBe(35);
  });

  it("createEmptyProject produces schema version 35", () => {
    expect(createEmptyProject("test", "Test").schemaVersion).toBe(35);
  });

  it("validates style and Signal Flow metadata together", () => {
    const project = createEmptyProject("test", "Test");
    project.documents[0]!.instances.push({
      ...baseInstance,
      styleOverride: { foreground: "#FF0000", background: "#0000FF" },
      signalFlowParameters: {
        formula: "z^-1",
        coefficient: "b0",
        bodyWidth: 100,
        bodyHeight: 50,
      },
    });
    expect(CircuitProjectSchema.safeParse(project).success).toBe(true);
  });
});
