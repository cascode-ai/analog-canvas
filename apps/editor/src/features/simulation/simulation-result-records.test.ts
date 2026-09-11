import { describe, expect, it } from "vitest";
import type { SimulationOutputData } from "@icm/simulation-service/contract";
import {
  selectedResultRecords,
  resultRecordLabel,
} from "./simulation-result-records";
describe("record selection", () => {
  it("does not invent a stable identity from duplicate kind or Plotname", () => {
    const data: SimulationOutputData = {
      schemaVersion: 1,
      diagnostics: [],
      analyses: [
        {
          analysis: "op",
          plotName: "Operating Point",
          outputs: [],
          rawPlotOrdinals: [0],
        },
        {
          analysis: "op",
          plotName: "Operating Point",
          outputs: [],
          rawPlotOrdinals: [2],
        },
        { analysis: "ac", plotName: "AC", outputs: [], rawPlotOrdinals: [3] },
      ],
    };
    expect(selectedResultRecords(data).map((r) => r.index)).toEqual([2]);
    expect(selectedResultRecords(data, { op: 1 }).map((r) => r.index)).toEqual([
      1, 2,
    ]);
    expect(selectedResultRecords(data, { op: 99 }).map((r) => r.index)).toEqual(
      [2],
    );
    expect(resultRecordLabel(1, data.analyses[1]!)).toContain("record 2");
  });
});
