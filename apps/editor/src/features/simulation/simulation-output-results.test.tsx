import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SimulationOutputResults } from "./simulation-output-results";

describe("Simulation Output Results", () => {
  it("shows captured singletons as record-local table values without rendering a waveform", () => {
    const markup = renderToStaticMarkup(
      <SimulationOutputResults
        outputs={[]}
        data={{
          schemaVersion: 1,
          diagnostics: [],
          analyses: [
            {
              analysis: "ac",
              plotName: "AC",
              rawPlotOrdinals: [0],
              domain: { name: "Frequency", unit: "Hz", values: [100, 200] },
              outputs: [],
              scalars: [
                {
                  id: "native:peak",
                  label: "peak_gain_db",
                  unit: "",
                  value: 4.43515,
                },
                {
                  id: "native:z",
                  label: "phasor",
                  unit: "V",
                  value: 3,
                  imaginary: -4,
                },
              ],
            },
          ],
        }}
      />,
    );
    expect(markup).toContain('aria-label="Captured scalars record 1"');
    expect(markup).toContain("4.435150");
    expect(markup).toContain("Unknown");
    expect(markup).toContain("− j4.000000");
    expect(markup).not.toContain("<svg");
    expect(markup).not.toContain("waveform-trace-list");
  });
  it("renders signed native dB and phase in independent unit-labelled plots", () => {
    const markup = renderToStaticMarkup(
      <SimulationOutputResults
        resultKey="native-rc"
        outputs={[]}
        data={{
          schemaVersion: 1,
          diagnostics: [],
          analyses: [
            {
              analysis: "ac",
              plotName: "RC",
              domain: {
                name: "Frequency",
                unit: "Hz",
                values: [10, 1000, 1000000],
              },
              outputs: [
                {
                  id: "gain",
                  label: "gain_db",
                  unit: "dB",
                  values: [0, -3, -56],
                  semantics: {
                    valueKind: "real",
                    quantity: "decibel",
                    origin: "expression",
                  },
                },
                {
                  id: "phase",
                  label: "phase_deg",
                  unit: "deg",
                  values: [0, -45, -90],
                  semantics: {
                    valueKind: "real",
                    quantity: "notype",
                    origin: "expression",
                  },
                },
              ],
            },
          ],
        }}
      />,
    );
    expect(markup).toContain('aria-label="AC Decibels"');
    expect(markup).toContain('aria-label="AC Phase"');
    expect(markup).toContain("dB");
    expect(markup).toContain("deg");
    expect(markup).toMatch(/-\d/);
    expect(markup).not.toContain(">Magnitude</button>");
    expect(markup.match(/class="simulation-plot-layout"/gu)).toHaveLength(2);
  });
  it("uses a compact analysis heading and one trailing measurement summary", () => {
    const markup = renderToStaticMarkup(
      <SimulationOutputResults
        resultKey="run-1"
        outputs={[]}
        data={{
          schemaVersion: 1,
          diagnostics: [],
          analyses: [
            {
              analysis: "op",
              plotName: "Bias point",
              outputs: [
                {
                  id: "out-v",
                  label: "VOUT",
                  unit: "V",
                  values: [1.5],
                },
              ],
            },
          ],
          measurements: [
            {
              id: "measurement-out-v",
              analysisIndex: 0,
              analysis: "op",
              plotName: "Bias point",
              outputId: "out-v",
              outputLabel: "VOUT",
              metric: "operating-point",
              label: "Operating point",
              unit: "V",
              status: "available",
              value: 1.5,
            },
          ],
        }}
      />,
    );

    expect(markup).toContain('class="simulation-output-results"');
    expect(markup).toContain('class="simulation-analysis-card"');
    expect(markup).toContain("Operating Point Analysis");
    expect(markup).not.toContain("<small>Bias point</small>");
    expect(markup).toContain("Measurements");
    expect(markup.indexOf("Measurements")).toBeGreaterThan(
      markup.indexOf("</section>"),
    );
  });

  it("keeps Noise spectra and integrated totals in one dedicated result", () => {
    const markup = renderToStaticMarkup(
      <SimulationOutputResults
        resultKey="run-noise"
        outputs={[]}
        data={{
          schemaVersion: 1,
          diagnostics: [],
          analyses: [
            {
              analysis: "noise",
              plotName: "Noise Analysis",
              domain: { name: "Frequency", unit: "Hz", values: [1, 10] },
              outputs: [
                {
                  id: "noise-output-density",
                  label: "Output noise density",
                  unit: "V/sqrt(Hz)",
                  values: [1e-9, 2e-9],
                },
                {
                  id: "noise-input-density",
                  label: "Input-referred noise density",
                  unit: "V/sqrt(Hz)",
                  values: [3e-9, 4e-9],
                },
              ],
              integrated: [
                {
                  id: "noise-integrated-output",
                  label: "Integrated output noise",
                  unit: "V",
                  value: 9e-8,
                },
                {
                  id: "noise-integrated-input",
                  label: "Integrated input-referred noise",
                  unit: "V",
                  value: 1.8e-7,
                },
              ],
            },
          ],
        }}
      />,
    );

    expect(markup).toContain("Noise Analysis");
    expect(markup).toContain('class="noise-results-explorer"');
    expect(markup).toContain('aria-label="Integrated noise"');
    expect(markup).toContain("Output noise density");
    expect(markup).toContain("Integrated input-referred noise");
    expect(markup).toContain("1.80000e-7 V");
  });

  it("presents AC expression variants as one switchable signal family", () => {
    const gain = {
      kind: "divide" as const,
      left: {
        kind: "voltage" as const,
        documentId: "tb",
        anchor: { kind: "base-net" as const, netId: "out" },
        occurrence: [],
      },
      right: {
        kind: "voltage" as const,
        documentId: "tb",
        anchor: { kind: "base-net" as const, netId: "in" },
        occurrence: [],
      },
    };
    const markup = renderToStaticMarkup(
      <SimulationOutputResults
        resultKey="run-gain"
        outputs={[
          { id: "gain", label: "A_v", expression: gain },
          {
            id: "gain-db",
            label: "dB(A_v)",
            expression: { kind: "db20", operand: gain },
          },
        ]}
        data={{
          schemaVersion: 1,
          diagnostics: [],
          analyses: [
            {
              analysis: "ac",
              plotName: "AC Analysis",
              domain: { name: "Frequency", unit: "Hz", values: [10, 100] },
              outputs: [
                {
                  id: "gain",
                  label: "A_v",
                  unit: "1",
                  values: [2, 1],
                  imaginary: [0, -1],
                },
                {
                  id: "gain-db",
                  label: "dB(A_v)",
                  unit: "dB",
                  values: [6.0206, 3.0103],
                },
              ],
            },
          ],
        }}
      />,
    );

    expect(markup).toContain("A_v");
    expect(markup).not.toContain("dB(A_v)");
    expect(markup).toContain('aria-label="Ratio display"');
    expect(markup).toContain(">dB</button>");
    expect(markup.match(/class="simulation-plot-layout"/gu)).toHaveLength(1);
  });

  it("keeps non-AC scalar outputs visible", () => {
    const markup = renderToStaticMarkup(
      <SimulationOutputResults
        resultKey="run-tran"
        outputs={[]}
        data={{
          schemaVersion: 1,
          diagnostics: [],
          analyses: [
            {
              analysis: "tran",
              plotName: "Transient Analysis",
              domain: { name: "Time", unit: "s", values: [0, 1e-6] },
              outputs: [
                {
                  id: "out-v",
                  label: "VOUT",
                  unit: "V",
                  values: [0, 1.2],
                },
              ],
            },
          ],
        }}
      />,
    );

    expect(markup).toContain("VOUT");
    expect(markup).toContain('aria-label="Transient voltage"');
  });

  it("uses one switchable expression family in DC and transient plots", () => {
    const gain = {
      kind: "divide" as const,
      left: {
        kind: "voltage" as const,
        documentId: "tb",
        anchor: { kind: "base-net" as const, netId: "out" },
        occurrence: [],
      },
      right: {
        kind: "voltage" as const,
        documentId: "tb",
        anchor: { kind: "base-net" as const, netId: "in" },
        occurrence: [],
      },
    };
    const outputs = [
      { id: "gain", label: "A_v", expression: gain },
      {
        id: "gain-db",
        label: "A_v / dB",
        expression: { kind: "db20" as const, operand: gain },
      },
      {
        id: "gain-phase",
        label: "phase(A_v)",
        expression: { kind: "phase" as const, operand: gain },
      },
    ];
    const resultOutputs = [
      { id: "gain", label: "A_v", unit: "1", values: [2, 1] },
      {
        id: "gain-db",
        label: "A_v / dB",
        unit: "dB",
        values: [6.0206, 0],
      },
      {
        id: "gain-phase",
        label: "phase(A_v)",
        unit: "deg",
        values: [0, 0],
      },
    ];
    const markup = renderToStaticMarkup(
      <SimulationOutputResults
        resultKey="run-complete"
        outputs={outputs}
        data={{
          schemaVersion: 1,
          diagnostics: [],
          analyses: [
            {
              analysis: "dc",
              plotName: "DC Analysis",
              domain: { name: "VINP", unit: "V", values: [0.8, 1] },
              outputs: resultOutputs,
            },
            {
              analysis: "tran",
              plotName: "Transient Analysis",
              domain: { name: "Time", unit: "s", values: [0, 1e-6] },
              outputs: resultOutputs,
            },
          ],
        }}
      />,
    );

    expect(markup.match(/aria-label="A_v display"/gu)).toHaveLength(2);
    expect(markup.match(/>Value<\/button>/gu)).toHaveLength(2);
    expect(markup.match(/>dB<\/button>/gu)).toHaveLength(2);
    expect(markup.match(/>Phase<\/button>/gu)).toHaveLength(2);
    expect(markup).not.toContain("A_v / dB");
    expect(markup).not.toContain("phase(A_v)");
    expect(markup.match(/class="simulation-expression-family"/gu)).toHaveLength(
      2,
    );
    expect(markup.match(/aria-pressed="true">Value/gu)).toHaveLength(2);
    expect(markup.match(/class="simulation-plot-layout"/gu)).toHaveLength(2);
  });
});
