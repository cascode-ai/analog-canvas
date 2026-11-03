import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseNgspiceRawfile } from "../packages/spice-run/dist/rawfile.js";

const { values } = parseArgs({ options: { output: { type: "string" } } });
assert(values.output, "Required: --output");
mkdirSync(resolve(values.output), { recursive: true });
const output = mkdtempSync(join(resolve(values.output), "run-"));
writeFileSync(
  join(output, ".spiceinit"),
  readFileSync("/opt/harness/hosted.spiceinit"),
);
const devices = [
  ["sg13_lv_nmos", "g 0 0", "w=1u l=500n", 0.6],
  ["sg13_lv_pmos", "gp vp vp", "w=1u l=500n", 0.6],
  ["sg13_hv_nmos", "gh 0 0", "w=2u l=1u", 1.6],
  ["sg13_hv_pmos", "ghp vh vh", "w=2u l=1u", 1.6],
  ["npn13G2", "b 0 0", "le=900n we=70n", 0.8],
  ["npn13G2l", "b 0 0", "le=1u we=70n", 0.8],
  ["npn13G2v", "b 0 0", "le=1u we=120n", 0.8],
  ["pnpMPA", "bp vp", "a=1.44p p=5.4u", 0.4],
  ["rsil", "0 0", "w=1u l=10u", 0.1],
  ["rppd", "0 0", "w=1u l=10u", 0.1],
  ["rhigh", "0 0", "w=1u l=10u", 0.1],
  ["cap_cmim", "0", "w=7u l=7u", 0],
  ["cap_rfcmim", "0 0", "w=10u l=10u wfeed=5u", 0],
];
const report = {};
for (const mode of ["statistical", "nominal-mismatch"]) {
  const cards = devices
    .flatMap(([master, pins, geometry, bias], i) =>
      [0, 1].map((copy) => {
        const node = `d${i}_${copy}`;
        const local =
          mode === "nominal-mismatch" && master !== "pnpMPA" ? " mm_ok=1" : "";
        return `V${node} ${node} 0 dc ${bias} ac 1\nX${node} ${node} ${pins} ${master} ${geometry}${local}`;
      }),
    )
    .join("\n");
  const rows = [];
  for (const [run, seed] of [
    7101,
    ...Array.from({ length: 32 }, (_, i) => 7101 + i),
  ].entries()) {
    const label = `${mode}-${run}`;
    const deck = `SG13G2 ${mode} seed ${seed}
.lib /opt/sg13g2/sg13g2.lib.spice ${mode}
Vg g 0 0.8
Vgp gp 0 0.4
Vgh gh 0 1.8
Vghp ghp 0 1.5
Vh vh 0 3.3
Vvp vp 0 1.2
Vb b 0 0.7
Vbp bp 0 0.5
${cards}
.control
setseed ${seed}
reset
op
write ${label}-op.raw ${devices.flatMap((_, i) => [0, 1].map((c) => `i(vd${i}_${c})`)).join(" ")}
ac lin 1 1Meg 1Meg
write ${label}-ac.raw i(vd11_0) i(vd11_1) i(vd12_0) i(vd12_1)
quit
.endc
.end
`;
    writeFileSync(join(output, `${label}.cir`), deck);
    const result = spawnSync(
      "/opt/ngspice/bin/ngspice",
      ["-b", `${label}.cir`],
      {
        cwd: output,
        env: { PATH: process.env.PATH, HOME: output },
        encoding: "utf8",
        timeout: 30000,
      },
    );
    const log = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    writeFileSync(join(output, `${label}.log`), log);
    assert(
      !result.error &&
        result.status === 0 &&
        !/error|unknown parameter|unrecognized parameter|timestep too small/iu.test(
          log,
        ),
      `${label}: ${log}`,
    );
    const plots = ["op", "ac"].map((kind) => {
      const parsed = parseNgspiceRawfile(
        readFileSync(join(output, `${label}-${kind}.raw`), "utf8"),
      );
      assert(parsed.ok);
      return parsed.plots[0];
    });
    const samples = Object.fromEntries(
      devices.map(([name], i) => [
        name,
        [0, 1].map((copy) => {
          const cap = i >= 11;
          const vector = plots[cap ? 1 : 0].vectors.find(
            (v) => v.variable.name.toLowerCase() === `i(vd${i}_${copy})`,
          );
          const measurement = cap
            ? -vector.imag[0] / (2 * Math.PI * 1e6)
            : vector.real[0];
          assert(
            Number.isFinite(measurement) && Math.abs(measurement) > 0,
            `${label} ${name} finite response`,
          );
          return measurement;
        }),
      ]),
    );
    rows.push({ seed, samples });
  }
  assert.deepEqual(
    rows[0].samples,
    rows[1].samples,
    `${mode}: replay identical seed`,
  );
  const spreads = {};
  for (const [name] of devices) {
    const samples = rows.slice(1).map((row) => row.samples[name]);
    const first = samples.map((pair) => pair[0]);
    const spread =
      (Math.max(...first) - Math.min(...first)) /
      Math.max(...first.map(Math.abs));
    const pairSpread = Math.max(
      ...samples.map(
        ([a, b]) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)),
      ),
    );
    spreads[name] = {
      relativeRange: spread,
      maximumRelativePairDifference: pairSpread,
    };
    if (mode === "nominal-mismatch" && name === "pnpMPA") {
      assert(
        pairSpread < 1e-6 && spread < 1e-6,
        "Upstream PNP has no local mismatch term",
      );
    } else {
      assert(spread > 1e-5, `${mode}: ${name} responds to the seed`);
      if (mode === "nominal-mismatch")
        assert(pairSpread > 1e-5, `${name}: instance mismatch`);
    }
  }
  report[mode] = { seeds: 32, replay: true, spreads, rows };
  console.log(`SG13G2 ${mode}: 32 seeds and a repeated seed passed`);
}
writeFileSync(
  join(output, "report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
