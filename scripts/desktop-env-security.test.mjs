import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { expect, it } from "vitest";
import desktopConfig from "../apps/editor/vite.desktop.config.ts";

it("does not embed local env-file or ambient VITE values in desktop output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "desktop-env-"));
  const previous = process.env.VITE_SECURITY_AUDIT_AMBIENT;
  process.env.VITE_SECURITY_AUDIT_AMBIENT = "ambient-audit-sentinel";
  try {
    await writeFile(
      join(directory, ".env.local"),
      "VITE_SECURITY_AUDIT_FILE=file-audit-sentinel\n",
    );
    await writeFile(
      join(directory, "index.html"),
      '<script type="module" src="/probe.js"></script>',
    );
    await writeFile(
      join(directory, "probe.js"),
      "globalThis.audit = [import.meta.env.VITE_SECURITY_AUDIT_AMBIENT, import.meta.env.VITE_SECURITY_AUDIT_FILE];",
    );
    const result = await build({
      ...desktopConfig,
      configFile: false,
      root: directory,
      plugins: [],
      logLevel: "silent",
      build: { write: false, minify: false },
    });
    const contents = result.output
      .map((item) => item.code ?? item.source)
      .join("\n");
    expect(contents).not.toContain("ambient-audit-sentinel");
    expect(contents).not.toContain("file-audit-sentinel");
    expect(contents).toContain("globalThis.audit");
  } finally {
    if (previous === undefined) delete process.env.VITE_SECURITY_AUDIT_AMBIENT;
    else process.env.VITE_SECURITY_AUDIT_AMBIENT = previous;
    if (!directory.startsWith(join(tmpdir(), "desktop-env-")))
      throw new Error("Unexpected temporary directory");
    await rm(directory, { recursive: true, force: true });
  }
});
