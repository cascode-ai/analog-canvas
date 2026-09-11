import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

/** Verify the served entry graph is the locally built candidate, not merely a live page. */
export async function verifyPreviewCandidate(baseUrl) {
  const local = await readFile(
    new URL("../../apps/editor/dist/index.html", import.meta.url),
    "utf8",
  );
  const entry = local.match(/src="(\/assets\/[^" ]+\.js)"/u)?.[1];
  assert(entry, "Build the candidate Editor before Preview acceptance");
  const response = await fetch(new URL("/editor", baseUrl), {
    cache: "no-store",
  });
  assert.equal(response.status, 200);
  const shell = await response.text();
  assert(
    shell.includes(`src="${entry}"`),
    "Preview is not serving this candidate's entry graph",
  );
  const remote = await fetch(new URL(entry, baseUrl), { cache: "no-store" });
  assert.equal(remote.status, 200);
  const localBytes = await readFile(
    new URL(`../../apps/editor/dist${entry}`, import.meta.url),
  );
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const entrySha256 = digest(localBytes);
  assert.equal(
    digest(Buffer.from(await remote.arrayBuffer())),
    entrySha256,
    "Served entry bytes differ from the built candidate",
  );
  const commitSha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  if (process.env.GITHUB_SHA) assert.equal(commitSha, process.env.GITHUB_SHA);
  return { commitSha, entry, entrySha256 };
}
