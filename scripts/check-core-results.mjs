// The required check must run even when a prerequisite failed or was skipped.
// Only a successful documentation plan is allowed to skip it in the workflow.
const needs = JSON.parse(process.env.CORE_NEEDS ?? "{}");
for (const job of [
  "changes",
  "core_build",
  "core_static",
  "core_unit",
  "core_release",
]) {
  if (needs[job]?.result !== "success") {
    throw new Error(`${job}: expected success, received ${needs[job]?.result}`);
  }
}
if (needs.changes.outputs?.heavy !== "true") {
  throw new Error("changes: missing implementation plan");
}
console.log("All Core contracts passed.");
