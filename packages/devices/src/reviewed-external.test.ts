import { readFileSync } from "node:fs";
import { delimiter } from "node:path";
import { describe, expect, it } from "vitest";

import {
  resolveReviewedLibraryInterface,
  projectLengthToSky130Micrometres,
  resolveReviewedExternalBinding,
  reviewedExternalBindingById,
  reviewedExternalBindingForMaster,
  reviewedExternalBindingSupportsSymbol,
  reviewedExternalModelSuggestions,
  sky130MicrometresToProjectLength,
  standardCellBindingForMaster,
} from "./reviewed-external.js";

describe("reviewed external device bindings", () => {
  it("recognizes only exact reviewed names and exact public interfaces", () => {
    expect(
      resolveReviewedExternalBinding("sky130_fd_pr__res_high_po", [
        "R0",
        "R1",
        "B",
      ]),
    ).toMatchObject({
      id: "sky130-res-high-po",
      symbolId: "resistor",
      terminals: [
        { targetName: "R0", pinName: "1", interaction: "canvas" },
        { targetName: "R1", pinName: "2", interaction: "canvas" },
        { targetName: "B", pinName: "B", interaction: "property" },
      ],
    });
    expect(
      resolveReviewedExternalBinding("sky130_fd_pr__res_high_po", [
        "R1",
        "R0",
        "B",
      ]),
    ).toBeUndefined();
    expect(
      reviewedExternalBindingForMaster("sky130_fd_pr__nfet_g5v0d10v5"),
    ).toMatchObject({
      id: "sky130-nfet-g5v0d10v5",
      symbolId: "nmos",
      deviceClass: "mos",
    });
    expect(
      resolveReviewedExternalBinding("sky130_fd_pr__cap_var_lvt", [
        "C0",
        "C1",
        "B",
      ]),
    ).toMatchObject({
      id: "sky130-cap-var-lvt",
      symbolId: "capacitor",
    });
    expect(
      resolveReviewedExternalBinding("sky130_fd_pr__ind_05_220", [
        "A",
        "B",
        "CT",
        "SUB",
      ]),
    ).toMatchObject({
      id: "sky130-ind-05-220",
      symbolId: "inductor",
      terminals: [
        { pinName: "1", interaction: "canvas" },
        { pinName: "2", interaction: "canvas" },
        { pinName: "CT", interaction: "property", role: "floating" },
        { pinName: "SUB", interaction: "property", role: "substrate" },
      ],
    });
    expect(
      resolveReviewedExternalBinding("sky130_fd_pr__pnp_05v5_W0p68L0p68", [
        "C",
        "B",
        "E",
      ]),
    ).toMatchObject({
      id: "sky130-pnp-05v5-w0p68l0p68",
      symbolId: "pnp",
      deviceClass: "bjt",
      terminals: [
        { pinName: "C", interaction: "canvas" },
        { pinName: "B", interaction: "canvas" },
        { pinName: "E", interaction: "canvas" },
      ],
    });
    expect(
      resolveReviewedExternalBinding("sky130_fd_pr__npn_05v5_W1p00L1p00", [
        "C",
        "B",
        "E",
        "S",
      ]),
    ).toMatchObject({
      id: "sky130-npn-05v5-w1p00l1p00",
      symbolId: "npn",
      deviceClass: "bjt",
    });
    expect(
      resolveReviewedExternalBinding("sky130_fd_pr__pnp_05v5_W0p68L0p68", [
        "C",
        "B",
        "E",
        "S",
      ]),
    ).toBeUndefined();
  });

  it("offers the varactor on the plain capacitor and no model on the generic Var Cap (#1298)", () => {
    // A Var Cap is any tunable capacitance — a switched MOM or MIM bank, MOS
    // capacitors, or a varactor — and its pins are P1/P2, which the
    // varactor's C0/C1 (pins 1/2) are not.
    const varactor = reviewedExternalBindingForMaster(
      "sky130_fd_pr__cap_var_lvt",
    )!;
    expect(reviewedExternalModelSuggestions("capacitor")).toContain(
      "sky130_fd_pr__cap_var_lvt",
    );
    expect(reviewedExternalBindingSupportsSymbol(varactor, "capacitor")).toBe(
      true,
    );
    expect(reviewedExternalModelSuggestions("variable-capacitor")).toEqual([]);
    expect(
      reviewedExternalBindingSupportsSymbol(varactor, "variable-capacitor"),
    ).toBe(false);
  });

  it("draws SKY130's drain-extended devices as DMOS", () => {
    expect(reviewedExternalModelSuggestions("ndmos")).toEqual([
      "sky130_fd_pr__nfet_g5v0d16v0",
      "sky130_fd_pr__nfet_20v0",
      "sky130_fd_pr__nfet_20v0_nvt",
      "sky130_fd_pr__nfet_20v0_zvt",
    ]);
    expect(reviewedExternalModelSuggestions("pdmos")).toEqual([
      "sky130_fd_pr__pfet_g5v0d16v0",
      "sky130_fd_pr__pfet_20v0",
    ]);
    // 16 V keeps binned geometry and nests its MOSFET one level down.
    expect(
      resolveReviewedExternalBinding("sky130_fd_pr__nfet_g5v0d16v0", [
        "D",
        "G",
        "S",
        "B",
      ]),
    ).toMatchObject({
      id: "sky130-nfet-g5v0d16v0",
      deviceClass: "mos",
      nativeElement: "xmain1.msky130_fd_pr__nfet_g5v0d16v0__base",
      parameters: [
        { name: "w", defaultValue: "5u", targetDefaultValue: "5" },
        { name: "l", defaultValue: "700n", targetDefaultValue: "0.7" },
        { name: "nf" },
        { name: "m" },
      ],
    });
    // 20 V fixes its channel inside the wrapper: only the count is offered.
    expect(
      reviewedExternalBindingForMaster("sky130_fd_pr__pfet_20v0"),
    ).toMatchObject({
      symbolId: "pdmos",
      nativeElement: "m1",
      parameters: [{ name: "m", defaultValue: "1" }],
    });
    // The plain MOS symbols keep only the core and 10.5 V models.
    expect(reviewedExternalModelSuggestions("nmos")).not.toContain(
      "sky130_fd_pr__nfet_g5v0d16v0",
    );
  });

  it("converts reviewed geometry in both directions without aliasing counts", () => {
    expect(projectLengthToSky130Micrometres("150n")).toBe("0.15");
    expect(projectLengthToSky130Micrometres("{WIDTH}")).toBe("{(WIDTH) / 1u}");
    expect(sky130MicrometresToProjectLength("{WIDTH}")).toBe("{(WIDTH) * 1u}");
    expect(
      projectLengthToSky130Micrometres(
        sky130MicrometresToProjectLength("{WIDTH * 2}"),
      ),
    ).toBe("{WIDTH * 2}");
    expect(
      sky130MicrometresToProjectLength(
        projectLengthToSky130Micrometres("{WIDTH * 2}"),
      ),
    ).toBe("{WIDTH * 2}");
    expect(projectLengthToSky130Micrometres("5.5u")).toBe("5.5");
    expect(sky130MicrometresToProjectLength("0.15")).toBe("150n");
    expect(sky130MicrometresToProjectLength("5.5")).toBe("5.5u");
    expect(() => sky130MicrometresToProjectLength("150n")).toThrow(
      /plain micrometre/u,
    );
    expect(
      reviewedExternalBindingForMaster(
        "sky130_fd_pr__nfet_01v8",
      )?.parameters.map((parameter) => parameter.name),
    ).toEqual(["w", "l", "nf", "m"]);
    expect(
      reviewedExternalBindingForMaster(
        "sky130_fd_pr__nfet_01v8",
      )?.parameters.map((parameter) => [
        parameter.name,
        parameter.targetDefaultValue,
      ]),
    ).toEqual([
      ["w", "1"],
      ["l", "0.15"],
      ["nf", "1"],
      ["m", "1"],
    ]);
    expect(
      reviewedExternalBindingForMaster(
        "sky130_fd_pr__pfet_01v8_lvt",
      )?.parameters.map((parameter) => [
        parameter.name,
        parameter.defaultValue,
        parameter.targetDefaultValue,
      ]),
    ).toEqual([
      ["w", "3u", "3"],
      ["l", "350n", "0.35"],
      ["nf", "1", "1"],
      ["m", "1", "1"],
    ]);
  });

  it("binds IHP SG13G2 devices with the interfaces of the PDK's own ngspice models", () => {
    // `.subckt` lines and xschem parameter order of IHP-Open-PDK
    // ihp-sg13g2/libs.tech (5e6d592e, 2026-09-01).
    const pdk: Record<string, [string, string[], string[]]> = {
      sg13_lv_nmos: ["nmos", ["d", "g", "s", "b"], ["w", "l", "ng", "m"]],
      sg13_lv_pmos: ["pmos", ["d", "g", "s", "b"], ["w", "l", "ng", "m"]],
      sg13_hv_nmos: ["nmos", ["d", "g", "s", "b"], ["w", "l", "ng", "m"]],
      sg13_hv_pmos: ["pmos", ["d", "g", "s", "b"], ["w", "l", "ng", "m"]],
      npn13G2: ["npn", ["c", "b", "e", "bn"], ["le", "we", "Nx"]],
      npn13G2l: ["npn", ["c", "b", "e", "bn"], ["le", "we", "Nx"]],
      npn13G2v: ["npn", ["c", "b", "e", "bn"], ["le", "we", "Nx"]],
      pnpMPA: ["pnp", ["c", "b", "e"], ["a", "p", "m"]],
      rsil: ["resistor", ["1", "2", "bn"], ["w", "l", "m"]],
      rppd: ["resistor", ["1", "2", "bn"], ["w", "l", "b", "m"]],
      rhigh: ["resistor", ["1", "2", "bn"], ["w", "l", "b", "m"]],
      cap_cmim: ["capacitor", ["PLUS", "MINUS"], ["w", "l", "m"]],
      cap_rfcmim: [
        "capacitor",
        ["PLUS", "MINUS", "bn"],
        ["w", "l", "wfeed", "m"],
      ],
    };
    for (const [master, [symbolId, terminals, parameters]] of Object.entries(
      pdk,
    )) {
      const binding = resolveReviewedExternalBinding(master, terminals);
      expect(binding, master).toMatchObject({
        libraryId: "sg13g2_pr",
        symbolId,
        invocationKind: "external-subcircuit",
      });
      expect(
        binding!.parameters
          .toSorted((left, right) => left.spiceOrder - right.spiceOrder)
          .map((parameter) => parameter.name),
        master,
      ).toEqual(parameters);
      // Metres in the Project and in the PDK: nothing is converted.
      expect(
        binding!.parameters.every((parameter) => !parameter.targetUnit),
        master,
      ).toBe(true);
      // The substrate is a property terminal, never a drawn pin.
      for (const terminal of binding!.terminals.filter(
        (item) => item.targetName === "bn",
      ))
        expect(terminal).toMatchObject({
          interaction: "property",
          role: "substrate",
        });
    }
    expect(
      reviewedExternalBindingForMaster("sg13_lv_nmos")!.terminals.map(
        (terminal) => terminal.pinName,
      ),
    ).toEqual(["D", "G", "S", "B"]);
    expect(
      reviewedExternalBindingForMaster("npn13G2")!.parameters.map((item) => [
        item.name,
        item.defaultValue,
      ]),
    ).toEqual([
      ["le", "900n"],
      ["we", "70n"],
      ["Nx", "1"],
    ]);
  });

  it("suggests the models of one PDK library when asked", () => {
    expect(reviewedExternalModelSuggestions("nmos", "sg13g2_pr")).toEqual([
      "sg13_lv_nmos",
      "sg13_hv_nmos",
    ]);
    expect(
      reviewedExternalModelSuggestions("nmos", "sky130_fd_pr"),
    ).not.toContain("sg13_lv_nmos");
    expect(reviewedExternalModelSuggestions("nmos")).toEqual(
      expect.arrayContaining(["sky130_fd_pr__nfet_01v8", "sg13_lv_nmos"]),
    );
  });
});

