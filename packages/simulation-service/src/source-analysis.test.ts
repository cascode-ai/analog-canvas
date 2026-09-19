import { describe, expect, it } from "vitest";
import { inspectSimulationSourceGraph } from "@icm/netlist";
import {
  literalSourceAnalyses,
  sourceOutputVolumeWarning,
} from "./source-analysis.js";

const volume = (program: string, limit = 1048576) =>
  sourceOutputVolumeWarning(
    inspectSimulationSourceGraph({
      kind: "source",
      configPath: "experiment.json",
      entry: "run.cir",
      files: [
        { path: "run.cir", text: `Probe\n.control\n${program}\n.endc\n.end\n` },
      ],
      circuitBindings: [],
      dependencies: [],
    }),
    limit,
  );

it("estimates each write subset, not every internally saved device vector", () => {
  const saves = Array.from({ length: 72 }, (_, i) => `v(n${i})`).join(" ");
  expect(
    volume(
      `save ${saves}\nop\nwrite out.raw all\ntran 1n 1u\nwrite out.raw v(n0) v(n1)`,
    ),
  ).toBeNull();
  expect(
    volume(
      `save ${saves}\nop\nwrite out.raw all\ntran 1n 1u\nwrite out.raw all`,
    ),
  ).toContain("across 2 write commands");
});
it("distinguishes unbounded capture from no capture without blocking", () => {
  expect(volume("op\nprint all")).toBeNull();
  expect(volume("tran 1n 1u\nwrite out.raw all")).toContain(
    "cannot be reliably estimated",
  );
  expect(volume("repeat 10\ntran 1n 1u\nwrite out.raw v(out)\nend")).toContain(
    "run remains allowed",
  );
  expect(volume("save v(out)\ntran 1n 1u\nwrite out.raw")).toBeNull();
  expect(volume("save all\nsave v(out)\ntran 1n 1u\nwrite out.raw")).toContain(
    "cannot be reliably estimated",
  );
  expect(volume("dc V1 0 1 0.1 V2 0 2 0.1\nwrite out.raw v(out)")).toContain(
    "cannot be reliably estimated",
  );
});

const inspect = (program: string) =>
  literalSourceAnalyses(
    inspectSimulationSourceGraph({
      kind: "source",
      configPath: "experiment.json",
      entry: "run.cir",
      files: [{ path: "run.cir", text: `* advisory\n${program}\n.end\n` }],
      circuitBindings: [],
      dependencies: [],
    }),
  );
describe("native source analysis estimates", () => {
  it("recognizes literal dot cards and control commands using SPICE units", () => {
    expect(
      inspect(
        ".ac dec 20 1 1Meg\n.control\nop\ntran 1n 1u 10n\ndc V1 1 -1 -0.1\nnoise v(out) V1 oct 2 1k 1Meg\n.endc",
      ),
    ).toEqual([
      { kind: "ac", sweep: "dec", points: 20, startHz: 1, stopHz: 1e6 },
      { kind: "op" },
      {
        kind: "tran",
        stepSeconds: 1e-9,
        stopSeconds: 1e-6,
        startSeconds: 1e-8,
      },
      { kind: "dc", startValue: 1, stopValue: -1, stepValue: 0.1 },
      { kind: "noise", sweep: "oct", points: 2, startHz: 1e3, stopHz: 1e6 },
    ]);
  });
  it("does not turn unresolved native arguments or opaque commands into admission failures", () => {
    expect(
      inspect(
        ".control\nac dec $points 1 $stop\ntran $step 1u\nset custom=true\n.endc",
      ),
    ).toEqual([]);
    expect(
      inspect(".control\nac lin 0 0 1\ntran 0 1u\ndc V1 0 1 0\n.endc"),
    ).toEqual([]);
  });
});
