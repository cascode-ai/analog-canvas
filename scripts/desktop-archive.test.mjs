import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { strToU8, zipSync, unzipSync } from "fflate";
import { expect, it } from "vitest";

const run = promisify(execFile);
const script = resolve("apps/desktop/scripts/archive-preview.mjs");
const commit = "0123456789abcdef0123456789abcdef01234567";

async function withPackage(action) {
  const directory = await mkdtemp(join(tmpdir(), "desktop-archive-"));
  try {
    const output = join(directory, "Analog-Canvas-Windows-x64");
    const executable = join(output, "Analog Canvas Preview.exe");
    const archive = join(
      directory,
      "analog-canvas-desktop-windows-x64-0123456789ab.zip",
    );
    const manifest = join(directory, "manifest.json");
    await mkdir(output);
    await writeFile(executable, "runtime fixture");
    await writeFile(join(output, "BUILD.txt"), `Source commit: ${commit}\n`);
    await writeFile(
      join(output, "ACCEPTANCE.json"),
      JSON.stringify({ status: "passed", packaged: true, source: commit }),
    );
    await writeFile(
      join(output, "SECURITY.json"),
      JSON.stringify({ status: "passed", source: commit }),
    );
    await writeFile(
      join(output, "source.zip"),
      zipSync({ "README.md": strToU8("public source") }),
    );
    await writeFile(
      manifest,
      JSON.stringify({ output, executable, archive, commit }),
    );
    return await action({ directory, output, executable, archive, manifest });
  } finally {
    if (!directory.startsWith(join(tmpdir(), "desktop-archive-")))
      throw Error("Unexpected temporary directory");
    await rm(directory, { recursive: true, force: true });
  }
}

it("archives the accepted application under one stable folder with the executable immediately visible", async () => {
  await withPackage(async ({ archive, manifest }) => {
    await run(process.execPath, [script, manifest]);
    const files = unzipSync(await readFile(archive));
    expect(Object.keys(files).sort()).toEqual([
      "Analog-Canvas-Windows-x64/ACCEPTANCE.json",
      "Analog-Canvas-Windows-x64/Analog Canvas Preview.exe",
      "Analog-Canvas-Windows-x64/BUILD.txt",
      "Analog-Canvas-Windows-x64/SECURITY.json",
      "Analog-Canvas-Windows-x64/source.zip",
    ]);
    expect(
      new TextDecoder().decode(
        files["Analog-Canvas-Windows-x64/Analog Canvas Preview.exe"],
      ),
    ).toBe("runtime fixture");
    const original = await readFile(archive);
    await expect(run(process.execPath, [script, manifest])).rejects.toThrow(
      /EEXIST/u,
    );
    expect(await readFile(archive)).toEqual(original);
  });
}, 15000);

it.each([
  ["ACCEPTANCE.json", { status: "failed", packaged: true, source: commit }],
  ["ACCEPTANCE.json", { status: "passed", packaged: false, source: commit }],
  ["SECURITY.json", { status: "passed", source: "f".repeat(40) }],
])(
  "refuses an unaccepted or mismatched %s before creating a ZIP",
  async (name, record) => {
    await withPackage(async ({ output, archive, manifest }) => {
      await writeFile(join(output, name), JSON.stringify(record));
      await expect(run(process.execPath, [script, manifest])).rejects.toThrow(
        /must pass for the distributed source/u,
      );
      await expect(readFile(archive)).rejects.toMatchObject({ code: "ENOENT" });
    });
  },
);

it("rejects private material even if a stale security receipt says passed", async () => {
  await withPackage(async ({ output, archive, manifest }) => {
    await writeFile(
      join(output, "source.zip"),
      zipSync({ ".env.local": strToU8("synthetic fixture") }),
    );
    await expect(run(process.execPath, [script, manifest])).rejects.toThrow(
      /not distributable/u,
    );
    await expect(readFile(archive)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
