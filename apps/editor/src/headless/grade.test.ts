import { describe, expect, it } from "vitest";
import { createEmptyProject } from "@icm/model";
import { workspaceNetlist } from "./artifacts";
import { explainGrade, gradeNetlists, structuralSpice } from "./grade";
import { createLocalEditor } from "./local-editor";

// A common-source stage with a diode-connected PMOS load and a bias source.
const AMPLIFIER = [
  "* amplifier",
  "M1 out in 0 0 nch",
  "M2 out out vdd vdd pch",
  "R1 out 0 1k",
  "I1 vdd out 1m",
  ".model nch nmos",
  ".model pch pmos",
].join("\n");

/** One resistor between each pair of nets. */
const ring = (pairs: [string, string][]) =>
  `* ring\n${pairs.map(([a, b], index) => `R${index} ${a} ${b} 1k`).join("\n")}\n`;
// One ring of six and two of three: every net joins two resistors in both.
const hexagon = ring([
  ["a", "b"],
  ["b", "c"],
  ["c", "d"],
  ["d", "e"],
  ["e", "f"],
  ["f", "a"],
]);
const triangles = ring([
  ["a", "b"],
  ["b", "c"],
  ["c", "a"],
  ["d", "e"],
  ["e", "f"],
  ["f", "d"],
]);

