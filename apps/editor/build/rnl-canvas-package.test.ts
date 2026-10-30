import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "vite";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
  canvasPackageFile,
  canvasPackageLock,
} from "../src/features/netlist-export/rnl-canvas-package";
import webConfig from "../vite.config";
import desktopConfig from "../vite.desktop.config";

const compositions = [
  ["Web", webConfig],
  ["desktop", desktopConfig],
] as const;

it.each(compositions)(
  "refuses a %s build with changed Canvas package bytes",
  async (_name, config) => {
    const directory = await mkdtemp(join(tmpdir(), "icm-rnl-package-"));
    try {
      const feature = join(directory, "src/features/netlist-export");
      await mkdir(feature, { recursive: true });
      for (const { version } of canvasPackageLock.versions)
        await writeFile(join(feature, canvasPackageFile(version)), "changed");
      const entry = join(directory, "entry.js");
      await writeFile(entry, "export const ready = true;");
      await expect(
        build({
          ...config,
          configFile: false,
          root: directory,
          logLevel: "silent",
          build: { write: false, rollupOptions: { input: entry } },
        }),
      ).rejects.toThrow(/Canvas package SHA-256 mismatch/u);
    } finally {
      if (!resolve(directory).startsWith(join(tmpdir(), "icm-rnl-package-")))
        throw new Error("Unexpected package test directory");
      await rm(directory, { recursive: true, force: true });
    }
  },
);

it.each(compositions)(
  "ships each locked version's raw bytes with the %s runtime",
  async (_name, config) => {
    const result = await build({
      ...config,
      configFile: false,
      root: resolve("apps/editor"),
      logLevel: "silent",
      build: {
        write: false,
        rollupOptions: {
          input: resolve(
            "apps/editor/src/features/netlist-export/rnl-runtime.ts",
          ),
        },
      },
    });
    if (Array.isArray(result) || !("output" in result))
      throw new Error("Expected one production bundle");
    const shipped = result.output.flatMap((item) =>
      item.type === "asset" &&
      /^assets\/analog-canvas-extensions-[^/]+\.rnl$/u.test(item.fileName)
        ? [createHash("sha256").update(item.source).digest("hex")]
        : [],
    );
    expect(shipped.sort()).toEqual([
      "3738e1ce0c5d6fca3e13ad44faac8bd54f5eeb70577a22e412f5858f21f86711",
      "40843a19ccbe02f81e7cbb4b5d7acb351bf2d3a4e737cb9be1f7b5fe6f83ac4a",
      "b9da7bd01b85ec1108546770cb0a845a85627a2b4879de8fc7351006f19cde7e",
      "d000fb9bfafae4b53c28e2293f40b6ab0c1bdc15e2b17d53ee502877262fc914",
    ]);
  },
  60000,
);
