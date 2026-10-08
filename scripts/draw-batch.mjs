#!/usr/bin/env node
// Draw a batch of circuits headlessly (#1498): one workspace per task, an
// Agent command per workspace, then the drawing's netlist and figure and a
// name-insensitive grade against the task's reference netlist (#1524). A
// drawing that misses can be redrawn by a second Agent; what neither settles
// goes to a review queue. See docs/agent/batch-drawing.md.
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, existsSync, readdirSync } from "node:fs";
import {
  appendFile,
  copyFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const DEFAULT_BUNDLE = resolve(
  root,
  "output/headless/analog-canvas-headless.mjs",
);
const RESERVED_IDS = new Set(["summary.json", "review-queue.jsonl"]);
const STDOUT_KEPT = 8 * 1024 * 1024;

const USAGE = `Usage:
  pnpm draw:batch <manifest.jsonl> --out DIR --agent "COMMAND"
                  [--second-agent "COMMAND"] [--jobs N] [--timeout SECONDS]
                  [--resume] [--mcp-command "COMMAND"]
                  [--instructions FILE] [--second-instructions FILE]
                  [--body auto|compare|ignore] [--source-polarity]
                  [--bundle FILE]

Each manifest line is a task: {"id", "image"?, "reference"?, "name"?,
"instructions"?}. The task is drawn in DIR/<id>/, a workspace holding the
reference as reference.sp, by COMMAND run there through the shell with the
prompt on stdin. These placeholders are replaced, shell-quoted: {dir} {id}
{image} {reference} {mcpConfig} {prompt} {role} {bundle}, and {cwd}, the
directory the batch was started from. --mcp-command is the
analog-canvas MCP server the written mcp.json starts for the workspace
(default: the packaged MCP, \`node …/analog-canvas-mcp.mjs --local {dir}\`).

A drawing that does not match, or exports no netlist, is redrawn in
DIR/<id>/second/ by --second-agent when given. --resume skips tasks that
have a verdict.json. --timeout defaults to 900 seconds (also 15m, 1h).`;

export function parseArguments(argv) {
  const options = {
    jobs: 1,
    timeoutSeconds: 900,
    resume: false,
    body: "auto",
    sourcePolarity: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--"))
        throw new Error(`${flag} needs a value\n\n${USAGE}`);
      index += 1;
      return next;
    };
    if (flag === "--") continue;
    else if (flag === "--out") options.out = value();
    else if (flag === "--agent") options.agent = value();
    else if (flag === "--second-agent") options.secondAgent = value();
    else if (flag === "--jobs") options.jobs = Number(value());
    else if (flag === "--timeout") options.timeoutSeconds = duration(value());
    else if (flag === "--resume") options.resume = true;
    else if (flag === "--mcp-command") options.mcpCommand = value();
    else if (flag === "--instructions") options.instructions = value();
    else if (flag === "--second-instructions")
      options.secondInstructions = value();
    else if (flag === "--body") options.body = value();
    else if (flag === "--source-polarity") options.sourcePolarity = true;
    else if (flag === "--bundle") options.bundle = value();
    else if (flag === "--help" || flag === "-h") options.help = true;
    else if (flag.startsWith("--"))
      throw new Error(`Unknown option ${flag}\n\n${USAGE}`);
    else if (options.manifest === undefined) options.manifest = flag;
    else throw new Error(`One manifest only, not also ${flag}\n\n${USAGE}`);
  }
  if (options.help) return options;
  for (const [key, flag] of [
    ["manifest", "a manifest"],
    ["out", "--out"],
    ["agent", "--agent"],
  ])
    if (!options[key]) throw new Error(`Give ${flag}\n\n${USAGE}`);
  if (!Number.isInteger(options.jobs) || options.jobs < 1)
    throw new Error(`--jobs is a whole number from 1\n\n${USAGE}`);
  if (!["auto", "compare", "ignore"].includes(options.body))
    throw new Error(`--body is auto, compare or ignore\n\n${USAGE}`);
  return options;
}

function duration(text) {
  const match = /^(\d+(?:\.\d+)?)(s|m|h)?$/u.exec(text);
  if (!match || Number(match[1]) <= 0)
    throw new Error(`--timeout is seconds, or 15m or 1h, not ${text}`);
  return Number(match[1]) * { s: 1, m: 60, h: 3600 }[match[2] ?? "s"];
}

