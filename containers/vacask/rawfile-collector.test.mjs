import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  link,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { collectVacaskRawfiles } from "./rawfile-collector.mjs";
import { readVacaskSimulationData } from "../../packages/spice-run/src/vacask-result-data.js";

const roots = [];
const limits = { maxBytes: 1_048_576, maxFiles: 64, maxEntries: 4096 };
async function directory() {
  const root = await mkdtemp(join(tmpdir(), "icm-native-collector-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
describe("native run-local collection", () => {
  it("collects an exact 64 MiB file without shortening it", async () => {
    const root = await directory();
    const size = 64 * 1024 * 1024;
    await writeFile(join(root, "large.raw"), Buffer.alloc(size, 49));
    const result = await collectVacaskRawfiles(root, {
      ...limits,
      maxBytes: size,
    });
    expect(result.truncated).toBe(false);
    expect(result.diagnostics).toEqual([]);
    expect(result.bytes).toBe(size);
    expect(result.rawfiles[0].text.length).toBe(size);
    expect(result.rawfiles[0].text.at(-1)).toBe("1");
  });
  it("collects multiple nested files exactly while excluding input and dependency subtrees", async () => {
    const root = await directory();
    await mkdir(join(root, "nested"));
    await mkdir(join(root, "models"));
    await writeFile(join(root, "nested", "one.raw"), "Title: original\r\n");
    await writeFile(join(root, "two.raw"), "Title: 二\n");
    await writeFile(join(root, "input.raw"), "source, not output");
    await writeFile(join(root, "models", "private.raw"), "model, not output");
    await writeFile(join(root, "log.txt"), "log");
    const result = await collectVacaskRawfiles(root, {
      ...limits,
      inputPaths: ["input.raw", "models"],
    });
    expect(result).toMatchObject({
      truncated: false,
      diagnostics: [],
      rawfiles: [
        { path: "nested/one.raw", text: "Title: original\r\n" },
        { path: "two.raw", text: "Title: 二\n" },
      ],
    });
    expect(result.bytes).toBe(
      Buffer.byteLength("Title: original\r\nTitle: 二\n"),
    );
  });
  it("bounds the aggregate output, keeps an explicitly incomplete prefix, and never calls it a complete result", async () => {
    const root = await directory();
    await writeFile(join(root, "a.raw"), "a".repeat(80));
    await writeFile(join(root, "b.raw"), "b".repeat(80));
    const result = await collectVacaskRawfiles(root, {
      ...limits,
      maxBytes: 100,
    });
    expect(result.bytes).toBe(100);
    expect(result.truncated).toBe(true);
    expect(
      result.rawfiles.reduce((n, file) => n + Buffer.byteLength(file.text), 0),
    ).toBe(100);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        text: expect.stringContaining("byte limit"),
      }),
    );
    for (const file of result.rawfiles)
      expect(
        (await readFile(join(root, file.path), "utf8")).startsWith(file.text),
      ).toBe(true);
  });
  it("bounds file count and directory traversal even for empty outputs or non-raw entries", async () => {
    const root = await directory();
    for (let i = 0; i < 5; i++) await writeFile(join(root, `${i}.raw`), "");
    const files = await collectVacaskRawfiles(root, { ...limits, maxFiles: 2 });
    expect(files.rawfiles).toHaveLength(2);
    expect(files.truncated).toBe(true);
    const entries = await collectVacaskRawfiles(root, {
      ...limits,
      maxEntries: 1,
    });
    expect(entries.rawfiles).toHaveLength(1);
    expect(entries.truncated).toBe(true);
  });

  it("does not insert replacement characters when the budget splits a UTF-8 title", async () => {
    const root = await directory();
    await writeFile(join(root, "title.raw"), "a二b");
    const result = await collectVacaskRawfiles(root, {
      ...limits,
      maxBytes: 3,
    });
    expect(result.truncated).toBe(true);
    expect(result.rawfiles).toEqual([{ path: "title.raw", text: "a" }]);
    expect(result.bytes).toBe(3);
  });

  it.skipIf(process.platform === "win32")(
    "rejects a FIFO without blocking collection",
    async () => {
      const root = await directory();
      expect(spawnSync("mkfifo", [join(root, "pipe.raw")]).status).toBe(0);
      const result = await collectVacaskRawfiles(root, limits);
      expect(result.rawfiles).toEqual([]);
      expect(result.diagnostics[0].text).toContain("unsafe-output");
    },
  );
  it("does not follow symbolic links, directory junctions, or hard-linked output files", async () => {
    const root = await directory();
    const outside = await directory();
    await writeFile(join(outside, "secret.raw"), "private data");
    await symlink(outside, join(root, "escape"), "junction");
    await link(join(outside, "secret.raw"), join(root, "hard.raw"));
    await writeFile(join(root, "ok.raw"), "visible");
    const result = await collectVacaskRawfiles(root, limits);
    expect(result.rawfiles).toEqual([{ path: "ok.raw", text: "visible" }]);
    expect(result.diagnostics).toHaveLength(2);
    expect(
      result.diagnostics.every(
        (d) => d.severity === "error" && d.text.includes("unsafe-output"),
      ),
    ).toBe(true);
    const excluded = await collectVacaskRawfiles(root, {
      ...limits,
      inputPaths: ["escape", "hard.raw"],
    });
    expect(excluded.diagnostics).toEqual([]);
  });
  it("reports binary data, invalid settings and missing directories without fabricating numeric output", async () => {
    const root = await directory();
    await writeFile(join(root, "binary.raw"), Buffer.from([0, 1, 2]));
    const binary = await collectVacaskRawfiles(root, limits);
    expect(binary.rawfiles).toEqual([]);
    expect(binary.diagnostics[0].text).toContain("binary");
    for (const settings of [
      { ...limits, maxFiles: 0 },
      { ...limits, inputPaths: ["../escape"] },
    ])
      expect(
        (await collectVacaskRawfiles(root, settings)).diagnostics[0].text,
      ).toContain("invalid");
    expect(
      (await collectVacaskRawfiles(join(root, "missing"), limits))
        .diagnostics[0].text,
    ).toContain("unreadable");
  });
  it.skipIf(!process.env.VACASK_BIN || !process.env.VACASK_MODULES)(
    "collects actual pinned native analyses and auxiliary OP without folding them into one rawfile",
    async () => {
      const root = await directory();
      const binary = resolve(process.env.VACASK_BIN);
      const modules = resolve(process.env.VACASK_MODULES);
      const source = `Native collection integration
ground 0
load "resistor.osdi"
load "capacitor.osdi"
model vs vsource
model rr resistor noisy=1
model cc capacitor
V1 (input 0) vs dc=1 mag=1
R1 (input output) rr r=1k
C1 (output 0) cc c=1u
control
  abort always
  options rawfile="ascii"
  save default
  analysis bias op
  sweep supply instance="V1" parameter="dc" from=0 to=2 step=1
    analysis dc op
  analysis frequency ac from=10 to=1k mode="dec" points=2 writeop=1
  analysis time tran stop=1m step=0.1m
  analysis noise noise out="output" in="V1" from=10 to=1k mode="dec" points=2
endc
`;
      await writeFile(join(root, "run.sim"), source);
      await writeFile(
        join(root, "vacaskrc.toml"),
        "# explicit controlled configuration\n",
      );
      const execution = spawnSync(
        binary,
        [
          "--tomlfile",
          join(root, "vacaskrc.toml"),
          "-n",
          "1",
          "-b",
          "1",
          "run.sim",
        ],
        {
          cwd: root,
          encoding: "utf8",
          timeout: 15_000,
          windowsHide: true,
          env: {
            ...Object.fromEntries(
              [
                "PATH",
                "SystemRoot",
                "WINDIR",
                "TEMP",
                "TMP",
                "LD_LIBRARY_PATH",
              ].flatMap((key) =>
                process.env[key] ? [[key, process.env[key]]] : [],
              ),
            ),
            SIM_MODULE_PATH: modules,
            OMP_NUM_THREADS: "1",
            OPENBLAS_NUM_THREADS: "1",
            LC_ALL: "C",
          },
        },
      );
      expect(execution.error, String(execution.error)).toBeUndefined();
      expect(execution.status, `${execution.stdout}\n${execution.stderr}`).toBe(
        0,
      );
      const collected = await collectVacaskRawfiles(root, {
        ...limits,
        inputPaths: ["run.sim", "vacaskrc.toml"],
      });
      expect(collected.diagnostics).toEqual([]);
      expect(collected.rawfiles.map((file) => file.path)).toEqual([
        "bias.raw",
        "dc.raw",
        "frequency.op.raw",
        "frequency.raw",
        "noise.raw",
        "time.raw",
      ]);
      for (const file of collected.rawfiles)
        expect(file.text).toBe(await readFile(join(root, file.path), "utf8"));
      expect(await readFile(join(root, "run.sim"), "utf8")).toBe(source);
      const result = readVacaskSimulationData(collected.rawfiles, [
        { artifactPath: "bias.raw", plotOrdinal: 0, analysis: "op" },
        {
          artifactPath: "dc.raw",
          plotOrdinal: 0,
          analysis: "dc",
          axis: { name: "supply", quantity: "voltage", unit: "V" },
        },
        {
          artifactPath: "frequency.op.raw",
          plotOrdinal: 0,
          analysis: "op",
        },
        {
          artifactPath: "frequency.raw",
          plotOrdinal: 0,
          analysis: "ac",
          axis: "frequency",
        },
        {
          artifactPath: "noise.raw",
          plotOrdinal: 0,
          analysis: "noise",
          axis: "frequency",
          outputPsd: "onoise",
          powerGain: "gain",
          inputQuantity: "voltage",
        },
        {
          artifactPath: "time.raw",
          plotOrdinal: 0,
          analysis: "tran",
          axis: "time",
        },
      ]);
      expect(result.status, JSON.stringify(result)).toBe("read");
      expect(result.data.analyses.map((a) => a.analysis)).toEqual([
        "op",
        "dc",
        "op",
        "ac",
        "noise",
        "tran",
      ]);
    },
  );
});
