import {
  collectChangedPaths,
  formatGatePlan,
  loadGateCatalog,
  planValidation,
  runGateCommand,
  executionGates,
} from "./lib/validation-gates.mjs";

function valueAfter(args, flag, fallback) {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const args = process.argv.slice(2).filter((value) => value !== "--");
const base = valueAfter(args, "--base", "origin/main");
const stage = valueAfter(args, "--stage", "preflight");
if (!new Set(["preflight", "affected"]).has(stage)) {
  throw new Error("gate-run supports only preflight or affected stages");
}

const catalog = await loadGateCatalog();
const plan = planValidation(
  collectChangedPaths(base, { ignoredPaths: catalog.ignoredPaths }),
  catalog,
);
process.stdout.write(formatGatePlan(plan, { base }));
for (const gate of executionGates(plan, stage)) {
  runGateCommand(gate, { base });
}