/**
 * Tasks from JSONL. Paths resolve against the manifest's directory; a
 * reference that holds a line break is the netlist itself. `figure` is
 * read as `image`, so the redraw task lists run as they are.
 */
export function parseManifest(text, baseDir) {
  const tasks = [];
  const ids = new Set();
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    if (!line.trim()) continue;
    const at = `Manifest line ${index + 1}`;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      throw new Error(`${at} is not JSON`);
    }
    if (!row || typeof row !== "object" || Array.isArray(row))
      throw new Error(`${at} is not an object`);
    const id = typeof row.id === "number" ? String(row.id) : row.id;
    if (
      typeof id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(id) ||
      RESERVED_IDS.has(id)
    )
      throw new Error(
        `${at}: id must be letters, digits, ".", "_" or "-", starting with a letter or digit`,
      );
    if (ids.has(id)) throw new Error(`${at}: id ${id} is used twice`);
    ids.add(id);
    const image = row.image ?? row.figure;
    for (const [field, value] of [
      ["image", image],
      ["reference", row.reference],
      ["name", row.name],
      ["instructions", row.instructions],
    ])
      if (value !== undefined && typeof value !== "string")
        throw new Error(`${at}: ${field} must be a string`);
    tasks.push({
      id,
      ...(image ? { image: resolve(baseDir, image) } : {}),
      ...(row.reference
        ? {
            reference: /[\r\n]/u.test(row.reference)
              ? { text: row.reference }
              : { path: resolve(baseDir, row.reference) },
          }
        : {}),
      ...(row.name ? { name: row.name } : {}),
      ...(row.instructions ? { instructions: row.instructions } : {}),
    });
  }
  if (!tasks.length) throw new Error("The manifest holds no tasks");
  return tasks;
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

/** Replace {name} placeholders it knows; leave any other braces alone. */
export function expandTemplate(template, values, quote = shellQuote) {
  return template.replace(/\{(\w+)\}/gu, (match, key) =>
    Object.hasOwn(values, key) ? quote(values[key] ?? "") : match,
  );
}

/** Split a command line into words, honouring quotes and backslashes. */
export function splitCommand(text) {
  const words = [];
  let word = null;
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote) quote = null;
      else if (char === "\\" && quote === '"' && index + 1 < text.length)
        word += text[++index];
      else word += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      word ??= "";
    } else if (char === "\\" && index + 1 < text.length) {
      word = (word ?? "") + text[++index];
    } else if (/\s/u.test(char)) {
      if (word !== null) words.push(word);
      word = null;
    } else word = (word ?? "") + char;
  }
  if (quote) throw new Error(`Unclosed quote in ${text}`);
  if (word !== null) words.push(word);
  return words;
}

/** The packaged MCP server's own --local mode, when it has been built. */
function defaultMcpCommand() {
  const packages = resolve(root, "output/mcp");
  const built = existsSync(packages)
    ? readdirSync(packages)
        .filter((name) => name.startsWith("analog-canvas-mcp-v"))
        .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
        .map((name) => join(packages, name, "bin/analog-canvas-mcp.mjs"))
        .filter((path) => existsSync(path))
    : [];
  return built.length
    ? `${JSON.stringify(process.execPath)} ${JSON.stringify(built.at(-1))} --local {dir}`
    : "analog-canvas-mcp --local {dir}";
}

/** The Claude Code / generic MCP client configuration for one workspace. */
export function mcpConfig(commandTemplate, values) {
  const [command, ...args] = splitCommand(commandTemplate).map((word) =>
    expandTemplate(word, values, String),
  );
  if (!command) throw new Error("--mcp-command is empty");
  return { mcpServers: { "analog-canvas": { command, args } } };
}

/**
 * Token and cost use an Agent printed: Claude Code's result object
 * (`claude -p --output-format json`, or the last line of stream-json), or
 * the turn.completed events of `codex exec --json`. Null when it printed
 * none, and then only wall time is known.
 */
