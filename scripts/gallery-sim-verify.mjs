#!/usr/bin/env node
// The Gallery's Sim mark from a run on this machine (#1545): read each
// entry's testbench with the Owner's token, prepare and run it with this
// checkout's headless engine and the local ngspice, judge it by the hosted
// check's rule, and, with --apply, record the verdict for exactly the
// content that ran. Dry run by default.
//
//   node scripts/gallery-sim-verify.mjs ID [ID...] | --all
//       [--apply] [--origin URL] [--ngspice BIN] [--models FILE]
//       [--sg13g2 DIR] [--library ID=FILE]... [--bundle FILE]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_ORIGIN,
  ownerToken,
  postOrigin,
} from "./gallery-import-batches.mjs";

const root = resolve(import.meta.dirname, "..");
const DEFAULT_BUNDLE = resolve(
  root,
  "output/headless/analog-canvas-headless.mjs",
);
const MODELS_ENV = "ANALOG_CANVAS_SKY130_LIB";
/**
 * Where the hosted simulator image's continuous (unbinned) SKY130 library is
 * kept here: its /opt/sky130 layer, unpacked under this directory. Volare's
 * binned library is not a stand-in: it caps W at 100 µm and fails entries the
 * hosted check runs.
 */
const CONTINUOUS_MODELS =
  ".volare/circuit-bench-2.0.8/opt/sky130/continuous/sky130.lib.spice";
const PROFILE = resolve(root, "containers/ngspice/hosted-sky130-profile.json");
const SG13G2_PROFILE = resolve(root, "containers/ngspice/sg13g2/profile.json");
const SG13G2_ENV = "ANALOG_CANVAS_SG13G2";
/**
 * Where the hosted SG13G2 image's /opt/sg13g2 (sg13g2.lib.spice beside the
 * IHP models and their OSDI modules) is laid out here; its standard cells,
 * the image's /opt/sg13g2-cells, beside it.
 */
const SG13G2_ROOT = "opt/sg13g2";
const USAGE = `usage: node scripts/gallery-sim-verify.mjs ID [ID...] | --all [--apply] [--origin URL] [--ngspice BIN] [--models FILE] [--sg13g2 DIR] [--library ID=FILE]... [--bundle FILE]

Runs each entry's testbench with the local ngspice and judges it as the hosted
check does, under the Profile each folder names: the hosted SKY130 or SG13G2
ngspice Profile. Without --apply nothing is recorded. --all takes every public
entry with a testbench. --models names the SKY130 library file the Profile's
models load from: the hosted simulator's continuous library (default
$${MODELS_ENV}, else ~/${CONTINUOUS_MODELS}). --sg13g2 names the directory laid
out as the SG13G2 image's /opt/sg13g2: sg13g2.lib.spice, models/ and the OSDI
modules in osdi/ (default $${SG13G2_ENV}, else ~/${SG13G2_ROOT}); its standard
cells are sg13g2-cells/sg13g2_stdcell.spice beside it. --library ID=FILE names
another Profile library; the SKY130 Profile's standard cells default to the
copy in containers/ngspice/cells. The Owner token comes from
$ANALOG_CANVAS_OWNER_TOKEN or ~/.config/analog-canvas/owner-token.`;

export class UsageError extends Error {}

/** The hosted simulator's continuous SKY130 library, the models a local check loads by default. */
export function defaultModels(env = process.env, home = homedir()) {
  const fromEnv = env[MODELS_ENV]?.trim();
  if (fromEnv) return resolve(fromEnv);
  const continuous = join(home, CONTINUOUS_MODELS);
  return existsSync(continuous) ? continuous : null;
}

/** The SG13G2 image's /opt/sg13g2 laid out here, or null. */
export function defaultSg13g2(env = process.env, home = homedir()) {
  const fromEnv = env[SG13G2_ENV]?.trim();
  if (fromEnv) return resolve(fromEnv);
  const installed = join(home, SG13G2_ROOT);
  return existsSync(join(installed, "sg13g2.lib.spice")) ? installed : null;
}

/**
 * The SG13G2 Profile's libraries in `directory`, laid out as the image's
 * /opt: the models library, and the standard cells beside it when there.
 */
