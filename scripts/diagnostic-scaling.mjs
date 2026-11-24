import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { measureDiagnosticCase } from "./lib/diagnostic-oracle.mjs";
import { diagnosticInput } from "./lib/diagnostic-scaling-fixtures.mjs";

const { values } = parseArgs({
  options: {
    case: { type: "string" },
    large: { type: "boolean" },
    input: { type: "string" },
    help: { type: "boolean" },
  },
});
const oracle = JSON.parse(
  readFileSync(
    new URL("../fixtures/performance/diagnostic-scaling.json", import.meta.url),
    "utf8",
  ),
);
if (values.help) {
  console.log(`Build: pnpm --filter @icm/agent-adapter... --if-present build
Run: node scripts/diagnostic-scaling.mjs [--large | --case NAME [--input FILE]]
Default: examples, protocol fixtures and wire-16. --large includes all generated workloads.
--input writes the selected portable Project for replay in a browser or paired Agent.
Reference: ${oracle.commit}
Cases: ${Object.keys(oracle.cases).join(", ")}`);
  process.exit(0);
}
assert.ok(!values.input || values.case, "--input requires one --case");
if (values.case)
  assert.ok(
    Object.hasOwn(oracle.cases, values.case),
    "Unknown case " + values.case,
  );

for (const [name, expected] of Object.entries(oracle.cases)) {
  if (
    values.case
      ? values.case !== name
      : !(values.large || name.includes("/") || name === "wire-16")
  )
    continue;
  const input = diagnosticInput(name);
  if (values.input) writeFileSync(values.input, input);
  const { actual, times } = measureDiagnosticCase(input);
  assert.deepEqual(actual, expected, name);
  console.log(
    JSON.stringify({
      name,
      inputBytes: Buffer.byteLength(input),
      projectCount: actual.projectCount,
      cells: actual.cells.map(
        ({ ordered, exports, ...measurements }) => measurements,
      ),
      times,
    }),
  );
}
