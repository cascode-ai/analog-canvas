import { createHash } from "node:crypto";
import type { CircuitProject } from "@icm/model";
import { importSpiceSources } from "@icm/spice";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";
import { embeddedReviewBundle } from "./embedded-review-source";
import { importLocalCircuit } from "./import-local-circuit";
import {
  compareReviewSource,
  incompleteCells,
} from "./review-source-comparison";

const input = (path: string, text: string) => {
  const bytes = new TextEncoder().encode(text);
  return {
    path,
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
};

// A Virtuoso export: a foundry library kept external, a local model file,
// a parameter and an analysis.
const top = input(
  "top.scs",
  [
    "simulator lang=spectre",
    'include "/pdk/tsmc28/models/spectre/toplevel.scs" section=tt',
    'include "models.scs"',
    "parameters wn=1u",
    "subckt inv (in out vdd vss)",
    "    M1 (out in vdd vdd) pch w=2*wn l=180n",
    "    M0 (out in vss vss) nch w=wn l=180n",
    "ends inv",
    "subckt buf (in out vdd vss)",
    "    I0 (in mid vdd vss) inv",
    "    I1 (mid out vdd vss) inv",
    "    C0 (out vss) capacitor c=10f",
    "ends buf",
    "tran tran step=10p stop=10n",
    "",
  ].join("\n"),
);
const models = input(
  "models.scs",
  "simulator lang=spectre\nmodel nch bsim3v3 type=n\nmodel pch bsim3v3 type=p\n",
);

async function delivered() {
  const { project } = await importLocalCircuit([top, models], "top.scs");
  const source = await embeddedReviewBundle(project.source);
  expect(source?.entryPath).toBe("top.scs");
  return { project, source: source! };
}

/** A copy whose `reference` Instance in Cell `cell` has parameter `name` set. */
function withParameter(
  project: CircuitProject,
  cell: string,
  reference: string,
  name: string,
  value: string,
): CircuitProject {
  const copy = structuredClone(project);
  const instance = copy.documents
    .find((document) => document.name === cell)!
    .instances.find((item) => item.reference === reference)!;
  instance.netlist!.parameters = {
    ...instance.netlist!.parameters,
    [name]: value,
  };
  return copy;
}

describe("Canvas review of an imported netlist", () => {
  it("reaches a verdict on a Virtuoso delivery and lists what it leaves out", async () => {
    const { project, source } = await delivered();
    const result = await compareReviewSource(project, source);
    expect(result, JSON.stringify(result.reasons)).toMatchObject({
      sourceVersion: source.version,
      status: "equal",
      topology: "equal",
      reasons: [],
      differences: [],
    });
    expect(result.notes).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Includes not read: .*toplevel\.scs/u),
        expect.stringMatching(/^Parameters not compared: wn/u),
        expect.stringMatching(/^Statements not compared: .*tran/u),
        expect.stringContaining("bsim3v3 model nch"),
      ]),
    );
  });

  it("reports an edit anywhere in the design with its original line", async () => {
    const { project, source } = await delivered();
    // The top Cell and a Cell it calls, whichever Cell is open.
    const edited = withParameter(
      withParameter(project, "buf", "C0", "value", "20f"),
      "inv",
      "M0",
      "w",
      "2u",
    );
    const result = await compareReviewSource(edited, source);
    expect(result).toMatchObject({ status: "different", topology: "equal" });
    expect(
      result.differences.map(
        ({ kind, cell, object, actual, expected, source }) => ({
          kind,
          cell,
          object,
          actual,
          expected,
          source,
        }),
      ),
    ).toEqual([
      {
        kind: "parameter",
        cell: "buf",
        object: "c0.value",
        actual: "20f",
        expected: "10f",
        source: { path: "top.scs", line: 12 },
      },
      {
        // An expression compares as the SPICE text it converts to.
        kind: "parameter",
        cell: "inv",
        object: "m0.w",
        actual: "2u",
        expected: "{wn}",
        source: { path: "top.scs", line: 7 },
      },
    ]);
  });

  it("compares the source model's declared polarity with the Canvas device", async () => {
    const entryPath = "model.sp";
    const source = (model: "nmos" | "pmos") => ({
      entryPath,
      version: model,
      files: [
        {
          path: entryPath,
          bytes: new TextEncoder().encode(
            `* source\n.model nch ${model}\n.subckt dut A B\nM1 A B 0 0 nch w=1u l=1u\n.ends dut\n`,
          ),
        },
      ],
    });
    const loaded = await importSpiceSources(source("nmos").files, entryPath);
    expect(loaded.successful).toBe(true);
    const project = loaded.project!;
    await expect(
      compareReviewSource(project, source("nmos")),
    ).resolves.toMatchObject({ status: "equal", differences: [] });
    await expect(
      compareReviewSource(project, source("pmos")),
    ).resolves.toMatchObject({
      status: "different",
      differences: [
        {
          kind: "declaration",
          object: "model nch",
          actual: "nmos",
          expected: "pmos",
          source: { path: entryPath, line: 2 },
        },
      ],
    });
  });

  it("lists Cells whose drawing still lacks an Instance or a connection", async () => {
    const { project } = await delivered();
    const resolver = createProjectSymbolResolver(project, builtInSymbols);
    // The import places every part and leaves its wiring to be drawn.
    expect(incompleteCells(project, resolver)).toEqual(
      ["inv", "buf"].map((name) =>
        expect.objectContaining({
          name,
          unplacedInstances: 0,
          unroutedConnections: expect.any(Number),
        }),
      ),
    );
    const unplaced = structuredClone(project);
    const inv = unplaced.documents.find(({ name }) => name === "inv")!;
    inv.instances.find(({ reference }) => reference === "M0")!.placement = null;
    expect(
      incompleteCells(unplaced, resolver).find(({ name }) => name === "inv"),
    ).toMatchObject({ unplacedInstances: 1 });
  });
});
