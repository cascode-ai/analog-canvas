import { resolve } from "node:path";

import { CircuitProjectSchema } from "@icm/model";
import { describe, expect, it } from "vitest";

import { compileSourceBundle } from "./compiler.js";
import { importCompileResult } from "./importer.js";
import { statementLedger } from "./ledger.js";
import { loadSourceBundleFromFile } from "./node-source.js";

const entries = [
  "mixed-device-acceptance",
  "phase-9-heldout-chopper-afe-8ch",
  "phase-9-heldout-differential-ring-8stage",
  "phase-9-heldout-flash-adc-4bit",
  "rlc-broadband-50-to-200-match",
  "rlc-rf-bandpass-100mhz",
  "sky130-ota-5t-gain40-pm60-noise50uv-pvt",
  "sky130-switched-capacitor-dac-6bit-pvt",
  "sky130-thermometer-trim-resistor",
  "sky130-transistor-divide-by-2",
] as const;

describe("current netlist corpus", () => {
  it("compiles every source entry and emits only current Projects", async () => {
    for (const directory of entries) {
      const entry = resolve(
        process.cwd(),
        "netlists",
        directory,
        "circuit.spi",
      );
      const compiled = compileSourceBundle(
        await loadSourceBundleFromFile(entry),
      );
      expect(
        compiled.diagnostics.filter((item) => item.severity === "error"),
        directory,
      ).toEqual([]);
      expect(compiled.ir, directory).not.toBeNull();
      const imported = importCompileResult(compiled);
      if (imported.project) {
        expect(CircuitProjectSchema.safeParse(imported.project).success).toBe(
          true,
        );
        expect(JSON.stringify(imported.project)).not.toContain('"ports"');
      }
      expect(compiled.ir?.unresolvedStatements, directory).toEqual([]);
      // Every statement has exactly one fate (#2294).
      const ledger = statementLedger(compiled, imported);
      expect(
        ledger.entries.filter(({ fate }) => fate === "unknown"),
        directory,
      ).toEqual([]);
      expect(ledger.complete, directory).toBe(true);
    }
  });
});
