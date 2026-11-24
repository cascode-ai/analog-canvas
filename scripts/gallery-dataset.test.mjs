import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  defaultDir,
  exportNetlists,
  parseArgs,
  run,
  UsageError,
} from "./gallery-dataset.mjs";

/** A stand-in engine: names each export after its Process and format. */
const fakeHeadless = {
  NETLIST_PROFILE_IDS: ["abstract", "sky130", "custom"],
  parseProject: (text) => JSON.parse(text),
  savedWorkspaceNetlist: (project, format) =>
    fakeHeadless.workspaceNetlist(project, format, project.process),
  workspaceNetlist: (project, format, process) =>
    project.blocked && process === "sky130"
      ? { status: "blocked", text: null, messages: ["no model"], warnings: [] }
      : {
          status: "ready",
          text: `\n* ${project.name} ${process ?? "saved"} ${format}\n`,
          messages: [],
          warnings: process === "abstract" ? ["W: stand-in"] : [],
        },
};

const made = [];
const servers = [];
afterEach(() => {
  for (const dir of made.splice(0))
    rmSync(dir, { recursive: true, force: true });
  for (const server of servers.splice(0)) server.close();
});

function temp() {
  const dir = mkdtempSync(join(tmpdir(), "gallery-dataset-"));
  made.push(dir);
  return dir;
}

/** A Gallery with one community circuit and one dataset circuit. */
async function gallery(state) {
  const entry = (id, extra = {}) => ({
    id,
    name: id,
    createdAt: id,
    previewRevision: "p1",
    ...extra,
  });
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://x");
    const send = (body, type = "application/json") => {
      response.writeHead(200, { "content-type": type });
      response.end(
        typeof body === "string" || Buffer.isBuffer(body)
          ? body
          : JSON.stringify(body),
      );
    };
    const source = url.searchParams.get("source");
    if (url.pathname === "/api/gallery/sources")
      return send({ sources: [{ key: "ds" }] });
    if (url.pathname === "/api/gallery/maintenance/changes")
      return send({
        changes: state.changes[source] ?? [],
        latest: state.latest,
      });
    if (url.pathname === "/api/gallery")
      return send({ entries: state.walls[source] ?? [], nextCursor: null });
    if (url.pathname === "/api/gallery/sources/ds/comparisons")
      return send({
        comparisons: [{ id: "d1", verdict: "match", figureRevision: "f1" }],
      });
    if (url.pathname === "/api/gallery/sources/ds/comparisons/d1/figure")
      return send(Buffer.from("png"), "image/png");
    if (url.pathname === "/api/gallery/sources/ds/comparisons/d1")
      return send({ sourceNetlist: "R1 a b 1k\n" });
    const match = /^\/api\/gallery\/([^/]+)(\/preview\.svg)?$/u.exec(
      url.pathname,
    );
    if (match?.[2]) {
      state.svgReads?.push(match[1]);
      return send("<svg/>", "image/svg+xml");
    }
    if (match) {
      state.reads.push(match[1]);
      return send({ projectText: JSON.stringify(state.projects[match[1]]) });
    }
    response.writeHead(404).end();
  });
  servers.push(server);
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${server.address().port}`;
  state.entry = entry;
  return base;
}

describe("the arguments", () => {
  it("default to the analog-canvas-data folder", () => {
    expect(defaultDir({ ANALOG_CANVAS_DATA: "/data" })).toBe("/data/gallery");
    expect(parseArgs([], { ANALOG_CANVAS_DATA: "/data" }).dir).toBe(
      "/data/gallery",
    );
    expect(
      parseArgs(["out", "--full", "--only", "a,b", "--cpu-workers", "3"]),
    ).toMatchObject({
      only: new Set(["a", "b"]),
      cpuWorkers: 3,
    });
    expect(() => parseArgs(["--workers", "0"])).toThrow(UsageError);
    expect(() => parseArgs(["--cpu-workers", "0"])).toThrow(UsageError);
    expect(() => parseArgs(["--nope"])).toThrow(UsageError);
  });
});

describe("the netlists of one Project", () => {
  it("pair SPICE with Spectre for the saved and each open Process", () => {
    const { files, diagnostics } = exportNetlists(
      fakeHeadless,
      JSON.stringify({ name: "amp", blocked: true }),
    );
    expect(Object.keys(files).sort()).toEqual([
      "abstract.scs",
      "abstract.sp",
      "saved.scs",
      "saved.sp",
    ]);
    expect(files["saved.sp"]).toBe("* amp saved spice\n");
    expect(diagnostics["sky130.sp"]).toEqual({
      status: "blocked",
      errors: ["no model"],
    });
    expect(diagnostics["abstract.scs"]).toEqual({
      status: "ready",
      warnings: ["W: stand-in"],
    });
    const own = exportNetlists(
      fakeHeadless,
      JSON.stringify({ name: "amp", process: "abstract" }),
    );
    expect(own.files["saved.sp"]).toBe("* amp abstract spice\n");
  });

  it("projects each Process once across formats and isolates single-format throws", () => {
    const calls = [];
    const batchedHeadless = {
      ...fakeHeadless,
      workspaceNetlist: (project, format, process) => {
        if (project.throwOn === `${process}:${format}`)
          throw new Error("spectre boom");
        return fakeHeadless.workspaceNetlist(project, format, process);
      },
      savedWorkspaceNetlistFormats: (project, formats) => {
        calls.push(["saved", formats]);
        return Object.fromEntries(
          formats.map((f) => [
            f,
            fakeHeadless.savedWorkspaceNetlist(project, f),
          ]),
        );
      },
      workspaceNetlistFormats: (project, formats, process) => {
        calls.push([process, formats]);
        return Object.fromEntries(
          formats.map((f) => [
            f,
            batchedHeadless.workspaceNetlist(project, f, process),
          ]),
        );
      },
    };
    const { files, diagnostics } = exportNetlists(
      batchedHeadless,
      JSON.stringify({ name: "amp", throwOn: "sky130:spectre" }),
    );
    expect(calls).toEqual([
      ["saved", ["spice", "spectre"]],
      ["abstract", ["spice", "spectre"]],
      ["sky130", ["spice", "spectre"]],
    ]);
    // SPICE survives even when Spectre threw during the batched call.
    expect(Object.keys(files).sort()).toEqual([
      "abstract.scs",
      "abstract.sp",
      "saved.scs",
      "saved.sp",
      "sky130.sp",
    ]);
    expect(diagnostics["sky130.scs"]).toEqual({
      status: "blocked",
      errors: ["spectre boom"],
    });
    expect(diagnostics["sky130.sp"]).toBeUndefined();
  });
});

describe("a dataset run", () => {
  it("writes every circuit, then reads only what changed", async () => {
    const state = {
      changes: {},
      walls: {},
      latest: 1,
      reads: [],
      projects: {},
    };
    const base = await gallery(state);
    state.walls = { community: [state.entry("c1")], ds: [state.entry("d1")] };
    state.projects = { c1: { name: "c1" }, d1: { name: "d1" } };
    const bundle = join(temp(), "headless.mjs");
    writeFileSync(
      bundle,
      `export const NETLIST_PROFILE_IDS = ["abstract", "custom"];
