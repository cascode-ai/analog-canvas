// The Season tool (tools/arena-season, #1560) on a small synthetic Gallery
// export whose circuits are drawn here through the editor's own Agent host.
// Equivalence is always judged by the #1524 grader itself.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createEmptyProject } from "@icm/model";

import {
  createLocalEditor,
  exportNetlist,
  gradeNetlists,
  parseProject,
  serializeProject,
} from "../tools/arena-season/editor.mjs";
import {
  buildSeason,
  checkSeason,
  submitContestant,
} from "../tools/arena-season/season.mjs";

const root = resolve(import.meta.dirname, "..");
const INSTRUCTIONS = "# Draw the Task\n\nDraw the netlist as a schematic.\n";
const RENDERER = "0123456789abcdef0123456789abcdef01234567";
const DATE = "2026-10-09";

// ---------------------------------------------------------------- fixtures

/** A Project drawn by the editor: parts placed, then wired pin to pin. */
function draw(name, parts, wires, { secondCell = false } = {}) {
  const project = createEmptyProject(`project-${name}`, name);
  project.documents[0].id = "main";
  project.topDocumentId = "main";
  const editor = createLocalEditor({ project });
  let call = 0;
  const transact = (actions, structural) => {
    call += 1;
    const answer = editor.circuit({
      apiVersion: "3.0",
      requestId: `fixture-${call}`,
      operation: "transact",
      documentId: editor.controller.document.id,
      transactionId: `fixture-${call}`,
      expectedRevision: editor.controller.document.revision,
      ...(structural
        ? { expectedStructureRevision: editor.project.structureRevision }
        : {}),
      dryRun: false,
      actions,
    });
    if (!answer.ok)
      throw new Error(`${name}: ${JSON.stringify(answer.error).slice(0, 600)}`);
  };
  transact(parts, true);
  for (let start = 0; start < wires.length; start += 64)
    transact(wires.slice(start, start + 64), false);
  if (secondCell)
    transact([{ kind: "create-cell", id: "second", name: "second" }], true);
  return editor.project;
}

const part = (symbol, reference, x, y) => ({
  kind: "place-component",
  symbol,
  reference,
  position: { x, y },
});
const marker = (symbol, id, x, y) => ({
  kind: "place-component",
  symbol,
  id,
  position: { x, y },
});
const wire = ([a, p], [b, q]) => ({
  kind: "connect",
  from: { kind: "pin", instance: a, pin: p },
  to: { kind: "pin", instance: b, pin: q },
});

/**
 * A common-source stage of five devices: an NMOS with a resistor load and
 * a degeneration resistor, an output capacitor and an input source. `names`
 * renames every part and port and `dx` moves the drawing, so two calls draw
 * the same circuit two ways.
 */
function amplifier(name, names, dx = 0) {
  const [m, rl, rs, c, v, input, output] = names;
  return draw(
    name,
    [
      marker("vdd-port", "vdd", 350 + dx, 80),
      part("resistor", rl, 350 + dx, 200),
      part("nmos", m, 340 + dx, 300),
      part("resistor", rs, 350 + dx, 420),
      marker("ground", "gnd", 350 + dx, 560),
      part("capacitor", c, 520 + dx, 420),
      part("voltage-source", v, 160 + dx, 420),
      part("port", input, 160 + dx, 300),
      part("port", output, 640 + dx, 260),
    ],
    [
      wire(["vdd", "P"], [rl, "1"]),
      wire([rl, "2"], [m, "D"]),
      wire([m, "S"], [rs, "1"]),
      wire([rs, "2"], ["gnd", "0"]),
      wire([output, "P"], [m, "D"]),
      wire([c, "1"], [m, "D"]),
      wire([c, "2"], ["gnd", "0"]),
      wire([input, "P"], [m, "G"]),
      wire([v, "+"], [input, "P"]),
      wire([v, "-"], ["gnd", "0"]),
    ],
  );
}

/** `count` resistors in series between ports A and B, in one column. */
function ladder(name, count, { open = false, secondCell = false } = {}) {
  const parts = [part("port", "A", 100, 40)];
  const wires = [];
  for (let index = 1; index <= count; index += 1) {
    parts.push(part("resistor", `R${index}`, 200, 40 + index * 100));
    wires.push(
      index === 1
        ? wire(["A", "P"], ["R1", "1"])
        : wire([`R${index - 1}`, "2"], [`R${index}`, "1"]),
    );
  }
  if (!open) {
    parts.push(part("port", "B", 100, 100 + count * 100));
    wires.push(wire([`R${count}`, "2"], ["B", "P"]));
  }
  return draw(name, parts, wires, { secondCell });
}

