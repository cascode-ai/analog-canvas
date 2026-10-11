import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { migratePreviewData, previewMigrationState } from "./preview-migration";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "canvas-migration-"));
  roots.push(root);
  const source = join(root, "preview"),
    target = join(root, "current");
  await mkdir(join(source, "IndexedDB"), { recursive: true });
  await writeFile(join(source, "recent-projects.json"), "[]");
  await writeFile(
    join(source, "IndexedDB", "recovery.bin"),
    "saved recovery fixture",
  );
  await mkdir(join(source, "Cache"));
  await writeFile(join(source, "Cache", "unused"), "cache");
  return { source, target };
}
describe("preview application data migration", () => {
  it("copies checked recovery and preferences once, preserves the source and excludes caches", async () => {
    const { source, target } = await setup();
    await writeFile(join(source, "recent-projects.json.authorized"), "[]");
    await mkdir(join(source, "recent-projects.json.creations"));
    await writeFile(
      join(source, "recent-projects.json.creations", "operation.json"),
      "{}",
    );
    expect(await previewMigrationState(target, source)).toBe("available");
    expect(await migratePreviewData(source, target, async () => {})).toBe(4);
    expect(
      await readFile(join(target, "recent-projects.json.authorized"), "utf8"),
    ).toBe("[]");
    expect(
      await readFile(
        join(target, "recent-projects.json.creations", "operation.json"),
        "utf8",
      ),
    ).toBe("{}");
    expect(await previewMigrationState(target, source)).toBe("complete");
    expect(
      await readFile(join(target, "IndexedDB", "recovery.bin"), "utf8"),
    ).toBe("saved recovery fixture");
    expect(
      await readFile(join(source, "IndexedDB", "recovery.bin"), "utf8"),
    ).toBe("saved recovery fixture");
    await expect(readFile(join(target, "Cache", "unused"))).rejects.toThrow();
    await expect(
      migratePreviewData(source, target, async () => {}),
    ).rejects.toThrow("already exists");
  });
  it("refuses active sources and existing current data before replacing any data", async () => {
    const { source, target } = await setup();
    await expect(
      migratePreviewData(source, target, async () => {
        throw new Error("still running");
      }),
    ).rejects.toThrow("still running");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "recent-projects.json"), '[{"id":"new"}]');
    await expect(
      migratePreviewData(source, target, async () => {}),
    ).rejects.toThrow("already exists");
    expect(await readFile(join(target, "recent-projects.json"), "utf8")).toBe(
      '[{"id":"new"}]',
    );
  });
  it("resumes a checked partial installation without rereading a source changed since the snapshot", async () => {
    const { source, target } = await setup();
    const staging = join(target, ".preview-import");
    await mkdir(staging, { recursive: true });
    const text = "[]";
    await writeFile(join(staging, "recent-projects.json"), text);
    await writeFile(
      join(staging, "manifest.json"),
      JSON.stringify({
        source,
        files: [
          {
            path: "recent-projects.json",
            size: 2,
            digest: createHash("sha256").update(text).digest("hex"),
          },
        ],
      }),
    );
    await writeFile(join(target, "recent-projects.json"), text);
    await writeFile(join(source, "recent-projects.json"), '[{"id":"later"}]');
    expect(await previewMigrationState(target, source)).toBe("pending");
    expect(
      await migratePreviewData(source, target, async () => {
        throw new Error("must not reread source");
      }),
    ).toBe(1);
    expect(await readFile(join(target, "recent-projects.json"), "utf8")).toBe(
      text,
    );
    expect(await readFile(join(source, "recent-projects.json"), "utf8")).toBe(
      '[{"id":"later"}]',
    );
  });
});
