// The Season tool (#1560): the Owner's list of chosen Gallery circuits
// becomes a Season's Task pack and the three Project sets every Season
// shows (Human Reference, Grid Baseline, Check Battle copy), and a model's
// folder of drawings becomes its Contestant bundle. The tool never chooses
// circuits: every problem it finds is reported for the Owner to resolve,
// and a list with a problem builds nothing.
//
// This module is the CLI's engine (cli.mjs bundles it with the editor code
// it runs); its tests call it directly. README.md describes the outputs.
import { existsSync } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import {
  CONTRACT_VERSION,
  SUBMISSIONS_KIND,
  SUBMISSION_FILE,
  TASK_PACK_KIND,
  checkContestant,
  jsonText,
  readTaskPack,
  writeContestantBundle,
} from "./bundle.mjs";
import {
  AI_AUTHOR_NAMES,
  exportNetlist,
  gradeNetlists,
  importSpiceSources,
  parseProject,
  serializeProject,
  sha256,
} from "./editor.mjs";
import { netlistGraphHash } from "./graph-hash.mjs";
import { parseOwnerList, parseSplit } from "./list.mjs";
import { drawCheckCopy, drawGridBaseline } from "./projects.mjs";

export { checkContestant };

const SIZE_TIERS = [
  { tier: "5-14", min: 5, max: 14 },
  { tier: "15-49", min: 15, max: 49 },
];
const GALLERY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
/** The folders and files a build writes into its output folder. */
const BUILD_OUTPUTS = [
  "task-pack",
  "human-reference",
  "grid-baseline",
  "check-copy",
  "season-exclusions.json",
];
const NO_CLASS = "(none)";

/** The three Project sets a build draws, as Contestant bundles. */
const BUILT_IN = [
  {
    slug: "human-reference",
    role: "human-reference",
    name: "Human Reference",
    provider: "Gallery authors",
    modelId: "human-reference",
    reasoning: "none",
    harness: "Analog Canvas editor (the author's Gallery drawing)",
    protocolDeclaration:
      "The author's original Gallery Project, unchanged; not drawn under the Drawing Protocol.",
  },
  {
    slug: "grid-baseline",
    role: "grid-baseline",
    name: "Grid Baseline",
    provider: "Analog Canvas",
    modelId: "grid-baseline",
    reasoning: "none",
    harness: "arena-season build: structural SPICE import on a grid",
    protocolDeclaration:
      "Drawn by the Season tool from the Task netlist alone: the structural SPICE import set on a grid, joined only by net labels; no human edits.",
  },
  {
    slug: "check-copy",
    role: "check-copy",
    name: "Check copy",
    provider: "Analog Canvas",
    modelId: "check-copy",
    reasoning: "none",
    harness: "arena-season build: seeded shuffle of the Human Reference",
    protocolDeclaration:
      "Drawn by the Season tool from the Human Reference: its parts moved by a seeded shuffle, connectivity kept; used only in Check Battles and never ranked.",
  },
];

function sizeTier(devices) {
  return (
    SIZE_TIERS.find(({ min, max }) => devices >= min && devices <= max)?.tier ??
    null
  );
}