describe("netlist grade (#1524)", () => {
  it("finds a netlist exact against itself, every score full", async () => {
    expect(await gradeNetlists(AMPLIFIER, AMPLIFIER)).toMatchObject({
      exact: true,
      mode: "strict",
      deviceTypeF1: 1,
      connectionF1: 1,
      details: {
        bodies: "ignored",
        devices: { actual: 4, reference: 4 },
        nets: { actual: 4, reference: 4 },
        deviceTypes: {},
      },
    });
  });

  it("ignores device, net and Cell names, ground spellings and the order of lines", async () => {
    const renamed = [
      "",
      ".subckt stage VCC GND x y",
      "Rload y GND 2k",
      "Mb y y VCC VCC sky130_fd_pr__pfet_01v8 l=0.15 w=1",
      "XMa y x GND GND sky130_fd_pr__nfet_01v8 l=0.15 w=1",
      "Ibias VCC y DC 1m",
      ".ends stage",
    ].join("\n");
    expect(await gradeNetlists(renamed, AMPLIFIER)).toMatchObject({
      exact: true,
      mode: "strict",
      connectionF1: 1,
    });
  });

  it("takes a swapped drain and source as the same transistor, in lenient mode", async () => {
    const swapped = AMPLIFIER.replace("M1 out in 0 0", "M1 0 in out 0");
    expect(await gradeNetlists(swapped, AMPLIFIER)).toMatchObject({
      exact: true,
      mode: "lenient",
      connectionF1: 1,
    });
  });

  it("refuses a merged net, and scores what it still shares", async () => {
    // The gate joins the output: two nets became one.
    const merged = AMPLIFIER.replace("M1 out in 0 0", "M1 out out 0 0");
    const grade = await gradeNetlists(merged, AMPLIFIER);
    expect(grade).toMatchObject({
      exact: false,
      deviceTypeF1: 1,
      details: { nets: { actual: 3, reference: 4 }, deviceTypes: {} },
    });
    expect(grade.connectionF1).toBeGreaterThan(0.5);
    expect(grade.connectionF1).toBeLessThan(1);
  });

  it("refuses a swapped device type and names the types that differ", async () => {
    const swapped = AMPLIFIER.replace("M1 out in 0 0 nch", "M1 out in 0 0 pch");
    const grade = await gradeNetlists(swapped, AMPLIFIER);
    expect(grade).toMatchObject({
      exact: false,
      deviceTypeF1: 0.75,
      details: { deviceTypes: { nmos: [0, 1], pmos: [2, 1] } },
    });
    expect(grade.connectionF1).toBeLessThan(1);
  });

  it("refuses a missing device and an extra one", async () => {
    const missing = AMPLIFIER.replace("R1 out 0 1k\n", "");
    const extra = `${AMPLIFIER}\nC1 in 0 1p`;
    const short = await gradeNetlists(missing, AMPLIFIER);
    expect(short).toMatchObject({
      exact: false,
      details: {
        devices: { actual: 3, reference: 4 },
        deviceTypes: { resistor: [0, 1] },
      },
    });
    expect(short.deviceTypeF1).toBeCloseTo(6 / 7);
    const long = await gradeNetlists(extra, AMPLIFIER);
    expect(long).toMatchObject({
      exact: false,
      details: { deviceTypes: { capacitor: [1, 0] } },
    });
    expect(long.deviceTypeF1).toBeCloseTo(8 / 9);
  });

  it("holds supplies and ground fixed: a rail never stands in for a signal", async () => {
    const divider = "* d\nR1 vdd out 1k\nR2 out 0 1k\n";
    const floating = "* d\nR1 in out 1k\nR2 out 0 1k\n";
    expect(await gradeNetlists(floating, divider)).toMatchObject({
      exact: false,
    });
    expect(
      await gradeNetlists("* d\nR1 AVDD x 1k\nR2 x gnd! 1k\n", divider),
    ).toMatchObject({ exact: true });
  });

  it("ignores a body one side leaves on its rail, and compares bodies both sides draw", async () => {
    // The reference ties M1's body to its source; the drawing's 3-terminal
    // symbol exports it on ground.
    const follower = "* f\nM1 vdd in out out nch\nR1 out 0 1k\n.model nch nmos";
    const drawn = "* f\nM1 vdd in out 0 nch\nR1 out 0 1k\n.model nch nmos";
    expect(await gradeNetlists(drawn, follower)).toMatchObject({
      exact: true,
      mode: "lenient",
      details: { bodies: "ignored" },
    });
    expect(
      await gradeNetlists(drawn, follower, { body: "compare" }),
    ).toMatchObject({
      exact: false,
      details: { bodies: "compared", bodiesOnly: true },
    });
    // Both draw a body off its rail, and they disagree.
    const other = follower.replace("out out nch", "out in nch");
    expect(await gradeNetlists(other, follower)).toMatchObject({
      exact: false,
      details: { bodies: "compared", bodiesOnly: true },
    });
  });

  it("scores source polarity only when asked to", async () => {
    const forward = "* s\nV1 in 0 DC 1\nR1 in 0 1k\n";
    const reversed = "* s\nV1 0 in DC 1\nR1 in 0 1k\n";
    expect(await gradeNetlists(reversed, forward)).toMatchObject({
      exact: true,
    });
    expect(
      await gradeNetlists(reversed, forward, { sourcePolarity: true }),
    ).toMatchObject({ exact: false });
  });

  it("tells apart graphs colour refinement alone cannot: one ring of six from two of three", async () => {
    const shuffled = ring([
      ["q", "u"],
      ["p", "s"],
      ["r", "q"],
      ["s", "t"],
      ["u", "p"],
      ["t", "r"],
    ]);
    expect(await gradeNetlists(triangles, hexagon)).toMatchObject({
      exact: false,
      deviceTypeF1: 1,
      connectionF1: 1,
    });
    expect(await gradeNetlists(shuffled, hexagon)).toMatchObject({
      exact: true,
    });
  });

  it("flattens hierarchy, and reads an answer that starts with a device line", async () => {
    const flat =
      "M1 out in 0 0 nch\nM2 out in vdd vdd pch\nM3 y out 0 0 nch\nM4 y out vdd vdd pch\n";
    const nested = [
      "* chain",
      ".subckt inv a z vp vn",
      "MN z a vn vn nmos_lvt",
      "MP z a vp vp pmos_lvt",
      ".ends inv",
      "X1 in mid vdd 0 inv",
      "X2 mid y vdd 0 inv",
    ].join("\n");
    expect(await gradeNetlists(flat, nested)).toMatchObject({
      exact: true,
      details: { devices: { actual: 4, reference: 4 } },
    });
  });

  it("reads structural Spectre as AnalogGenie writes it, values or not", async () => {
    const spectre = [
      "M0 (out in VSS VSS) nmos4",
      "M1 (out out VDD VDD) pmos4",
      "R0 (out VSS) resistor",
      "I0 (VDD out) isource dc=1m",
    ].join("\n");
    expect(structuralSpice(spectre)).toMatchObject({ from: "spectre" });
    expect(structuralSpice(spectre).text).toContain("R0 out VSS 1");
    expect(structuralSpice(AMPLIFIER)).toEqual({
      text: AMPLIFIER,
      from: "spice",
    });
    expect(await gradeNetlists(AMPLIFIER, spectre)).toMatchObject({
      exact: true,
      mode: "strict",
    });
  });

  it("grades the editor's own export against a dataset reference", async () => {
    const project = createEmptyProject("project-grade", "Grade");
    project.documents[0]!.id = "main";
    project.topDocumentId = "main";
    const editor = createLocalEditor({ project });
    const place = (
      symbol: string,
      reference: string,
      x: number,
      y: number,
    ) => ({
      kind: "place-component",
      symbol,
      reference,
      position: { x, y },
    });
    const pin = (instance: string, name: string) => ({
      kind: "pin",
      instance,
      pin: name,
    });
    const transact = (actions: unknown[], structure: boolean) =>
      editor.circuit({
        apiVersion: "3.0",
        requestId: `grade-${actions.length}`,
        operation: "transact",
        documentId: "main",
        transactionId: `grade-${actions.length}-${structure}`,
        expectedRevision: editor.controller.document.revision,
        ...(structure
          ? { expectedStructureRevision: editor.project.structureRevision }
          : {}),
        dryRun: false,
        actions,
      } as never);
    expect(
      transact(
        [
          place("nmos", "M1", 200, 300),
          place("resistor", "R1", 350, 200),
          {
            kind: "place-component",
            symbol: "vdd-port",
            id: "vdd",
            position: { x: 350, y: 80 },
          },
          {
            kind: "place-component",
            symbol: "ground",
            id: "gnd",
            position: { x: 200, y: 420 },
          },
          place("port", "IN", 50, 300),
          place("port", "OUT", 450, 250),
        ],
        true,
      ),
    ).toMatchObject({ ok: true });
    expect(
      transact(
        [
          { kind: "connect", from: pin("IN", "P"), to: pin("M1", "G") },
          { kind: "connect", from: pin("M1", "S"), to: pin("gnd", "0") },
          { kind: "connect", from: pin("R1", "1"), to: pin("vdd", "P") },
          { kind: "connect", from: pin("R1", "2"), to: pin("M1", "D") },
          { kind: "connect", from: pin("OUT", "P"), to: pin("M1", "D") },
        ],
        false,
      ),
    ).toMatchObject({ ok: true });
    const netlist = workspaceNetlist(editor.project);
    expect(netlist.status, netlist.messages.join("; ")).toBe("ready");
    const reference = "M0 (VOUT VIN VSS VSS) nmos4\nR0 (VDD VOUT) resistor";
    const grade = await gradeNetlists(netlist.text!, reference);
    expect(grade, JSON.stringify(grade.details)).toMatchObject({
      exact: true,
    });
    const wrong = "M0 (VOUT VIN VSS VSS) nmos4\nR0 (VIN VOUT) resistor";
    expect(await gradeNetlists(netlist.text!, wrong)).toMatchObject({
      exact: false,
    });
  });

  it("answers the same every time, and says why an unreadable side is not graded", async () => {
    const answer = AMPLIFIER.replace("M1 out in 0 0", "M1 in out 0 0");
    expect(await gradeNetlists(answer, AMPLIFIER)).toEqual(
      await gradeNetlists(answer, AMPLIFIER),
    );
    expect(
      await gradeNetlists(
        AMPLIFIER,
        "* two roots\n.subckt a x\nR1 x 0 1\n.ends\n.subckt b y\nR1 y 0 1\n.ends\n",
      ),
    ).toMatchObject({
      exact: false,
      deviceTypeF1: 0,
      details: { error: expect.stringContaining("several top Cells") },
    });
    // A line the reader cannot take keeps the verdict from being exact.
    expect(
      await gradeNetlists(`${AMPLIFIER}\nR9 out`, `${AMPLIFIER}`),
    ).toMatchObject({
      exact: false,
      details: {
        problems: { actual: [expect.any(String), expect.any(String)] },
      },
    });
  });
});