export const parseProject = (text) => JSON.parse(text);
export const savedWorkspaceNetlist = (p, format) => workspaceNetlist(p, format);
export const embedFormalSvgFontsHeadless = async (svg) => svg.replace("<svg/>", "<svg><style>embedded</style></svg>");
export const workspaceNetlist = (p, format, process) => ({ status: "ready", text: p.name + " " + (process ?? "saved") + " " + format + "\\n", messages: [], warnings: [] });`,
    );
    const dir = temp();
    const quiet = () => {};
    expect(
      await run(
        { ...parseArgs([dir, "--base", base, "--bundle", bundle]) },
        quiet,
      ),
    ).toBe(0);

    const d1 = join(dir, "circuits/d1");
    expect(readFileSync(join(d1, "netlists/abstract.scs"), "utf8")).toBe(
      "d1 abstract spectre\n",
    );
    expect(readFileSync(join(d1, "source.sp"), "utf8")).toBe("R1 a b 1k\n");
    expect(readFileSync(join(d1, "figure.png"), "utf8")).toBe("png");
    expect(
      JSON.parse(readFileSync(join(d1, "meta.json"), "utf8")).dataset.verdict,
    ).toBe("match");
    expect(
      readFileSync(join(dir, "circuits/c1/schematic.svg"), "utf8"),
    ).toContain("embedded");
    expect(
      JSON.parse(readFileSync(join(dir, "snapshot.json"), "utf8")),
    ).toMatchObject({ circuits: 2 });

    // The next run reads only the circuit the feed names, and drops a removed one.
    state.reads.length = 0;
    state.changes = {
      community: [{ id: "c1", removed: true }],
      ds: [{ id: "d1", entry: state.entry("d1", { name: "renamed" }) }],
    };
    expect(
      await run(
        { ...parseArgs([dir, "--base", base, "--bundle", bundle]) },
        quiet,
      ),
    ).toBe(0);
    expect(state.reads).toEqual(["d1"]);
    expect(existsSync(join(dir, "circuits/c1"))).toBe(false);
    expect(JSON.parse(readFileSync(join(d1, "meta.json"), "utf8")).name).toBe(
      "renamed",
    );
  });

  it("re-exports across CPU workers without re-fetching unchanged previews", async () => {
    const state = {
      changes: {},
      walls: {},
      latest: 1,
      reads: [],
      svgReads: [],
      projects: {},
    };
    const base = await gallery(state);
    const ids = ["c1", "c2", "c3", "c4", "c5"];
    state.walls = { community: ids.map((id) => state.entry(id)), ds: [] };
    state.projects = Object.fromEntries(ids.map((id) => [id, { name: id }]));

    const makeBundle = (tag) => {
      const bundle = join(temp(), `headless-${tag}.mjs`);
      writeFileSync(
        bundle,
        `export const NETLIST_PROFILE_IDS = ["abstract", "custom"];