export function sg13g2Libraries(directory, profile = SG13G2_PROFILE) {
  if (!directory) return {};
  const { models, cellLibraries = [] } = JSON.parse(
    readFileSync(profile, "utf8"),
  );
  return Object.fromEntries([
    [models.id, join(directory, basename(models.library.runtimePath))],
    ...cellLibraries
      .map((cell) => [
        cell.id,
        join(
          dirname(directory),
          basename(dirname(cell.library.runtimePath)),
          basename(cell.library.runtimePath),
        ),
      ])
      .filter(([, file]) => existsSync(file)),
  ]);
}

/** The hosted Profile's standard-cell libraries, from the copies this checkout vendors. */
export function defaultLibraries(profile = PROFILE) {
  const { cellLibraries = [] } = JSON.parse(readFileSync(profile, "utf8"));
  return Object.fromEntries(
    cellLibraries
      .map((cell) => [
        cell.id,
        resolve(
          root,
          "containers/ngspice/cells",
          basename(cell.library.runtimePath),
        ),
      ])
      .filter(([, file]) => existsSync(file)),
  );
}

export function parseArguments(argv, env = process.env, home = homedir()) {
  const options = {
    ids: [],
    all: false,
    apply: false,
    origin: DEFAULT_ORIGIN,
    ngspice: "ngspice",
    models: defaultModels(env, home),
    sg13g2: defaultSg13g2(env, home),
    libraries: defaultLibraries(),
    bundle: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[++index];
      if (next === undefined) throw new UsageError(`${arg} needs a value`);
      return next;
    };
    if (arg === "--help" || arg === "-h") throw new UsageError(USAGE);
    else if (arg === "--all") options.all = true;
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--origin") options.origin = postOrigin(value());
    else if (arg === "--ngspice") options.ngspice = value();
    else if (arg === "--models") options.models = resolve(value());
    else if (arg === "--sg13g2") options.sg13g2 = resolve(value());
    else if (arg === "--bundle") options.bundle = resolve(value());
    else if (arg === "--library") {
      const [id, file] = value().split(/=(.*)/su);
      if (!id || !file) throw new UsageError("--library takes ID=FILE");
      options.libraries[id] = resolve(file);
    } else if (arg.startsWith("--"))
      throw new UsageError(`Unknown option ${arg}`);
    else options.ids.push(arg);
  }
  if (options.all === options.ids.length > 0)
    throw new UsageError(`Name entry ids or --all, not both.\n\n${USAGE}`);
  return options;
}

/** The first Spec, or else the reason, that keeps a verdict from passing. */
function whyNot(check) {
  const folder = check.folders.find((item) => item.status !== "pass");
  const spec = folder?.specs.find((item) => item.judgment !== "pass");
  if (spec)
    return `${folder.name}: ${spec.name} = ${spec.value ?? "none"}${spec.unit ? ` ${spec.unit}` : ""}, wants ${spec.expected} (${spec.reason ?? spec.judgment})`;
  if (folder)
    return `${folder.name}: ${folder.code ?? folder.status}${folder.message ? ` — ${folder.message}` : ""}`;
  return check.reason ?? check.status;
}

/** One line of the summary for one entry. */
export function describeResult(result) {
  const head = `${result.id}${result.name ? ` (${result.name})` : ""}`;
  if (result.outcome === "cannot-run")
    return `cannot run  ${head}: ${result.reason}`;
  const recorded =
    result.recorded === undefined
      ? ""
      : result.recorded
        ? " [recorded]"
        : ` [not recorded: ${result.refusal}]`;
  return result.outcome === "pass"
    ? `pass        ${head}${recorded}`
    : `${result.outcome.padEnd(11)} ${head}: ${whyNot(result.check)}${recorded}`;
}

/**
 * Check each entry and, with `apply`, record its verdict: the testbench read
 * with the Owner's token, run by `check` (the headless engine's
 * localSimulationCheck) on `simulator`, and posted for the digests it read.
 */