/** Five resistors in series with an ideal switch, which SPICE import lacks. */
function switched(name) {
  return draw(
    name,
    [
      part("port", "A", 100, 40),
      part("resistor", "R1", 200, 140),
      part("resistor", "R2", 200, 240),
      part("ideal-switch", "S1", 300, 320),
      part("resistor", "R3", 400, 400),
      part("resistor", "R4", 400, 500),
      part("resistor", "R5", 400, 600),
      part("port", "B", 500, 700),
    ],
    [
      wire(["A", "P"], ["R1", "1"]),
      wire(["R1", "2"], ["R2", "1"]),
      wire(["R2", "2"], ["S1", "1"]),
      wire(["S1", "2"], ["R3", "1"]),
      wire(["R3", "2"], ["R4", "1"]),
      wire(["R4", "2"], ["R5", "1"]),
      wire(["R5", "2"], ["B", "P"]),
    ],
  );
}

/** Two ports and no device. */
function bare(name) {
  return draw(
    name,
    [part("port", "A", 100, 40), part("port", "B", 300, 40)],
    [],
  );
}

/** One Gallery export entry, as the 2026-10-08 export lays it out. */
function addEntry(exportDir, id, project, { author = "Ada", netlist } = {}) {
  const dir = join(exportDir, "circuits", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "project.icproj.json"), serializeProject(project));
  writeFileSync(
    join(dir, "entry.json"),
    JSON.stringify({
      id,
      name: `${project.name} entry`,
      author,
      documentCount: project.documents.length,
    }),
  );
  const exported = netlist ?? exportNetlist(project).text;
  if (exported) writeFileSync(join(dir, "netlist.sp"), exported);
}

// --------------------------------------------------------- the contract

const sha = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** Checks a Task pack folder against the Season bundle contract. */
function expectTaskPack(dir) {
  const bytes = readFileSync(join(dir, "manifest.json"));
  const manifest = JSON.parse(bytes.toString("utf8"));
  expect(Object.keys(manifest).sort()).toEqual(
    [
      "kind",
      "version",
      "season",
      "instructionsVersion",
      "instructions",
      "tasks",
    ].sort(),
  );
  expect(manifest).toMatchObject({
    kind: "analog-arena/task-pack",
    version: 1,
    season: expect.any(String),
    instructionsVersion: expect.stringMatching(/^[0-9a-f]{12}$/u),
    instructions: "instructions.md",
  });
  expect(existsSync(join(dir, manifest.instructions))).toBe(true);
  for (const task of manifest.tasks) {
    expect(Object.keys(task).sort()).toEqual(
      [
        "id",
        "circuitName",
        "functionClass",
        "devices",
        "netlist",
        "netlistHash",
        "source",
      ].sort(),
    );
    expect(task.id).toMatch(/^T\d{3,}$/u);
    expect(typeof task.circuitName).toBe("string");
    expect(
      task.functionClass === null || typeof task.functionClass === "string",
    ).toBe(true);
    expect(Number.isInteger(task.devices)).toBe(true);
    expect(task.devices).toBeGreaterThan(0);
    expect(task.netlist).toBe(`tasks/${task.id}.sp`);
    expect(task.netlistHash).toBe(sha(readFileSync(join(dir, task.netlist))));
    expect(task.source).toEqual({ gallery: expect.any(String) });
  }
  return { manifest, hash: sha(bytes) };
}

