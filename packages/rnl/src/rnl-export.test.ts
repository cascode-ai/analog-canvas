import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type { CircuitProject } from "@icm/model";
import type { NetlistFormat } from "@icm/netlist";
import { parseProject } from "@icm/project-protocol";

import { createRnlExport } from "./rnl-export.js";

const example = (name: string): CircuitProject =>
  parseProject(
    readFileSync(
      resolve(process.cwd(), `apps/editor/src/examples/${name}.icproj.json`),
      "utf8",
    ),
  );

const EXAMPLES = [
  "simulation-common-source",
  "simulation-rc",
  "simulation-rlc",
  "simulation-ota",
  "two-stage-op-amp",
];
const FORMATS: NetlistFormat[] = ["spice", "spectre"];

describe("the SPICE+RNL and Spectre+RNL exports", () => {
  it.each(EXAMPLES.flatMap((name) => FORMATS.map((format) => [name, format])))(
    "names in %s's %s operations only what its netlist prints",
    (name, format) => {
      const result = createRnlExport(example(name), {
        format: format as NetlistFormat,
      });
      expect(result.status).toBe("ready");
      if (result.status !== "ready") return;
      const { request } = result;
      expect(request.dialect).toBe(format);
      expect(request.author).toBe("analog-canvas");
      const lines = request.netlist.split("\n");
      // SPICE: `XM1 out in ...`; Spectre: `XM1 (out in ...) master`.
      const prints = (instance: string) =>
        lines.some((line) =>
          line.startsWith(
            format === "spice" ? `${instance} ` : `${instance} (`,
          ),
        );
      for (const op of request.ops) {
        // A lone `#` is the Cell itself, which takes its block symbol.
        if (op.op === "set" && op.object.startsWith("#") && op.object !== "#")
          expect(prints(op.object.slice(1)), op.object).toBe(true);
        if (op.op === "add-wire")
          for (const net of op.nets)
            expect(request.netlist, net).toMatch(
              new RegExp(`[ (]${net.slice(1)}[ )\\n]`),
            );
      }
    },
  );

  it("blocks a part RNL cannot turn, and says why", () => {
    const project = example("simulation-rc");
    project.documents[0]!.instances.find(
      (instance) => instance.placement,
    )!.placement!.rotation = 45;
    const result = createRnlExport(project, { format: "spice" });
    expect(result.status).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toContain(
      "RNL_ROTATION_NOT_QUARTER",
    );
  });

  it("blocks with the netlist's own findings when the netlist does not print", () => {
    const result = createRnlExport(example("common-source-amplifier"), {
      format: "spice",
    });
    expect(result.status).toBe("blocked");
    expect(
      result.netlistDiagnostics.some((item) => item.severity === "error"),
    ).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });
});
