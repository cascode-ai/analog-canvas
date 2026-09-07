import { createEmptyProject } from "@icm/model";
import { describe, expect, it } from "vitest";

import { deriveOperatingPointCanvasProjection } from "./operating-point-projection";

describe("deriveOperatingPointCanvasProjection", () => {
  it("maps only direct finite OP voltages through authored object anchors", () => {
    const project = createEmptyProject("op-projection", "OP");
    const document = project.documents[0]!;
    document.nets.push({ id: "net-out", terminals: [] });
    const voltage = {
      id: "out-voltage",
      label: "V(out)",
      expression: {
        kind: "voltage" as const,
        documentId: document.id,
        occurrence: [],
        anchor: { kind: "base-net" as const, netId: "net-out" },
      },
    };
    const projection = deriveOperatingPointCanvasProjection(
      project,
      document.id,
      "revision-1",
      {
        schemaVersion: 1,
        analyses: [
          {
            analysis: "op",
            plotName: "Operating Point",
            outputs: [
              {
                id: voltage.id,
                label: voltage.label,
                unit: "V",
                values: [1.25],
              },
              {
                id: "gain",
                label: "Gain",
                unit: "1",
                values: [10],
              },
            ],
          },
          {
            analysis: "tran",
            plotName: "Transient",
            domain: { name: "time", unit: "s", values: [0] },
            outputs: [
              {
                id: voltage.id,
                label: voltage.label,
                unit: "V",
                values: [9],
              },
            ],
          },
        ],
        diagnostics: [],
      },
      [
        voltage,
        {
          id: "gain",
          label: "Gain",
          expression: { kind: "constant", value: 10 },
        },
      ],
      "named",
    );

    expect(projection).toEqual({
      rootDocumentId: document.id,
      inputRevision: "revision-1",
      display: "named",
      values: [
        {
          documentId: document.id,
          occurrence: [],
          netId: "net-out",
          volts: 1.25,
        },
      ],
    });
  });

  it("keeps repeated hierarchy occurrences distinct", () => {
    const project = createEmptyProject("op-hierarchy", "Hierarchy");
    const document = project.documents[0]!;
    document.nets.push({ id: "net-child", terminals: [] });
    const outputs = ["x1", "x2"].map((instanceId, index) => ({
      id: `voltage-${instanceId}`,
      label: instanceId,
      expression: {
        kind: "voltage" as const,
        documentId: document.id,
        occurrence: [instanceId],
        anchor: { kind: "base-net" as const, netId: "net-child" },
      },
      value: index + 1,
    }));
    const projection = deriveOperatingPointCanvasProjection(
      project,
      document.id,
      "revision-2",
      {
        schemaVersion: 1,
        analyses: [
          {
            analysis: "op",
            plotName: "Operating Point",
            outputs: outputs.map((output) => ({
              id: output.id,
              label: output.label,
              unit: "V",
              values: [output.value],
            })),
          },
        ],
        diagnostics: [],
      },
      outputs,
      "all",
    );

    expect(
      projection.values.map((value) => [value.occurrence, value.volts]),
    ).toEqual([
      [["x1"], 1],
      [["x2"], 2],
    ]);
  });
});