async function readOptional(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** One listed id read from the Gallery export and checked on its own. */
async function checkEntry(row, exportDir) {
  const result = {
    line: row.line,
    gallery: row.id,
    circuitName: row.name ?? null,
    functionClass: row.functionClass ?? null,
    author: null,
    devices: null,
    sizeTier: null,
    graphHash: null,
    netlistHash: null,
    problems: [],
    notes: [],
  };
  const dir = join(exportDir, "circuits", row.id);
  const entryBytes = GALLERY_ID.test(row.id)
    ? await readOptional(join(dir, "entry.json"))
    : null;
  const projectBytes = entryBytes
    ? await readOptional(join(dir, "project.icproj.json"))
    : null;
  if (!entryBytes || !projectBytes) {
    result.problems.push("Unknown id: the Gallery export has no such entry");
    return { result };
  }
  const entry = JSON.parse(entryBytes.toString("utf8"));
  result.author = entry.author ?? null;
  result.circuitName ??= entry.name?.trim() || null;
  if (!result.circuitName)
    result.problems.push(
      "No circuit name: the entry has none; give one in the list's second column",
    );
  if (
    AI_AUTHOR_NAMES.has(
      String(entry.author ?? "")
        .trim()
        .toLowerCase(),
    )
  )
    result.problems.push(
      `Drawn by an AI account (${entry.author}), not by a person`,
    );
  let project;
  try {
    project = parseProject(projectBytes.toString("utf8"));
  } catch (error) {
    result.problems.push(`The Project cannot be read: ${error.message}`);
    return { result };
  }
  if (project.documents.length !== 1)
    result.problems.push(
      `Not exactly one Cell: the Project has ${project.documents.length}`,
    );
  const exported = exportNetlist(project);
  if (exported.text === null) {
    result.problems.push(
      `The current exporter cannot produce its netlist: ${exported.errors.slice(0, 3).join("; ")}`,
    );
    return { result };
  }
  if (exported.unfinished.length)
    result.problems.push(
      `The current exporter refuses it as an unfinished drawing: ${exported.unfinished.slice(0, 3).join("; ")}`,
    );
  const exportedSpice = await readOptional(join(dir, "netlist.sp"));
  if (!exportedSpice)
    result.notes.push(
      "The export holds no netlist.sp; the Task uses the current exporter's netlist",
    );
  else if (exportedSpice.toString("utf8") !== exported.text)
    result.notes.push(
      "The current exporter's netlist differs from the export's netlist.sp; the Task uses the current one",
    );
  result.netlistHash = `sha256:${sha256(exported.text)}`;
  const self = await gradeNetlists(exported.text, exported.text, {
    sourcePolarity: true,
  });
  if (!self.exact) {
    result.problems.push(
      `The #1524 grader cannot read its netlist: ${
        self.details.error ??
        self.details.problems.reference.slice(0, 2).join("; ")
      }`,
    );
    return { result };
  }
  // The Grid Baseline is this import; a netlist it cannot read has none.
  const imported = await importSpiceSources(
    [{ path: "task.sp", bytes: new TextEncoder().encode(exported.text) }],
    "task.sp",
  );
  if (!imported.successful) {
    const errors = imported.diagnostics.filter(
      (item) => item.severity === "error",
    );
    result.problems.push(
      `The structural SPICE import cannot read its netlist, so it can have no Grid Baseline: ${errors[0]?.message ?? "no Project"}${errors.length > 1 ? ` (and ${errors.length - 1} more)` : ""}`,
    );
  }
  result.devices = self.details.devices.reference;
  result.sizeTier = sizeTier(result.devices);
  if (!result.sizeTier)
    result.problems.push(`Size outside 5–49 devices: it has ${result.devices}`);
  try {
    result.graphHash = await netlistGraphHash(exported.text);
  } catch (error) {
    result.problems.push(`No graph hash: ${error.message}`);
  }
  return { result, project, projectBytes, netlist: exported.text };
}

/**
 * Check the Owner's list against a Gallery export, id by id, in the list's
 * order. Every entry gets its would-be Task id; the report is `ok` only
 * when no entry has a problem.
 *
 * @param {{ listText: string, exportDir: string, splitText?: string }} options
 */
export async function checkSeason({ listText, exportDir, splitText }) {
  if (!existsSync(join(exportDir, "circuits")))
    throw new Error(
      `${exportDir} is not a Gallery export: it has no circuits/`,
    );
  const rows = parseOwnerList(listText);
  if (!rows.length) throw new Error("The list names no Gallery entries");
  const split = splitText === undefined ? null : parseSplit(splitText);
  const checked = [];
  for (const [index, row] of rows.entries()) {
    const entry = await checkEntry(row, exportDir);
    entry.result = {
      taskId: `T${String(index + 1).padStart(3, "0")}`,
      ...entry.result,
    };
    checked.push(entry);
  }
  // Duplicates: the same id twice, or the same graph, which the grader
  // itself must confirm, so a hash collision never reports one.
  for (const [index, { result }] of checked.entries()) {
    for (const { result: earlier, netlist: earlierNetlist } of checked.slice(
      0,
      index,
    )) {
      if (earlier.gallery === result.gallery) {
        result.problems.push(
          `Listed twice: also on line ${earlier.line} (${earlier.taskId})`,
        );
        break;
      }
      if (!result.graphHash || earlier.graphHash !== result.graphHash) continue;
      const same = await gradeNetlists(checked[index].netlist, earlierNetlist);
      if (same.exact) {
        result.problems.push(
          `Duplicate by graph hash of ${earlier.gallery} on line ${earlier.line} (${earlier.taskId})`,
        );
        break;
      }
      result.notes.push(
        `Shares its graph hash with ${earlier.gallery} (${earlier.taskId}), but the grader tells them apart`,
      );
    }
    if (
      split &&
      (split.has(result.gallery) ||
        (result.graphHash && split.has(result.graphHash)))
    )
      result.problems.push("In #1524's private test split");
  }
  const entries = checked.map(({ result }) => result);
  const sizeTiers = Object.fromEntries(SIZE_TIERS.map(({ tier }) => [tier, 0]));
  const functionClasses = {};
  for (const entry of entries) {
    if (entry.sizeTier) sizeTiers[entry.sizeTier] += 1;
    const name = entry.functionClass ?? NO_CLASS;
    functionClasses[name] = (functionClasses[name] ?? 0) + 1;
  }
  const withProblems = entries.filter((entry) => entry.problems.length).length;
  return {
    report: {
      kind: "analog-arena/season-check",
      version: 1,
      ok: withProblems === 0,
      listed: entries.length,
      withProblems,
      totals: {
        sizeTiers,
        functionClasses: Object.fromEntries(
          Object.entries(functionClasses).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        ),
      },
      entries,
    },
    checked,
  };
}

/** Whether `path` is missing or something a previous build wrote. */
async function ownedOutput(path) {
  if (!existsSync(path)) return true;
  if (path.endsWith(".json")) {
    const text = await readFile(path, "utf8").catch(() => "");
    return text.includes('"analog-canvas/season-exclusions"');
  }
  const manifest = await readFile(join(path, "manifest.json"), "utf8").catch(
    () => "",
  );
  return [TASK_PACK_KIND, SUBMISSIONS_KIND].some((kind) =>
    manifest.includes(`"kind": "${kind}"`),
  );
}

async function writeTree(root, files) {
  for (const [path, content] of files) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), content);
  }
}

