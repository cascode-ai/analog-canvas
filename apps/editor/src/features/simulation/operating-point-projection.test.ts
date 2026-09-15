import { createEmptyProject } from "@icm/model";
import { describe, expect, it } from "vitest";
import type {
  Prepared,
  SimulationOutputData,
} from "@icm/simulation-service/contract";

import { deriveOperatingPointCanvasProjection } from "./operating-point-projection";

describe("deriveOperatingPointCanvasProjection", () => {
  it("maps native untyped nodes only through captured voltage addresses and preserves occurrences", () => {
    const project = createEmptyProject("native-op", "Native OP");
    const document = project.documents[0]!;
    document.nets.push({ id: "n", terminals: [] });
    const target = {
      rootDocumentId: document.id,
      documentId: document.id,
      netId: "n",
      occurrence: [] as string[],
    };
    const signals: Prepared["signalTargets"] = {
      "X1:out": [{ ...target, occurrence: ["x1"] }],
      "X2:out": [{ ...target, occurrence: ["x2"] }],
      current: [{ ...target, terminal: { instanceId: "m", pinName: "D" } }],
      expression: [target],
      missing: [{ ...target, netId: "removed" }],
    };
    const raw = (name: string, value: number) => ({
      id: `native:${name}`,
      label: "same display label",
      unit: "",
      values: [value],
      semantics: {
        origin: "raw" as const,
        quantity: "notype",
        valueKind: "real" as const,
      },
    });
    const data: SimulationOutputData = {
      schemaVersion: 1,
      diagnostics: [],
      analyses: [
        {
          analysis: "op",
          plotName: "bias",
          outputs: [
            raw("X1:out", 1),
            raw("X2:out", 2),
            raw("x1:out", 3),
            raw("current", 4),
            raw("missing", 5),
            {
              ...raw("expression", 6),
              semantics: {
                origin: "expression",
                quantity: "notype",
                valueKind: "real",
              },
            },
          ],
        },
      ],
    };
    const derive = (selected?: number) =>
      deriveOperatingPointCanvasProjection(
        project,
        document.id,
        "rev",
        data,
        [],
        "all",
        selected,
        signals,
      );
    expect(derive().values.map((v) => [v.occurrence, v.volts])).toEqual([
      [["x1"], 1],
      [["x2"], 2],
    ]);
    // Multiple bias records require explicit selection, not accidental last-write wins.
    data.analyses.push({ ...data.analyses[0]!, plotName: "second bias" });
    expect(derive().values).toEqual([]);
    expect(derive(1).values).toHaveLength(2);
    expect(
      deriveOperatingPointCanvasProjection(
        project,
        document.id,
        "rev",
        data,
        [],
        "all",
        1,
      ).values,
    ).toEqual([]);
    data.analyses = [data.analyses[0]!];
    data.analyses[0]!.outputs = [raw("X1:out", 1)];
    data.analyses[0]!.postprocessor = { logLine: 7 };
    expect(
      deriveOperatingPointCanvasProjection(
        project,
        document.id,
        "rev",
        data,
        [],
        "all",
        undefined,
        signals,
      ).values,
    ).toEqual([]);
  });

  it("does not project postprocessor results or non-scalar/complex native values", () => {
    const project = createEmptyProject("native-op-filter", "Native OP");
    const document = project.documents[0]!;
    document.nets.push({ id: "n", terminals: [] });
    const output = {
      id: "native:out",
      label: "out",
      unit: "V",
      values: [1],
      semantics: {
        origin: "raw" as const,
        quantity: "voltage",
        valueKind: "real" as const,
      },
    };
    const signals = {
      out: [
        {
          rootDocumentId: document.id,
          documentId: document.id,
          netId: "n",
          occurrence: [],
        },
      ],
    };
    for (const values of [[null], [1, 2]]) {
      const data: SimulationOutputData = {
        schemaVersion: 1,
        diagnostics: [],
        analyses: [
          {
            analysis: "op",
            plotName: "bias",
            outputs: [{ ...output, values }],
          },
        ],
      };
      expect(
        deriveOperatingPointCanvasProjection(
          project,
          document.id,
          "rev",
          data,
          [],
          "all",
          undefined,
          signals,
        ).values,
      ).toEqual([]);
    }
    const data: SimulationOutputData = {
      schemaVersion: 1,
      diagnostics: [],
      analyses: [
        {
          analysis: "op",
          plotName: "bias",
          outputs: [{ ...output, imaginary: [1] }],
        },
      ],
    };
    expect(
      deriveOperatingPointCanvasProjection(
        project,
        document.id,
        "rev",
        data,
        [],
        "all",
        undefined,
        signals,
      ).values,
    ).toEqual([]);
  });
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
