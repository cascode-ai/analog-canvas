import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { measureDiagnosticCase } from "./diagnostic-oracle.mjs";
import { diagnosticInput } from "./diagnostic-scaling-fixtures.mjs";

const oracle = JSON.parse(
  readFileSync(
    new URL(
      "../../fixtures/performance/diagnostic-scaling.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
it.each(["project/hierarchical-gain-stage", "wire-16"])(
  "preserves the full check, ordered Agent results and exports for %s",
  (name) => {
    const { actual } = measureDiagnosticCase(diagnosticInput(name));
    expect(actual).toEqual(oracle.cases[name]);
  },
);
