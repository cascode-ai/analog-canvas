// Exercise the actual pinned scanner against synthetic credentials, including
// a source-only leak. These keys are generated for this check and never used.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { zipSync, strToU8 } from "fflate";

const root = resolve(import.meta.dirname, "..");
const directory = await mkdtemp(join(root, "plan", "scanner-contract-"));
const key = generateKeyPairSync("ed25519", {
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey;
const testSource = await readFile(
  join(root, "packages/agent-adapter/src/http.test.ts"),
  "utf8",
);
function scan() {
  return spawnSync(
    process.execPath,
    [join(root, "scripts/desktop-package-security.mjs"), directory],
    { cwd: root, encoding: "utf8", env: process.env },
  );
}
try {
  await writeFile(
    join(directory, "BUILD.txt"),
    `Source commit: ${"a".repeat(40)}\n`,
  );
  await writeFile(
    join(directory, "source.zip"),
    zipSync({
      "packages/agent-adapter/src/http.test.ts": strToU8(testSource),
    }),
  );
  assert.equal(
    scan().status,
    0,
    "Reviewed test fixture should pass only at its exact path",
  );
  await writeFile(join(directory, "runtime.js"), key);
  let result = scan();
  assert.equal(result.status, 1, "Runtime private key must block distribution");
  assert(!`${result.stdout}${result.stderr}`.includes(key));
  await rm(join(directory, "runtime.js"));
  await writeFile(
    join(directory, "source.zip"),
    zipSync({ "worker/server.ts": strToU8(key) }),
  );
  assert.equal(
    scan().status,
    1,
    "Source-only private key must block distribution",
  );
  await writeFile(
    join(directory, "source.zip"),
    zipSync({ "worker/server.ts": strToU8(testSource) }),
  );
  assert.equal(
    scan().status,
    1,
    "Fixture exception must not cover a different path",
  );
  const report = await readFile(
    join(root, "plan/desktop-security-gate/findings.json"),
    "utf8",
  );
  assert(!report.includes('"Secret"'));
  assert(!report.includes('"Match"'));
  console.log(
    "Credential scanner rejects runtime/source canaries; fixture exception is path-bound.",
  );
} finally {
  if (!directory.startsWith(join(root, "plan", "scanner-contract-")))
    throw new Error("Unexpected temporary directory");
  await rm(directory, { recursive: true, force: true });
}
