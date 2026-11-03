import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseNgspiceRawfile } from "../packages/spice-run/dist/rawfile.js";

// Trusted electrical acceptance fixtures, not a second product executor.
const { values } = parseArgs({
  options: {
    binary: { type: "string" },
    models: { type: "string" },
    modules: { type: "string" },
    output: { type: "string" },
    library: { type: "string" },
    section: { type: "string", default: "nominal" },
  },
});
for (const name of ["binary", "models", "modules", "output"])
  assert(values[name], `Required: --${name}`);
const binary = resolve(values.binary);
const models = resolve(values.models);
const modules = resolve(values.modules);
mkdirSync(resolve(values.output), { recursive: true });
const output = mkdtempSync(join(resolve(values.output), "run-"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const report = {
  binarySha256: digest(readFileSync(binary)),
  cases: [],
  passed: false,
};
const startup = readFileSync(
  new URL("../containers/ngspice/sg13g2/hosted.spiceinit", import.meta.url),
  "utf8",
)
  .replaceAll("/opt/sg13g2/models", models)
  .replaceAll("/opt/sg13g2/osdi", modules);
writeFileSync(join(output, ".spiceinit"), startup);
writeFileSync(
  join(output, "sg13g2.lib.spice"),
  readFileSync(
    values.library ??
      new URL("../containers/ngspice/sg13g2/sg13g2.lib.spice", import.meta.url),
  ),
);
const library = `.lib sg13g2.lib.spice ${values.section}`;

function run(name, circuit, commands, vectors) {
  const deck = `${name}\n${library}\n${circuit}\n.control\n${commands}\nwrite ${name}.raw ${vectors.join(" ")}\nquit\n.endc\n.end\n`;
  writeFileSync(join(output, `${name}.spice`), deck);
  const result = spawnSync(binary, ["-b", `${name}.spice`], {
    cwd: output,
    env: { PATH: process.env.PATH, HOME: output, LANG: "C", LC_ALL: "C" },
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
  const log = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  writeFileSync(join(output, `${name}.log`), log);
  assert(
    !result.error && result.status === 0,
    `${name}: process failed; ${log}`,
  );
  assert(
    !/error|unknown parameter|unrecognized parameter|timestep too small/iu.test(
      log,
    ),
    `${name}: simulator diagnostics; ${log}`,
  );
  const raw = readFileSync(join(output, `${name}.raw`), "utf8");
  const parsed = parseNgspiceRawfile(raw);
  assert(parsed.ok, `${name}: invalid or incomplete rawfile`);
  const plot = parsed.plots.at(-1);
  assert(plot && plot.pointCount > 0, `${name}: empty result`);
  report.cases.push({
    name,
    deckSha256: digest(deck),
    rawSha256: digest(raw),
    points: plot.pointCount,
    observations: Object.fromEntries(
      plot.vectors.map((vector) => [
        vector.variable.name.toLowerCase(),
        {
          first: vector.real[0],
          last: vector.real.at(-1),
          ...(vector.imag
            ? {
                imaginaryFirst: vector.imag[0],
                imaginaryLast: vector.imag.at(-1),
              }
            : {}),
        },
      ]),
    ),
  });
  return (name, imaginary = false) => {
    const vector = plot.vectors.find(
      (v) => v.variable.name.toLowerCase() === name.toLowerCase(),
    );
    assert(
      vector,
      `Missing ${name}; received ${plot.vectors.map((v) => v.variable.name).join(", ")}`,
    );
    const data = imaginary ? vector.imag : vector.real;
    assert(
      data?.length === plot.pointCount && data.every(Number.isFinite),
      `Incomplete ${name}`,
    );
    return data;
  };
}

try {
  const nmos = run(
    "nmos-dc",
    `Vd d 0 0.6
Vg g 0 0
Xn d g 0 0 sg13_lv_nmos w=1u l=0.5u ng=1 m=1`,
    "dc Vg 0 1.2 0.1",
    ["i(vd)"],
  );
  const current = nmos("i(vd)").map((i) => -i);
  assert.equal(current.length, 13);
  assert(current.at(-1) > 1e-6 && current.at(-1) < 0.01, "NMOS on current");
  assert(current.at(-1) > 100 * Math.abs(current[0]), "NMOS on/off ratio");
  for (let i = 1; i < current.length; i++)
    assert(current[i] >= current[i - 1] - 1e-12, "NMOS monotonic transfer");
  const pmos = run(
    "pmos-dc",
    `Vd d 0 0.6
Vs s 0 1.2
Vg g 0 1.2
Xp d g s s sg13_lv_pmos w=1u l=0.5u ng=1 m=1`,
    "dc Vg 1.2 0 -0.1",
    ["i(vd)"],
  )("i(vd)");
  assert.equal(pmos.length, 13);
  assert(
    pmos.at(-1) > 1e-6 && pmos.at(-1) < 0.01,
    "PMOS current direction and magnitude",
  );
  assert(pmos.at(-1) > 100 * Math.abs(pmos[0]), "PMOS on/off ratio");
  const close = (actual, expected, relative = 1e-5, absolute = 1e-12) =>
    assert(
      Math.abs(actual - expected) <= absolute + relative * Math.abs(expected),
      `${actual} differs from ${expected}`,
    );
  const native = run(
    "mos-native-op",
    `Vd d 0 0.6
Vg g 0 0.8
X1 d g 0 0 sg13_lv_nmos w=1u l=0.5u ng=2 m=3`,
    "save i(vd) @n.x1.nsg13_lv_nmos[ide] @n.x1.nsg13_lv_nmos[vgs] @n.x1.nsg13_lv_nmos[vds]\nop",
    [
      "i(vd)",
      "@n.x1.nsg13_lv_nmos[ide]",
      "@n.x1.nsg13_lv_nmos[vgs]",
      "@n.x1.nsg13_lv_nmos[vds]",
    ],
  );
  close(native("i(@n.x1.nsg13_lv_nmos[ide])")[0], -native("i(vd)")[0]);
  close(native("v(@n.x1.nsg13_lv_nmos[vgs])")[0], 0.8);
  close(native("v(@n.x1.nsg13_lv_nmos[vds])")[0], 0.6);
  const nativeP = run(
    "pmos-native-op",
    `Vd d 0 0.6
Vs s 0 1.2
Vg g 0 0.4
X1 d g s s sg13_lv_pmos w=1u l=0.5u ng=2 m=3`,
    "save i(vd) @n.x1.nsg13_lv_pmos[ide] @n.x1.nsg13_lv_pmos[vgs] @n.x1.nsg13_lv_pmos[vds]\nop",
    [
      "i(vd)",
      "@n.x1.nsg13_lv_pmos[ide]",
      "@n.x1.nsg13_lv_pmos[vgs]",
      "@n.x1.nsg13_lv_pmos[vds]",
    ],
  );
  // PSP's native PMOS outputs are polarity-normalized model quantities.
  close(nativeP("i(@n.x1.nsg13_lv_pmos[ide])")[0], nativeP("i(vd)")[0]);
  close(nativeP("v(@n.x1.nsg13_lv_pmos[vgs])")[0], 0.8);
  close(nativeP("v(@n.x1.nsg13_lv_pmos[vds])")[0], 0.6);
  // Doubling parallel devices must double their terminal current, independent
  // of model coefficients. Bias and geometry are identical in both branches.
  for (const [name, master, pins, parameters, bias, count] of [
    ["nmos", "sg13_lv_nmos", "d g 0 0", "w=1u l=0.5u ng=1", "Vg g 0 0.8", "m"],
    [
      "pmos",
      "sg13_lv_pmos",
      "d g s s",
      "w=1u l=0.5u ng=1",
      "Vg g 0 0.4\nVs s 0 1.2",
      "m",
    ],
    ["rsil", "rsil", "d 0 0", "w=1u l=10u", "", "m"],
    ["rppd", "rppd", "d 0 0", "w=1u l=10u b=0", "", "m"],
    ["rhigh", "rhigh", "d 0 0", "w=1u l=10u b=0", "", "m"],
    ["hbt", "npn13G2", "d b 0 0", "le=900n we=70n", "Vb b 0 0.7", "Nx"],
    ["hv-nmos", "sg13_hv_nmos", "d g 0 0", "w=2u l=1u ng=2", "Vg g 0 1.8", "m"],
    [
      "hv-pmos",
      "sg13_hv_pmos",
      "d g s s",
      "w=2u l=1u ng=2",
      "Vg g 0 1.5\nVs s 0 3.3",
      "m",
    ],
    ["hbt-long", "npn13G2l", "d b 0 0", "le=1u we=70n", "Vb b 0 0.7", "Nx"],
    [
      "hbt-high-voltage",
      "npn13G2v",
      "d b 0 0",
      "le=1u we=120n",
      "Vb b 0 0.7",
      "Nx",
    ],
    ["pnp", "pnpMPA", "d b e", "a=1.44p p=5.4u", "Vb b 0 0.5\nVe e 0 1.2", "m"],
  ]) {
    const vectors = run(
      `${name}-op`,
      `Vd d 0 0.6
Vd2 d2 0 0.6
${bias}
X1 ${pins} ${master} ${parameters} ${count}=1
X2 ${pins.replace(/^d /u, "d2 ")} ${master} ${parameters} ${count}=2`,
      "op",
      ["i(vd)", "i(vd2)"],
    );
    const first = vectors("i(vd)")[0];
    const second = vectors("i(vd2)")[0];
    assert(
      Math.abs(first) > 1e-10 && Math.abs(first) < 1,
      `${name}: conducting bias`,
    );
    close(second, first * 2, name.startsWith("hbt") ? 0.02 : 1e-5);
  }
  {
    const rf = run(
      "rf-mim-ac",
      `V1 a 0 dc 0 ac 1
V2 b 0 dc 0 ac 1
X1 a 0 0 cap_rfcmim w=10u l=10u wfeed=5u m=1
X2 b 0 0 cap_rfcmim w=10u l=10u wfeed=5u m=2`,
      "ac dec 5 1Meg 10Gig",
      ["i(v1)", "i(v2)"],
    );
    for (const imaginary of [false, true]) {
      const single = rf("i(v1)", imaginary);
      const doubled = rf("i(v2)", imaginary);
      single.forEach((current, index) =>
        close(doubled[index], current * 2, 1e-5, 1e-12),
      );
    }
    assert(rf("i(v1)", true)[0] < -1e-7, "RF MIM capacitive response");
  }
  const cap = run(
    "cap-ac",
    `V1 a 0 dc 0 ac 1
X1 a 0 cap_cmim w=7u l=7u m=1`,
    "ac lin 1 1Meg 1Meg",
    ["i(v1)"],
  );
  // Upstream cap_typ: area 1.5 fF/um², edge 40 aF/um. 7um square.
  const areaFactor = values.section.includes("cap-bcs")
    ? 0.9
    : values.section.includes("cap-wcs")
      ? 1.1
      : 1;
  const capacitance = 49 * 1.5e-15 * areaFactor + 28 * 40e-18;
  close(-cap("i(v1)", true)[0] / (2 * Math.PI * 1e6), capacitance, 1e-5, 1e-20);
  const transient = run(
    "cap-tran",
    `V1 in 0 pulse(0 1 0 1p 1p 10n 20n)
R1 in out 10k
X1 out 0 cap_cmim w=7u l=7u m=1`,
    "tran 10p 5n",
    ["v(out)"],
  );
  const voltage = transient("v(out)");
  assert(
    voltage.length > 100 && voltage.at(-1) > 0.99 && voltage.at(-1) <= 1.001,
    "MIM RC charges to supply",
  );
  const noise = run(
    "res-noise",
    `Vi in 0 dc 0 ac 1
X1 in out 0 rsil w=1u l=10u m=1
C1 out 0 1n`,
    "noise v(out) Vi dec 5 1 1Meg\nsetplot noise1",
    ["onoise_spectrum"],
  )("onoise_spectrum");
  assert(
    noise.length > 10 && noise.every((n) => n > 0),
    "Resistor noise is finite and positive",
  );
  report.passed = true;
} finally {
  writeFileSync(
    join(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify({ output, ...report }));
}
