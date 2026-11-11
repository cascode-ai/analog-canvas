import { expect, it } from "vitest";

import { reconcile } from "./rnl-reconcile.mjs";

const inStep = {
  runtimeLocked: "0.5.5",
  runtimeLatest: "0.5.5",
  canvasLocked: ["0.1", "0.10", "0.9"],
  canvasCatalog: ["0.9", "0.10"],
  upstreamLocked: ["0.10"],
  privateReferences: 0,
};

it("finds nothing when Analog Canvas and upstream are in step", () => {
  // 0.10 is newer than 0.9: versions compare by number, not by text.
  expect(reconcile(inStep)).toEqual([]);
});

it("names each thing out of step", () => {
  expect(
    reconcile({
      ...inStep,
      runtimeLatest: "0.6.0",
      canvasCatalog: ["0.10", "0.11"],
      upstreamLocked: ["0.1"],
      privateReferences: 3,
    }),
  ).toEqual([
    "runtime: locked 0.5.5, npm has 0.6.0",
    "analog-canvas-extensions: the editor writes 0.10, the catalog's newest is 0.11",
    "analog-canvas-extensions 0.10 is not in rnl's packages.lock.json (upstream CI does not read what Analog Canvas writes)",
    "3 references to the private rnl-dev remain",
  ]);
});
