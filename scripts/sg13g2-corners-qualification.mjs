import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    binary: { type: "string" },
    models: { type: "string" },
    modules: { type: "string" },
    output: { type: "string" },
  },
});
for (const key of ["binary", "models", "modules", "output"])
  assert(values[key], `Required: --${key}`);
const profile = JSON.parse(
  readFileSync(
    new URL("../containers/ngspice/sg13g2/profile.json", import.meta.url),
    "utf8",
  ),
);
const sections = profile.qualifiedScope.sections.filter(
  (section) => section === "nominal" || section.startsWith("mos-"),
);
assert.equal(
  new Set(sections).size,
  135,
  "five MOS x three HBT x three resistor x three capacitor corners",
);
const output = resolve(values.output);
mkdirSync(output, { recursive: true });
const reports = new Map();
for (const [index, section] of sections.entries()) {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/sg13g2-qualification.mjs",
      "--library",
      profile.models.library.runtimePath,
      "--section",
      section,
      "--binary",
      values.binary,
      "--models",
      values.models,
      "--modules",
      values.modules,
      "--output",
      join(output, section),
    ],
    { encoding: "utf8", timeout: 120000, maxBuffer: 4 * 1024 * 1024 },
  );
  writeFileSync(
    join(output, `${section}.log`),
    `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  );
  assert(
    !result.error && result.status === 0,
    `Corner ${section} failed; see ${output}/${section}.log`,
  );
  const report = JSON.parse(result.stdout.trim());
  assert(report.passed && report.cases.length === 19, `Incomplete ${section}`);
  reports.set(section, report);
  if (index % 10 === 0)
    console.log(`SG13G2 corners: ${index + 1}/${sections.length}`);
}
const name = (mos, hbt = "typ", res = "typ", cap = "typ") =>
  mos === "tt" && hbt === "typ" && res === "typ" && cap === "typ"
    ? "nominal"
    : `mos-${mos}_hbt-${hbt}_res-${res}_cap-${cap}`;
const observation = (section, test, vector = "i(vd)") =>
  reports.get(section).cases.find((c) => c.name === test).observations[vector]
    .first;
// Corner changes must have electrical effects, while independently swept
// families must not silently overwrite each other's model parameters.
for (const test of ["nmos-op", "pmos-op", "hv-nmos-op", "hv-pmos-op"]) {
  assert(
    Math.abs(observation(name("ff"), test)) >
      Math.abs(observation(name("ss"), test)),
    `${test}: fast/slow ordering`,
  );
}
for (const test of ["rsil-op", "rppd-op", "rhigh-op"]) {
  assert(
    Math.abs(observation(name("tt", "typ", "bcs"), test)) >
      Math.abs(observation(name("tt", "typ", "wcs"), test)),
    `${test}: low/high resistance ordering`,
  );
}
for (const test of ["hbt-op", "hbt-long-op", "hbt-high-voltage-op", "pnp-op"]) {
  assert(
    Math.abs(
      observation(name("tt", "bcs"), test) -
        observation(name("tt", "wcs"), test),
    ) > 1e-12,
    `${test}: distinct HBT corners`,
  );
}
for (const section of sections) {
  if (section === "nominal") continue;
  const [, mos, hbt, res] = /^mos-(\w+)_hbt-(\w+)_res-(\w+)_cap-(\w+)$/u.exec(
    section,
  );
  for (const [test, isolated] of [
    ["nmos-op", name(mos)],
    ["pmos-op", name(mos)],
    ["hv-nmos-op", name(mos)],
    ["hv-pmos-op", name(mos)],
    ["hbt-op", name("tt", hbt)],
    ["hbt-long-op", name("tt", hbt)],
    ["hbt-high-voltage-op", name("tt", hbt)],
    ["pnp-op", name("tt", hbt)],
    ["rsil-op", name("tt", "typ", res)],
    ["rppd-op", name("tt", "typ", res)],
    ["rhigh-op", name("tt", "typ", res)],
  ]) {
    const expected = observation(isolated, test);
    assert(
      Math.abs(observation(section, test) - expected) <
        1e-12 + Math.abs(expected) * 1e-7,
      `${section}: ${test} family isolation`,
    );
  }
}
writeFileSync(
  join(output, "report.json"),
  JSON.stringify(
    {
      passed: true,
      corners: sections.length,
      cases: sections.length * 19,
      sections,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `SG13G2 corners passed: ${sections.length}, ${sections.length * 19} electrical cases`,
);
