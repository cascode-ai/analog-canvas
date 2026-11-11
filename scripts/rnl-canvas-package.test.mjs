import { expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { canvasPackageLock as lock } from "../apps/editor/src/features/netlist-export/rnl-canvas-package.ts";
import { downloadCanvasPackages } from "./rnl-canvas-package.mjs";

const base = "https://rich-netlist.github.io/rnl-packages/";
// The catalog's records of the locked versions, as the catalog writes them.
const records = lock.versions.map(({ version, url, sha256 }) => ({
  name: lock.name,
  version,
  url: url.slice(base.length),
  sha256,
}));
const bytes = Object.fromEntries(
  await Promise.all(
    records.map(async ({ version }) => [
      version,
      await readFile(
        new URL(
          `../apps/editor/src/features/netlist-export/analog-canvas-extensions-${version}.rnl`,
          import.meta.url,
        ),
      ),
    ]),
  ),
);
const catalog = (packages = records) =>
  Response.json({ schemaVersion: 1, packages });

it("rejects a changed catalog lock before downloading package bytes", async () => {
  const request = vi
    .fn()
    .mockResolvedValue(
      catalog([records[0], { ...records[1], sha256: "0".repeat(64) }]),
    );
  await expect(downloadCanvasPackages(request)).rejects.toThrow(
    /Canvas package lock differs from catalog for 0.2/u,
  );
  expect(request).toHaveBeenCalledTimes(1);
});

it("downloads each locked version even when the catalog adds newer versions", async () => {
  const newest = records.at(-1);
  const request = vi
    .fn()
    .mockResolvedValueOnce(
      catalog([
        { ...newest, version: "9.9", sha256: "new-version" },
        ...records,
      ]),
    );
  for (const { version } of records)
    request.mockResolvedValueOnce(new Response(bytes[version]));
  const packages = await downloadCanvasPackages(request);
  expect([...packages.keys()]).toEqual(records.map(({ version }) => version));
  expect(packages.get(newest.version)).toEqual(
    new Uint8Array(bytes[newest.version]),
  );
  expect(request.mock.calls.map(([url]) => url)).toEqual([
    `${base}catalog.json`,
    ...records.map((record) => `${base}${record.url}`),
  ]);
});

it("rejects changed raw bytes even when the catalog hash still matches", async () => {
  const request = vi.fn().mockResolvedValueOnce(catalog());
  for (const { version } of records.slice(0, -1))
    request.mockResolvedValueOnce(new Response(bytes[version]));
  request.mockResolvedValueOnce(
    new Response(
      Buffer.concat([bytes[records.at(-1).version], Buffer.from("\n")]),
    ),
  );
  await expect(downloadCanvasPackages(request)).rejects.toThrow(
    /Canvas package SHA-256 mismatch/u,
  );
});