describe("standard cells behind Library gates (#1450)", () => {
  const order = (name: string) =>
    standardCellBindingForMaster(name)?.terminals.map((terminal) =>
      [terminal.targetName, terminal.pinName, terminal.supply ?? ""].join(":"),
    );

  it("reads each library's pin order from the cell name alone", () => {
    expect(order("sky130_fd_sc_hd__nand2_1")).toEqual([
      "A:A:",
      "B:B:",
      "VGND:VSS:VSS",
      "VNB:VSS:VSS",
      "VPB:VDD:VDD",
      "VPWR:VDD:VDD",
      "Y:Y:",
    ]);
    // SKY130 names xnor3's output X although xnor2's is Y.
    expect(order("sky130_fd_sc_hd__xnor3_4")?.at(-1)).toBe("X:Y:");
    expect(order("sky130_fd_sc_hd__xnor2_1")?.at(-1)).toBe("Y:Y:");
    expect(order("sg13g2_or3_2")).toEqual([
      "X:Y:",
      "A:A:",
      "B:B:",
      "C:C:",
      "VDD:VDD:VDD",
      "VSS:VSS:VSS",
    ]);
    expect(order("CKND2D1BWP12T30P140LVT")).toEqual([
      "A1:A:",
      "A2:B:",
      "ZN:Y:",
      "VDD:VDD:VDD",
      "VSS:VSS:VSS",
    ]);
    expect(order("INVD1P25BWP12T30P140")?.slice(0, 2)).toEqual([
      "I:A:",
      "ZN:Y:",
    ]);
    expect(order("XOR3OPTND2BWP12T30P140")?.at(3)).toBe("Z:Y:");
  });

  it("stands each cell behind the gate of its function and input count", () => {
    const gate = (name: string) => standardCellBindingForMaster(name)?.symbolId;
    expect(gate("sky130_fd_sc_hd__inv_16")).toBe("inverter");
    expect(gate("sg13g2_buf_8")).toBe("buffer");
    expect(gate("CKBD4BWP12T30P140")).toBe("buffer");
    // Clock, delay, ECO and level-shifting cells are inverters and buffers.
    for (const name of [
      "sky130_fd_sc_hd__clkinv_2",
      "sky130_fd_sc_hd__clkinvlp_4",
      "sky130_fd_sc_hd__bufinv_8",
      "DCCKND4BWP12T30P140",
      "GINVMCOD1BWP12T30P140LVT",
    ])
      expect(gate(name), name).toBe("inverter");
    for (const name of [
      "sky130_fd_sc_hd__clkbuf_16",
      "sky130_fd_sc_hd__clkdlybuf4s50_1",
      "sky130_fd_sc_hd__dlygate4sd3_1",
      "sky130_fd_sc_hd__dlymetal6s2s_1",
      "sg13g2_dlygate4sd1_1",
      "DEL250D1BWP12T30P140",
      "LVLHLD2BWP12T30P140",
    ])
      expect(gate(name), name).toBe("buffer");
    expect(gate("NR4D2BWP12T30P140")).toBe("nor-gate-4");
    expect(gate("AN2XD16BWP12T30P140LVT")).toBe("and-gate");
    expect(gate("XNR4D1BWP12T30P140")).toBe("xnor-gate-4");
    // Inverted inputs, enables and complex functions have no gate, nor do
    // functions a library does not build, nor a name of the wrong shape.
    for (const name of [
      "sky130_fd_sc_hd__nand2b_1",
      "sky130_fd_sc_hd__xor4_1",
      "sky130_fd_sc_hd__nand_1",
      "sky130_fd_sc_hd__inv2_1",
      "sg13g2_a21oi_1",
      "sg13g2_xor3_1",
      "IND2D1BWP12T30P140",
      "ND1BWP12T30P140",
      "ND2D1BWP12T30P140HVT",
      "LVLHLCD1BWP12T30P140",
    ])
      expect(gate(name), name).toBeUndefined();
  });

  it("reviews a cell only behind its own gate", () => {
    // Imported or drawn as a block, a cell is an ordinary subcircuit.
    expect(
      reviewedExternalBindingForMaster("sky130_fd_sc_hd__nand2_1"),
    ).toBeUndefined();
    expect(
      reviewedExternalBindingForMaster("sky130_fd_sc_hd__nand2_1", "nor-gate"),
    ).toBeUndefined();
    const pins = ["A", "B", "VGND", "VNB", "VPB", "VPWR", "Y"];
    expect(
      resolveReviewedExternalBinding("sky130_fd_sc_hd__nand2_1", pins),
    ).toBeUndefined();
    expect(
      resolveReviewedExternalBinding(
        "sky130_fd_sc_hd__nand2_1",
        pins,
        "nand-gate",
      )?.symbolId,
    ).toBe("nand-gate");
    // Its library supplies the body whichever symbol draws it.
    expect(
      resolveReviewedLibraryInterface("sky130_fd_sc_hd__nand2_1", pins)
        ?.symbolId,
    ).toBe("nand-gate");
    expect(
      resolveReviewedLibraryInterface(
        "sky130_fd_sc_hd__nand2_1",
        pins.toReversed(),
      ),
    ).toBeUndefined();
    expect(
      reviewedExternalBindingForMaster("sky130_fd_pr__nfet_01v8", "nand-gate"),
    ).toBeDefined();
  });

  it("matches names in any case and finds a netlisted cell by its id", () => {
    const cell = standardCellBindingForMaster("nd2d1bwp12t30p140lvt")!;
    expect(cell.masterName).toBe("ND2D1BWP12T30P140LVT");
    expect(standardCellBindingForMaster("SG13G2_NOR2_1")?.masterName).toBe(
      "sg13g2_nor2_1",
    );
    expect(reviewedExternalBindingById(cell.id)).toBe(cell);
    expect(reviewedExternalBindingById("sky130-nfet-01v8")?.masterName).toBe(
      "sky130_fd_pr__nfet_01v8",
    );
    expect(reviewedExternalBindingById(undefined)).toBeUndefined();
  });

  it("suggests the weakest cell of each library, within the Process", () => {
    expect(reviewedExternalModelSuggestions("nand-gate")).toEqual([
      "sky130_fd_sc_hd__nand2_1",
      "sg13g2_nand2_1",
      "ND2D1BWP12T30P140",
    ]);
    expect(
      reviewedExternalModelSuggestions("inverter", "sky130_fd_pr"),
    ).toEqual(["sky130_fd_sc_hd__inv_1"]);
    expect(reviewedExternalModelSuggestions("xor-gate-3", "sg13g2_pr")).toEqual(
      [],
    );
    expect(reviewedExternalModelSuggestions("xor-gate-4")).toEqual([
      "XOR4D1BWP12T30P140",
    ]);
  });

  // Opt-in: ICM_STD_CELL_SPICE lists library netlists (sky130_fd_sc_hd.spice,
  // sg13g2_stdcell.spice, the tcbn28hpcplusbwp12t30p140 .spi), which are not in
  // the repository. Every cell a rule accepts must have exactly the rule's
  // pins, and every suggestion must be a cell of its library.
  it.skipIf(!process.env.ICM_STD_CELL_SPICE)(
    "agrees with every cell of the libraries' own netlists",
    () => {
      const suggestions = [
        "inverter",
        "buffer",
        ...["nand", "nor", "and", "or", "xor", "xnor"].flatMap((fn) => [
          `${fn}-gate`,
          `${fn}-gate-3`,
          `${fn}-gate-4`,
        ]),
      ].flatMap((symbolId) => reviewedExternalModelSuggestions(symbolId));
      for (const path of process.env.ICM_STD_CELL_SPICE!.split(delimiter)) {
        const cells = new Map(
          [
            ...readFileSync(path, "utf8")
              .replace(/\n\+/gu, " ")
              .matchAll(/^\.subckt\s+(\S+)\s+([^\n]*)$/gimu),
          ].map((match) => [
            match[1]!.toLowerCase(),
            match[2]!.trim().split(/\s+/u),
          ]),
        );
        const libraries = new Set<string>();
        let accepted = 0;
        for (const [name, pins] of cells) {
          const binding = standardCellBindingForMaster(name);
          if (!binding) continue;
          accepted += 1;
          libraries.add(binding.libraryId);
          expect(
            binding.terminals.map((terminal) => terminal.targetName),
            name,
          ).toEqual(pins);
        }
        expect(accepted, path).toBeGreaterThan(20);
        for (const suggestion of suggestions)
          if (
            libraries.has(standardCellBindingForMaster(suggestion)!.libraryId)
          )
            expect(cells.has(suggestion.toLowerCase()), suggestion).toBe(true);
        console.log(`${path}: ${accepted} gate cells agree`);
      }
    },
  );
});
