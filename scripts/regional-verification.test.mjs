import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { prepareVerification } from "./regional-verification.mjs";

it("only prepares proof for the exact candidate and currently served run attempt", async () => {
  const dir = await mkdtemp(join(tmpdir(), "regional-proof-"));
  try {
    const commit = "b".repeat(40),
      manifest = '{"schemaVersion":1}';
    const sha256 = createHash("sha256").update(manifest).digest("hex");
    const pointer = {
      commit,
      sha256,
      manifest: `/regional-release/${commit}/release.json`,
      attempt: "123-2",
    };
    await mkdir(join(dir, "regional-release", commit), { recursive: true });
    await writeFile(
      join(dir, "regional-release", commit, "release.json"),
      manifest,
    );
    await writeFile(
      join(dir, "regional-release/current.json"),
      JSON.stringify(pointer),
    );
    const output = join(dir, "proof.json");
    const options = {
      dist: dir,
      commit,
      attempt: "123-2",
      output,
      origin: "https://overseas.test",
      fetch: async () => Response.json(pointer),
    };
    expect(await prepareVerification(options)).toBe(
      `${commit}/${sha256}/123-2.json`,
    );
    expect(JSON.parse(await readFile(output, "utf8"))).toEqual({
      schemaVersion: 1,
      commit,
      sha256,
      attempt: "123-2",
      verified: true,
    });
    await expect(
      prepareVerification({ ...options, attempt: "123-1" }),
    ).rejects.toThrow();
    await expect(
      prepareVerification({
        ...options,
        fetch: async () => Response.json({ ...pointer, attempt: "123-1" }),
      }),
    ).rejects.toThrow();
    await writeFile(
      join(dir, "regional-release", commit, "release.json"),
      "changed",
    );
    await expect(prepareVerification(options)).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
