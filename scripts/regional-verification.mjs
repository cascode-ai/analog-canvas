// Run only after Production verification succeeds. Output is the private R2
// object key; the protected deployment credential uploads the tiny receipt.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export async function prepareVerification({
  dist,
  commit,
  attempt,
  origin,
  output,
  fetch: request = fetch,
}) {
  assert.match(commit, /^[0-9a-f]{40}$/);
  assert.match(attempt, /^[1-9][0-9]*-[1-9][0-9]*$/);
  assert.match(origin, /^https:\/\/[A-Za-z0-9.-]+$/);
  const pointer = JSON.parse(
    await readFile(join(dist, "regional-release/current.json"), "utf8"),
  );
  const manifest = `/regional-release/${commit}/release.json`;
  const sha256 = createHash("sha256")
    .update(await readFile(join(dist, manifest.slice(1))))
    .digest("hex");
  const expected = { commit, manifest, sha256, attempt };
  assert.deepEqual(
    pointer,
    expected,
    "Candidate does not belong to this verified run",
  );
  const live = await request(`${origin}/regional-release/current.json`, {
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  assert.equal(live.status, 200, "Overseas pointer is unavailable");
  assert.deepEqual(
    await live.json(),
    expected,
    "Overseas no longer serves the verified candidate",
  );
  await writeFile(
    output,
    `${JSON.stringify({ schemaVersion: 1, commit, sha256, attempt, verified: true })}\n`,
  );
  return `${commit}/${sha256}/${attempt}.json`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [dist, commit, origin, output] = process.argv.slice(2);
  console.log(
    await prepareVerification({
      dist,
      commit,
      origin,
      output,
      attempt: `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`,
    }),
  );
}
