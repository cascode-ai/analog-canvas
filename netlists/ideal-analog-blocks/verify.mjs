import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEmptyProject } from "@icm/model";
import { subcircuitDescriptor } from "@icm/devices";
import { generateCircuitSource } from "@icm/netlist";

// Exercise Project -> netlist, not hand-written copies of the models. Build first.
const executable = process.argv[2] ?? "ngspice";
const directory = mkdtempSync(join(tmpdir(), "icm-ideal-blocks-"));
function run(args) {
  const result = spawnSync(executable, args, {
    cwd: directory,
    encoding: "utf8",
    timeout: 30000,
    windowsHide: true,
  });
  assert.equal(
    result.status,
    0,
    result.error?.message ?? result.stdout + result.stderr,
  );
  return result.stdout + result.stderr;
}
console.log(run(["--version"]).trim());
const symbols = [
  "opamp",
  "opamp-wide",
  "voltage-amplifier",
  "transconductance",
  "differential-transconductance",
  "opamp-differential",
  "opamp-differential-wide",
];
for (const symbolId of symbols) {
  const descriptor = subcircuitDescriptor(symbolId);
  assert.ok(descriptor);
  for (const gain of [2, 7]) {
    const prefix = `${symbolId}-${gain}-`;
    const project = createEmptyProject("ideal-block", "Ideal block", "dut");
    const document = project.documents[0];
    const currentOutput = descriptor.target.includes("transconductance");
    const differentialOutput = descriptor.target === "opamp_differential";
    document.instances.push({
      id: "amp",
      symbolId,
      reference: "X1",
      placement: null,
      netlist: {
        binding: { kind: "unresolved-subcircuit", name: descriptor.target },
        parameters: currentOutput
          ? { gm: String(gain / 1000) }
          : { gain: String(gain) },
      },
    });
    const names = {
      VDD: "avdd",
      VSS: "avss",
      VIP: "input",
      VIN: descriptor.ports.some((port) => port.name === "VIP")
        ? "minus"
        : "input",
      VOUT: "out",
      VOP: "out",
      VON: "outn",
    };
    for (const port of descriptor.ports) {
      const name = names[port.name];
      assert.ok(name, port.name);
      document.nets.push({
        id: name,
        terminals: [
          { instanceId: "amp", pinName: port.supply ?? port.pinName },
        ],
      });
      document.connectivityEvidence.push({
        id: `name-${name}`,
        kind: "net-name-hint",
        netId: name,
        sourceName: name,
        origin: "spice-import",
      });
    }
    const generated = generateCircuitSource(
      project,
      {
        id: "circuit",
        path: "circuit.spice",
        documentId: "dut",
        emission: "top-level",
      },
      undefined,
      "ngspice",
    );
    assert.ok(generated.ok, JSON.stringify(generated));
    assert.doesNotMatch(generated.source.text, /\.global/iu);
    assert.match(generated.source.text, /X1 avdd avss /u);
    const output = differentialOutput ? "v(out,outn) v(out) v(outn)" : "v(out)";
    const deck = `Ideal block acceptance: ${symbolId}
${generated.source.text.replace(/^\.end\s*$/gimu, "")}
VDD avdd 0 5
VSS avss 0 -5
Vin input 0 DC 0.1 AC 1 PULSE(0 0.1 1u 1n 1n 2u 4u)
Vminus minus 0 0
Rload out 0 1k
${differentialOutput ? "Rloadn outn 0 1k" : ""}
.control
set noaskquit
set numdgt=15
set wr_singlescale
op
wrdata ${prefix}op.txt ${output}
dc Vin -0.1 0.1 0.05
wrdata ${prefix}dc.txt ${output}
ac dec 4 1 1meg
wrdata ${prefix}ac.txt ${output}
tran 10n 5u
wrdata ${prefix}tran.txt v(input) ${output}
quit
.endc
.end
`;
    const file = `${symbolId}-${gain}.cir`;
    writeFileSync(join(directory, file), deck);
    const log = run(["-b", file]);
    assert.doesNotMatch(
      log,
      /fatal error|unknown parameter|undefined parameter|no such vector/iu,
    );
    const rows = (name) =>
      readFileSync(join(directory, `${prefix}${name}.txt`), "utf8")
        .trim()
        .split(/\r?\n/u)
        .map((line) => line.trim().split(/\s+/u).map(Number));
    const near = (actual, expected, description) =>
      assert.ok(
        Number.isFinite(actual) && Math.abs(actual - expected) < 1e-8,
        `${symbolId} gain ${gain} ${description}: ${actual} != ${expected}`,
      );
    const check = (row, offset, input) => {
      near(row[offset], gain * input, "output");
      if (differentialOutput) {
        near(row[offset + 1], (gain * input) / 2, "positive output");
        near(row[offset + 2], (-gain * input) / 2, "negative output");
      }
    };
    assert.equal(rows("op").length, 1);
    check(rows("op")[0], 1, 0.1);
    assert.equal(rows("dc").length, 5);
    for (const row of rows("dc")) check(row, 1, row[0]);
    assert.ok(rows("ac").length > 20);
    for (const row of rows("ac")) {
      near(row[1], gain, "AC real gain");
      near(row[2], 0, "AC imaginary gain");
      if (differentialOutput) {
        near(row[3], gain / 2, "AC positive output");
        near(row[4], 0, "AC positive imaginary");
        near(row[5], -gain / 2, "AC negative output");
        near(row[6], 0, "AC negative imaginary");
      }
    }
    assert.ok(rows("tran").length > 400);
    for (const row of rows("tran")) check(row, 2, row[1]);
    console.log(`${symbolId}: gain=${gain} OP/DC/AC/TRAN PASS`);
  }
}
console.log(`Evidence decks and last run data: ${directory}`);