export function parseUsage(stdout) {
  const objects = [];
  const take = (text) => {
    try {
      const value = JSON.parse(text);
      if (value && typeof value === "object" && !Array.isArray(value))
        objects.push(value);
      return true;
    } catch {
      return false;
    }
  };
  if (!take(stdout.trim()))
    for (const line of stdout.split(/\r?\n/u))
      if (line.trim().startsWith("{")) take(line.trim());
  const defined = (record) =>
    Object.fromEntries(
      Object.entries(record).filter(([, value]) => value !== undefined),
    );
  const tokens = (usage = {}) => ({
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadInputTokens:
      usage.cache_read_input_tokens ?? usage.cached_input_tokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens,
  });
  const result = objects.findLast(
    (value) => value.type === "result" || "total_cost_usd" in value,
  );
  if (result)
    return defined({
      costUsd: result.total_cost_usd,
      numTurns: result.num_turns,
      durationMs: result.duration_ms,
      isError: result.is_error,
      ...tokens(result.usage),
    });
  const turns = objects.filter(
    (value) => value.type === "turn.completed" && value.usage,
  );
  if (turns.length) {
    const sum = (key) =>
      turns.reduce((total, turn) => total + (Number(turn.usage[key]) || 0), 0);
    return defined({
      numTurns: turns.length,
      inputTokens: sum("input_tokens"),
      outputTokens: sum("output_tokens"),
      cacheReadInputTokens: sum("cached_input_tokens"),
    });
  }
  const last = objects.findLast(
    (value) => value.usage && typeof value.usage === "object",
  );
  return last ? defined(tokens(last.usage)) : null;
}

