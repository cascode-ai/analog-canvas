import { expect, it } from "vitest";

import { markdown, reconcile, skillLanguage } from "./rnl-reconcile.mjs";

const released = {
  package: "@rich-netlist/runtime",
  source: "npm",
  version: "0.6.0",
  built: "npm",
};
const inStep = {
  line: {
    language: "0.4",
    standardSeries: "0.4",
    toolsRelease: "0.6.0",
    runtime: released,
  },
  releasedCore: "0.6.0",
  releasedSkillLanguage: "0.4",
  mainSkillLanguage: "0.4",
  mainHead: "5347dcb2f0b1a8f7c3e9d4a6b2c1e0f9a8b7c6d5",
  commitsBehindMain: 0,
  runtimeLatest: "0.6.0",
  canvasLocked: ["0.1", "0.10", "0.9"],
  canvasCatalog: ["0.9", "0.10"],
  upstreamLocked: ["0.10"],
  privateReferences: 0,
};

it("finds nothing when Analog Canvas and upstream are in step", () => {
  // 0.10 is newer than 0.9: versions compare by number, not by text.
  expect(reconcile(inStep)).toEqual([]);
});

it("names first a language that no released tool or guide reads, then a runtime built from main", () => {
  expect(
    reconcile({
      ...inStep,
      line: {
        ...inStep.line,
        runtime: {
          ...released,
          source: "commit",
          commit: "7d9659817323a415b99c7db615ef1dc53ac91507",
          version: "0.6.0-dev.7d965981",
        },
      },
      releasedCore: "0.5.5",
      releasedSkillLanguage: "0.3",
      mainSkillLanguage: "0.3",
      commitsBehindMain: 12,
      runtimeLatest: "0.5.5",
    }),
  ).toEqual([
    "version line: Analog Canvas reads and writes RNL 0.4, but the latest rnl release, core 0.5.5, comes before 0.6.0, the first to read it, and its RNL Skill teaches 0.3: no released tool or guide writes what Analog Canvas reads",
    "the RNL Skill on rnl main teaches 0.3, not 0.4",
    "runtime: built from rnl main 7d965981, unreleased; npm has 0.5.5",
    "runtime: 12 commits behind rnl main (5347dcb2)",
  ]);
});

it("says when a release can replace the vendored build", () => {
  expect(
    reconcile({
      ...inStep,
      line: {
        ...inStep.line,
        runtime: {
          ...released,
          source: "commit",
          commit: "7d9659817323a415b99c7db615ef1dc53ac91507",
        },
      },
    }),
  ).toContain(
    "runtime: npm 0.6.0 reads RNL 0.4; replace the vendored build with it",
  );
});

it("names each package and reference out of step", () => {
  expect(
    reconcile({
      ...inStep,
      runtimeLatest: "0.6.1",
      canvasCatalog: ["0.10", "0.11"],
      upstreamLocked: ["0.1"],
      privateReferences: 3,
    }),
  ).toEqual([
    "runtime: locked 0.6.0, npm has 0.6.1",
    "analog-canvas-extensions: the editor writes 0.10, the catalog's newest is 0.11",
    "analog-canvas-extensions 0.10 is not in rnl's packages.lock.json (upstream CI does not read what Analog Canvas writes)",
    "3 references to the private rnl-dev remain",
  ]);
});

it("reads the language an RNL Skill teaches from its title", () => {
  expect(
    skillLanguage("---\nname: rnl\n---\n\n# RNL (Rich Netlist) 0.3\n"),
  ).toBe("0.3");
  expect(skillLanguage("# Something else")).toBeNull();
});

it("writes the report for the issue, with the combination it checked", () => {
  const text = markdown(["runtime: x"], inStep, "2026-11-17");
  expect(text).toContain("### RNL upstream reconcile, 2026-11-17");
  expect(text).toContain("- runtime: x");
  expect(text).toContain("Analog Canvas: RNL 0.4, standard series 0.4");
  expect(text).toContain("core 0.6.0 released, main 5347dcb2");
});
