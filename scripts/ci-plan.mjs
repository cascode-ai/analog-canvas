import { appendFile } from "node:fs/promises";

import {
  browserShardMatrix,
  formatCiValidationPlan,
  formatCiValidationPlanMarkdown,
  planCiValidation,
} from "./lib/ci-validation-plan.mjs";
import {
  collectChangedPaths,
  formatGatePlanMarkdown,
  loadGateCatalog,
  planValidation,
} from "./lib/validation-gates.mjs";

function valuesAfter(args, flag) {
  return args.flatMap((value, index) =>
    value === flag && args[index + 1] ? [args[index + 1]] : [],
  );
}

const args = process.argv.slice(2).filter((value) => value !== "--");
const base = valuesAfter(args, "--base")[0] ?? "origin/main";
const explicitPaths = valuesAfter(args, "--path");
const forceFull = args.includes("--force-full");
const githubOutput = args.includes("--github-output");
const githubSummary = args.includes("--github-summary");
const catalog = await loadGateCatalog();
const paths =
  explicitPaths.length > 0
    ? explicitPaths
    : collectChangedPaths(base, { ignoredPaths: catalog.ignoredPaths });
const gatePlan = planValidation(paths, catalog);
const ciPlan = planCiValidation(gatePlan, { forceFull });

process.stdout.write(formatCiValidationPlan(ciPlan));

if (githubOutput) {
  if (!process.env.GITHUB_OUTPUT) {
    throw new Error("--github-output requires GITHUB_OUTPUT");
  }
  await appendFile(
    process.env.GITHUB_OUTPUT,
    [
      `heavy=${String(ciPlan.heavy)}`,
      `browser=${String(ciPlan.browser)}`,
      `browser_shards=${JSON.stringify(browserShardMatrix(ciPlan))}`,
      `mode=${ciPlan.mode}`,
      `e2e_args=${ciPlan.e2eArgs.join(" ")}`,
      "",
    ].join("\n"),
  );
}

if (githubSummary) {
  if (!process.env.GITHUB_STEP_SUMMARY) {
    throw new Error("--github-summary requires GITHUB_STEP_SUMMARY");
  }
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    `${formatCiValidationPlanMarkdown(ciPlan)}${formatGatePlanMarkdown(gatePlan, { base })}`,
  );
}
