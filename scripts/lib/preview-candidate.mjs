import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
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
  // Vite splits simulation/editor code into lazy chunks. Matching only the
  // entry does not establish that these actually served bytes are the build.
  const assets = [{ path: entry, sha256: entrySha256 }];
  const directory = new URL("../../apps/editor/dist/assets/", import.meta.url);
  async function compareDirectory(directory, prefix) {
    for (const file of await readdir(directory, { withFileTypes: true })) {
      const path = `${prefix}/${file.name}`;
      const localUrl = new URL(encodeURIComponent(file.name), directory);
      if (file.isDirectory()) {
        await compareDirectory(
          new URL(`${encodeURIComponent(file.name)}/`, directory),
          path,
        );
        continue;
      }
      assert(file.isFile(), "Candidate assets must be regular files");
      if (path === entry) continue;
      const bytes = await readFile(localUrl);
      const served = await fetch(new URL(path, baseUrl), { cache: "no-store" });
      assert.equal(served.status, 200, `Candidate asset unavailable: ${path}`);
      const sha256 = digest(bytes);
      assert.equal(
        digest(Buffer.from(await served.arrayBuffer())),
        sha256,
        `Served asset bytes differ from the built candidate: ${path}`,
      );
      assets.push({ path, sha256 });
    }
  }
  await compareDirectory(directory, "/assets");
  assets.sort((a, b) => a.path.localeCompare(b.path, "en"));
  const commitSha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  // A labeled pull request deploys its head while GITHUB_SHA names GitHub's
  // merge preview, so the workflow's RELEASE_SHA is the deployed commit.
  const expectedSha = process.env.RELEASE_SHA || process.env.GITHUB_SHA;
  if (expectedSha) assert.equal(commitSha, expectedSha);
  // commitSha names the checkout used for acceptance, not independent proof
  // that an ignored dist directory was built from that revision.
  return { commitSha, entry, entrySha256, assets };
}