/** Checks a Contestant bundle folder against the contract and its pack. */
function expectBundle(dir, pack) {
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  expect(Object.keys(manifest).sort()).toEqual(
    [
      "kind",
      "version",
      "season",
      "taskPackHash",
      "contestant",
      "rendererVersion",
      "items",
    ].sort(),
  );
  expect(manifest).toMatchObject({
    kind: "analog-arena/submissions",
    version: 1,
    season: pack.manifest.season,
    taskPackHash: pack.hash,
    rendererVersion: expect.any(String),
  });
  expect(Object.keys(manifest.contestant).sort()).toEqual(
    [
      "slug",
      "role",
      "name",
      "provider",
      "modelId",
      "reasoning",
      "harness",
      "date",
      "protocolDeclaration",
    ].sort(),
  );
  for (const value of Object.values(manifest.contestant))
    expect(typeof value).toBe("string");
  expect([
    "model",
    "tool",
    "grid-baseline",
    "human-reference",
    "check-copy",
  ]).toContain(manifest.contestant.role);
  expect(manifest.items.map((item) => item.taskId)).toEqual(
    pack.manifest.tasks.map((task) => task.id),
  );
  for (const item of manifest.items) {
    expect(Object.keys(item).sort()).toEqual(
      ["taskId", "status", "reason", "project", "svg", "netlist"].sort(),
    );
    expect(["valid", "not-equivalent", "unreadable", "missing"]).toContain(
      item.status,
    );
    if (item.status === "valid") expect(item.reason).toBeNull();
    else expect(typeof item.reason).toBe("string");
    if (item.status === "missing")
      expect([item.project, item.svg, item.netlist]).toEqual([
        null,
        null,
        null,
      ]);
    else expect(item.project).toBe(`${item.taskId}.icproj.json`);
    if (item.status === "valid" || item.status === "not-equivalent") {
      expect(item.svg).toBe(`${item.taskId}.svg`);
      expect(item.netlist).toBe(`${item.taskId}.sp`);
    }
    for (const file of [item.project, item.svg, item.netlist])
      if (file !== null) expect(existsSync(join(dir, file))).toBe(true);
  }
  return manifest;
}

function tree(dir) {
  const files = {};
  const walk = (current) => {
    for (const name of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, name.name);
      if (name.isDirectory()) walk(path);
      else files[relative(dir, path)] = readFileSync(path).toString("base64");
    }
  };
  walk(dir);
  return files;
}

// ------------------------------------------------------------------ tests

