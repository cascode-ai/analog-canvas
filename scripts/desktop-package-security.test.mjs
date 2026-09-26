import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import {
  assertPublicDistributionPath,
  inspectSourceArchive,
  inspectDistributionDirectory,
  publicFinding,
} from "./lib/distribution-security.mjs";

describe("distribution private material boundary", () => {
  it.each([
    ".env",
    "apps/editor/.env.production.local",
    "worker/.dev.vars",
    ".git/config",
    "nested/.npmrc",
    "keys/private.pem",
    "auth.pfx",
    "data/Cookies",
    "data/Local State",
    "data/sessions.sqlite",
    "credentials.json",
    "assets/editor.js.map",
    "../outside",
    "C:\\private.key",
  ])("rejects %s", (path) => {
    expect(() => assertPublicDistributionPath(path)).toThrow();
  });

  it("retains public authentication implementation and notices", () => {
    for (const path of [
      "worker/auth.ts",
      "worker/auth.test.ts",
      "LICENSE.md",
      "source.zip",
    ])
      expect(() => assertPublicDistributionPath(path)).not.toThrow();
  });

  it("rejects private files inside the real source ZIP without extracting them", () => {
    const archive = zipSync({
      "apps/editor/.env.local": strToU8("not a real secret"),
    });
    expect(() => inspectSourceArchive(archive)).toThrow(/not distributable/);
    expect(
      inspectSourceArchive(zipSync({ "worker/auth.ts": strToU8("export {}") })),
    ).toBe(1);
    expect(() => inspectSourceArchive(new Uint8Array([1, 2, 3]))).toThrow();
  });

  it("inspects runtime files and requires corresponding source", async () => {
    const directory = await mkdtemp(join(tmpdir(), "desktop-layout-"));
    try {
      await expect(inspectDistributionDirectory(directory)).rejects.toThrow(
        /source.zip/,
      );
      await writeFile(
        join(directory, "source.zip"),
        zipSync({ "README.md": strToU8("Public source") }),
      );
      await expect(inspectDistributionDirectory(directory)).resolves.toEqual({
        files: 1,
        sourceEntries: 1,
      });
      await mkdir(join(directory, "resources"));
      await writeFile(join(directory, "resources/.dev.vars"), "fixture");
      await expect(inspectDistributionDirectory(directory)).rejects.toThrow(
        /not distributable/,
      );
    } finally {
      if (!directory.startsWith(join(tmpdir(), "desktop-layout-")))
        throw new Error("Unexpected temporary directory");
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("never reports matched source lines or credential values", () => {
    expect(
      publicFinding({
        RuleID: "private-key",
        File: "runtime.js",
        StartLine: 3,
        Secret: "sensitive value",
        Match: "matched source",
        Message: "commit content",
      }),
    ).toEqual({ rule: "private-key", file: "runtime.js", line: 3 });
  });
});