describe("grade explanation", () => {
  it("does not blame the connections when the same connections form another circuit", async () => {
    const explanation = explainGrade(await gradeNetlists(triangles, hexagon));

    expect(explanation).toBe(
      "The same devices make the same connections, but they form a different circuit: no renaming of nets turns one into the other.",
    );
  });

  it("says a netlist with no devices was not compared, rather than counting its connections", async () => {
    const explanation = explainGrade(
      await gradeNetlists("* Nothing here\n.end\n", hexagon),
    );

    expect(explanation).toBe(
      "The netlists were not compared. The netlist: no devices.",
    );
  });

  it("names each device type whose count differs", async () => {
    const swapped = AMPLIFIER.replace("M1 out in 0 0 nch", "M1 out in 0 0 pch");

    expect(explainGrade(await gradeNetlists(swapped, AMPLIFIER))).toBe(
      "The device counts differ: nmos, 0 in the netlist and 1 in the reference; pmos, 2 in the netlist and 1 in the reference.",
    );
  });

  it("counts the connections when the same devices are connected differently", async () => {
    // The gate joins the output: five new pairs on it, and the gate's own net
    // is gone.
    const merged = AMPLIFIER.replace("M1 out in 0 0", "M1 out out 0 0");

    expect(explainGrade(await gradeNetlists(merged, AMPLIFIER))).toBe(
      "The connections differ: the netlist makes 14 of the reference's 15 connections and 5 that the reference does not.",
    );
  });

  it("says when the bodies are the only difference", async () => {
    // Both tie M1's body off its rail, so bodies count, and they disagree.
    const follower = "* f\nM1 vdd in out out nch\nR1 out 0 1k\n.model nch nmos";
    const other = follower.replace("out out nch", "out in nch");

    expect(explainGrade(await gradeNetlists(other, follower))).toBe(
      "Only the transistor bodies are connected differently, and here the bodies count.",
    );
  });

  it("calls a search that ran out of budget inconclusive, not a difference", async () => {
    // No circuit this small exhausts the search; a grade that did reads so.
    const grade = await gradeNetlists(triangles, hexagon);
    const exhausted = {
      ...grade,
      details: { ...grade.details, budgetExceeded: true },
    };

    expect(explainGrade(exhausted)).toBe(
      "The search for a match ran out of budget before it could decide, so whether the netlists are equivalent is inconclusive.",
    );
  });

  it("names what the grader could not read, beside any difference it found", async () => {
    // R9 has one node: the reader refuses it, so the rest still matches.
    const unread = `${AMPLIFIER}\nR9 out`;
    const merged = unread.replace("M1 out in 0 0", "M1 out out 0 0");

    expect(explainGrade(await gradeNetlists(unread, AMPLIFIER))).toMatch(
      /^The netlist has errors or unread statements: [^.]*R9 out[^]*\.$/u,
    );
    expect(explainGrade(await gradeNetlists(merged, AMPLIFIER))).toMatch(
      /^The netlist has errors or unread statements: .+\. The connections differ: the netlist makes 14 of the reference's 15 connections and 5 that the reference does not\.$/u,
    );
  });

  it("says an exact grade is equivalent", async () => {
    const swapped = AMPLIFIER.replace("M1 out in 0 0", "M1 0 in out 0");

    expect(explainGrade(await gradeNetlists(swapped, AMPLIFIER))).toBe(
      "The netlists are equivalent.",
    );
  });
});