describe("Season tool (#1560)", () => {
  let work;
  let exportDir;
  let listPath;
  let built;
  const build = (listText, outDir, extra = {}) =>
    buildSeason({
      listText,
      exportDir,
      outDir,
      season: "S1",
      instructions: INSTRUCTIONS,
      date: DATE,
      rendererVersion: RENDERER,
      ...extra,
    });

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), "arena-season-"));
    exportDir = join(work, "export");
    addEntry(
      exportDir,
      "amp5",
      amplifier("cs", ["M1", "R1", "R2", "C1", "V1", "IN", "OUT"]),
    );
    // The same circuit drawn again with other names, elsewhere.
    addEntry(
      exportDir,
      "amp5b",
      amplifier("cs2", ["Mx", "Ra", "Rb", "Cx", "Vx", "VIN", "VOUT"], 80),
    );
    // Its netlist.sp is out of date: the Task must use the current export.
    addEntry(exportDir, "ladder15", ladder("ladder15", 15), {
      netlist: "* an older export\nR1 A B 1k\n",
    });
    addEntry(exportDir, "ladder6", ladder("ladder6", 6));
    addEntry(exportDir, "ladder7", ladder("ladder7", 7));
    addEntry(exportDir, "ladder4", ladder("ladder4", 4));
    addEntry(exportDir, "ladder50", ladder("ladder50", 50));
    addEntry(exportDir, "ai16", ladder("ladder16", 16), {
      author: "Claude Opus 5.5",
    });
    addEntry(exportDir, "open6", ladder("open6", 6, { open: true }));
    addEntry(
      exportDir,
      "twocells",
      ladder("twocells", 6, { secondCell: true }),
    );
    addEntry(exportDir, "switched", switched("switched"));
    addEntry(exportDir, "bare", bare("bare"));
    listPath = join(work, "list.txt");
    writeFileSync(
      listPath,
      [
        "# Season 1, first draft",
        "amp5\tCommon-source amplifier\tamplifier",
        "ladder15\t\tdivider",
        "ladder6",
        "",
        "ladder7\tSeven-resistor ladder",
      ].join("\n"),
    );
    built = await build(readFileSync(listPath, "utf8"), join(work, "out"));
  }, 240_000);

  afterAll(() => rmSync(work, { recursive: true, force: true }));

  it("reports every problem in the Owner's list with device counts and function class totals, and builds nothing", async () => {
    const listText = [
      "amp5\t\tamplifier",
      "nosuch",
      "twocells",
      "open6",
      "ladder4",
      "ladder50",
      "ai16\t\tdivider",
      "amp5b\t\tamplifier",
      "ladder15\t\tdivider",
      "amp5",
      "switched",
      "bare",
    ].join("\n");
    const { report } = await checkSeason({
      listText,
      exportDir,
      splitText: "ladder15\nsomething-else\n",
    });
    const problems = Object.fromEntries(
      report.entries.map((entry) => [
        `${entry.taskId} ${entry.gallery}`,
        entry.problems,
      ]),
    );
    expect(problems).toEqual({
      "T001 amp5": [],
      "T002 nosuch": [expect.stringMatching(/^Unknown id/u)],
      "T003 twocells": [expect.stringMatching(/^Not exactly one Cell: .* 2$/u)],
      "T004 open6": [
        expect.stringMatching(
          /^The current exporter cannot produce its netlist/u,
        ),
      ],
      // Any positive number of devices is a valid size.
      "T005 ladder4": [],
      "T006 ladder50": [],
      "T007 ai16": [
        expect.stringMatching(/^Drawn by an AI account \(Claude Opus 5\.5\)/u),
      ],
      "T008 amp5b": [
        expect.stringMatching(
          /^Duplicate by graph hash of amp5 on line 1 \(T001\)/u,
        ),
      ],
      "T009 ladder15": ["In #1524's private test split"],
      "T010 amp5": [
        expect.stringMatching(/^Listed twice: also on line 1 \(T001\)/u),
      ],
      "T011 switched": [
        expect.stringMatching(
          /^The structural SPICE import cannot read its netlist, so it can have no Grid Baseline/u,
        ),
      ],
      "T012 bare": ["No devices: it has 0"],
    });
    expect(report.ok).toBe(false);
    expect(report.totals).toEqual({
      devices: { min: 0, median: 5.5, max: 50 },
      functionClasses: { "(none)": 8, amplifier: 2, divider: 2 },
    });
    // The out-of-date netlist.sp is a note, not a problem.
    expect(report.entries[8].notes).toEqual([
      expect.stringMatching(/differs from the export's netlist\.sp/u),
    ]);

    const outDir = join(work, "blocked");
    const result = await build(listText, outDir);
    expect(result.status).toBe("blocked");
    expect(readdirSync(outDir)).toEqual(["build-report.json"]);
  });

  it("builds the Task pack in the Owner's order and three Contestant bundles that follow the contract", () => {
    const out = join(work, "out");
    expect(built.status).toBe("built");
    const pack = expectTaskPack(join(out, "task-pack"));
    expect(
      pack.manifest.tasks.map((task) => [
        task.id,
        task.source.gallery,
        task.circuitName,
        task.functionClass,
        task.devices,
      ]),
    ).toEqual([
      ["T001", "amp5", "Common-source amplifier", "amplifier", 5],
      ["T002", "ladder15", "ladder15 entry", "divider", 15],
      ["T003", "ladder6", "ladder6 entry", null, 6],
      ["T004", "ladder7", "Seven-resistor ladder", null, 7],
    ]);
    expect(readFileSync(join(out, "task-pack/instructions.md"), "utf8")).toBe(
      INSTRUCTIONS,
    );
    // The Task netlist is the current exporter's, not the stale netlist.sp.
    expect(readFileSync(join(out, "task-pack/tasks/T002.sp"), "utf8")).toBe(
      exportNetlist(
        parseProject(
          readFileSync(
            join(exportDir, "circuits/ladder15/project.icproj.json"),
            "utf8",
          ),
        ),
      ).text,
    );
    const renderers = new Set();
    for (const slug of ["human-reference", "grid-baseline", "check-copy"]) {
      const bundle = expectBundle(join(out, slug), pack);
      expect(bundle.contestant).toMatchObject({ slug, role: slug, date: DATE });
      expect(bundle.items.map((item) => item.status)).toEqual([
        "valid",
        "valid",
        "valid",
        "valid",
      ]);
      renderers.add(bundle.rendererVersion);
    }
    expect([...renderers]).toEqual([RENDERER]);
    // The Human Reference is the author's file, byte for byte.
    expect(readFileSync(join(out, "human-reference/T001.icproj.json"))).toEqual(
      readFileSync(join(exportDir, "circuits/amp5/project.icproj.json")),
    );
    const exclusions = JSON.parse(
      readFileSync(join(out, "season-exclusions.json"), "utf8"),
    );
    expect(exclusions.entries).toEqual(
      ["amp5", "ladder15", "ladder6", "ladder7"].map((gallery, index) => ({
        taskId: `T00${index + 1}`,
        gallery,
        graphHash: expect.stringMatching(/^wl1:[0-9a-f]{64}$/u),
      })),
    );
    expect(
      new Set(exclusions.entries.map((entry) => entry.graphHash)).size,
    ).toBe(4);
  });

  it("draws every Project equivalent to its Task: the grader says so, with source polarity on", async () => {
    const out = join(work, "out");
    for (const slug of ["human-reference", "grid-baseline", "check-copy"])
      for (const id of ["T001", "T002", "T003", "T004"]) {
        const project = parseProject(
          readFileSync(join(out, slug, `${id}.icproj.json`), "utf8"),
        );
        const grade = await gradeNetlists(
          exportNetlist(project).text,
          readFileSync(join(out, "task-pack/tasks", `${id}.sp`), "utf8"),
          { sourcePolarity: true },
        );
        expect(grade.exact, `${slug} ${id}`).toBe(true);
      }
  });

  it("joins the Grid Baseline's devices only by net labels, and moves the Check copy's parts", () => {
    const out = join(work, "out");
    const read = (slug, id) => {
      const project = JSON.parse(
        readFileSync(join(out, slug, `${id}.icproj.json`), "utf8"),
      );
      return project.documents[0];
    };
    for (const id of ["T001", "T002"]) {
      const grid = read("grid-baseline", id);
      const terminals = (end) => (end && "terminal" in end ? 1 : 0);
      expect(grid.routes.length).toBeGreaterThan(0);
      for (const route of grid.routes)
        expect(terminals(route.start) + terminals(route.end)).toBe(1);
      expect(
        grid.annotations.filter((label) => label.kind === "net-label"),
      ).toHaveLength(grid.routes.length);

      const reference = read("human-reference", id);
      const copy = read("check-copy", id);
      const at = (document) =>
        Object.fromEntries(
          document.instances.map((instance) => [
            instance.id,
            instance.coordinate.join(","),
          ]),
        );
      expect(Object.keys(at(copy)).sort()).toEqual(
        Object.keys(at(reference)).sort(),
      );
      const moved = Object.entries(at(copy)).filter(
        ([instance, position]) => at(reference)[instance] !== position,
      );
      expect(moved.length).toBeGreaterThan(0);
    }
  });

  it("gives the same outputs byte for byte on a rerun and never changes the Owner's list", async () => {
    const before = readFileSync(listPath);
    const modified = statSync(listPath).mtimeMs;
    const again = join(work, "again");
    await build(readFileSync(listPath, "utf8"), again);
    expect(tree(again)).toEqual(tree(join(work, "out")));
    // Into the same folder, replacing the previous build.
    await build(readFileSync(listPath, "utf8"), again);
    expect(tree(again)).toEqual(tree(join(work, "out")));
    expect(readFileSync(listPath)).toEqual(before);
    expect(statSync(listPath).mtimeMs).toBe(modified);
  }, 120_000);

  it("turns a Contestant's folder into its bundle: valid, not equivalent, unreadable, missing; unknown Task ids left out", async () => {
    const out = join(work, "out");
    const pack = expectTaskPack(join(out, "task-pack"));
    const contestant = (slug) => ({
      slug,
      role: "model",
      name: `Model ${slug}`,
      provider: "Example",
      modelId: `${slug}-1`,
      reasoning: "high",
      harness: "analog-canvas MCP --local",
      date: "2026-10-12",
      protocolDeclaration: "Netlist and circuit name only; one attempt.",
    });
    const submit = async (slug, files) => {
      const folder = join(work, slug);
      mkdirSync(folder);
      for (const [name, content] of Object.entries(files))
        writeFileSync(join(folder, name), content);
      const result = await submitContestant({
        taskPackDir: join(out, "task-pack"),
        contestantDir: folder,
        contestant: contestant(slug),
        outDir: out,
        rendererVersion: RENDERER,
      });
      const manifest = expectBundle(join(out, slug), pack);
      expect(manifest.contestant).toEqual(contestant(slug));
      expect(manifest.rendererVersion).toBe(RENDERER);
      return { result, manifest };
    };
    // A drawing with one resistor's value left out, which main's exporter
    // refuses; device values are optional, so the structure decides.
    const withoutValue = (path) => {
      const project = JSON.parse(readFileSync(path, "utf8"));
      project.documents[0].instances.find(
        (instance) => instance.name === "R1",
      ).parameters = {};
      return JSON.stringify(project);
    };
    const { result, manifest } = await submit("model-a", {
      "T001.icproj.json": readFileSync(
        join(out, "human-reference/T001.icproj.json"),
      ),
      "T002.icproj.json": withoutValue(
        join(out, "human-reference/T002.icproj.json"),
      ),
      // Six resistors where the Task has seven.
      "T004.icproj.json": readFileSync(
        join(exportDir, "circuits/ladder6/project.icproj.json"),
      ),
      "T009.icproj.json": readFileSync(
        join(out, "human-reference/T001.icproj.json"),
      ),
      "notes.txt": "drawn on a Tuesday",
    });
    expect(manifest.items.map((item) => [item.taskId, item.status])).toEqual([
      ["T001", "valid"],
      ["T002", "valid"],
      ["T003", "missing"],
      ["T004", "not-equivalent"],
    ]);
    expect(manifest.items[1]).toMatchObject({
      reason: null,
      svg: "T002.svg",
      netlist: "T002.sp",
    });
    const draft = readFileSync(join(out, "model-a/T002.sp"), "utf8");
    expect(draft.split("\n")[0]).toBe(
      "* Missing device values, printed as ? placeholders: Instance R1 requires parameter value",
    );
    expect(draft).toMatch(/^R1 \S+ \S+ \?$/mu);
    expect(manifest.items[3].reason).toMatch(/6 devices where the Task has 7/u);
    expect(result.unknownTasks).toEqual(["T009.icproj.json"]);
    expect(result.ignored).toEqual(["notes.txt"]);
    expect(existsSync(join(out, "model-a/T009.icproj.json"))).toBe(false);

    const other = await submit("model-b", {
      "T001.icproj.json": "{ not a Project",
      // An unconnected pin blocks the export for another reason.
      "T003.icproj.json": readFileSync(
        join(exportDir, "circuits/open6/project.icproj.json"),
      ),
      // Without a value and with one resistor too few.
      "T004.icproj.json": withoutValue(
        join(exportDir, "circuits/ladder6/project.icproj.json"),
      ),
    });
    expect(other.manifest.items).toEqual([
      {
        taskId: "T001",
        status: "unreadable",
        reason: expect.stringMatching(/^Not an Analog Canvas Project/u),
        project: "T001.icproj.json",
        svg: null,
        netlist: null,
      },
      expect.objectContaining({ taskId: "T002", status: "missing" }),
      {
        taskId: "T003",
        status: "unreadable",
        reason: expect.stringMatching(
          /^Its netlist cannot be exported: (?!.*requires parameter)/u,
        ),
        project: "T003.icproj.json",
        svg: "T003.svg",
        netlist: null,
      },
      expect.objectContaining({
        taskId: "T004",
        status: "not-equivalent",
        reason: expect.stringMatching(/6 devices where the Task has 7/u),
        netlist: "T004.sp",
      }),
    ]);
  });

  it("runs from the command line: build, submissions, and upload as a seam", () => {
    const cli = (...args) =>
      spawnSync(process.execPath, ["tools/arena-season/cli.mjs", ...args], {
        cwd: root,
        encoding: "utf8",
        timeout: 180_000,
      });
    const out = join(work, "cli");
    const built = cli(
      "build",
      "--list",
      listPath,
      "--export",
      exportDir,
      "--out",
      out,
      "--date",
      DATE,
    );
    expect(built.status, built.stderr).toBe(0);
    expect(built.stdout).toMatch(/Devices: min 5, median 6\.5, max 15\./u);
    const head = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).stdout.trim();
    const pack = expectTaskPack(join(out, "task-pack"));
    expect(expectBundle(join(out, "grid-baseline"), pack).rendererVersion).toBe(
      head,
    );

    const info = join(work, "info.json");
    writeFileSync(
      info,
      JSON.stringify({
        slug: "human-again",
        role: "tool",
        name: "Human Reference again",
        provider: "Test",
        modelId: "none",
        reasoning: "none",
        harness: "copy",
        date: DATE,
        protocolDeclaration: "A copy of the Human Reference.",
      }),
    );
    const judged = cli(
      "submissions",
      "--tasks",
      join(out, "task-pack"),
      "--contestant",
      join(out, "human-reference"),
      "--contestant-info",
      info,
      "--out",
      out,
    );
    expect(judged.status, judged.stderr).toBe(0);
    expect(
      expectBundle(join(out, "human-again"), pack).items.every(
        (item) => item.status === "valid",
      ),
    ).toBe(true);

    const upload = cli("upload", "--out", out);
    expect(upload.status).toBe(2);
    expect(upload.stderr).toMatch(/#1559/u);
  }, 240_000);
});
