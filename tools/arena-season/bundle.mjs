// Contestant bundles (#1560): every Project Arena shows, a model's or one of
// the three the Season build draws, goes through this one pipeline. Each
// file is rendered as the Gallery renders a preview, exported with the
// editor's netlist exporter and graded against its Task netlist by the
// #1524 grader with source polarity on. The bundle layout is fixed by the
// Season bundle contract in README.md, which Arena (#1559) reads.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  exportNetlist,
  gradeNetlists,
  parseProject,
  renderSvg,
  sha256,
} from "./editor.mjs";

export const TASK_PACK_KIND = "analog-arena/task-pack";
export const SUBMISSIONS_KIND = "analog-arena/submissions";
export const CONTRACT_VERSION = 1;
export const CONTESTANT_ROLES = [
  "model",
  "tool",
  "grid-baseline",
  "human-reference",
  "check-copy",
];
const CONTESTANT_FIELDS = [
  "slug",
  "role",
  "name",
  "provider",
  "modelId",
  "reasoning",
  "harness",
  "date",
  "protocolDeclaration",
];
/** A file a Contestant hands in: its Task id and the Project extension. */
export const SUBMISSION_FILE = /^(T\d{3,})\.icproj\.json$/u;

/** JSON as every file of a bundle writes it: two spaces, a final newline. */
export const jsonText = (value) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * A Task pack read back from its folder: the manifest, the hash Contestant
 * bundles cite, and each Task's netlist.
 */
export async function readTaskPack(dir) {
  const bytes = await readFile(join(dir, "manifest.json")).catch(() => {
    throw new Error(`${dir} holds no Task pack manifest.json`);
  });
  const manifest = JSON.parse(bytes.toString("utf8"));
  if (manifest.kind !== TASK_PACK_KIND || manifest.version !== CONTRACT_VERSION)
    throw new Error(`${dir}/manifest.json is not a version 1 Task pack`);
  const netlists = new Map();
  for (const task of manifest.tasks)
    netlists.set(task.id, await readFile(join(dir, task.netlist), "utf8"));
  return { manifest, hash: `sha256:${sha256(bytes)}`, netlists };
}

/** The Contestant a bundle describes, checked against the contract. */
export function checkContestant(info) {
  if (!info || typeof info !== "object" || Array.isArray(info))
    throw new Error("The Contestant information is not a JSON object");
  for (const field of CONTESTANT_FIELDS)
    if (typeof info[field] !== "string" || !info[field].trim())
      throw new Error(`The Contestant information needs "${field}"`);
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(info.slug))
    throw new Error(
      `The Contestant slug "${info.slug}" must be lower-case letters, digits and "-"`,
    );
  if (!CONTESTANT_ROLES.includes(info.role))
    throw new Error(
      `The Contestant role must be one of ${CONTESTANT_ROLES.join(", ")}`,
    );
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(info.date))
    throw new Error("The Contestant date must read YYYY-MM-DD");
  return Object.fromEntries(CONTESTANT_FIELDS.map((key) => [key, info[key]]));
}

/** Why a netlist the grader did not match falls short, in one line. */
function mismatchReason(grade) {
  const { details } = grade;
  if (details.error) return `Not gradable: ${details.error}`;
  const parts = [];
  if (details.problems.actual.length)
    parts.push(
      `its netlist could not be read in full (${details.problems.actual
        .slice(0, 2)
        .join("; ")})`,
    );
  if (details.devices.actual !== details.devices.reference)
    parts.push(
      `${details.devices.actual} devices where the Task has ${details.devices.reference}`,
    );
  const types = Object.entries(details.deviceTypes).map(
    ([type, [actual, reference]]) => `${type} ${actual} vs ${reference}`,
  );
  if (types.length) parts.push(`device types differ (${types.join(", ")})`);
  if (details.nets.actual !== details.nets.reference)
    parts.push(
      `${details.nets.actual} nets where the Task has ${details.nets.reference}`,
    );
  if (details.bodiesOnly) parts.push("only device bodies differ");
  if (details.budgetExceeded) parts.push("the comparison ran out of budget");
  if (!parts.length)
    parts.push(
      `the connections differ (${details.connections.shared} of ${details.connections.reference} match)`,
    );
  return `Not equivalent to the Task netlist: ${parts.join("; ")}`;
}

