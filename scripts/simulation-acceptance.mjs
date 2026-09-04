// ADR 0055's acceptance evidence, made repeatable.
//
// The ADR asks for one thing that no unit test can give: proof that a circuit
// carried through import, the model, and the exporter still simulates as the
// circuit somebody wrote. Every layer here has its own tests, and all of them
// can pass while the netlist we hand ngspice describes a different circuit --
// a swapped subcircuit port, a dropped `nf`, a net renamed into a short.
//
// So this runs ngspice twice: once on the reference SPICE file, once on what
// our exporter prints after reading it, through one identical testbench. The
// two runs must agree. It is a differential check on purpose: it asserts no
// absolute voltage, which would only encode today's model corner, and instead
// asserts that our round trip changed nothing the simulator can see.
//
// ngspice and the Sky130 models are not in CI and are not vendored, so an
// absent tool SKIPS rather than fails. `--require` turns that into a failure
// for a machine that is supposed to have them.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

// Imported from `dist` the way every other script here does: the root
// package does not depend on the workspace packages, and `pnpm build`
// prefixes this script so the built output is there.
import {
  analyzeDesignNetlist,
  printSpiceNetlist,
} from "../packages/netlist/dist/index.js";
import { importSpiceSources } from "../packages/spice/dist/index.js";
import { SKY130_LIBRARY_PATH } from "../packages/spice-run/dist/index.js";

const run = promisify(execFile);
const workspace = process.cwd();
const required = process.argv.includes("--require");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function skip(reason) {
  console.log(`Skipping simulation acceptance: ${reason}`);
  if (required) {
    console.error(
      "--require was given, so an absent prerequisite is a failure.",
    );
    process.exit(1);
  }
  process.exit(0);
}

// The one library, at the path the pinned container image puts it. There is
// deliberately no search of the machine: a volare or ciel checkout holds the
// BINNED model set, which is a different library that answers differently and
// refuses the benchmark's own reference devices outright. Silently using it
// would make this script's numbers incomparable with the product's, which is
// the one thing it exists to rule out.
function findModelLibrary() {
  const fromEnv = process.env.SKY130_LIB_PATH;
  if (fromEnv && !existsSync(fromEnv)) {
    console.error(`SKY130_LIB_PATH points at nothing: ${fromEnv}`);
    process.exit(1);
  }
  const path = fromEnv ?? SKY130_LIBRARY_PATH;
  return existsSync(path) ? path : undefined;
}

