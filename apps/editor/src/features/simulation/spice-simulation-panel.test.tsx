import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  SpiceSimulationPanel,
  type SimulationRunState,
  type SimulatabilityView,
} from "./spice-simulation-panel";

const noop = () => undefined;

function render(
  overrides: Partial<{
    simulatability: SimulatabilityView;
    run: SimulationRunState;
    testbench: string;
    runsLocally: boolean;
  }> = {},
): string {
  return renderToStaticMarkup(
    <SpiceSimulationPanel
      simulatability={overrides.simulatability ?? { kind: "ready" }}
      run={overrides.run ?? { kind: "idle" }}
      testbench={overrides.testbench ?? ""}
      onTestbenchChange={noop}
      onRun={noop}
      circuitIncludePath="/app/circuit.spi"
      {...(overrides.runsLocally === undefined
        ? {}
        : { runsLocally: overrides.runsLocally })}
    />,
  );
}

describe("SpiceSimulationPanel", () => {
  it("refuses before the run and names the instances in the way", () => {
    // ADR 0055: refusal is a diagnosis, never a silent failure. A greyed
    // button with no reason leaves the author nowhere to go.
    const markup = render({
      simulatability: {
        kind: "blocked",
        blockers: [
          { instanceId: "U3", reason: "signal-flow block has no device model" },
          {
            instanceId: "E1",
            reason: "behavioural source has no device model",
          },
        ],
      },
      testbench: ".op\n",
    });

    expect(markup).toContain("U3");
    expect(markup).toContain("signal-flow block has no device model");
    expect(markup).toContain("E1");
    expect(markup).toMatch(/data-testid="simulation-run"[^>]*disabled/u);
  });

  it("ships no testbench template, example, or default analysis", () => {
    // The testbench encodes what the designer is trying to prove; guessing it
    // produces confident answers to questions nobody asked.
    const markup = render();

    expect(markup).toContain('data-testid="simulation-testbench"');
    // The input starts genuinely empty — no seeded directive of any kind.
    expect(markup).not.toMatch(/\.(op|ac|tran|dc)\b/u);
    expect(markup).not.toContain(".control");
    expect(markup).not.toContain(".lib");
    // What it does state is our own interface, which is documentation rather
    // than a guess at intent.
    expect(markup).toContain("/app/circuit.spi");
  });

  it("gives the testbench room for a real one, not a single line", () => {
    // The reference benches run to a hundred lines with a .control section.
    expect(render()).toMatch(/rows="1[0-9]"|rows="[2-9][0-9]"/u);
  });

  it("will not run an empty testbench", () => {
    expect(render({ testbench: "   \n" })).toMatch(
      /data-testid="simulation-run"[^>]*disabled/u,
    );
    expect(render({ testbench: ".op\n" })).not.toMatch(
      /data-testid="simulation-run"[^>]*disabled/u,
    );
  });

  it("says on the panel that the circuit leaves this machine", () => {
    // ADR 0055 states this in the product, not buried in a document.
    const hosted = render();
    expect(hosted).toContain("leave this machine");
    expect(hosted).toContain("local host");

    const local = render({ runsLocally: true });
    expect(local).toContain("stay here");
  });

  it("shows ngspice's own words when a run fails", () => {
    // "Simulation failed" is useless; non-convergence and missing models are
    // ordinary, and the author needs the simulator's actual text.
    const log =
      "doAnalyses: TRAN:  Timestep too small; time = 1.2e-09, timestep = 1e-18";
    const markup = render({ run: { kind: "failed", log } });

    expect(markup).toContain("Timestep too small");
    expect(markup).toContain("time = 1.2e-09");
  });

  it("keeps the log on success too, where convergence warnings live", () => {
    const markup = render({
      run: {
        kind: "done",
        operatingPoint: new Map([["net-out", 0.9]]),
        log: "Warning: singular matrix reordered",
      },
    });

    expect(markup).toContain("singular matrix reordered");
    expect(markup).toContain("1 node");
  });

  it("draws the AC plot only when there is an AC result", () => {
    const withoutAc = render({
      run: { kind: "done", operatingPoint: new Map(), log: "" },
    });
    expect(withoutAc).not.toContain('data-testid="simulation-ac-plot"');

    const withAc = render({
      run: {
        kind: "done",
        log: "",
        acTraces: [
          {
            label: "vdb(vout)",
            points: [
              { frequency: 1, magnitudeDb: 40, phaseDeg: 0 },
              { frequency: 1e6, magnitudeDb: -20, phaseDeg: -90 },
            ],
          },
        ],
      },
    });
    expect(withAc).toContain('data-testid="simulation-ac-plot"');
    expect(withAc).toContain("<svg");
  });
});