/**
 * Judge one Project file against its Task netlist: `valid`, or
 * `not-equivalent` with the grader's reason, or `unreadable` when it is not
 * a Project, cannot be rendered, or exports no netlist.
 *
 * @param {Uint8Array} bytes
 * @param {string} taskNetlist
 */
export async function judgeProjectFile(bytes, taskNetlist) {
  let project;
  try {
    project = parseProject(new TextDecoder().decode(bytes));
  } catch (error) {
    return {
      status: "unreadable",
      reason: `Not an Analog Canvas Project: ${error.message}`,
      svg: null,
      netlist: null,
    };
  }
  let svg;
  try {
    svg = await renderSvg(project);
  } catch (error) {
    return {
      status: "unreadable",
      reason: `It could not be rendered: ${error.message}`,
      svg: null,
      netlist: null,
    };
  }
  const exported = exportNetlist(project);
  if (exported.text === null)
    return {
      status: "unreadable",
      reason: `It exports no netlist: ${exported.errors.slice(0, 2).join("; ") || "blocked"}`,
      svg,
      netlist: null,
    };
  const grade = await gradeNetlists(exported.text, taskNetlist, {
    sourcePolarity: true,
  });
  return grade.exact
    ? { status: "valid", reason: null, svg, netlist: exported.text }
    : {
        status: "not-equivalent",
        reason: mismatchReason(grade),
        svg,
        netlist: exported.text,
      };
}

/**
 * Write one Contestant bundle into `dir`, which must be empty or new: a
 * manifest with exactly one item per Task, in the Task pack's order, and
 * beside it each handed-in Project unchanged with its SVG and netlist.
 *
 * @param {{
 *   dir: string,
 *   taskPack: { manifest: any, hash: string, netlists: Map<string, string> },
 *   contestant: Record<string, string>,
 *   rendererVersion: string,
 *   files: Map<string, Uint8Array>,
 * }} options
 */
export async function writeContestantBundle({
  dir,
  taskPack,
  contestant,
  rendererVersion,
  files,
}) {
  await mkdir(dir, { recursive: true });
  const items = [];
  for (const task of taskPack.manifest.tasks) {
    const bytes = files.get(task.id);
    if (!bytes) {
      items.push({
        taskId: task.id,
        status: "missing",
        reason: "No file was handed in for this Task",
        project: null,
        svg: null,
        netlist: null,
      });
      continue;
    }
    const verdict = await judgeProjectFile(
      bytes,
      taskPack.netlists.get(task.id),
    );
    const project = `${task.id}.icproj.json`;
    await writeFile(join(dir, project), bytes);
    const item = {
      taskId: task.id,
      status: verdict.status,
      reason: verdict.reason,
      project,
      svg: null,
      netlist: null,
    };
    if (verdict.svg !== null) {
      item.svg = `${task.id}.svg`;
      await writeFile(join(dir, item.svg), verdict.svg);
    }
    if (verdict.netlist !== null) {
      item.netlist = `${task.id}.sp`;
      await writeFile(join(dir, item.netlist), verdict.netlist);
    }
    items.push(item);
  }
  const manifest = {
    kind: SUBMISSIONS_KIND,
    version: CONTRACT_VERSION,
    season: taskPack.manifest.season,
    taskPackHash: taskPack.hash,
    contestant,
    rendererVersion,
    items,
  };
  await writeFile(join(dir, "manifest.json"), jsonText(manifest));
  return manifest;
}
