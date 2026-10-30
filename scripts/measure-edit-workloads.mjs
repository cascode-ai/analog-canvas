// Shared measurement process for the release check and its rejection probes.
import { pathToFileURL } from "node:url";
import { sampleEditWorkload, editSampling } from "./lib/edit-performance.mjs";

const [bundle, budgetJson, slowEdit] = process.argv.slice(2);
const { createEditPerformanceProject, createEditWorkload, editWorkloadNames } =
  await import(pathToFileURL(bundle).href);
if (slowEdit && !editWorkloadNames.includes(slowEdit))
  throw new Error(`Unknown editing workload: ${slowEdit}`);
const budgets = JSON.parse(budgetJson);
const project = createEditPerformanceProject();
const editWorkloads = Object.fromEntries(
  editWorkloadNames.map((name) => [
    name,
    sampleEditWorkload(() => createEditWorkload(project, name), budgets[name], {
      slowdown: name === slowEdit ? 2 : 1,
    }),
  ]),
);
const failures = Object.entries(editWorkloads)
  .filter(([, result]) => result.passed === false)
  .map(([name, result]) => [name, result.medianMs]);
process.stdout.write(
  JSON.stringify({
    editSampling,
    editWorkloads,
    failures,
    passed: failures.length === 0,
  }),
);
process.exitCode = failures.length ? 1 : 0;
