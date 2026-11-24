// The required check must run even when a prerequisite failed or was skipped.
// Only a successful documentation plan is allowed to skip it in the workflow.
const needs = JSON.parse(process.env.CORE_NEEDS ?? "{}");

for (const job of ["changes", "core_static"]) {
  if (needs[job]?.result !== "success") {
    throw new Error(`${job}: expected success, received ${needs[job]?.result}`);
  }
}

const outputs = needs.changes.outputs ?? {};
if (outputs.heavy !== "true") {
  throw new Error("changes: missing implementation plan");
}

for (const flag of ["regional_python", "unit_strict"]) {
  if (outputs[flag] !== "true" && outputs[flag] !== "false") {
    throw new Error(`changes: missing boolean output ${flag}`);
  }
}

const unitMode = outputs.unit_mode;
if (!["full", "affected", "none"].includes(unitMode)) {
  throw new Error(`changes: invalid unit_mode (${unitMode})`);
}
const expectedUnit = unitMode === "none" ? "skipped" : "success";
if (needs.core_unit?.result !== expectedUnit) {
  throw new Error(
    `core_unit: expected ${expectedUnit} for unit_mode=${unitMode}, received ${needs.core_unit?.result}`,
  );
}

const optionalJobs = [
  ["core_build", "build"],
  ["core_unit_built", "unit_built"],
  ["core_performance", "performance"],
  ["core_release", "release"],
];
for (const [job, flag] of optionalJobs) {
  const enabled = outputs[flag];
  if (enabled !== "true" && enabled !== "false") {
    throw new Error(`changes: missing boolean output ${flag}`);
  }
  const expected = enabled === "true" ? "success" : "skipped";
  if (needs[job]?.result !== expected) {
    throw new Error(
      `${job}: expected ${expected} (${flag}=${enabled}), received ${needs[job]?.result}`,
    );
  }
}

if (
  outputs.build === "false" &&
  (outputs.unit_built === "true" ||
    outputs.performance === "true" ||
    outputs.release === "true")
) {
  throw new Error("changes: build=false contradicts enabled build consumer");
}

console.log("All Core contracts passed.");