export async function verifyEntries({
  ids,
  all,
  apply,
  origin,
  token,
  simulator,
  check,
  fetchImpl = fetch,
  log = () => {},
}) {
  const request = async (path, body) => {
    const response = await fetchImpl(`${origin}${path}`, {
      ...(body === undefined
        ? {}
        : { method: "POST", body: JSON.stringify(body) }),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
    });
    const payload = await response.json().catch(() => ({}));
    return { status: response.status, payload };
  };
  let entries = ids.map((id) => ({ id }));
  if (all) {
    const listed = await request("/api/gallery/simulation-checks/inputs");
    if (listed.status !== 200)
      throw new Error(
        `Listing the entries was refused (${listed.status} ${listed.payload.error ?? ""}): the Owner token is missing, wrong or revoked, or not the Owner's.`,
      );
    entries = listed.payload.entries;
  }
  const results = [];
  for (const entry of entries) {
    const input = await request(
      `/api/gallery/${encodeURIComponent(entry.id)}/simulation-check/input`,
    );
    let result;
    if (input.status === 401 || input.status === 403)
      throw new Error(
        `Reading ${entry.id} was refused (${input.status}): the Owner token is missing, wrong or revoked, or not the Owner's.`,
      );
    if (input.status !== 200)
      result = {
        id: entry.id,
        outcome: "cannot-run",
        reason: input.payload.error ?? `HTTP ${input.status}`,
      };
    else if (input.payload.testbenchDigest === null)
      result = {
        id: entry.id,
        name: input.payload.name,
        outcome: "cannot-run",
        reason: "no testbench",
      };
    else {
      const judged = await check(input.payload.projectText, simulator);
      if (judged.kind === "cannot-run")
        result = {
          id: entry.id,
          name: input.payload.name,
          outcome: "cannot-run",
          reason: `${judged.folder}: ${judged.code} — ${judged.message}`,
        };
      else {
        result = {
          id: entry.id,
          name: input.payload.name,
          outcome: judged.check.status,
          check: judged.check,
        };
        if (apply) {
          const posted = await request(
            `/api/gallery/${encodeURIComponent(entry.id)}/simulation-check`,
            {
              projectDigest: input.payload.projectDigest,
              testbenchDigest: input.payload.testbenchDigest,
              status: judged.check.status,
              checkedAt: judged.check.checkedAt,
              folders: judged.check.folders,
            },
          );
          result.recorded = posted.status === 200;
          if (!result.recorded)
            result.refusal = posted.payload.error ?? `HTTP ${posted.status}`;
        }
      }
    }
    results.push(result);
    log(describeResult(result));
  }
  return results;
}

/** The headless engine, built from this checkout when it is not there. */
async function loadHeadless(bundle, explicit) {
  if (!existsSync(bundle)) {
    if (explicit) throw new Error(`No headless bundle at ${bundle}`);
    execFileSync(
      process.execPath,
      [join(root, "scripts/package-headless.mjs")],
      { stdio: "inherit" },
    );
  }
  const headless = await import(pathToFileURL(bundle).href);
  if (typeof headless.localSimulationCheck !== "function")
    throw new Error(
      `${bundle} predates the local simulation check; rebuild it with node scripts/package-headless.mjs.`,
    );
  return headless;
}

export async function main(
  argv,
  {
    env = process.env,
    home = homedir(),
    fetchImpl = fetch,
    log = console.log,
  } = {},
) {
  let options;
  try {
    options = parseArguments(argv, env, home);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    log(error.message);
    return argv.includes("--help") || argv.includes("-h") ? 0 : 2;
  }
  const headless = await loadHeadless(
    options.bundle ?? DEFAULT_BUNDLE,
    options.bundle !== undefined,
  );
  const libraries = {
    ...(options.models
      ? { [headless.LOCAL_SIMULATION_MODELS_ID]: options.models }
      : {}),
    ...sg13g2Libraries(options.sg13g2),
    ...options.libraries,
  };
  log(
    `${options.apply ? "Recording" : "Dry run (no --apply): nothing is recorded"}; ngspice ${options.ngspice}, models ${libraries[headless.LOCAL_SIMULATION_MODELS_ID] ?? "none"}, SG13G2 ${options.sg13g2 ?? "none"}, ${options.origin}`,
  );
  const results = await verifyEntries({
    ids: options.ids,
    all: options.all,
    apply: options.apply,
    origin: options.origin,
    token: ownerToken(env, home),
    simulator: { ngspice: options.ngspice, libraries },
    check: headless.localSimulationCheck,
    fetchImpl,
    log,
  });
  const count = (outcome) =>
    results.filter((result) => result.outcome === outcome).length;
  log(
    `${results.length} checked: ${count("pass")} pass, ${count("fail")} fail, ${count("error")} error, ${count("cannot-run")} cannot run` +
      (options.apply
        ? `; ${results.filter((result) => result.recorded).length} recorded`
        : ""),
  );
  return results.some((result) => result.recorded === false) ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
