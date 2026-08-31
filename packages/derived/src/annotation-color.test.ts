import type { Annotation, Instance } from "@icm/model";
import { describe, expect, it } from "vitest";

import {
  annotationOwningInstanceId,
  resolveAnnotationTextColor,
} from "./annotation-color.js";

function instance(id: string, foreground?: string): Instance {
  return {
    id,
    symbolId: "resistor",
    placement: {
      position: { x: 0, y: 0 },
      rotation: 0,
      mirror: "none",
    },
    ...(foreground ? { styleOverride: { foreground } } : {}),
  };
}

function label(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: "label",
    kind: "instance-label",
    binding: { kind: "instance-reference", instanceId: "semantic" },
    anchor: {
      kind: "object",
      objectId: "visual",
      localOffset: { x: 0, y: -20 },
      fallbackPosition: { x: 0, y: -20 },
    },
    alignment: "middle",
    rotation: 0,
    locked: false,
    ...overrides,
  };
}

describe("annotation text color", () => {
  it("uses binding ownership before a conflicting visual anchor", () => {
    const annotation = label();
    expect(annotationOwningInstanceId(annotation)).toBe("semantic");
    expect(
      resolveAnnotationTextColor(
        annotation,
        instance("semantic", "#DC2626"),
        "#000000",
      ),
    ).toBe("#DC2626");
  });

  it("falls back to an object anchor for literal instance text", () => {
    const annotation = label({
      binding: undefined,
      content: { runs: [{ kind: "text", value: "R_LOAD" }] },
    });
    expect(annotationOwningInstanceId(annotation)).toBe("visual");
    expect(
      resolveAnnotationTextColor(
        annotation,
        instance("visual", "#059669"),
        "#000000",
      ),
    ).toBe("#059669");
  });

  it("lets Annotation.textColor override inherited instance ink", () => {
    const annotation = label({ textColor: "#2563EB" });
    expect(
      resolveAnnotationTextColor(
        annotation,
        instance("semantic", "#DC2626"),
        "#000000",
      ),
    ).toBe("#2563EB");
  });

  it("uses the Document profile for annotations without instance ownership", () => {
    const annotation: Annotation = {
      id: "note",
      kind: "net-label",
      binding: { kind: "net-name", netId: "net-1" },
      anchor: { kind: "free", position: { x: 10, y: 20 } },
      netId: "net-1",
      alignment: "start",
      rotation: 0,
      locked: false,
    };
    expect(annotationOwningInstanceId(annotation)).toBeUndefined();
    expect(
      resolveAnnotationTextColor(
        annotation,
        instance("visual", "#DC2626"),
        "#123456",
      ),
    ).toBe("#123456");
  });
});
