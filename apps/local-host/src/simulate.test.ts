import { describe, expect, it } from "vitest";

import { simulateLocally } from "./simulate.js";

/**
 * These run the SIMULATOR ON THIS MACHINE when there is one, and skip
 * themselves when there is not, so the suite stays honest on a machine
 * without ngspice instead of asserting against a mock that agrees with
 * whatever we believe today.
 */
const ngspiceAvailable = await simulateLocally(
  { netlist: "V1 a 0 DC 1\nR1 a 0 1k", testbench: ".control\nop\n.endc" },
  {},
).then((outcome) => outcome.kind === "ran");

const withSimulator = ngspiceAvailable ? it : it.skip;

describe("local simulation", () => {
  it("says a missing simulator is about the machine, not the circuit", async () => {
    const outcome = await simulateLocally(
      { netlist: "V1 a 0 DC 1", testbench: ".control\nop\n.endc" },
      { ngspicePath: "/nonexistent/ngspice-not-here" },
    );
    expect(outcome.kind).toBe("simulator-unavailable");
    if (outcome.kind !== "simulator-unavailable") return;
    // A designer must not read this as a verdict on their design.
    expect(outcome.message).toContain("Install ngspice");
    expect(outcome.message).not.toMatch(/circuit|netlist|converge/iu);
  });

  withSimulator("runs a real circuit through the real simulator", async () => {
    const outcome = await simulateLocally({
      netlist: "V1 in 0 DC 1\nR1 in out 1k\nR2 out 0 1k",
      testbench: ".control\nop\nprint v(out)\n.endc",
      inputRevision: "local-revision-1",
    });
    expect(outcome.kind).toBe("ran");
    if (outcome.kind !== "ran") return;
    expect(outcome.result.outcome.status).toBe("completed");
    expect(outcome.result.log).toContain("5.000000e-01");
    expect(outcome.result.metadata).toMatchObject({
      schemaVersion: 1,
      input: { inputRevision: "local-revision-1" },
      configuration: { modelLibrary: null },
      environment: {
        executor: "local-host",
        reproducibility: "observed",
        simulator: { name: "ngspice" },
      },
    });
    expect(outcome.result.metadata.environment.fingerprint).toMatch(
      /^[0-9a-f]{64}$/u,
    );
  });

  withSimulator(
    "returns requested vectors through the shared result policy",
    async () => {
      const outcome = await simulateLocally({
        netlist: "V1 in 0 DC 1\nR1 in out 1k\nR2 out 0 1k",
        testbench:
          ".control\nset filetype=ascii\nop\nwrite out.raw v(out)\n.endc",
      });
      expect(outcome.kind).toBe("ran");
      if (outcome.kind !== "ran") return;
      expect(outcome.result.outcome.status).toBe("completed");
      const operatingPoint = outcome.result.data?.analyses.find(
        (analysis) => analysis.analysis === "op",
      );
      expect(operatingPoint?.analysis).toBe("op");
      if (operatingPoint?.analysis !== "op") return;
      expect(
        operatingPoint.probes.find((probe) => probe.name === "v(out)")?.value,
      ).toBeCloseTo(0.5, 12);
    },
  );

  withSimulator(
    "never calls a run clean when the simulator dropped a device",
    async () => {
      // The measured trap: ngspice exits 0 having discarded the resistor.
      const outcome = await simulateLocally({
        netlist: "V1 in 0 DC 1\nR1 in out",
        testbench: ".control\nop\n.endc",
      });
      expect(outcome.kind).toBe("ran");
      if (outcome.kind !== "ran") return;
      expect(outcome.result.outcome.status).toBe(
        "completed-with-dropped-input",
      );
      expect(
        outcome.result.diagnostics.some(
          (diagnostic: { droppedInput?: boolean }) =>
            diagnostic.droppedInput === true,
        ),
      ).toBe(true);
    },
  );

  withSimulator("stops at the ceiling and says so", async () => {
    const outcome = await simulateLocally({
      netlist: "V1 in 0 SIN(0 1 1k)\nR1 in out 1k\nC1 out 0 1u",
      testbench: ".control\ntran 10n 20m\n.endc",
      timeoutMs: 400,
    });
    expect(outcome.kind).toBe("ran");
    if (outcome.kind !== "ran") return;
    expect(outcome.result.outcome).toEqual({
      status: "timed-out",
      timeoutMs: 400,
    });
  });
});
