import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
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
    if (match?.[2]) return send("<svg/>", "image/svg+xml");
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
    expect(parseArgs(["out", "--full", "--only", "a,b"]).only).toEqual(
      new Set(["a", "b"]),
    );
    expect(() => parseArgs(["--workers", "0"])).toThrow(UsageError);
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
    expect(readdirSync(join(d1, "netlists")).sort()).toEqual([
      "abstract.scs",
      "abstract.sp",
      "saved.scs",
      "saved.sp",
    ]);
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
    ).toMatchObject({
      circuits: 2,
      variants: ["saved", "abstract"],
      formats: ["spice", "spectre"],
    });

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
});