/**
 * Build a Season from the Owner's list. Checks first: a list with any
 * problem writes only `build-report.json`. Otherwise the Task pack, the
 * three Contestant bundles and the record for #1524 are drawn in a staging
 * folder, every bundle item must be `valid`, and only then do they replace
 * what the output folder held. Returns the report.
 *
 * @param {{
 *   listText: string, exportDir: string, outDir: string, splitText?: string,
 *   season: string, instructions: string, date: string,
 *   rendererVersion: string,
 * }} options
 */
export async function buildSeason({
  listText,
  exportDir,
  outDir,
  splitText,
  season,
  instructions,
  date,
  rendererVersion,
}) {
  const { report, checked } = await checkSeason({
    listText,
    exportDir,
    splitText,
  });
  const result = {
    ...report,
    kind: "analog-arena/season-build",
    season,
    status: "blocked",
    rendererVersion,
    verification: [],
    checkCopies: [],
  };
  await mkdir(outDir, { recursive: true });
  const finish = async (status) => {
    result.status = status;
    result.ok = status === "built";
    await writeFile(join(outDir, "build-report.json"), jsonText(result));
    return result;
  };
  if (!report.ok) return finish("blocked");
  for (const name of BUILD_OUTPUTS)
    if (!(await ownedOutput(join(outDir, name))))
      throw new Error(
        `${join(outDir, name)} exists and is not something this tool wrote; choose another --out`,
      );

  const staging = join(outDir, `.staging-${process.pid}`);
  await rm(staging, { recursive: true, force: true });
  try {
    const packDir = join(staging, "task-pack");
    const tasks = checked.map(({ result: entry, netlist }) => ({
      entry,
      netlist,
    }));
    const instructionsVersion = sha256(instructions).slice(0, 12);
    const packManifest = {
      kind: TASK_PACK_KIND,
      version: CONTRACT_VERSION,
      season,
      instructionsVersion,
      instructions: "instructions.md",
      tasks: tasks.map(({ entry }) => ({
        id: entry.taskId,
        circuitName: entry.circuitName,
        functionClass: entry.functionClass,
        sizeTier: entry.sizeTier,
        devices: entry.devices,
        netlist: `tasks/${entry.taskId}.sp`,
        netlistHash: entry.netlistHash,
        source: { gallery: entry.gallery },
      })),
    };
    await writeTree(packDir, [
      ["instructions.md", instructions],
      ...tasks.map(({ entry, netlist }) => [
        `tasks/${entry.taskId}.sp`,
        netlist,
      ]),
      ["manifest.json", jsonText(packManifest)],
    ]);
    const taskPack = await readTaskPack(packDir);

    const sets = {
      "human-reference": new Map(),
      "grid-baseline": new Map(),
      "check-copy": new Map(),
    };
    for (const [index, { entry, netlist }] of tasks.entries()) {
      const { project, projectBytes } = checked[index];
      sets["human-reference"].set(entry.taskId, projectBytes);
      const failed = (set, error) =>
        result.verification.push({
          taskId: entry.taskId,
          set,
          status: "failed",
          reason: error.message,
        });
      try {
        const grid = await drawGridBaseline(entry.taskId, netlist);
        sets["grid-baseline"].set(
          entry.taskId,
          new TextEncoder().encode(serializeProject(grid)),
        );
      } catch (error) {
        failed("grid-baseline", error);
      }
      try {
        const copy = await drawCheckCopy(entry.gallery, project, netlist);
        result.checkCopies.push({
          taskId: entry.taskId,
          moved: copy.moved,
          parts: copy.parts,
        });
        if (copy.moved === 0)
          throw new Error(
            "No part could be moved without changing the circuit",
          );
        sets["check-copy"].set(
          entry.taskId,
          new TextEncoder().encode(serializeProject(copy.project)),
        );
      } catch (error) {
        failed("check-copy", error);
      }
    }
    for (const contestant of BUILT_IN) {
      const manifest = await writeContestantBundle({
        dir: join(staging, contestant.slug),
        taskPack,
        contestant: { ...contestant, date },
        rendererVersion,
        files: sets[contestant.slug],
      });
      for (const item of manifest.items)
        if (item.status !== "valid" && sets[contestant.slug].has(item.taskId))
          result.verification.push({
            taskId: item.taskId,
            set: contestant.slug,
            status: item.status,
            reason: item.reason,
          });
    }
    result.verification.sort((a, b) =>
      a.taskId === b.taskId
        ? BUILT_IN.findIndex(({ slug }) => slug === a.set) -
          BUILT_IN.findIndex(({ slug }) => slug === b.set)
        : a.taskId < b.taskId
          ? -1
          : 1,
    );
    if (result.verification.length) return await finish("blocked");

    await writeFile(
      join(staging, "season-exclusions.json"),
      jsonText({
        kind: "analog-canvas/season-exclusions",
        version: 1,
        season,
        purpose:
          "Gallery circuits this Season uses as Tasks; #1524 leaves them out of its private test split.",
        graphHash:
          "wl1: colour refinement of the device–net graph under #1524's rules, bodies and source polarity ignored (tools/arena-season/graph-hash.mjs)",
        entries: tasks.map(({ entry }) => ({
          taskId: entry.taskId,
          gallery: entry.gallery,
          graphHash: entry.graphHash,
        })),
      }),
    );
    for (const name of BUILD_OUTPUTS) {
      await rm(join(outDir, name), { recursive: true, force: true });
      await rename(join(staging, name), join(outDir, name));
    }
    return await finish("built");
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/**
 * Judge a Contestant's folder of `T###.icproj.json` files against a Task
 * pack and write its bundle to `<outDir>/<slug>/`, replacing a bundle this
 * tool wrote there before. Files named after no Task in the pack, and files
 * not named after a Task at all, are reported and left out.
 *
 * @param {{
 *   taskPackDir: string, contestantDir: string, contestant: object,
 *   outDir: string, rendererVersion: string,
 * }} options
 */
export async function submitContestant({
  taskPackDir,
  contestantDir,
  contestant,
  outDir,
  rendererVersion,
}) {
  const info = checkContestant(contestant);
  const taskPack = await readTaskPack(taskPackDir);
  const known = new Set(taskPack.manifest.tasks.map((task) => task.id));
  const files = new Map();
  const unknownTasks = [];
  const ignored = [];
  for (const name of (await readdir(contestantDir)).sort()) {
    const match = SUBMISSION_FILE.exec(name);
    if (!match) ignored.push(name);
    else if (!known.has(match[1])) unknownTasks.push(name);
    else files.set(match[1], await readFile(join(contestantDir, name)));
  }
  const dir = join(outDir, info.slug);
  if (!(await ownedOutput(dir)))
    throw new Error(
      `${dir} exists and is not a bundle this tool wrote; choose another --out`,
    );
  const staging = join(outDir, `.staging-${info.slug}-${process.pid}`);
  await rm(staging, { recursive: true, force: true });
  try {
    const manifest = await writeContestantBundle({
      dir: staging,
      taskPack,
      contestant: info,
      rendererVersion,
      files,
    });
    await rm(dir, { recursive: true, force: true });
    await rename(staging, dir);
    const counts = Object.fromEntries(
      ["valid", "not-equivalent", "unreadable", "missing"].map((status) => [
        status,
        manifest.items.filter((item) => item.status === status).length,
      ]),
    );
    return { bundle: dir, manifest, counts, unknownTasks, ignored };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** The check report as the Owner reads it in a terminal. */
export function formatReport(report) {
  const lines = [];
  for (const entry of report.entries) {
    const facts = [
      entry.sizeTier ??
        (entry.devices === null ? null : `${entry.devices} devices`),
      entry.functionClass,
    ].filter(Boolean);
    lines.push(
      `${entry.taskId}  ${entry.gallery}  ${entry.circuitName ?? "?"}${facts.length ? `  [${facts.join(", ")}]` : ""}  ${entry.problems.length ? "PROBLEM" : "ok"}`,
    );
    for (const problem of entry.problems)
      lines.push(`      problem: ${problem}`);
    for (const note of entry.notes) lines.push(`      note: ${note}`);
  }
  const tiers = Object.entries(report.totals.sizeTiers)
    .map(([tier, count]) => `${tier}: ${count}`)
    .join(", ");
  const classes = Object.entries(report.totals.functionClasses)
    .map(([name, count]) => `${name}: ${count}`)
    .join(", ");
  lines.push(
    "",
    `Listed ${report.listed}; ${report.withProblems} with problems.`,
    `Size tiers: ${tiers}.`,
    `Function classes: ${classes || "none"}.`,
  );
  for (const item of report.verification ?? [])
    lines.push(
      `Verification: ${item.taskId} ${item.set} is ${item.status}: ${item.reason}`,
    );
  return `${lines.join("\n")}\n`;
}
