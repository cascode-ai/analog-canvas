import {
  createEmptyDocument,
  DraftingObjectSchema,
  flattenRichText,
} from "@icm/model";
import type { DigitalSimulationResult } from "@icm/simulation";
import { describe, expect, it } from "vitest";

import {
  createTimingWaveformDiagram,
  defaultWaveformLabelDocument,
  layoutTimingWaveformDiagram,
  parseSimulationTimePs,
  timingWaveformSvg,
  traceStepPoints,
  waveformDraftingObjects,
} from "./timing-waveform";

const result: DigitalSimulationResult = {
  documentId: "main",
  documentRevision: 4,
  inputFingerprint: "test-fingerprint",
  stopTimePs: 20_000,
  completed: true,
  diagnostics: [],
  traces: [
    {
      netId: "clock",
      baseNetIds: ["clock"],
      name: "CK",
      transitions: [
        { timePs: 0, value: "0" },
        { timePs: 5_000, value: "1" },
        { timePs: 10_000, value: "0" },
      ],
    },
  ],
};

const presentation = createEmptyDocument("main", "Main").presentation;

function layout(
  aliases: Parameters<typeof createTimingWaveformDiagram>[1] = {},
) {
  return layoutTimingWaveformDiagram(
    createTimingWaveformDiagram(result, aliases),
    presentation,
  );
}

describe("timing waveform presentation", () => {
  it("parses explicit simulation time units into integer picoseconds", () => {
    expect(parseSimulationTimePs("40ns")).toBe(40_000);
    expect(parseSimulationTimePs("1.5 us")).toBe(1_500_000);
    expect(parseSimulationTimePs("0ns")).toBeNull();
    expect(parseSimulationTimePs("40")).toBeNull();
  });

  it("builds square-step points without interpolating digital edges", () => {
    expect(
      traceStepPoints(result.traces[0]!, 20_000, 100, 400, 20, 20),
    ).toEqual([
      { x: 100, y: 40 },
      { x: 200, y: 40 },
      { x: 200, y: 20 },
      { x: 300, y: 20 },
      { x: 300, y: 40 },
      { x: 500, y: 40 },
    ]);
  });

  it("keeps the entire default Razavi label bold italic without implicit subscripts", () => {
    const label = defaultWaveformLabelDocument("CLK_LONG");
    expect(flattenRichText(label)).toBe("CLK_LONG");
    expect(label).toEqual({
      runs: [
        {
          kind: "span",
          style: "italic",
          children: [
            {
              kind: "span",
              style: "bold",
              children: [{ kind: "text", value: "CLK_LONG" }],
            },
          ],
        },
      ],
    });
  });

  it("uses one adaptive label gutter while preserving a compact fixed gap", () => {
    const short = layout();
    const long = layout({
      clock: defaultWaveformLabelDocument("CLOCK_ENABLE_EXTENDED"),
    });
    const shortRow = short.rows[0]!;
    const longRow = long.rows[0]!;

    expect(longRow.points[0]!.x).toBeGreaterThan(shortRow.points[0]!.x);
    expect(longRow.points[0]!.x - longRow.label.position.x).toBe(12);
    expect(shortRow.points.at(-1)!.x - shortRow.points[0]!.x).toBe(520);
    expect(longRow.points.at(-1)!.x - longRow.points[0]!.x).toBe(520);
  });

  it("renders preview/export from the exact drafting layout placed on canvas", () => {
    const waveformLayout = layout();
    let suffix = 0;
    const objects = waveformDraftingObjects(
      waveformLayout,
      { x: 0, y: 0 },
      (prefix) => `${prefix}-${++suffix}`,
    );
    const svg = timingWaveformSvg(waveformLayout, presentation);
    const trace = objects.find(
      (object) =>
        object.kind === "construction-line" && object.lineStyle === "solid",
    );
    const timeSymbol = objects.at(-1);

    expect(svg).toContain('aria-labelledby="title"');
    expect(svg).toContain('<title id="title">Digital timing waveform</title>');
    expect(svg).toContain("stroke-dasharray");
    expect(svg).toContain("CK");
    expect(svg).toContain("20 ns");
    expect(svg).toContain("font-style:italic");
    expect(svg).toContain("font-weight:700");
    expect(trace).toMatchObject({
      kind: "construction-line",
      points: waveformLayout.rows[0]!.points,
    });
    expect(timeSymbol?.kind).toBe("text");
    if (timeSymbol?.kind === "text") {
      expect(flattenRichText(timeSymbol.content)).toBe("t");
    }
    for (const object of objects) {
      expect(DraftingObjectSchema.parse(object)).toEqual(object);
    }
  });
});