export const parseProject = (text) => JSON.parse(text);
export const savedWorkspaceNetlist = (p, format) => workspaceNetlist(p, format);
export const savedWorkspaceNetlistFormats = (p, formats) => Object.fromEntries(formats.map((f) => [f, savedWorkspaceNetlist(p, f)]));
export const workspaceNetlistFormats = (p, formats, process) => Object.fromEntries(formats.map((f) => [f, workspaceNetlist(p, f, process)]));
export const embedFormalSvgFontsHeadless = async (svg) => svg.replace("<svg/>", "<svg><style>embedded-${tag}</style></svg>");
export const workspaceNetlist = (p, format, process) => ({ status: "ready", text: "${tag} " + p.name + " " + (process ?? "saved") + " " + format + "\\n", messages: [], warnings: [] });`,
      );
      return bundle;
    };

    const dir = temp();
    const quiet = () => {};
    expect(
      await run(
        parseArgs([
          dir,
          "--base",
          base,
          "--bundle",
          makeBundle("v1"),
          "--cpu-workers",
          "2",
        ]),
        quiet,
      ),
    ).toBe(0);
    expect(state.svgReads.sort()).toEqual(ids);
    expect(
      readFileSync(join(dir, "circuits/c3/netlists/abstract.sp"), "utf8"),
    ).toBe("v1 c3 abstract spice\n");

    // Engine changes (v2), previewRevision stays p1: re-export every netlist, keep SVGs.
    state.reads.length = 0;
    state.svgReads.length = 0;
    expect(
      await run(
        parseArgs([
          dir,
          "--base",
          base,
          "--bundle",
          makeBundle("v2"),
          "--cpu-workers",
          "2",
        ]),
        quiet,
      ),
    ).toBe(0);
    expect(state.reads.sort()).toEqual(ids);
    expect(state.svgReads).toEqual([]);
    expect(
      readFileSync(join(dir, "circuits/c3/netlists/abstract.sp"), "utf8"),
    ).toBe("v2 c3 abstract spice\n");
    expect(
      readFileSync(join(dir, "circuits/c3/schematic.svg"), "utf8"),
    ).toContain("embedded-v1");

    // --full still refreshes preview SVGs as well.
    state.svgReads.length = 0;
    expect(
      await run(
        parseArgs([
          dir,
          "--base",
          base,
          "--bundle",
          makeBundle("v2"),
          "--full",
          "--cpu-workers",
          "2",
        ]),
        quiet,
      ),
    ).toBe(0);
    expect(state.svgReads.sort()).toEqual(ids);
    expect(
      readFileSync(join(dir, "circuits/c3/schematic.svg"), "utf8"),
    ).toContain("embedded-v2");
  });

  it("fails cleanly without hanging when every CPU worker exits unexpectedly", async () => {
    const state = {
      changes: {},
      walls: {},
      latest: 1,
      reads: [],
      svgReads: [],
      projects: {},
    };
    const base = await gallery(state);
    const ids = ["c1", "c2", "c3"];
    state.walls = { community: ids.map((id) => state.entry(id)), ds: [] };
    state.projects = Object.fromEntries(ids.map((id) => [id, { name: id }]));
    const bundle = join(temp(), "headless-exit.mjs");
    writeFileSync(
      bundle,
      `import { isMainThread } from "node:worker_threads";
export const NETLIST_PROFILE_IDS = ["abstract", "custom"];
export const parseProject = (text) => JSON.parse(text);
export const savedWorkspaceNetlist = () => ({ status: "ready", text: "", messages: [], warnings: [] });
export const workspaceNetlist = savedWorkspaceNetlist;
export const embedFormalSvgFontsHeadless = async (svg) => svg;
if (!isMainThread) process.exit(0);`,
    );
    const dir = temp();
    const quiet = () => {};
    expect(
      await run(
        parseArgs([
          dir,
          "--base",
          base,
          "--bundle",
          bundle,
          "--cpu-workers",
          "2",
        ]),
        quiet,
      ),
    ).toBe(1);
    expect(
      JSON.parse(readFileSync(join(dir, "snapshot.json"), "utf8")).engine,
    ).toBeNull();
  });
});
