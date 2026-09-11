import { mkdtemp, mkdir, writeFile, rm, symlink, link } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { readDeclaredRawfile, validCollection } from "./rawfile-collector.mjs";

const roots = [];
async function directory() {
  const root = await mkdtemp(join(tmpdir(), "icm-collector-test-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("declared rawfile collection", () => {
  it("collects only the exact declared path, including nested outputs", async () => {
    const root = await directory();
    await mkdir(join(root, "results"));
    await writeFile(join(root, "results", "chosen.raw"), "Title: chosen\n");
    await writeFile(join(root, "a.raw"), "wrong rawfile");
    await writeFile(join(root, "deck.cir"), "wrong source");
    expect(
      await readDeclaredRawfile(root, { rawfile: "results/chosen.raw" }, 100),
    ).toMatchObject({
      rawfile: "Title: chosen\n",
      rawfileName: "results/chosen.raw",
      rawfileFormat: "ascii",
      truncated: false,
    });
    expect(
      await readDeclaredRawfile(root, { rawfile: "missing.raw" }, 100),
    ).toMatchObject({
      rawfile: null,
      rawfileName: null,
      rawfileError: "missing-output",
    });
    expect(
      await readDeclaredRawfile(root, { rawfile: null }, 100),
    ).toMatchObject({
      rawfile: null,
      rawfileError: null,
    });
  });
  it("distinguishes exact cap, truncation and binary without parsing or throwing", async () => {
    const root = await directory();
    await writeFile(join(root, "out.raw"), "12345");
    expect(
      await readDeclaredRawfile(root, { rawfile: "out.raw" }, 5),
    ).toMatchObject({ rawfile: "12345", truncated: false });
    expect(
      await readDeclaredRawfile(root, { rawfile: "out.raw" }, 4),
    ).toMatchObject({ rawfile: "1234", truncated: true });
    await writeFile(join(root, "out.raw"), Buffer.from([80, 0, 81]));
    expect(
      await readDeclaredRawfile(root, { rawfile: "out.raw" }, 100),
    ).toMatchObject({ rawfile: null, rawfileFormat: "binary" });
  });
  it("never reads directories, hard-linked inputs or escaping paths", async () => {
    const root = await directory();
    await mkdir(join(root, "dir.raw"));
    await writeFile(join(root, "source.cir"), "source");
    await link(join(root, "source.cir"), join(root, "copy.raw"));
    for (const path of ["dir.raw", "copy.raw"])
      expect(
        await readDeclaredRawfile(root, { rawfile: path }, 100),
      ).toMatchObject({ rawfile: null, rawfileError: "unsafe-output" });
    expect(
      await readDeclaredRawfile(root, { rawfile: "../outside.raw" }, 100),
    ).toMatchObject({ rawfile: null, rawfileError: "invalid-collection" });
  });
  it("does not traverse a symlinked output directory", async () => {
    const root = await directory();
    const outside = await directory();
    await writeFile(join(outside, "out.raw"), "private");
    // A directory junction tests the same lstat boundary without Windows'
    // symbolic-link privilege requirement. POSIX uses an ordinary symlink.
    await symlink(
      outside,
      join(root, "alias"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(
      await readDeclaredRawfile(root, { rawfile: "alias/out.raw" }, 100),
    ).toMatchObject({ rawfile: null, rawfileError: "unsafe-output" });
  });
  it("rejects input/mount collisions but permits unrelated output names", () => {
    for (const path of [
      "run.cir",
      "models",
      "models/lib.spice",
      "a/b",
      ".spiceinit",
      "/abs",
      "C:/x",
      "a/../x",
    ])
      expect(
        validCollection({ rawfile: path }, [
          "run.cir",
          "models/lib.spice",
          "a",
        ]),
      ).toBe(false);
    expect(validCollection({ rawfile: "results/out.raw" }, ["run.cir"])).toBe(
      true,
    );
    expect(validCollection({ rawfile: null }, ["run.cir"])).toBe(true);
    for (const invalid of [
      null,
      {},
      [],
      { rawfile: true },
      { rawfile: null, extra: 1 },
    ])
      expect(validCollection(invalid)).toBe(false);
  });
});
