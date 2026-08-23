import { execFileSync } from "node:child_process";

import {
  collectChangedPaths,
  loadGateCatalog,
} from "./lib/validation-gates.mjs";
import {
  assessTestImpact,
  readTestImpactTrailers,
} from "./lib/test-impact.mjs";

const baseIndex = process.argv.indexOf("--base");
const base = baseIndex >= 0 ? process.argv[baseIndex + 1] : undefined;

/** Commit messages introduced by this change, newest first. */
function commitMessages(range) {
  const output = execFileSync(
    "git",
    ["log", "--format=%B%x00", `${range}..HEAD`],
    { encoding: "utf8" },
  );
  return output
    .split("\0")
    .map((message) => message.trim())
    .filter((message) => message.length > 0);
}

if (!base) {
  console.error("Usage: node scripts/check-test-impact.mjs --base <git-ref>");
  process.exitCode = 2;
} else {
  const catalog = await loadGateCatalog();
  const paths = collectChangedPaths(base, {
    ignoredPaths: catalog.ignoredPaths,
  });
  const result = assessTestImpact(
    paths,
    readTestImpactTrailers(commitMessages(base)),
  );
  if (!result.ok) {
    console.error(`Test-impact check failed: ${result.message}`);
    console.error(
      "Add a trailer to a commit message, for example:\n" +
        "  Test-Impact: tests-updated\n" +
        "  Test-Impact: no-test-change — comment-only change, no behavior touched",
    );
    process.exitCode = 1;
  } else {
    console.log(`Test-impact check passed: ${result.message}`);
  }
}
