import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  changeTransientTimeRange,
  TransientResultsExplorer,
  transientBoxZoomRanges,
  transientPolylinePoints,
  transientValueExtent,
} from "./transient-results-explorer";

describe("Transient Results Explorer", () => {
  it("maps the simulator's actual time coordinates rather than point indices", () => {
    const points = transientPolylinePoints([0, 1e-9, 10e-9], [0, 0.5, 1]);
    const x = points.split(" ").map((point) => Number(point.split(",")[0]));
    expect(x[1]! - x[0]!).toBeLessThan((x[2]! - x[0]!) / 5);
  });

  it("does not magnify simulator round-off around a constant signal", () => {
    const extent = transientValueExtent([1.8, 1.8 + 1e-13, 1.8 - 1e-13]);
    expect(extent[0]).toBeCloseTo(1.71, 10);
    expect(extent[1]).toBeCloseTo(1.89, 10);
  });

  it("maps a dragged plot rectangle onto ordered time and value ranges", () => {
    const ranges = transientBoxZoomRanges(
      { x: 572.5, y: 188.5 },
      { x: 233.5, y: 73.5 },
      [0, 10],
      [0, 4],
    );
    expect(ranges.time[0]).toBeCloseTo(2.5);
    expect(ranges.time[1]).toBeCloseTo(7.5);
    expect(ranges.value[0]).toBeCloseTo(1);
    expect(ranges.value[1]).toBeCloseTo(3);
  });

  it("presents linked voltage and current time-domain outputs", () => {
    const markup = renderToStaticMarkup(
      <TransientResultsExplorer
        analysis={{
          analysis: "tran",
          plotName: "Transient Analysis",
          timeSeconds: [0, 1e-9, 10e-9],
          probes: [
            {
              name: "v(out)",
              quantity: "voltage",
              unit: "V",
              value: [0, 0.5, 1],
            },
            {
              name: "i(v1)",
              quantity: "current",
              unit: "A",
              value: [0, 1e-3, 0],
            },
          ],
        }}
        vectors={[
          { probeId: "probe-out", vector: "v(out)", quantity: "voltage" },
          { probeId: "probe-v1", vector: "i(v1)", quantity: "current" },
        ]}
        probes={[
          {
            id: "probe-out",
            kind: "net-voltage",
            documentId: "tb",
            anchor: { kind: "base-net", netId: "out" },
            occurrence: [],
          },
          {
            id: "probe-v1",
            kind: "source-current",
            documentId: "tb",
            instanceId: "V1",
            occurrence: [],
          },
        ]}
        labels={{ "probe-out": "VOUT", "probe-v1": "IIN" }}
      />,
    );

    expect(markup).toContain("VOUT");
    expect(markup).toContain("IIN");
    expect(markup).toContain('aria-label="Transient voltage"');
    expect(markup).toContain('aria-label="Transient current"');
    expect(markup.match(/data-trace-index=/gu)).toHaveLength(2);
    expect(markup).toContain('aria-label="Plot tools"');
    expect(markup.match(/aria-label="Box zoom"/gu)).toHaveLength(2);
    expect(markup.match(/aria-label="Open plot"/gu)).toHaveLength(2);
    expect(markup).toContain(
      'class="ac-trace-hit" fill="none" stroke="transparent" stroke-width="12" pointer-events="stroke"',
    );
  });

  it("keeps explicit linear zoom and pan inside the transient interval", () => {
    expect(changeTransientTimeRange([0, 10], [0, 10], "zoom-in")).toEqual([
      2, 8,
    ]);
    expect(changeTransientTimeRange([2, 8], [0, 10], "pan-right")).toEqual([
      3.2, 9.2,
    ]);
    expect(changeTransientTimeRange([0, 10], [0, 10], "pan-left")).toEqual([
      0, 10,
    ]);
  });
});
