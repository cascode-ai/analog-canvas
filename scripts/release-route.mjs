// Decide whether a push to main releases to Preview or Production (ADR 0057).
//
// Usage (GitHub Actions):
//   node scripts/release-route.mjs --sha "$GITHUB_SHA" --github-output
// Reads GITHUB_REPOSITORY and GH_TOKEN (or GITHUB_TOKEN). Prints the target
// and its reason; exits 1 when the pull request lookup keeps failing.
import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { pullRequestsForCommit, releaseRoute } from "./lib/release-route.mjs";

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function main(
  args = process.argv.slice(2),
  { environment = process.env, fetchImpl = fetch, delayMs } = {},
) {
  const sha = valueAfter(args, "--sha") ?? environment.GITHUB_SHA;
  const pullRequests = await pullRequestsForCommit({
    repository: environment.GITHUB_REPOSITORY,
    sha,
    token: environment.GH_TOKEN ?? environment.GITHUB_TOKEN,
    fetchImpl,
    ...(delayMs === undefined ? {} : { delayMs }),
  });
  const route = releaseRoute({ sha, pullRequests });
  process.stdout.write(`Release target: ${route.target} (${route.reason})\n`);
  if (args.includes("--github-output")) {
    if (!environment.GITHUB_OUTPUT)
      throw new Error("--github-output requires GITHUB_OUTPUT");
    await appendFile(
      environment.GITHUB_OUTPUT,
      `target=${route.target}\npull_request=${route.pullRequest ?? ""}\n`,
    );
  }
  return route;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(
      `Could not determine the release target: ${error instanceof Error ? error.message : String(error)}. Re-run this workflow.`,
    );
    process.exitCode = 1;
  });
