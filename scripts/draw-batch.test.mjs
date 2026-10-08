import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  decide,
  expandTemplate,
  mcpConfig,
  parseArguments,
  parseManifest,
  parseUsage,
  splitCommand,
  summarize,
  wantsSecond,
  wilson,
} from "./draw-batch.mjs";

const root = resolve(import.meta.dirname, "..");

describe("batch drawing runner (#1498)", () => {
  it("reads its options and refuses what it cannot run", () => {
    expect(
      parseArguments([
        "--",
        "tasks.jsonl",
        "--out",
        "out",
        "--agent",
        "claude -p",
        "--jobs",
        "4",
        "--timeout",
        "15m",
        "--resume",
        "--body",
        "ignore",
      ]),
    ).toMatchObject({
      manifest: "tasks.jsonl",
      out: "out",
      agent: "claude -p",
      jobs: 4,
      timeoutSeconds: 900,
      resume: true,
      body: "ignore",
      sourcePolarity: false,
    });
    const base = ["tasks.jsonl", "--out", "out", "--agent", "a"];
    expect(() => parseArguments(["tasks.jsonl", "--out", "o"])).toThrow(
      "Give --agent",
    );
    expect(() => parseArguments([...base, "--jobs", "0"])).toThrow("--jobs");
    expect(() => parseArguments([...base, "--body", "maybe"])).toThrow(
      "--body",
    );
    expect(() => parseArguments([...base, "--timeout", "soon"])).toThrow(
      "--timeout",
    );
    expect(() => parseArguments([...base, "--fast"])).toThrow("Unknown option");
  });

  it("reads a manifest: ids, paths beside it, inline references and the redraw lists' figure field", () => {
    const tasks = parseManifest(
      [
        '{"id": 4, "figure": "Book4.png", "reference": "4.cir", "dataset": "analoggenie"}',
        "",
        '{"id": "inline", "reference": "R1 vdd 0 1k\\nR2 vdd 0 1k", "name": "Two", "instructions": "Mind the rails"}',
      ].join("\n"),
      "/data",
    );
    expect(tasks).toEqual([
      {
        id: "4",
        image: resolve("/data", "Book4.png"),
        reference: { path: resolve("/data", "4.cir") },
      },
      {
        id: "inline",
        reference: { text: "R1 vdd 0 1k\nR2 vdd 0 1k" },
        name: "Two",
        instructions: "Mind the rails",
      },
    ]);
    expect(() => parseManifest('{"id":"a"}\n{"id":"a"}', "/")).toThrow(
      "line 2: id a is used twice",
    );
    expect(() => parseManifest('{"id":"../a"}', "/")).toThrow("id must be");
    expect(() => parseManifest('{"id":"summary.json"}', "/")).toThrow(
      "id must be",
    );
    expect(() => parseManifest('{"id":"a","image":3}', "/")).toThrow(
      "image must be a string",
    );
    expect(() => parseManifest("{id: a}", "/")).toThrow("line 1 is not JSON");
    expect(() => parseManifest("\n", "/")).toThrow("no tasks");
  });

  it("quotes placeholders for the shell and writes the MCP server's own words", () => {
    const values = { dir: "/tmp/a b/it's", id: "7" };
    expect(expandTemplate("run {dir} --id {id} {unknown} {}", values)).toBe(
      "run '/tmp/a b/it'\\''s' --id '7' {unknown} {}",
    );
    expect(splitCommand(`node "/opt/a b/mcp.mjs" --local {dir} 'x y'`)).toEqual(
      ["node", "/opt/a b/mcp.mjs", "--local", "{dir}", "x y"],
    );
    expect(() => splitCommand('node "open')).toThrow("Unclosed quote");
    expect(mcpConfig("node /opt/mcp.mjs --local {dir}", values)).toEqual({
      mcpServers: {
        "analog-canvas": {
          command: "node",
          args: ["/opt/mcp.mjs", "--local", "/tmp/a b/it's"],
        },
      },
    });
  });

  it("reads the usage Claude Code and Codex print, and nothing from plain output", () => {
    const result = {
      type: "result",
      num_turns: 12,
      total_cost_usd: 0.42,
      duration_ms: 61000,
      is_error: false,
      usage: {
        input_tokens: 30,
        output_tokens: 4000,
        cache_read_input_tokens: 90000,
        cache_creation_input_tokens: 5000,
      },
    };
    const claude = {
      costUsd: 0.42,
      numTurns: 12,
      durationMs: 61000,
      isError: false,
      inputTokens: 30,
      outputTokens: 4000,
      cacheReadInputTokens: 90000,
      cacheCreationInputTokens: 5000,
    };
    expect(parseUsage(JSON.stringify(result, null, 2))).toEqual(claude);
    expect(
      parseUsage(
        `{"type":"system"}\n{"type":"assistant"}\n${JSON.stringify(result)}\n`,
      ),
    ).toEqual(claude);
    expect(
      parseUsage(
        [
          '{"type":"thread.started"}',
          '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":7}}',
          '{"type":"turn.completed","usage":{"input_tokens":50,"cached_input_tokens":10,"output_tokens":3}}',
        ].join("\n"),
      ),
    ).toEqual({
      numTurns: 2,
      inputTokens: 150,
      outputTokens: 10,
      cacheReadInputTokens: 50,
    });
    expect(parseUsage("drew 4 parts\n")).toBeNull();
  });

  it("puts a Wilson interval around a rate", () => {
    const [low, high] = wilson(4, 6);
    expect(low).toBeCloseTo(0.3, 3);
    expect(high).toBeCloseTo(0.9032, 3);
    expect(wilson(0, 0)).toEqual([0, 1]);
    expect(wilson(10, 10)[1]).toBeCloseTo(1, 12);
    expect(wilson(50, 100)[0]).toBeCloseTo(0.4038, 3);
  });

  it("decides which drawing a task keeps", () => {
    expect(wantsSecond("mismatch")).toBe(true);
    expect(wantsSecond("blocked")).toBe(true);
    expect(wantsSecond("match")).toBe(false);
    expect(wantsSecond("ungradable")).toBe(false);
    const table = [
      [{ first: "match" }, "first", "first", false],
      [{ first: "no-reference" }, "unchecked", null, false],
      [{ first: "ungradable" }, "review", null, false],
      [{ first: "mismatch" }, "review", null, false],
      [{ first: "mismatch", second: "match" }, "second", "second", false],
      [{ first: "blocked", second: "match" }, "second", "second", false],
      [
        { first: "mismatch", second: "mismatch", agree: true },
        "agreed",
        "first",
        true,
      ],
      [
        { first: "mismatch", second: "mismatch", agree: false },
        "review",
        null,
        false,
      ],
      [{ first: "blocked", second: "mismatch" }, "review", null, false],
      [{ first: "error", second: "blocked" }, "review", null, false],
    ];
    for (const [input, path, accepted, datasetSuspect] of table)
      expect(decide(input), JSON.stringify(input)).toMatchObject({
        path,
        accepted,
        datasetSuspect,
      });
    expect(decide({ first: "mismatch" }).reason).toContain("no second drawing");
  });

  it("counts the exact rate over tasks graded against a readable reference", () => {
    const attempt = (outcome, costUsd) => ({
      outcome,
      ...(outcome === "match" || outcome === "mismatch"
        ? {
            grade: {
              exact: outcome === "match",
              mode: "strict",
              deviceTypeF1: outcome === "match" ? 1 : 0.5,
              connectionF1: outcome === "match" ? 1 : 0.25,
            },
          }
        : {}),
      agent: { wallSeconds: 10, usage: costUsd ? { costUsd } : null },
    });
    const summary = summarize([
      {
        id: "a",
        path: "first",
        accepted: "first",
        reference: "spice",
        first: attempt("match", 1),
      },
      {
        id: "b",
        path: "agreed",
        accepted: "first",
        datasetSuspect: true,
        reference: "spectre",
        first: attempt("mismatch", 2),
        second: attempt("mismatch", 3),
      },
      {
        id: "c",
        path: "review",
        accepted: null,
        reference: "spice",
        first: attempt("blocked"),
      },
      {
        id: "d",
        path: "unchecked",
        accepted: null,
        reference: null,
        first: attempt("no-reference"),
      },
      {
        id: "e",
        path: "review",
        accepted: null,
        reference: "spice",
        referenceProblems: ["Unread statement: K1 L1 L2 1"],
        first: attempt("mismatch"),
      },
    ]);
    expect(summary).toMatchObject({
      tasks: 5,
      paths: { first: 1, agreed: 1, review: 2, unchecked: 1 },
      exact: { count: 1, n: 3 },
      accepted: { count: 2, n: 3 },
      datasetSuspect: 1,
      review: 2,
      meanDeviceTypeF1: 0.75,
      meanConnectionF1: 0.625,
      usage: { tasksWithUsage: 2, costUsd: 6 },
      agentSeconds: 60,
    });
    expect(summary.perTask[1]).toMatchObject({
      id: "b",
      second: "mismatch",
      costUsd: 5,
      agentSeconds: 20,
      datasetSuspect: true,
    });
  });
});

