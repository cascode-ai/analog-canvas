#!/usr/bin/env node
// A scripted Agent for the batch runner (scripts/draw-batch.mjs, #1498). It
// draws a known circuit into its task's workspace through the headless
// editor bundle the runner loads, so the runner and its checking pipeline
// can be tried without a model. The prompt on stdin names what each role
// draws, e.g. `script-agent first=divider second=divider`; the default is a
// divider. It prints a usage line as `claude -p --output-format json` does.
//
//   --agent "node {cwd}/scripts/lib/draw-batch-script-agent.mjs {bundle} {dir} {role}"
//
// Circuits: divider (VDD–R1–OUT–R2–ground), divider-short (R2 from VDD),
// amplifier (an NMOS with a resistor load from VDD), nothing, fail, hang.
import { pathToFileURL } from "node:url";

const [bundle, dir, role = "first"] = process.argv.slice(2);
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
const choice = /script-agent\b(.*)$/mu.exec(prompt)?.[1] ?? "";
const circuit =
  new RegExp(`\\b${role}=(\\S+)`, "u").exec(choice)?.[1] ?? "divider";

if (circuit === "fail") {
  console.error("script agent: asked to fail");
  process.exit(3);
}
if (circuit === "hang") setInterval(() => {}, 1000);
else {
  if (circuit !== "nothing") {
    const headless = await import(pathToFileURL(bundle).href);
    const workspace = await headless.openLocalWorkspace(dir);
    const { editor } = workspace;
    let call = 0;
    const transact = (actions, structural) => {
      call += 1;
      const answer = editor.circuit({
        apiVersion: "3.0",
        requestId: `script-${call}`,
        operation: "transact",
        documentId: editor.controller.document.id,
        transactionId: `script-${call}`,
        expectedRevision: editor.controller.document.revision,
        ...(structural
          ? { expectedStructureRevision: editor.project.structureRevision }
          : {}),
        dryRun: false,
        actions,
      });
      if (!answer.ok) throw new Error(JSON.stringify(answer.error));
    };
    const place = (symbol, reference, x, y) => ({
      kind: "place-component",
      symbol,
      reference,
      position: { x, y },
    });
    const marker = (symbol, id, x, y) => ({
      kind: "place-component",
      symbol,
      id,
      position: { x, y },
    });
    const wire = ([a, p], [b, q]) => ({
      kind: "connect",
      from: { kind: "pin", instance: a, pin: p },
      to: { kind: "pin", instance: b, pin: q },
    });
    if (circuit === "amplifier") {
      transact(
        [
          place("nmos", "M1", 200, 300),
          place("resistor", "R1", 350, 200),
          marker("vdd-port", "vdd", 350, 80),
          marker("ground", "gnd", 200, 420),
          place("port", "IN", 50, 300),
          place("port", "OUT", 450, 250),
        ],
        true,
      );
      transact(
        [
          wire(["IN", "P"], ["M1", "G"]),
          wire(["M1", "S"], ["gnd", "0"]),
          wire(["R1", "1"], ["vdd", "P"]),
          wire(["R1", "2"], ["M1", "D"]),
          wire(["OUT", "P"], ["M1", "D"]),
        ],
        false,
      );
    } else {
      transact(
        [
          place("resistor", "R1", 100, 100),
          place("resistor", "R2", 100, 200),
          marker("vdd-port", "vdd", 100, 20),
          marker("ground", "gnd", 100, 260),
          place("port", "OUT", 200, 150),
        ],
        true,
      );
      transact(
        [
          wire(["vdd", "P"], ["R1", "1"]),
          wire(["R1", "2"], ["OUT", "P"]),
          circuit === "divider-short"
            ? wire(["R2", "1"], ["vdd", "P"])
            : wire(["R2", "1"], ["R1", "2"]),
          wire(["R2", "2"], ["gnd", "0"]),
        ],
        false,
      );
    }
    await workspace.close();
  }
  console.log(
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      num_turns: 2,
      total_cost_usd: 0.0125,
      usage: {
        input_tokens: 1200,
        output_tokens: 300,
        cache_read_input_tokens: 800,
        cache_creation_input_tokens: 0,
      },
    }),
  );
}
