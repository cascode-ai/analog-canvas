import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { hierarchyParameterFixture } from "./fixture.ts";
import { analyzeDesignNetlist, printSpiceNetlist } from "@icm/netlist";
import {
  executeProjectTransaction,
  planRenameCellParameter,
  planSetCellParameterDefault,
} from "../../packages/edit-engine/dist/index.js";

// Node 24 can load the erasable TypeScript fixture. Build workspace packages first.
const executable = process.argv[2] ?? "ngspice";
const wsl = process.argv.includes("--wsl");
function run(args, input) {
  const result = spawnSync(
    wsl ? "wsl" : executable,
    wsl ? ["-d", "Ubuntu", "--", executable, ...args] : args,
    { input, encoding: "utf8", timeout: 30000 },
  );
  assert.equal(
    result.status,
    0,
    result.error?.message ?? result.stderr + result.stdout,
  );
  return result.stdout + result.stderr;
}
const version = run(["--version"]);
assert.match(version, /ngspice/iu);
console.log(version.trim());

function apply(project, edits) {
  const result = executeProjectTransaction(project, {
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    transactionId: "simulation-acceptance",
    actor: { kind: "human", id: "acceptance" },
    edits,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.project;
}

function simulate(name, project, expected) {
  const analysis = analyzeDesignNetlist(project);
  assert.ok(analysis.ir, JSON.stringify(analysis.diagnostics));
  const text = printSpiceNetlist(analysis.ir);
  const deck = `${text}\nVa a 0 DC 1\nVb b 0 DC 1\nXcheck a b 0 dut\n.control\nset numdgt=12\nop\nprint i(va) i(vb)\nquit\n.endc\n.end\n`;
  const output = run(["-b"], deck);
  assert.ok(
    !/fatal error|unknown parameter|undefined parameter/iu.test(output),
    output,
  );
  const currents = ["va", "vb"].map((source) => {
    const match = new RegExp(
      `i\\(${source}\\)\\s*=\\s*([+\\-\\d.eE]+)`,
      "u",
    ).exec(output);
    assert.ok(match, output);
    return Number(match[1]);
  });
  currents.forEach((value, index) =>
    assert.ok(
      Math.abs(value - expected[index]) < 1e-10,
      `${name}: ${value} != ${expected[index]}`,
    ),
  );
  console.log(
    JSON.stringify({
      name,
      analysis: "OP",
      volts: 1,
      currents,
      expected,
      toleranceAmps: 1e-10,
    }),
  );
}

const initial = hierarchyParameterFixture();
simulate("override-and-default", initial, [-1 / 6000, -1 / 3000]);
const renamed = apply(
  initial,
  planRenameCellParameter(initial, "resistors", "Rbase", "Resistance"),
);
simulate("rename", renamed, [-1 / 6000, -1 / 3000]);
const changed = apply(
  renamed,
  planSetCellParameterDefault(renamed, "resistors", "Resistance", "3k"),
);
simulate("default-change", changed, [-1 / 6000, -1 / 9000]);
const top = changed.documents[0];
const reset = apply(changed, [
  {
    kind: "transact_document",
    documentId: top.id,
    expectedRevision: top.revision,
    edits: [
      {
        kind: "patch_instance_netlist_parameters",
        instanceId: "X1",
        unset: ["Resistance"],
      },
    ],
  },
]);
simulate("reset-override", reset, [-1 / 9000, -1 / 9000]);
