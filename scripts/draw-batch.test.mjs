import {
  mkdirSync,
  mkdtempSync,
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
  main,
  mcpConfig,
  parseArguments,
  parseManifest,
  parseUsage,
  runAgent,
  splitCommand,
  summarize,
  wantsSecond,
  wilson,
} from "./draw-batch.mjs";

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

describe("batch drawing runner around its Agents (#1498)", () => {
  let work;
  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), "icm-draw-batch-"));
  });
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  it("never draws over a batch it was not asked to resume", async () => {
    writeFileSync(
      join(work, "tasks.jsonl"),
      `${JSON.stringify({ id: "a", instructions: "draw" })}\n`,
    );
    const out = join(work, "out");
    mkdirSync(out);
    writeFileSync(join(out, "summary.json"), "{}");
    await expect(
      main([join(work, "tasks.jsonl"), "--out", out, "--agent", "agent"]),
    ).rejects.toThrow("already holds a batch; pass --resume");
  });

  it("ends an Agent that runs past its timeout", async () => {
    const run = await runAgent({
      command: `"${process.execPath}" -e "setInterval(() => {}, 1000)"`,
      cwd: work,
      env: process.env,
      input: "",
      logPath: join(work, "agent.log"),
      timeoutMs: 300,
    });
    expect(run).toMatchObject({
      timedOut: true,
      signal: process.platform === "win32" ? null : "SIGTERM",
    });
    expect(readFileSync(join(work, "agent.log"), "utf8")).toContain(
      "timed out after 0.3 s",
    );
  });
});