describe("batch drawing runner end to end (#1498)", () => {
  let work;
  let bundle;
  const agent =
    "node {cwd}/scripts/lib/draw-batch-script-agent.mjs {bundle} {dir} {role}";
  const run = (out, ...extra) =>
    spawnSync(
      process.execPath,
      [
        "scripts/draw-batch.mjs",
        join(work, "tasks.jsonl"),
        "--out",
        out,
        "--jobs",
        "4",
        // Long enough for a loaded CI runner to start the bundled editor and
        // draw; the hanging task still runs into it.
        "--timeout",
        "20",
        "--agent",
        agent,
        "--second-agent",
        agent,
        "--bundle",
        bundle,
        ...extra,
      ],
      { cwd: root, encoding: "utf8", timeout: 240_000 },
    );
  const json = (...path) => JSON.parse(readFileSync(join(...path), "utf8"));

  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), "icm-draw-batch-"));
    // The real editor, bundled from source as the runner loads it.
    execFileSync(process.execPath, [
      join(root, "scripts/package-headless.mjs"),
      join(work, "bundle"),
    ]);
    bundle = join(work, "bundle/analog-canvas-headless.mjs");
    writeFileSync(
      join(work, "divider.sp"),
      "* d\nR1 vdd out 1k\nR2 out 0 2k\n",
    );
    // A dataset netlist that does not say what the figure shows.
    writeFileSync(join(work, "wrong.sp"), "* w\nR1 vdd out 1k\nR2 vdd 0 2k\n");
    writeFileSync(join(work, "figure.png"), "not really a png");
    const task = (id, reference, instructions, extra = {}) =>
      JSON.stringify({ id, reference, instructions, ...extra });
    writeFileSync(
      join(work, "tasks.jsonl"),
      [
        task("first", "divider.sp", "script-agent first=divider"),
        task(
          "second",
          "divider.sp",
          "script-agent first=divider-short second=divider",
        ),
        task(
          "suspect",
          "wrong.sp",
          "script-agent first=divider second=divider",
        ),
        task("review", "divider.sp", "script-agent first=nothing second=fail"),
        task(
          "spectre",
          "M0 (VOUT VIN VSS VSS) nmos4\nR0 (VDD VOUT) resistor",
          "script-agent first=amplifier",
          { image: "figure.png" },
        ),
        task("timeout", "divider.sp", "script-agent first=hang second=divider"),
        JSON.stringify({
          id: "unchecked",
          instructions: "script-agent first=divider",
        }),
      ].join("\n"),
    );
  }, 120_000);
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  it("draws, grades, redraws and queues each task, and resumes where it stopped", () => {
    const out = join(work, "out");
    const first = run(out);
    expect(first.status, first.stderr).toBe(0);
    const verdict = (id) => json(out, id, "verdict.json");
    expect(verdict("first")).toMatchObject({
      path: "first",
      accepted: "first",
      reference: "spice",
      first: {
        outcome: "match",
        grade: { exact: true, mode: "strict" },
        agent: {
          exitCode: 0,
          timedOut: false,
          usage: { costUsd: 0.0125, numTurns: 2, inputTokens: 1200 },
        },
      },
    });
    for (const file of [
      "project.icproj.json",
      "reference.sp",
      "mcp.json",
      "prompt.md",
      "agent.log",
      "netlist.sp",
      "figure.svg",
    ])
      expect(existsSync(join(out, "first", file)), file).toBe(true);
    expect(
      json(out, "first", "mcp.json").mcpServers["analog-canvas"].args,
    ).toContain(join(out, "first"));
    expect(verdict("second")).toMatchObject({
      path: "second",
      accepted: "second",
      first: { outcome: "mismatch", grade: { exact: false } },
      second: { dir: join("second", "second"), outcome: "match" },
      firstVsSecond: { exact: false },
    });
    expect(verdict("suspect")).toMatchObject({
      path: "agreed",
      accepted: "first",
      datasetSuspect: true,
      first: { outcome: "mismatch" },
      second: { outcome: "mismatch" },
      firstVsSecond: { exact: true },
    });
    expect(verdict("review")).toMatchObject({
      path: "review",
      accepted: null,
      first: { outcome: "blocked", messages: ["Nothing was drawn"] },
      second: { outcome: "blocked", agent: { exitCode: 3, usage: null } },
    });
    expect(
      readFileSync(join(out, "review", "second", "agent.log"), "utf8"),
    ).toContain("asked to fail");
    // The AnalogGenie reference is read as structural Spectre and kept.
    expect(verdict("spectre")).toMatchObject({
      path: "first",
      reference: "spectre",
      first: { outcome: "match", byName: { status: "mismatch" } },
    });
    expect(
      readFileSync(join(out, "spectre", "reference.scs"), "utf8"),
    ).toContain("nmos4");
    expect(readFileSync(join(out, "spectre", "input.png"), "utf8")).toBe(
      "not really a png",
    );
    expect(verdict("timeout")).toMatchObject({
      path: "second",
      first: {
        outcome: "blocked",
        agent: { timedOut: true, signal: "SIGTERM" },
      },
      second: { outcome: "match" },
    });
    expect(verdict("unchecked")).toMatchObject({
      path: "unchecked",
      reference: null,
      first: { outcome: "no-reference" },
    });
    expect(json(out, "summary.json")).toMatchObject({
      tasks: 7,
      exact: { count: 2, n: 6 },
      accepted: { count: 5, n: 6 },
      datasetSuspect: 1,
      review: 1,
      paths: { first: 2, second: 2, agreed: 1, review: 1, unchecked: 1 },
    });
    const queue = () =>
      readFileSync(join(out, "review-queue.jsonl"), "utf8").trim().split("\n");
    expect(queue().map((line) => JSON.parse(line).id)).toEqual(["review"]);

    // A batch is never drawn over; a resumed one redraws only what has no verdict.
    expect(run(out).stderr).toContain("already holds a batch");
    rmSync(join(out, "review", "verdict.json"));
    const before = readFileSync(join(out, "first", "agent.log"), "utf8");
    const resumed = run(out, "--resume");
    expect(resumed.status, resumed.stderr).toBe(0);
    expect(resumed.stdout).toContain("7 tasks, 6 already done");
    expect(readFileSync(join(out, "first", "agent.log"), "utf8")).toBe(before);
    expect(readdirSync(join(out, ".interrupted"))).toEqual([
      expect.stringMatching(/^review-/u),
    ]);
    expect(verdict("review")).toMatchObject({ path: "review" });
    expect(queue()).toHaveLength(1);
    expect(json(out, "summary.json")).toMatchObject({ tasks: 7, review: 1 });
  }, 300_000);
});
