import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  TransientResultsExplorer,
  transientPolylinePoints,
} from "./transient-results-explorer";

describe("Transient Results Explorer", () => {
  it("maps the simulator's actual time coordinates rather than point indices", () => {
    const points = transientPolylinePoints([0, 1e-9, 10e-9], [0, 0.5, 1]);
    const x = points.split(" ").map((point) => Number(point.split(",")[0]));
    expect(x[1]! - x[0]!).toBeLessThan((x[2]! - x[0]!) / 5);
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
  });
});
