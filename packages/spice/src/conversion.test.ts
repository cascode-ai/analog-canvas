import { describe, expect, it } from "vitest";
import {
  convertNetlist,
  MAX_CONVERSION_BYTES,
  type NetlistDialect,
} from "./conversion.js";
import { importSpiceSources } from "./importer.js";

function converted(
  text: string,
  source: NetlistDialect = "spectre",
  fragment = true,
) {
  const result = convertNetlist({
    text,
    source,
    target: source === "spectre" ? "spice" : "spectre",
    fragment,
  });
  expect(result.status, JSON.stringify(result)).toBe("converted");
  if (result.status !== "converted") throw new Error("blocked");
  return result.text;
}

describe("netlist-crawler structural conversion", () => {
  it("converts optional subcircuit port parentheses without changing order", async () => {
    for (const ports of ["(z a)", "z a"]) {
      const spice = converted(
        `simulator lang=spectre\nsubckt amp ${ports}\nparameters gain=2\nR1 (z a) resistor r=(gain*1k)\nends amp`,
      );
      expect(spice).toContain(".subckt amp z a\n");
      expect(spice).toContain("R1 z a {(gain*1000)}");
      const imported = await importSpiceSources(
        [{ path: "circuit.spi", bytes: new TextEncoder().encode(spice) }],
        "circuit.spi",
      );
      expect(imported.successful, JSON.stringify(imported.diagnostics)).toBe(
        true,
      );
    }
  });
  it("roundtrips hierarchy, formal defaults, node order and device parameters", () => {
    const source =
      ".subckt leaf out in params: w=2u\nM1 out in 0 0 NMOS w={w*2} l=150n\n.ends leaf\n.subckt Main z a\nX1 z a leaf w=3u\n.ends Main\n";
    const scs = converted(source, "spice");
    expect(scs).toContain("subckt leaf (out in)\nparameters w=0.000002");
    const spice = converted(scs);
    expect(spice).toContain("X1 z a leaf w=0.000003");
    expect(spice).toContain("M1 out in 0 0 NMOS w={(w*2)} l=1.5e-7");
  });
  it("converts coupled inductors both ways, as the T-coil subcircuit is written", () => {
    const tcoil = [
      ".subckt tcoil n1 n2 n3 params: l1=1n l2=1n k=1 cb=1p",
      "L1 n1 n3 {l1}",
      "L2 n3 n2 {l2}",
      "K12 L1 L2 {k}",
      "CB n1 n2 {cb}",
      ".ends tcoil",
      "",
    ].join("\n");
    const scs = converted(tcoil, "spice");
    expect(scs).toContain("L1 (n1 n3) inductor l=(l1)");
    expect(scs).toContain("K12 mutual_inductor coupling=(k) ind1=L1 ind2=L2");
    const spice = converted(scs);
    expect(spice).toContain("L1 n1 n3 {(l1)}");
    expect(spice).toContain("K12 L1 L2 {(k)}");
    // Spectre inductors need no L; SPICE spells them, and their coupling,
    // with the prefixes it requires.
    expect(
      converted(
        "W1 (a b) inductor l=1n\nW2 (c d) inductor l=2n\nM0 mutual_inductor coupling=0.5 ind1=W1 ind2=W2",
      ),
    ).toContain("LW1 a b 1e-9\nLW2 c d 2e-9\nKM0 LW1 LW2 0.5");
    for (const text of ["K1 L1 L2 L3 0.9", "K1 L1 0.9"])
      expect(
        convertNetlist({ text, source: "spice", target: "spectre" }).status,
      ).toBe("blocked");
  });
  it("distinguishes mega and milli and translates arithmetic coefficients", () => {
    expect(
      converted("R1 (a b) resistor r=1M\nR2 (b 0) resistor r=1m"),
    ).toContain("R1 a b 1000000\nR2 b 0 0.001");
    expect(converted("R1 a b 1Meg\nR2 b 0 1M", "spice")).toContain(
      "r=1000000\nR2 (b 0) resistor r=0.001",
    );
    expect(converted("M1 (d g s b) NMOS w=(size*2u) l=150n")).toContain(
      "w={(size*0.000002)} l=1.5e-7",
    );
  });
  it.each([
    ["V1 a 0 DC 1 AC 2 90", "vsource dc=1 mag=2 phase=90"],
    ["V1 a 0 PULSE(0 1 0 1n 2n 3n 6n)", "type=pulse"],
    ["I1 a 0 SIN(0 1m 1k 0 2 45)", "damp=2 sinephase=45"],
    ["V1 a 0 PWL(0 0 1n 1)", "wave=[0 0 1e-9 1]"],
  ])("preserves independent source intent: %s", (spice, expected) => {
    const scs = converted(spice, "spice");
    expect(scs).toContain(expected);
    const output = converted(scs);
    expect(output).toMatch(new RegExp(`\\n${spice[0]}1 a 0 `));
    expect(output).not.toContain("DC 0");
  });
  it("handles continuations and comments around quoted includes", () => {
    const spice = converted(
      'include "models/a//b.scs" section=tt // local library\nM1 (d g s b) NMOS w=2u \\\n l=150n',
    );
    expect(spice).toContain('.lib "models/a//b.scs" tt');
    expect(spice).toContain("w=0.000002 l=1.5e-7");
    expect(
      converted(
        "M1 d g s b NMOS\n* comment between continuation\n+ w=2u l=150n",
        "spice",
      ),
    ).toContain("NMOS w=0.000002 l=1.5e-7");
  });
  it("retains a SPICE-language section, including its library and control script", () => {
    const text =
      '// wrapper\nsimulator lang=spice\n.lib "sky130.lib.spice" tt\nR1 a 0 1k\n.control\nlet a = 1\nlet b = 2\nprint a b\n.endc\n.end';
    const result = converted(text);
    expect(result).toContain('.lib "sky130.lib.spice" tt');
    expect(result).toContain("let a = 1\nlet b = 2\nprint a b\n.endc\n.end");
  });
  it("uses X for declared subcircuits and reviewed PDK wrappers", () => {
    const text =
      "subckt child (a b)\nR1 (a b) resistor r=1k\nends child\nM1 (a b) child\nM2 (d g s b) sky130_fd_pr__nfet_01v8 w=1 l=0.15";
    expect(converted(text)).toContain(
      "XM1 a b child\nXM2 d g s b sky130_fd_pr__nfet_01v8 w=1 l=0.15",
    );
  });
  it.each([
    ["R1 (a b) resistor r=1k tc1=0.1", "spectre"],
    ["R1 a b 1k tc1=0.1", "spice"],
    ["R1 (a b) resistor", "spectre"],
    ["V1 (a 0) vsource type=pulse val0=0 val1=1", "spectre"],
    ["V1 (a 0) vsource type=unknown dc=1", "spectre"],
    ["V1 (a 0) vsource dc=1 weird=2", "spectre"],
    ["B1 (a 0) bsource v=1", "spectre"],
    ["U1 (a 0) unknown_master", "spectre"],
    ["M1 (d g s b) N w=1u W=2u", "spectre"],
    ["R1 (a b) resistor r=sin(time)", "spectre"],
    [".control\nprint v(a)\n.endc", "spice"],
    [".tran 1n 1u uic", "spice"],
    ["simulator lang=veriloga", "spectre"],
    ["subckt a (a b)\nends b", "spectre"],
    ["R1 (a b resistor r=1k", "spectre"],
    ["r (a b) resistor r=1k\nR (b 0) resistor r=2k", "spectre"],
    ["foo (a b) resistor r=1k\nRfoo (b 0) resistor r=2k", "spectre"],
  ] as const)(
    "blocks unsupported or ambiguous input without partial output: %s",
    (text, source) => {
      const result = convertNetlist({
        text,
        source,
        target: source === "spice" ? "spectre" : "spice",
      });
      expect(result.status).toBe("blocked");
      expect(result).not.toHaveProperty("text");
      expect(result.issues[0]?.line).toBeGreaterThan(0);
    },
  );
  it("preserves SPICE model/library dialects and the editor's sine offset", () => {
    const model =
      '.lib "models.lib" tt\n.model N nmos level=1\nM1 d g 0 0 N w=2u l=150n';
    const scs = converted(model, "spice");
    expect(scs).toContain(
      'simulator lang=spice\n.lib "models.lib" tt\nsimulator lang=spectre',
    );
    expect(converted(scs)).toContain(".model N nmos level=1");
    expect(
      converted(
        "V1 (a 0) vsource type=sine dc=0.5 ampl=0.1 freq=1k damp=2 sinephase=45",
      ),
    ).toContain("DC 0.5 SIN(0.5 0.1 1000 0 2 45)");
  });
  it.each([
    ["R1 (Out 0) resistor r=1k\nR2 (out 0) resistor r=2k", "spectre"],
    [".subckt cell Out in\nR1 out in 1k\n.ends cell", "spice"],
    ["global VDD\nR1 (vdd 0) resistor r=1k", "spectre"],
  ] as const)(
    "refuses node case aliases before changing dialect",
    (text, source) => {
      expect(
        convertNetlist({
          text,
          source,
          target: source === "spice" ? "spectre" : "spice",
        }),
      ).toMatchObject({
        status: "blocked",
        issues: [{ code: "NODE_CASE_COLLISION" }],
      });
    },
  );
  it("handles the first-line title only for an explicitly complete SPICE deck", () => {
    const result = convertNetlist({
      text: "A deck title\nR1 a 0 1k\n.end",
      source: "spice",
      target: "spectre",
      fragment: false,
    });
    expect(result).toMatchObject({
      status: "converted",
      text: expect.stringContaining("R1 (a 0) resistor r=1000"),
    });
    expect(
      convertNetlist({ text: ".subckt", source: "spice", target: "spectre" })
        .status,
    ).toBe("blocked");
  });
  it("adds a deck terminator only when requested and bounds input size", () => {
    expect(converted("R1 (a 0) resistor r=1k")).not.toContain(".end");
    expect(converted("R1 (a 0) resistor r=1k", "spectre", false)).toContain(
      ".end\n",
    );
    expect(
      convertNetlist({
        text: "*".repeat(MAX_CONVERSION_BYTES + 1),
        source: "spice",
        target: "spectre",
      }).status,
    ).toBe("blocked");
  });
});
