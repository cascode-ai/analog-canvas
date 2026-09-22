import { it, expect } from "vitest";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { packageVacaskHarness } from "./package-vacask-harness.mjs";

it("packages the real entrypoint and starts outside the workspace without node_modules", async () => {
  const root = await mkdtemp(join(tmpdir(), "vacask-package-"));
  try {
    const output = join(root, "bundle");
    const manifest = await packageVacaskHarness(output);
    const entry = join(output, manifest.entry);
    const bytes = await readFile(entry);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      manifest.sha256,
    );
    expect(manifest.status).toBe("packaged-not-deployed");
    // Invalid operator configuration reaches the real entrypoint, rather than
    // failing an unresolved workspace/package import on the deployment host.
    // Invoke it through a directory alias because macOS presents /var as
    // /private/var and deployment mounts can have the same real-path mismatch.
    const alias = join(root, "bundle-alias");
    await symlink(
      output,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    const aliasedEntry = join(alias, manifest.entry);
    const config = join(root, "invalid.json");
    await writeFile(config, "{}");
    let failure;
    try {
      await promisify(execFile)(process.execPath, [aliasedEntry, config], {
        cwd: root,
        windowsHide: true,
        timeout: 20000,
        env: { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" },
      });
    } catch (error) {
      failure = error;
    }
    expect(failure?.code).toBe(1);
    expect(failure?.stderr).toContain("vacask-startup-failed");
    expect(failure?.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
    await expect(packageVacaskHarness(output)).rejects.toMatchObject({
      code: "EEXIST",
    });
    expect(await readFile(entry)).toEqual(bytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
