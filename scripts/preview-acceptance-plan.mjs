import { execFileSync } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const deepAcceptancePatterns = [
  /^\.github\/workflows\/(?:cloudflare|deploy-preview)\.yml$/u,
  /^apps\/editor\/src\/agent\//u,
  /^apps\/editor\/src\/features\/simulation\//u,
  /^apps\/mcp-server\//u,
  /^config\/(?:simulation|vacask)[^/]*\.json$/u,
  /^containers\//u,
  /^packages\/(?:agent-|netlist|simulation-service|spice|spice-run)(?:\/|$)/u,
  /^scripts\/(?:preview-|run-preview-acceptance|lib\/preview-)/u,
  /^worker\/(?:agent|simulation|index\.)/u,
  /^wrangler(?:\.preview)?\.jsonc$/u,
];

export function planPreviewAcceptance(paths, { forceDeep = false } = {}) {
  const deepPaths = paths.filter((path) =>
    deepAcceptancePatterns.some((pattern) => pattern.test(path)),
  );
  return {
    mode: forceDeep || deepPaths.length > 0 ? "deep" : "fast",
    deepPaths,
  };
}

function valuesAfter(args, flag) {
  return args.flatMap((value, index) =>
    value === flag && args[index + 1] ? [args[index + 1]] : [],
  );
}

function changedPaths(base) {
  try {
    return execFileSync(
      "git",
      ["diff", "--name-only", "--diff-filter=ACMR", base, "HEAD"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    )
      .split(/\r?\n/u)
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function main(args = process.argv.slice(2)) {
  const paths = valuesAfter(args, "--path");
  const base = valuesAfter(args, "--base")[0];
  const forceDeep =
    args.includes("--force-deep") || (!base && paths.length === 0);
  const resolvedPaths =
    paths.length > 0 ? paths : base ? changedPaths(base) : [];
  // A missing/unfetchable base must never silently downgrade acceptance.
  const plan = planPreviewAcceptance(resolvedPaths, {
    forceDeep: forceDeep || (Boolean(base) && resolvedPaths.length === 0),
  });
  process.stdout.write(
    `Preview acceptance: ${plan.mode}\n${plan.deepPaths.map((path) => `  - ${path}`).join("\n")}${plan.deepPaths.length ? "\n" : ""}`,
  );
  if (args.includes("--github-output")) {
    if (!process.env.GITHUB_OUTPUT)
      throw new Error("--github-output requires GITHUB_OUTPUT");
    await appendFile(process.env.GITHUB_OUTPUT, `mode=${plan.mode}\n`);
  }
  return plan;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