async function findNgspice() {
  try {
    const { stdout } = await run("which", ["ngspice"]);
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

// A testbench of our own, not the author's: ADR 0055 leaves the testbench to
// whoever owns the circuit, and this file owns the fixture. It biases the OTA
// into its intended operating region and reports the four internal nodes plus
// small-signal gain and bandwidth -- enough that a wrong connection anywhere
// in the core moves at least one number.
function testbench({ libraryPath, netlistPath }) {
  return `* ADR 0055 acceptance testbench
.lib ${libraryPath} tt
.include ${netlistPath}
Vdd vdd 0 1.8
Vinp vinp 0 0.9 AC 1
Vinn vinn 0 0.9 AC 0
Ibias vdd ibias 15u
Xdut 0 ibias vdd vinn vinp vout ota_5t
CL vout 0 1p
.control
op
print v(vout) v(ibias) v(xdut.tail) v(xdut.nleft)
ac dec 10 1 1G
meas ac gain_db FIND vdb(vout) AT=1k
meas ac ugb WHEN vdb(vout)=0 FALL=1
print gain_db ugb
.endc
.end
`;
}

// ngspice prints results as `name = value`, both from `print` and from `meas`.
// `meas` also echoes its own line in a different column layout, so the last
// occurrence of a name wins -- that is the one `print` produced.
function readMeasurements(output) {
  const values = new Map();
  for (const line of output.split("\n")) {
    const match = /^\s*([a-z0-9_().]+)\s*=\s*(-?[0-9.]+e[+-][0-9]+)\s*$/i.exec(
      line,
    );
    if (match) values.set(match[1].toLowerCase(), Number(match[2]));
  }
  return values;
}

async function simulate({ ngspice, directory, label, libraryPath, netlist }) {
  const netlistPath = join(directory, `${label}.spi`);
  const deckPath = join(directory, `tb-${label}.spi`);
  await writeFile(netlistPath, netlist, "utf8");
  await writeFile(deckPath, testbench({ libraryPath, netlistPath }), "utf8");
  let output;
  try {
    const result = await run(ngspice, ["-b", deckPath], {
      maxBuffer: 32 * 1024 * 1024,
    });
    output = `${result.stdout}\n${result.stderr}`;
  } catch (error) {
    output = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
  }
  const values = readMeasurements(output);
  if (values.size === 0) {
    console.error(`ngspice produced no measurements for ${label}:`);
    console.error(output.split("\n").slice(-30).join("\n"));
    process.exit(1);
  }
  return values;
}

const ngspice = await findNgspice();
if (!ngspice) skip("ngspice is not on PATH");
const libraryPath = findModelLibrary();
if (!libraryPath) {
  skip(
    `no Sky130 library at ${SKY130_LIBRARY_PATH}. It comes from the pinned ` +
      `container image, not from a PDK checkout; set SKY130_LIB_PATH if this ` +
      `host mounts that same library elsewhere.`,
  );
}

const referencePath = resolve(
  workspace,
  argument("--reference") ?? "fixtures/simulation-acceptance/ota-5t.spi",
);
const referenceText = await readFile(referencePath, "utf8");

const imported = await importSpiceSources(
  [{ path: "circuit.spi", bytes: new TextEncoder().encode(referenceText) }],
  "circuit.spi",
);
const blocking = imported.diagnostics.filter((one) => one.severity === "error");
if (blocking.length > 0 || !imported.project) {
  console.error("Import refused the reference netlist:");
  for (const one of blocking) console.error(`  ${one.code}: ${one.message}`);
  process.exit(1);
}

const analysis = analyzeDesignNetlist(imported.project);
const exportErrors = analysis.diagnostics.filter(
  (one) => one.severity === "error",
);
if (exportErrors.length > 0 || !analysis.ir) {
  console.error("Export refused the imported project:");
  for (const one of exportErrors)
    console.error(`  ${one.code}: ${one.message}`);
  process.exit(1);
}
const exported = printSpiceNetlist(analysis.ir);

const directory = await mkdtemp(join(tmpdir(), "icm-sim-acceptance-"));
const reference = await simulate({
  ngspice,
  directory,
  label: "reference",
  libraryPath,
  netlist: referenceText,
});
const ours = await simulate({
  ngspice,
  directory,
  label: "exported",
  libraryPath,
  netlist: exported,
});

// Bit-identical is what this actually produces, because the two netlists
// describe the same circuit. The tolerance exists so a future ngspice that
// reorders its solve does not fail a check about our exporter; it is still
// far tighter than any difference a real defect would make.
const TOLERANCE = 1e-9;
const rows = [];
let worst = 0;
for (const [name, expected] of reference) {
  const actual = ours.get(name);
  if (actual === undefined) {
    console.error(`Our export produced no value for ${name}.`);
    process.exit(1);
  }
  const deviation =
    expected === 0
      ? Math.abs(actual)
      : Math.abs((actual - expected) / expected);
  worst = Math.max(worst, deviation);
  rows.push({ name, expected, actual, deviation });
}

const table = rows
  .map(
    ({ name, expected, actual }) =>
      `  ${name.padEnd(18)} ${expected.toExponential(6)}   ${actual.toExponential(6)}`,
  )
  .join("\n");
console.log(`Reference: ${referencePath}`);
console.log(`ngspice:   ${ngspice}`);
console.log(`Models:    ${libraryPath}\n`);
console.log(
  `  ${"measurement".padEnd(18)} ${"reference".padEnd(13)}  as exported`,
);
console.log(table);

if (worst > TOLERANCE) {
  console.error(
    `\nThe exported netlist does not simulate as the reference does ` +
      `(worst relative deviation ${worst.toExponential(3)}).`,
  );
  process.exit(1);
}
console.log(
  `\nThe exported netlist simulates as the reference does ` +
    `(worst relative deviation ${worst.toExponential(3)}).`,
);