/** Wilson score interval at 95 % for k successes in n. */
export function wilson(k, n) {
  if (n === 0) return [0, 1];
  const z = 1.959963984540054;
  const p = k / n;
  const denominator = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denominator;
  const half =
    (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** Outcomes of a drawing that a second, independent drawing may settle. */
export function wantsSecond(outcome) {
  return ["mismatch", "blocked", "error"].includes(outcome);
}

/**
 * Which drawing a task keeps. `first` and `second` are attempt outcomes;
 * `agree` says whether the two drawings are isomorphic to each other.
 * Two independent drawings that agree with each other and not with the
 * reference are kept, and the reference is marked suspect.
 */
export function decide({ first, second, agree = false }) {
  const verdict = (path, accepted, reason, datasetSuspect = false) => ({
    path,
    accepted,
    datasetSuspect,
    ...(reason ? { reason } : {}),
  });
  if (first === "match") return verdict("first", "first");
  if (first === "no-reference")
    return verdict("unchecked", null, "The task has no reference netlist");
  if (first === "ungradable")
    return verdict("review", null, "The reference netlist cannot be graded");
  if (!second)
    return verdict(
      "review",
      null,
      `The drawing ${first === "mismatch" ? "does not match the reference" : `is ${first}`}; there is no second drawing`,
    );
  if (second === "match") return verdict("second", "second");
  if (first === "mismatch" && second === "mismatch" && agree)
    return verdict(
      "agreed",
      "first",
      "Two independent drawings agree with each other, not with the reference",
      true,
    );
  return verdict(
    "review",
    null,
    first === "mismatch" && second === "mismatch"
      ? "The two drawings differ from the reference and from each other"
      : `The first drawing is ${first} and the second ${second}`,
  );
}

function prompt({ task, dir, image, reference, instructions }) {
  return [
    `# Draw circuit ${task.id}`,
    "",
    "Draw the schematic in the figure as an Analog Canvas Project, with the",
    "analog-canvas MCP tools; they are bound to this task's workspace. The",
    "batch runner exports the netlist and figure when you finish.",
    "",
    `- Figure: ${image ?? "none given"}`,
    `- Workspace: ${dir}`,
    ...(reference ? [`- Reference netlist: ${reference}`] : []),
    ...(instructions ? ["", instructions.trim()] : []),
    ...(task.instructions ? ["", task.instructions.trim()] : []),
    "",
  ].join("\n");
}

/** Run one Agent command; a timeout ends its whole process group. */
export function runAgent({
  command,
  cwd,
  env,
  input,
  logPath,
  timeoutMs,
  running,
}) {
  return new Promise((done) => {
    const log = createWriteStream(logPath, { flags: "a" });
    log.write(`$ ${command}\n`);
    const started = performance.now();
    let stdout = "";
    let timedOut = false;
    const child = spawn(command, {
      shell: true,
      cwd,
      env,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const group = (signal) => {
      try {
        process.kill(-child.pid, signal);
      } catch {
        // The group has already gone.
      }
    };
    running?.add(group);
    const timers = [
      setTimeout(() => {
        timedOut = true;
        log.write(`\n[draw-batch] timed out after ${timeoutMs / 1000} s\n`);
        group("SIGTERM");
        timers.push(setTimeout(() => group("SIGKILL"), 5000));
      }, timeoutMs),
    ];
    child.stdin.on("error", () => {});
    child.stdin.end(input);
    child.stdout.on("data", (chunk) => {
      log.write(chunk);
      stdout = (stdout + chunk).slice(-STDOUT_KEPT);
    });
    child.stderr.on("data", (chunk) => log.write(chunk));
    // A process the Agent left running may hold its output open.
    child.on("exit", () => {
      timers.push(
        setTimeout(() => {
          child.stdout.destroy();
          child.stderr.destroy();
        }, 2000),
      );
    });
    let finished = false;
    const finish = (exitCode, signal, error) => {
      if (finished) return;
      finished = true;
      for (const timer of timers) clearTimeout(timer);
      group("SIGTERM");
      running?.delete(group);
      const wallSeconds = (performance.now() - started) / 1000;
      log.end(
        `\n[draw-batch] exit ${exitCode ?? signal ?? error} after ${wallSeconds.toFixed(1)} s\n`,
      );
      done({
        exitCode,
        signal,
        timedOut,
        wallSeconds,
        stdout,
        ...(error ? { error } : {}),
      });
    };
    child.on("error", (error) => finish(null, null, error.message));
    child.on("close", (code, signal) => finish(code, signal));
  });
}

async function loadReference(reference, headless) {
  const original =
    reference.text ??
    (await readFile(reference.path, "utf8").catch((error) => {
      throw new Error(
        error.code === "ENOENT"
          ? `Reference not found: ${reference.path}`
          : error.message,
      );
    }));
  const read = headless.structuralSpice(original);
  // A reference the grader cannot read whole stops every drawing matching.
  const self = await headless.gradeNetlists(read.text, read.text);
  const problems = [
    ...(self.details.error ? [self.details.error] : []),
    ...self.details.problems.reference,
  ];
  if (!self.exact && !problems.length)
    problems.push("The grader cannot settle the reference against itself");
  return { original, spice: read.text, from: read.from, problems };
}

/** Grade what a workspace holds after its Agent has finished. */
async function collect(dir, reference, headless, options) {
  const project = await headless.readWorkspace(dir);
  const messages = [];
  try {
    await writeFile(
      join(dir, "figure.svg"),
      await headless.workspaceSvg(project),
    );
  } catch (error) {
    messages.push(`The figure could not be rendered: ${error.message}`);
  }
  const top = project.documents.find(
    (document) => document.id === project.topDocumentId,
  );
  if (!top?.instances.length)
    return { outcome: "blocked", messages: ["Nothing was drawn", ...messages] };
  const netlist = headless.workspaceNetlist(project);
  if (netlist.status !== "ready")
    return { outcome: "blocked", messages: [...netlist.messages, ...messages] };
  await writeFile(join(dir, "netlist.sp"), netlist.text);
  if (!reference)
    return { outcome: "no-reference", messages, netlist: netlist.text };
  const grade = await headless.gradeNetlists(netlist.text, reference.spice, {
    body: options.body,
    sourcePolarity: options.sourcePolarity,
  });
  const byName = await headless
    .compareNetlists(netlist.text, reference.spice, {
      compare: {
        portOrder: false,
        parameters: false,
        bindings: false,
        declarations: false,
      },
    })
    .then((result) => ({
      status: result.status,
      summary: result.summary ?? null,
    }))
    .catch((error) => ({ status: "inconclusive", summary: error.message }));
  return {
    outcome: reference.problems.length
      ? "ungradable"
      : grade.exact
        ? "match"
        : "mismatch",
    messages,
    netlist: netlist.text,
    grade,
    byName,
  };
}

/** Draw once in `dir`: a new workspace, the Agent, then the grade. */
async function attempt(role, dir, task, reference, context) {
  const { headless, options, out } = context;
  await mkdir(dirname(dir), { recursive: true });
  await headless.createWorkspace(dir, {
    name: task.name ?? task.id,
    ...(reference ? { reference: reference.spice } : {}),
  });
  if (reference?.from === "spectre")
    await writeFile(join(dir, "reference.scs"), reference.original);
  let image;
  if (task.image) {
    image = join(dir, `input${extname(task.image).toLowerCase()}`);
    await copyFile(task.image, image).catch((error) => {
      throw new Error(
        error.code === "ENOENT"
          ? `Image not found: ${task.image}`
          : error.message,
      );
    });
  }
  const values = {
    dir,
    id: task.id,
    image: image ?? "",
    reference: reference ? join(dir, "reference.sp") : "",
    mcpConfig: join(dir, "mcp.json"),
    prompt: join(dir, "prompt.md"),
    role,
    bundle: context.bundle,
    cwd: process.cwd(),
  };
  await writeFile(
    values.mcpConfig,
    `${JSON.stringify(mcpConfig(context.mcpCommand, values), null, 2)}\n`,
  );
  const text = prompt({
    task,
    dir,
    image,
    reference: values.reference || undefined,
    instructions:
      role === "second" ? context.secondInstructions : context.instructions,
  });
  await writeFile(values.prompt, text);
  const template = role === "second" ? options.secondAgent : options.agent;
  const run = await runAgent({
    command: expandTemplate(template, values),
    cwd: dir,
    env: {
      ...process.env,
      ANALOG_CANVAS_BATCH_ID: task.id,
      ANALOG_CANVAS_BATCH_ROLE: role,
      ANALOG_CANVAS_BATCH_DIR: dir,
      ANALOG_CANVAS_BATCH_IMAGE: values.image,
      ANALOG_CANVAS_BATCH_REFERENCE: values.reference,
      ANALOG_CANVAS_BATCH_MCP_CONFIG: values.mcpConfig,
      ANALOG_CANVAS_BATCH_PROMPT: values.prompt,
      ANALOG_CANVAS_HEADLESS: context.bundle,
    },
    input: text,
    logPath: join(dir, "agent.log"),
    timeoutMs: options.timeoutSeconds * 1000,
    running: context.running,
  });
  const agent = {
    exitCode: run.exitCode,
    signal: run.signal,
    timedOut: run.timedOut,
    wallSeconds: Number(run.wallSeconds.toFixed(2)),
    usage: parseUsage(run.stdout),
    ...(run.error ? { error: run.error } : {}),
  };
  let result;
  try {
    result = await collect(dir, reference, headless, options);
  } catch (error) {
    result = { outcome: "error", messages: [error.message] };
  }
  const { netlist, ...recorded } = result;
  return {
    record: { dir: relative(out, dir), ...recorded, agent },
    netlist,
  };
}

async function runTask(task, context) {
  const { headless, out } = context;
  const dir = join(out, task.id);
  const started = performance.now();
  let verdict;
  try {
    const reference = task.reference
      ? await loadReference(task.reference, headless)
      : undefined;
    const first = await attempt("first", dir, task, reference, context);
    let second;
    if (
      context.options.secondAgent &&
      wantsSecond(first.record.outcome) &&
      !reference?.problems.length
    )
      second = await attempt(
        "second",
        join(dir, "second"),
        task,
        reference,
        context,
      );
    let firstVsSecond;
    if (first.netlist && second?.netlist) {
      const grade = await headless.gradeNetlists(
        first.netlist,
        second.netlist,
        {
          body: context.options.body,
          sourcePolarity: context.options.sourcePolarity,
        },
      );
      firstVsSecond = {
        exact: grade.exact,
        mode: grade.mode,
        deviceTypeF1: grade.deviceTypeF1,
        connectionF1: grade.connectionF1,
      };
    }
    verdict = {
      id: task.id,
      ...decide({
        first: reference?.problems.length ? "ungradable" : first.record.outcome,
        second: second?.record.outcome,
        agree: firstVsSecond?.exact,
      }),
      reference: reference?.from ?? null,
      ...(reference?.problems.length
        ? { referenceProblems: reference.problems }
        : {}),
      first: first.record,
      ...(second ? { second: second.record } : {}),
      ...(firstVsSecond ? { firstVsSecond } : {}),
    };
  } catch (error) {
    verdict = {
      id: task.id,
      path: "review",
      accepted: null,
      datasetSuspect: false,
      reason: error.message,
      first: { outcome: "error", messages: [error.message] },
    };
  }
  verdict.wallSeconds = Number(
    ((performance.now() - started) / 1000).toFixed(2),
  );
  verdict.finishedAt = new Date().toISOString();
  await mkdir(dir, { recursive: true });
  if (verdict.path === "review")
    await appendFile(
      join(out, "review-queue.jsonl"),
      `${JSON.stringify(reviewItem(verdict))}\n`,
    );
  await writeFile(
    join(dir, "verdict.json"),
    `${JSON.stringify(verdict, null, 2)}\n`,
  );
  return verdict;
}

function reviewItem(verdict) {
  const side = (record) =>
    record && {
      outcome: record.outcome,
      ...(record.dir ? { dir: record.dir } : {}),
      ...(record.messages?.length ? { messages: record.messages } : {}),
    };
  return {
    id: verdict.id,
    reason: verdict.reason,
    first: side(verdict.first),
    ...(verdict.second ? { second: side(verdict.second) } : {}),
  };
}

/** Counts, the exact rate with its Wilson interval, and per-task cost. */
export function summarize(verdicts) {
  const count = (values) => {
    const counts = {};
    for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  };
  const rate = (k, n) => ({
    count: k,
    n,
    rate: n ? k / n : null,
    wilson95: wilson(k, n),
  });
  // Graded: a drawing was attempted against a reference the grader reads.
  const graded = verdicts.filter(
    (verdict) =>
      verdict.reference &&
      !verdict.referenceProblems &&
      ["match", "mismatch", "blocked"].includes(verdict.first?.outcome),
  );
  const attempts = (verdict) =>
    [verdict.first, verdict.second].filter((record) => record?.agent);
  const total = (verdict, key) => {
    const values = attempts(verdict)
      .map((record) => record.agent.usage?.[key])
      .filter((value) => typeof value === "number");
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  };
  const tasks = verdicts.map((verdict) => ({
    id: verdict.id,
    path: verdict.path,
    first: verdict.first?.outcome,
    ...(verdict.second ? { second: verdict.second.outcome } : {}),
    exact: verdict.first?.grade?.exact ?? false,
    ...(verdict.first?.grade
      ? {
          mode: verdict.first.grade.mode,
          deviceTypeF1: verdict.first.grade.deviceTypeF1,
          connectionF1: verdict.first.grade.connectionF1,
        }
      : {}),
    datasetSuspect: verdict.datasetSuspect ?? false,
    costUsd: total(verdict, "costUsd"),
    inputTokens: total(verdict, "inputTokens"),
    outputTokens: total(verdict, "outputTokens"),
    numTurns: total(verdict, "numTurns"),
    agentSeconds: attempts(verdict).reduce(
      (sum, record) => sum + record.agent.wallSeconds,
      0,
    ),
    wallSeconds: verdict.wallSeconds ?? null,
  }));
  const sum = (key) =>
    tasks.reduce((total, task) => total + (task[key] ?? 0), 0);
  const scored = graded.filter((verdict) => verdict.first.grade);
  const mean = (key) =>
    scored.length
      ? scored.reduce((total, verdict) => total + verdict.first.grade[key], 0) /
        scored.length
      : null;
  return {
    tasks: verdicts.length,
    first: count(verdicts.map((verdict) => verdict.first?.outcome)),
    paths: count(verdicts.map((verdict) => verdict.path)),
    exact: rate(
      graded.filter((verdict) => verdict.first.outcome === "match").length,
      graded.length,
    ),
    accepted: rate(
      graded.filter((verdict) => verdict.accepted).length,
      graded.length,
    ),
    datasetSuspect: verdicts.filter((verdict) => verdict.datasetSuspect).length,
    review: verdicts.filter((verdict) => verdict.path === "review").length,
    meanDeviceTypeF1: mean("deviceTypeF1"),
    meanConnectionF1: mean("connectionF1"),
    usage: {
      tasksWithUsage: tasks.filter(
        (task) => task.costUsd !== null || task.inputTokens !== null,
      ).length,
      costUsd: sum("costUsd"),
      inputTokens: sum("inputTokens"),
      outputTokens: sum("outputTokens"),
    },
    agentSeconds: sum("agentSeconds"),
    perTask: tasks,
  };
}

async function loadHeadless(bundle, explicit) {
  if (!existsSync(bundle)) {
    if (explicit) throw new Error(`No headless bundle at ${bundle}`);
    execFileSync(
      process.execPath,
      [join(root, "scripts/package-headless.mjs")],
      {
        stdio: "inherit",
      },
    );
  }
  return import(pathToFileURL(bundle).href);
}

export async function main(argv) {
  const options = parseArguments(argv);
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  const manifest = resolve(options.manifest);
  const tasks = parseManifest(
    await readFile(manifest, "utf8"),
    dirname(manifest),
  );
  const out = resolve(options.out);
  const verdictOf = (id) => join(out, id, "verdict.json");
  const started = tasks.filter((task) => existsSync(join(out, task.id)));
  if (
    !options.resume &&
    (started.length || existsSync(join(out, "summary.json")))
  )
    throw new Error(
      `${out} already holds a batch; pass --resume to finish it, or another --out`,
    );
  await mkdir(out, { recursive: true });
  // A task stopped mid-way is set aside and drawn again.
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  for (const task of started)
    if (!existsSync(verdictOf(task.id))) {
      await mkdir(join(out, ".interrupted"), { recursive: true });
      await rename(
        join(out, task.id),
        join(out, ".interrupted", `${task.id}-${stamp}`),
      );
    }
  const pending = tasks.filter((task) => !existsSync(verdictOf(task.id)));
  const bundle = resolve(options.bundle ?? DEFAULT_BUNDLE);
  const context = {
    options,
    out,
    bundle,
    headless: await loadHeadless(bundle, options.bundle !== undefined),
    mcpCommand: options.mcpCommand ?? defaultMcpCommand(),
    instructions: options.instructions
      ? await readFile(resolve(options.instructions), "utf8")
      : undefined,
    running: new Set(),
  };
  context.secondInstructions = options.secondInstructions
    ? await readFile(resolve(options.secondInstructions), "utf8")
    : context.instructions;
  const stop = () => {
    for (const group of context.running) group("SIGTERM");
    process.exit(130);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  console.log(
    `${tasks.length} tasks, ${tasks.length - pending.length} already done; ${options.jobs} at a time into ${out}`,
  );
  let done = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(options.jobs, pending.length) }, async () => {
      while (next < pending.length) {
        const task = pending[next++];
        // Even a verdict that cannot be written stops only its own task.
        const verdict = await runTask(task, context).catch((error) => ({
          id: task.id,
          path: "review",
          reason: error.message,
          first: { outcome: "error" },
          wallSeconds: 0,
        }));
        done += 1;
        const cost = [verdict.first, verdict.second]
          .map((record) => record?.agent?.usage?.costUsd)
          .filter((value) => typeof value === "number");
        console.log(
          `[${done}/${pending.length}] ${task.id}: ${verdict.path} (${[verdict.first?.outcome, verdict.second?.outcome].filter(Boolean).join(", ")}) ${verdict.wallSeconds.toFixed(1)} s${cost.length ? ` $${cost.reduce((a, b) => a + b, 0).toFixed(3)}` : ""}`,
        );
      }
    }),
  );
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
  const verdicts = [];
  for (const task of tasks) {
    try {
      verdicts.push(JSON.parse(await readFile(verdictOf(task.id), "utf8")));
    } catch {
      verdicts.push({
        id: task.id,
        path: "review",
        first: { outcome: "error" },
        reason: "No verdict was written",
      });
    }
  }
  const summary = summarize(verdicts);
  await writeFile(
    join(out, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  // Rewritten whole, so a resumed batch lists each task once, in order.
  const review = verdicts.filter((verdict) => verdict.path === "review");
  await writeFile(
    join(out, "review-queue.jsonl"),
    review
      .map((verdict) => `${JSON.stringify(reviewItem(verdict))}\n`)
      .join(""),
  );
  const percent = (value) =>
    value === null ? "-" : `${(value * 100).toFixed(1)} %`;
  console.log(
    `Exact ${summary.exact.count}/${summary.exact.n} (${percent(summary.exact.rate)}, 95 % ${percent(summary.exact.wilson95[0])}–${percent(summary.exact.wilson95[1])}); accepted ${summary.accepted.count}; review ${summary.review}; dataset suspect ${summary.datasetSuspect}. See ${join(out, "summary.json")}`,
  );
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
