import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  Prepared,
  SimulationOutputData,
} from "@icm/simulation-service/contract";
import {
  operatingPointOutputs,
  isRedundantOpMeasurement,
} from "./operating-point-presentation";
import { SimulationOutputResults } from "./simulation-output-results";

function fixture() {
  const prepared: Pick<Prepared, "vectors" | "deviceOperatingPoints"> = {
    vectors: [{ probeId: "id", vector: "@m.x1.m1[id]", quantity: "native" }],
    deviceOperatingPoints: [
      {
        id: "native-op:m.x1.m1",
        documentId: "dut",
        instanceId: "M1",
        occurrence: ["X1"],
        reference: "X1.M1",
        polarity: "nmos",
        values: [
          {
            parameter: "id",
            label: "ID",
            unit: "A",
            expression: {
              kind: "acquisition",
              acquisitionId: "id",
              quantity: "native",
            },
          },
        ],
      },
    ],
  };
  const data: SimulationOutputData = {
    schemaVersion: 1,
    diagnostics: [],
    analyses: [
      {
        analysis: "op",
        plotName: "Operating Point",
        rawPlotOrdinals: [0],
        outputs: [
          {
            id: "native:i(@m.x1.m1[id])",
            label: "i(@m.x1.m1[id])",
            unit: "A",
            values: [0.001],
          },
          { id: "native:v(out)", label: "v(out)", unit: "V", values: [0.001] },
        ],
      },
    ],
    deviceOperatingPoints: [
      {
        ...prepared.deviceOperatingPoints[0]!,
        occurrence: ["X1"],
        analysisIndex: 0,
        values: [
          {
            parameter: "id",
            label: "ID",
            unit: "A",
            status: "available",
            value: 0.001,
          },
        ],
      },
    ],
    measurements: [
      {
        id: "copy",
        analysisIndex: 0,
        analysis: "op",
        plotName: "Operating Point",
        outputId: "native:i(@m.x1.m1[id])",
        outputLabel: "i(@m.x1.m1[id])",
        metric: "operating-point",
        label: "Operating point",
        unit: "A",
        status: "available",
        value: 0.001,
      },
    ],
  };
  return { prepared, data };
}

describe("OP result ownership", () => {
  it("renders MOS once, keeps equal-valued nodes, and never mutates archive evidence", () => {
    const { data, prepared } = fixture();
    const original = structuredClone(data);
    const html = renderToStaticMarkup(
      <SimulationOutputResults
        resultKey="op"
        data={data}
        prepared={prepared}
        outputs={[]}
        view="op"
      />,
    );
    expect(html.match(/>ID</gu)).toHaveLength(1);
    expect(html).not.toContain("i(@m.x1.m1[id])");
    expect(html).not.toContain("Measurements");
    expect(html).toContain("v(out)");
    expect(data).toEqual(original);
  });
  it.each([
    "missing mapping",
    "other occurrence",
    "other record",
    "unavailable",
    "different value",
  ])("retains native evidence with %s", (kind) => {
    const { data, prepared } = fixture();
    const device = data.deviceOperatingPoints![0]!;
    if (kind === "missing mapping") prepared.deviceOperatingPoints = [];
    if (kind === "other occurrence") device.occurrence = ["X2"];
    if (kind === "other record") device.analysisIndex = 1;
    if (kind === "unavailable")
      device.values = [
        {
          parameter: "id",
          label: "ID",
          unit: "A",
          status: "unavailable",
          reason: "missing",
        },
      ];
    if (kind === "different value")
      device.values = [
        {
          parameter: "id",
          label: "ID",
          unit: "A",
          status: "available",
          value: 2,
        },
      ];
    expect(operatingPointOutputs(data, 0, prepared)).toEqual(
      data.analyses[0]!.outputs,
    );
  });
  it("retains authored, failed and inconsistent measurements in historical results", () => {
    const { data } = fixture();
    const copy = data.measurements![0]!;
    expect(isRedundantOpMeasurement(data, copy)).toBe(true);
    expect(
      isRedundantOpMeasurement(data, { ...copy, origin: "authored" }),
    ).toBe(false);
    expect(
      isRedundantOpMeasurement(data, {
        ...copy,
        status: "available",
        value: 2,
      }),
    ).toBe(false);
    expect(isRedundantOpMeasurement(data, { ...copy, analysisIndex: 1 })).toBe(
      false,
    );
    expect(
      isRedundantOpMeasurement(data, {
        ...copy,
        status: "unavailable",
        reason: "missing",
      }),
    ).toBe(false);
  });
  it("labels separate OP records and does not collapse equal values across runs", () => {
    const { data, prepared } = fixture();
    data.analyses.push({
      ...structuredClone(data.analyses[0]!),
      rawPlotOrdinals: [1],
    });
    const html = renderToStaticMarkup(
      <SimulationOutputResults
        resultKey="op"
        data={data}
        prepared={prepared}
        outputs={[]}
        view="op"
      />,
    );
    expect(html).toContain("record 0");
    expect(html).toContain("record 1");
    expect(html.match(/>v\(out\)</gu)).toHaveLength(2);
    expect(html).toContain("i(@m.x1.m1[id])");
  });
  it("does not hide explicitly authored aliases or unknown device parameters", () => {
    const { data, prepared } = fixture();
    data.analyses[0]!.outputs.push({
      id: "my-id",
      label: "authored ID",
      unit: "A",
      values: [0.001],
    });
    data.analyses[0]!.outputs.push({
      id: "native:@m.x1.m1[unknown]",
      label: "unknown",
      unit: "A",
      values: [0.001],
    });
    expect(
      operatingPointOutputs(data, 0, prepared).map((output) => output.id),
    ).toEqual(["native:v(out)", "my-id", "native:@m.x1.m1[unknown]"]);
  });
});
