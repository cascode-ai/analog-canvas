import { describe, expect, it } from "vitest";
import {
  CircuitProjectSchema,
  createEmptyProject,
  parseProjectSnapshot,
} from "@icm/model";
import { withProjectComponentDefinitions } from "@icm/symbols";

import { parseProject, validateProjectReadSnapshot } from "./load.js";
import { serializeCompactProject, serializeProject } from "./save.js";
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

  it("serializes deeply frozen projects with RichText, symbols and source spans without mutating inputs", () => {
    const base = createEmptyProject("cow-save", "CoW Save");
    base.source.files.push({
      id: "src-1",
      path: "amp.cir",
      hash: "sha256:abc123",
      content: {
        text: ".subckt top in out\nR1 in out 10k\n.ends\n",
        encoding: "utf-8",
      },
    });
    const doc = base.documents[0]!;
    doc.sourceBinding = {
      cellName: "top",
      sourceRef: {
        fileId: "src-1",
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 18, line: 1, column: 19 },
      },
    };
    doc.instances.push({
      id: "R1",
      reference: "R1",
      symbolId: "resistor",
      placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
      netlist: {
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: { value: "10k" },
      },
      sourceRef: {
        fileId: "src-1",
        start: { offset: 19, line: 2, column: 1 },
        end: { offset: 32, line: 2, column: 14 },
      },
    });
    doc.annotations.push({
      id: "val-R1",
      kind: "instance-value",
      content: {
        runs: [
          {
            kind: "span",
            style: "bold",
            children: [{ kind: "text", value: "10k" }],
          },
        ],
      },
      anchor: {
        kind: "object",
        objectId: "R1",
        localOffset: { x: 0, y: 20 },
        fallbackPosition: { x: 100, y: 120 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });
    const frozen = parseProjectSnapshot(
      withProjectComponentDefinitions(CircuitProjectSchema.parse(base)),
    );
    const before = structuredClone(frozen);

    const readable = serializeProject(frozen);
    const compact = serializeCompactProject(frozen);
    expect(frozen).toEqual(before);

    const parsedReadable = parseProject(readable);
    const parsedCompact = parseProject(compact);
    expect(parsedReadable).toEqual(before);
    expect(parsedCompact).toEqual(before);
    expect(serializeProject(parsedCompact)).toBe(readable);
    expect(serializeCompactProject(parsedReadable)).toBe(compact);
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
