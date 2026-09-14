import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DcResultsExplorer } from "./dc-results-explorer";
import { AcResultsExplorer } from "./ac-results-explorer";
import { TransientResultsExplorer } from "./transient-results-explorer";

describe("DcResultsExplorer", () => {
  it.each(["dc", "ac", "tran"] as const)(
    "keeps case-distinct %s raw-result bindings and labels",
    (kind) => {
      const vectors = [
        { probeId: "upper", vector: "Out", quantity: "voltage" as const },
        { probeId: "lower", vector: "out", quantity: "voltage" as const },
      ];
      const display = {
        vectors,
        probes: [],
        labels: { upper: "Upper trace", lower: "Lower trace" },
      };
      const probes = vectors.map((v, i) => ({
        name: v.vector,
        quantity: "voltage",
        unit: "V",
        value: [i + 1, i + 2],
      }));
      const plotName = "Native identity";
      const markup = renderToStaticMarkup(
        kind === "dc" ? (
          <DcResultsExplorer
            {...display}
            analysis={{
              analysis: "dc",
              plotName,
              probes,
              sweep: {
                name: "supply",
                unit: "V",
                quantity: "voltage",
                values: [0, 1],
              },
            }}
          />
        ) : kind === "ac" ? (
          <AcResultsExplorer
            {...display}
            analysis={{
              analysis: "ac",
              plotName,
              frequencyHz: [1, 2],
              probes: probes.map(({ value, ...p }) => ({
                ...p,
                real: value,
                imag: [0, 0],
              })),
            }}
          />
        ) : (
          <TransientResultsExplorer
            {...display}
            analysis={{
              analysis: "tran",
              plotName,
              probes,
              timeSeconds: [0, 1],
            }}
          />
        ),
      );
      expect(markup).toContain("Upper trace");
      expect(markup).toContain("Lower trace");
    },
  );
  it("plots the simulator sweep axis and labels compiled probes", () => {
    const markup = renderToStaticMarkup(
      <DcResultsExplorer
        analysis={{
          analysis: "dc",
          plotName: "DC transfer characteristic",
          sweep: {
            name: "v-sweep",
            quantity: "voltage",
            unit: "V",
            values: [0, 0.5, 1],
          },
          probes: [
            {
              name: "v(out)",
              quantity: "voltage",
              unit: "V",
              value: [0, 0.25, 0.5],
            },
          ],
        }}
        vectors={[
          { probeId: "probe-out", vector: "v(out)", quantity: "voltage" },
        ]}
        probes={[
          {
            id: "probe-out",
            kind: "voltage",
            documentId: "tb",
            anchor: { kind: "base-net", netId: "out" },
            occurrence: [],
          },
        ]}
        labels={{ "probe-out": "Output" }}
      />,
    );
    expect(markup).toContain('aria-label="DC sweep results"');
    expect(markup).toContain('aria-label="DC voltage"');
    expect(markup).not.toContain("Voltage DC sweep");
    expect(markup).toContain("3 points");
    expect(markup).toContain("Output");
    expect(markup).toContain('class="ac-axis-title"');
    expect(markup).toContain(">v-sweep/V</text>");
    expect(markup).toContain("<polyline");
    expect(markup).toContain(">-0.05</text>");
    expect(markup).toContain(">1.05</text>");
    expect(markup).toContain(">voltage/mV</text>");
  });
});
