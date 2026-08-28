import { describe, expect, it } from "vitest";

import {
  CircuitProjectSchema,
  CURRENT_PROJECT_SCHEMA_VERSION,
  HexColorSchema,
  InstanceSchema,
  InstanceStyleOverrideSchema,
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
  it("accepts both foreground and background", () => {
    const result = InstanceStyleOverrideSchema.safeParse({
      foreground: "#FF0000",
      background: "#00FF00",
    });
    expect(result.success).toBe(true);
  });

  it("accepts only foreground", () => {
    const result = InstanceStyleOverrideSchema.safeParse({
      foreground: "#FF0000",
    });
    expect(result.success).toBe(true);
  });

  it("accepts only background", () => {
    const result = InstanceStyleOverrideSchema.safeParse({
      background: "#00FF00",
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty object", () => {
    const result = InstanceStyleOverrideSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects invalid hex colors", () => {
    expect(
      InstanceStyleOverrideSchema.safeParse({ foreground: "red" }).success,
    ).toBe(false);
    expect(
      InstanceStyleOverrideSchema.safeParse({ background: "#FFF" }).success,
    ).toBe(false);
  });

  it("rejects unknown keys", () => {
    expect(
      InstanceStyleOverrideSchema.safeParse({
        foreground: "#FF0000",
        borderColor: "#000000",
      }).success,
    ).toBe(false);
  });
});

describe("InstanceSchema with styleOverride", () => {
  const baseInstance = {
    id: "inst-1",
    symbolId: "resistor",
    placement: {
      position: { x: 0, y: 0 },
      rotation: 0 as const,
      mirror: "none" as const,
    },
    netlist: {
      reference: "R1",
      parameters: {},
    },
  };

  it("accepts an instance with styleOverride", () => {
    const result = InstanceSchema.safeParse({
      ...baseInstance,
      styleOverride: { foreground: "#FF0000", background: "#00FF00" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts an instance without styleOverride (backward compatible)", () => {
    const result = InstanceSchema.safeParse(baseInstance);
    expect(result.success).toBe(true);
    expect(result.data!.styleOverride).toBeUndefined();
  });

  it("accepts styleOverride with only foreground", () => {
    const result = InstanceSchema.safeParse({
      ...baseInstance,
      styleOverride: { foreground: "#123ABC" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects styleOverride with invalid color", () => {
    const result = InstanceSchema.safeParse({
      ...baseInstance,
      styleOverride: { foreground: "not-a-color" },
    });
    expect(result.success).toBe(false);
  });
});

describe("CircuitProject schema version", () => {
  it("current schema version is 30", () => {
    expect(CURRENT_PROJECT_SCHEMA_VERSION).toBe(30);
  });

  it("createEmptyProject produces schema version 30", () => {
    const project = createEmptyProject("test", "Test");
    expect(project.schemaVersion).toBe(30);
  });

  it("validates a project with styleOverride on an instance", () => {
    const project = createEmptyProject("test", "Test");
    const document = project.documents[0]!;
    document.instances.push({
      id: "inst-1",
      symbolId: "resistor",
      placement: {
        position: { x: 0, y: 0 },
        rotation: 0,
        mirror: "none",
      },
      netlist: { reference: "R1", parameters: {} },
      styleOverride: { foreground: "#FF0000", background: "#0000FF" },
    });
    const result = CircuitProjectSchema.safeParse(project);
    expect(result.success).toBe(true);
  });
});
