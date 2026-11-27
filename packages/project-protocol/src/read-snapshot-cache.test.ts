import { describe, expect, it } from "vitest";
import {
  CircuitProjectSchema,
  createEmptyProject,
  parseProjectSnapshot,
} from "@icm/model";
import { withProjectComponentDefinitions } from "@icm/symbols";

import { validateProjectReadSnapshot } from "./load.js";
import { repairBoundFormatOverrides } from "./transforms/bound-format-override.js";
import { symbolSignature } from "./transforms/symbol-signature.js";

describe("project-protocol fast paths", () => {
  it("reuses frozen snapshots in validateProjectReadSnapshot without altering outputs", () => {
    const base = createEmptyProject("cache-test", "Cache Test");
    const frozen = parseProjectSnapshot(
      withProjectComponentDefinitions(CircuitProjectSchema.parse(base)),
    );
    const first = validateProjectReadSnapshot(frozen);
    const second = validateProjectReadSnapshot(frozen);
    expect(first).toBe(frozen);
    expect(second).toBe(frozen);
  });

  it("leaves clean raw projects untouched in repairBoundFormatOverrides", () => {
    const raw: Record<string, unknown> = {
      schemaVersion: 87,
      documents: [{ id: "d1", annotations: [] }],
    };
    expect(repairBoundFormatOverrides(raw)).toBe(raw);
  });

  it("computes key-order-independent symbol signatures identically for frozen and mutable inputs", () => {
    const left = { b: 2, a: [{ y: 1, x: 2 }, undefined], skip: undefined };
    const right = Object.freeze({ a: [{ x: 2, y: 1 }, undefined], b: 2 });
    expect(symbolSignature("test-sig", left)).toBe(
      symbolSignature("test-sig", right),
    );
  });
});
