import { expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { downloadCanvasPackages } from "./rnl-canvas-package.mjs";

const base = "https://rich-netlist.github.io/rnl-packages/";
const records = [
  {
    name: "analog-canvas-extensions",
    version: "0.1",
    url: "packages/analog-canvas-extensions/0.1/analog-canvas-extensions.rnl",
    sha256: "3738e1ce0c5d6fca3e13ad44faac8bd54f5eeb70577a22e412f5858f21f86711",
  },
  {
    name: "analog-canvas-extensions",
    version: "0.2",
    url: "packages/analog-canvas-extensions/0.2/analog-canvas-extensions.rnl",
    sha256: "b9da7bd01b85ec1108546770cb0a845a85627a2b4879de8fc7351006f19cde7e",
  },
  {
    name: "analog-canvas-extensions",
    version: "0.3",
    url: "packages/analog-canvas-extensions/0.3/analog-canvas-extensions.rnl",
    sha256: "d000fb9bfafae4b53c28e2293f40b6ab0c1bdc15e2b17d53ee502877262fc914",
  },
  {
    name: "analog-canvas-extensions",
    version: "0.4",
    url: "packages/analog-canvas-extensions/0.4/analog-canvas-extensions.rnl",
    sha256: "40843a19ccbe02f81e7cbb4b5d7acb351bf2d3a4e737cb9be1f7b5fe6f83ac4a",
  },
];
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
  const request = vi
    .fn()
    .mockResolvedValueOnce(
      catalog([
        { ...records[3], version: "0.5", sha256: "new-version" },
        ...records,
      ]),
    )
    .mockResolvedValueOnce(new Response(bytes["0.1"]))
    .mockResolvedValueOnce(new Response(bytes["0.2"]))
    .mockResolvedValueOnce(new Response(bytes["0.3"]))
    .mockResolvedValueOnce(new Response(bytes["0.4"]));
  const packages = await downloadCanvasPackages(request);
  expect([...packages.keys()]).toEqual(["0.1", "0.2", "0.3", "0.4"]);
  expect(packages.get("0.4")).toEqual(new Uint8Array(bytes["0.4"]));
  expect(request.mock.calls.map(([url]) => url)).toEqual([
    `${base}catalog.json`,
    ...records.map((record) => `${base}${record.url}`),
  ]);
});

it("rejects changed raw bytes even when the catalog hash still matches", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(catalog())
    .mockResolvedValueOnce(new Response(bytes["0.1"]))
    .mockResolvedValueOnce(new Response(bytes["0.2"]))
    .mockResolvedValueOnce(new Response(bytes["0.3"]))
    .mockResolvedValueOnce(
      new Response(Buffer.concat([bytes["0.4"], Buffer.from("\n")])),
    );
  await expect(downloadCanvasPackages(request)).rejects.toThrow(
    /Canvas package SHA-256 mismatch/u,
  );
});

it.each([2, "1", null])("rejects catalog schema %s", async (schemaVersion) => {
  const request = vi
    .fn()
    .mockResolvedValue(Response.json({ schemaVersion, packages: records }));
  await expect(downloadCanvasPackages(request)).rejects.toThrow(
    /Unsupported package catalog/u,
  );
});

it.each([
  ["missing version", [records[0]]],
  [
    "changed URL",
    [records[0], { ...records[1], url: "https://example.test/changed.rnl" }],
  ],
])("rejects a %s in the catalog", async (_name, packages) => {
  const request = vi.fn().mockResolvedValue(catalog(packages));
  await expect(downloadCanvasPackages(request)).rejects.toThrow(
    /Canvas package lock differs from catalog/u,
  );
});

it.each(["Catalog", "Canvas package"])(
  "reports %s HTTP failures",
  async (stage) => {
    const request = vi.fn();
    if (stage === "Canvas package") request.mockResolvedValueOnce(catalog());
    request.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    await expect(downloadCanvasPackages(request)).rejects.toThrow(
      `${stage} HTTP 503`,
    );
  },
);
