import { describe, expect, it } from "vitest";

import {
  projectLengthToSky130Micrometres,
  resolveReviewedExternalBinding,
  reviewedExternalBindingForMaster,
  reviewedExternalBindingSupportsSymbol,
  reviewedExternalModelSuggestions,
  sky130MicrometresToProjectLength,
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
