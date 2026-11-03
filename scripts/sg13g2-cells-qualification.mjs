import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseNgspiceRawfile } from "../packages/spice-run/dist/rawfile.js";

const { values } = parseArgs({
  options: Object.fromEntries(
    ["binary", "models", "modules", "cells", "output"].map((key) => [
      key,
      { type: "string" },
    ]),
  ),
});
for (const key of ["binary", "models", "modules", "cells", "output"])
  assert(values[key], `Required: --${key}`);
mkdirSync(resolve(values.output), { recursive: true });
const output = mkdtempSync(join(resolve(values.output), "run-"));
const bytes = readFileSync(values.cells);
const manifest = JSON.parse(
  readFileSync(
    new URL("../containers/ngspice/sg13g2/profile.json", import.meta.url),
    "utf8",
  ),
);
assert.equal(
  createHash("sha256").update(bytes).digest("hex"),
  manifest.cellLibraries[0].contentSha256,
);
const cells = [
  ...bytes
    .toString("utf8")
    .matchAll(
      /^\.subckt (sg13g2_(inv|buf|dlygate4sd\d|(?:nand|nor|and|or|xor|xnor)[234])_\d+) (.+)$/gmu,
    ),
].map((match, index) => ({
  name: match[1],
  family: match[2],
  pins: match[3].trim().split(/\s+/u),
  output: `out${index}`,
}));
assert.deepEqual(
  cells.map((cell) => cell.name).sort(),
  [...manifest.cellLibraries[0].masters].sort(),
);
assert.equal(
  cells.length,
  37,
  "Every existing Library-gate cell in the pinned upstream netlist",
);
const startup = readFileSync(
  new URL("../containers/ngspice/sg13g2/hosted.spiceinit", import.meta.url),
  "utf8",
)
  .replaceAll("/opt/sg13g2/models", resolve(values.models))
  .replaceAll("/opt/sg13g2/osdi", resolve(values.modules));
writeFileSync(join(output, ".spiceinit"), startup);
writeFileSync(join(output, "cells.spice"), bytes);
writeFileSync(
  join(output, "models.lib"),
  readFileSync(manifest.models.library.runtimePath),
);
const truth = (family, code) => {
  const count = Number(/([234])$/u.exec(family)?.[1] ?? 1);
  const input = Array.from({ length: count }, (_, bit) => (code >> bit) & 1);
  const sum = input.reduce((a, b) => a + b, 0);
  if (family === "inv") return 1 - input[0];
  if (family === "buf" || family.startsWith("dlygate")) return input[0];
  const fn = family.replace(/[234]$/u, "");
  return {
    and: sum === count,
    nand: sum !== count,
    or: sum > 0,
    nor: sum === 0,
    xor: sum % 2 === 1,
    xnor: sum % 2 === 0,
  }[fn]
    ? 1
    : 0;
};
const circuit = [
  "VDD vdd 0 1.2",
  ...["A", "B", "C", "D"].map(
    (pin, bit) =>
      `B${pin} ${pin} 0 v=1.2*(floor(v(code)/${2 ** bit})-2*floor(v(code)/${2 ** (bit + 1)}))`,
  ),
  ...cells.flatMap((cell) => {
    const expectedOutput = /^(inv|nand|nor|xnor)/u.test(cell.family)
      ? "Y"
      : "X";
    assert.equal(
      cell.pins[0],
      expectedOutput,
      `${cell.name}: output polarity and position`,
    );
    return [
      `X${cell.output} ${cell.pins.map((pin, index) => (index === 0 ? cell.output : pin === "VDD" ? "vdd" : pin === "VSS" ? "0" : pin)).join(" ")} ${cell.name}`,
      `C${cell.output} ${cell.output} 0 5f`,
    ];
  }),
].join("\n");
const observations = [];
for (const corner of ["tt", "ff", "ss", "fs", "sf"])
  for (const temperature of [-40, 27, 125]) {
    const section =
      corner === "tt" ? "nominal" : `mos-${corner}_hbt-typ_res-typ_cap-typ`;
    const label = `${corner}-${temperature}`;
    const waveform = Array.from(
      { length: 16 },
      (_, code) => `${code * 20}n ${code} ${(code + 1) * 20 - 0.05}n ${code}`,
    ).join(" ");
    const deck = `SG13G2 gate truth and switching ${label}
.lib models.lib ${section}
.include cells.spice
.temp ${temperature}
Vcode code 0 PWL(${waveform})
${circuit}
.control
dc Vcode 0 15 1
write ${label}-dc.raw ${cells.map((cell) => `v(${cell.output})`).join(" ")}
tran 0.1n 310n
write ${label}-tran.raw ${cells.map((cell) => `v(${cell.output})`).join(" ")}
quit
.endc
.end
`;
    const filename = `${label}.spice`;
    writeFileSync(join(output, filename), deck);
    const result = spawnSync(resolve(values.binary), ["-b", filename], {
      cwd: output,
      env: { PATH: process.env.PATH, HOME: output, LANG: "C", LC_ALL: "C" },
      encoding: "utf8",
      timeout: 120000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const log = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    writeFileSync(join(output, `${label}.log`), log);
    assert(
      !result.error &&
        result.status === 0 &&
        !/error|unknown parameter|unrecognized parameter|timestep too small/iu.test(
          log,
        ),
      `${label}: simulator diagnostics; ${log}`,
    );
    for (const analysis of ["dc", "tran"]) {
      const parsed = parseNgspiceRawfile(
        readFileSync(join(output, `${label}-${analysis}.raw`), "utf8"),
      );
      assert(parsed.ok, `${label} ${analysis}: complete rawfile`);
      const plot = parsed.plots.at(-1);
      const scale = plot.vectors[0].real;
      for (let code = 0; code < 16; code++) {
        const point =
          analysis === "dc"
            ? code
            : scale.findIndex((time) => time >= (code * 20 + 9.9) * 1e-9);
        assert(point >= 0, `${label}: sample for code ${code}`);
        for (const cell of cells) {
          const voltage = plot.vectors.find(
            (vector) =>
              vector.variable.name.toLowerCase() === `v(${cell.output})`,
          )?.real[point];
          const expected = truth(cell.family, code) * 1.2;
          assert(
            Number.isFinite(voltage) && Math.abs(voltage - expected) < 0.12,
            `${label} ${analysis}: ${cell.name}, inputs=${code}, received ${voltage}, expected ${expected}`,
          );
        }
      }
    }
    observations.push({
      corner,
      temperature,
      dcInputs: 16,
      transientInputs: 16,
    });
    console.log(`SG13G2 cells passed: ${label}`);
  }
writeFileSync(
  join(output, "report.json"),
  JSON.stringify(
    {
      passed: true,
      cells: cells.map((cell) => cell.name),
      contentSha256: createHash("sha256").update(bytes).digest("hex"),
      observations,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `SG13G2: all ${cells.length} Library-gate cells pass exhaustive static and transient truth tables at five MOS corners and three temperatures`,
);
