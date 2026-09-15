import { it, expect } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { packageVacaskImage } from "./package-vacask-image.mjs";

it("refuses an unexpected simulator before creating an image context or touching inputs", async () => {
  const root = await mkdtemp(join(tmpdir(), "native-image-package-"));
  try {
    await mkdir(join(root, "bin"));
    await writeFile(join(root, "bin/vacask"), "not the accepted binary");
    const output = join(root, "output");
    await expect(
      packageVacaskImage(
        output,
        root,
        "absent-modules",
        "absent-models",
        "absent-harness",
      ),
    ).rejects.toThrow("Unexpected VACASK Linux binary");
    await expect(access(output)).rejects.toThrow();
    expect(await readFile(join(root, "bin/vacask"), "utf8")).toBe(
      "not the accepted binary",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("requires all explicit package inputs rather than guessing local runtime paths", () => {
  let failure;
  try {
    execFileSync(process.execPath, ["scripts/package-vacask-image.mjs"], {
      stdio: "pipe",
      timeout: 10000,
    });
  } catch (error) {
    failure = error;
  }
  expect(failure?.status).toBe(1);
  expect(String(failure?.stderr)).toContain("Usage: package-vacask-image.mjs");
});
