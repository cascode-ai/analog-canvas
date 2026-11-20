import { describe, expect, it } from "vitest";
import { buildProjectConnectivityIndex, runErcChecks } from "@icm/derived";
import type { CircuitProject } from "@icm/model";
import { analyzeDesignNetlist, createDesignNetlistExport } from "@icm/netlist";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { importNetlistSources } from "./netlist-source-import.js";

function erc(project: CircuitProject) {
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  return runErcChecks(
    project,
    buildProjectConnectivityIndex(project, resolver),
    resolver,
  );
}

const file = (path: string, text: string) => ({
  path,
  bytes: new TextEncoder().encode(text),
});

function importedProject(
  result: Awaited<ReturnType<typeof importNetlistSources>>,
) {
  if (result.status !== "imported")
    throw new Error(
      result.diagnostics.map(({ message }) => message).join("\n"),
    );
  return result.project;
}

function carriedModels(project: Parameters<typeof analyzeDesignNetlist>[0]) {
  return (analyzeDesignNetlist(project).ir?.cells ?? []).flatMap((cell) =>
    (cell.models ?? []).map((model) => model.name),
  );
}

describe("netlist source import: model evidence", () => {
  it("gives an imported model no card declares no Canvas stand-in, even one named NMOS", async () => {
    const project = importedProject(
      await importNetlistSources(
        [
          file(
            "top.sp",
            "* absent model\n.subckt top d g s b\nM1 d g s b NMOS w=1u l=30n\n.ends top\n",
          ),
        ],
        "top.sp",
        { modelTypes: { NMOS: "nmos" } },
      ),
    );
    expect(carriedModels(project)).toEqual([]);
  });

  it("keeps the stand-in of a netlist Canvas wrote, imported again (#1789)", async () => {
    const project = importedProject(
      await importNetlistSources(
        [
          file(
            "top.sp",
            "* written by Canvas\n.subckt top d g s b\nM1 d g s b NMOS w=1u l=30n\n.model NMOS nmos level=54\n.ends top\n",
          ),
        ],
        "top.sp",
      ),
    );
    expect(carriedModels(project)).toEqual(["NMOS"]);
  });

  it("hands out an imported model's reference without a card, and says so", async () => {
    const project = importedProject(
      await importNetlistSources(
        [
          file(
            "top.sp",
            "* pdk model\n.subckt top d g s b\nM1 d g s b nch_mac w=1u l=30n\n.ends top\n",
          ),
        ],
        "top.sp",
        { modelTypes: { nch_mac: "nmos" } },
      ),
    );
    const design = analyzeDesignNetlist(project);
    expect(carriedModels(project)).toEqual([]);
    expect(design.ir?.cells[0]?.instances[0]?.target).toBe("nch_mac");
    expect(
      design.diagnostics.find(({ code }) => code === "IMPORTED_MODEL_EXTERNAL"),
    ).toMatchObject({
      severity: "info",
      message: expect.stringContaining("M1 names nch_mac"),
    });
  });

  it("refuses a run whose files do not define an imported model, naming the part", async () => {
    const project = importedProject(
      await importNetlistSources(
        [
          file(
            "top.sp",
            "* pdk model\n.subckt top d g s b\nM1 d g s b nch_mac w=1u l=30n\n.ends top\n",
          ),
        ],
        "top.sp",
        { modelTypes: { nch_mac: "nmos" } },
      ),
    );
    const missing = (deckSources: string[]) =>
      analyzeDesignNetlist(project, { deckSources }).diagnostics.find(
        ({ code }) => code === "IMPORTED_MODEL_MISSING",
      );
    expect(missing([])).toMatchObject({
      severity: "error",
      message: expect.stringContaining("M1 names nch_mac"),
    });
    expect(missing([".model nch_mac nmos level=54\n"])).toBeUndefined();
  });

  it("keeps a PDK model's parameters as written and checks none it has no schema for", async () => {
    const project = importedProject(
      await importNetlistSources(
        [
          file(
            "top.sp",
            "* pdk parameters\n.subckt top d g s b\nM1 d g s b nch_mac w=1u l=30n ad=1p AS=1p nrd=0.1 multi=2 dfm_flag=1\n.ends top\n",
          ),
        ],
        "top.sp",
        { modelTypes: { nch_mac: "nmos" } },
      ),
    );
    const m1 = project.documents
      .flatMap((document) => document.instances)
      .find((instance) => instance.reference === "M1")!;
    expect(m1.netlist?.parameters).toMatchObject({
      w: "1u",
      l: "30n",
      ad: "1p",
      as: "1p",
      nrd: "0.1",
      multi: "2",
      dfm_flag: "1",
    });
    const findings = erc(project);
    expect(
      findings.filter(({ code }) => code === "ERC_UNKNOWN_DEVICE_PARAMETER"),
    ).toEqual([]);
    expect(
      findings.filter(
        ({ code }) => code === "ERC_UNVERIFIED_DEVICE_PARAMETERS",
      ),
    ).toEqual([
      expect.objectContaining({
        severity: "info",
        message: expect.stringContaining(
          "M1 (nch_mac): ad, as, nrd, multi, dfm_flag",
        ),
      }),
    ]);
  });

  it("raises no ERC error for a typed PDK model a library outside the sources holds", async () => {
    const project = importedProject(
      await importNetlistSources(
        [
          file(
            "top.sp",
            "* pdk model\n.subckt top d g s b\nM1 d g s b nch_mac w=1u l=30n\n.ends top\n",
          ),
        ],
        "top.sp",
        { modelTypes: { nch_mac: "nmos" } },
      ),
    );
    expect(
      erc(project).filter(({ severity }) => severity === "error"),
    ).toEqual([]);
  });

  it("keeps checking a part placed in Canvas against its own parameters", async () => {
    const project = importedProject(
      await importNetlistSources(
        [
          file(
            "top.sp",
            "* pdk parameters\n.subckt top d g s b\nM1 d g s b nch_mac w=1u l=30n ad=1p\n.ends top\n",
          ),
        ],
        "top.sp",
        { modelTypes: { nch_mac: "nmos" } },
      ),
    );
    // The author chooses a Canvas model for it: its parameters are that
    // model's again.
    const m1 = project.documents[0]!.instances.find(
      (instance) => instance.reference === "M1",
    )!;
    m1.netlist = {
      ...m1.netlist!,
      binding: { kind: "model", deviceClass: "mos", name: "NMOS" },
    };
    expect(
      erc(project).filter(
        ({ code }) => code === "ERC_UNKNOWN_DEVICE_PARAMETER",
      ),
    ).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("unknown parameter ad"),
      }),
    ]);
  });

  it("keeps the author's own card of a generic name as the author's", async () => {
    const project = importedProject(
      await importNetlistSources(
        [
          file(
            "top.sp",
            "* author's card\n.subckt top d g s b\nM1 d g s b NMOS w=1u l=30n\n.ends top\n.model NMOS nmos level=1 vto=0.5\n",
          ),
        ],
        "top.sp",
      ),
    );
    expect(carriedModels(project)).toEqual([]);
  });
});

function fates(result: Awaited<ReturnType<typeof importNetlistSources>>) {
  return result.ledger.entries.map(
    ({ path, line, fate }) => `${path}:${line} ${fate}`,
  );
}

describe("netlist source import: statement ledger", () => {
  it("gives every statement of a SPICE netlist exactly one fate", async () => {
    const result = await importNetlistSources(
      [
        file(
          "top.sp",
          [
            "Ledger example",
            ".param gain=2 flag=0",
            ".model nfet nmos level=1",
            ".subckt amp in out vdd vss",
            "M1 out in vss vss nfet w=1u l=1u",
            "R1 vdd out 10k",
            ".ends amp",
            "X1 a b vdd 0 amp",
            "V1 vdd 0 1.8",
            ".if missing_flag",
            "R2 a 0 1k",
            ".endif",
            ".if flag",
            "R3 a 0 1k",
            ".endif",
            "A1 a b xmod",
            ".tran 1n 10n",
            ".end",
          ].join("\n"),
        ),
      ],
      "top.sp",
    );
    expect(result.status).toBe("imported");
    expect(fates(result)).toEqual([
      "top.sp:1 preserved",
      "top.sp:2 declaration",
      "top.sp:3 declaration",
      "top.sp:4 definition",
      "top.sp:5 instance",
      "top.sp:6 instance",
      "top.sp:7 definition",
      "top.sp:8 instance",
      "top.sp:9 instance",
      "top.sp:10 unresolved",
      "top.sp:11 unresolved",
      "top.sp:12 unresolved",
      "top.sp:13 preserved",
      "top.sp:14 preserved",
      "top.sp:15 preserved",
      "top.sp:16 unresolved",
      "top.sp:17 preserved",
      "top.sp:18 preserved",
    ]);
    expect(result.ledger.complete).toBe(true);
    expect(
      result.diagnostics.find(({ code }) => code === "SPICE_IMPORT_COVERAGE"),
    ).toMatchObject({
      severity: "warning",
      message:
        "18 statements: 4 instance, 2 definition, 2 declaration, 6 preserved, 4 unresolved (top.sp:10, top.sp:11, top.sp:12, top.sp:16)",
    });
  });

  it("refuses a Spectre file it cannot convert with its location, and keeps the Project as it was", async () => {
    const result = await importNetlistSources(
      [file("top.scs", "simulator lang=spectre\nR1 (a A) resistor r=1k\n")],
      "top.scs",
    );
    expect(result.status).toBe("refused");
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: "error",
        message: expect.stringContaining("top.scs:2"),
      }),
    ]);
  });

  it("accounts for a Spectre file by its own lines, statements with no SPICE form included", async () => {
    const result = await importNetlistSources(
      [
        file(
          "top.scs",
          [
            "simulator lang=spectre",
            "global 0 vdd!",
            "subckt inv in out vdd vss",
            "M1 (out in vss vss) nch w=1u l=30n",
            "ends inv",
            "model nch bsim3v3 type=n",
            "I0 (a b vdd! 0) inv",
            "tran1 tran step=1n stop=10n",
          ].join("\n"),
        ),
      ],
      "top.scs",
    );
    expect(result.status).toBe("imported");
    expect(fates(result)).toEqual([
      "top.scs:1 preserved",
      "top.scs:2 declaration",
      "top.scs:3 definition",
      "top.scs:4 instance",
      "top.scs:5 definition",
      "top.scs:6 declaration",
      "top.scs:7 instance",
      "top.scs:8 preserved",
    ]);
    expect(result.ledger.complete).toBe(true);
  });
});

function instanceNamed(project: CircuitProject, reference: string) {
  return project.documents
    .flatMap((document) => document.instances)
    .find((instance) => instance.reference === reference)!;
}

function masterOf(project: CircuitProject, reference: string) {
  const binding = instanceNamed(project, reference).netlist?.binding;
  return binding?.kind === "external-subcircuit"
    ? project.externalSubcircuitDefinitions.find(
        ({ id }) => id === binding.definitionId,
      )?.name
    : undefined;
}

describe("netlist source import: Spectre masters", () => {
  it("imports a master it does not know as an external call: its name, ordered ports, parameters and location", async () => {
    const result = await importNetlistSources(
      [
        file(
          "top.scs",
          [
            "simulator lang=spectre",
            "subckt top a b c",
            "C1 (a b) cfmom_2t nr=8 lr=2u w=50n s=50n multi=2",
            "R1 (b c) rupolym l=17.13u w=1u m=1 multi=(2)",
            "I0 (a c) external_cell",
            "ends top",
          ].join("\n"),
        ),
      ],
      "top.scs",
    );
    const project = importedProject(result);
    expect(["C1", "R1", "I0"].map((name) => masterOf(project, name))).toEqual([
      "cfmom_2t",
      "rupolym",
      "external_cell",
    ]);
    expect(instanceNamed(project, "C1").netlist?.parameters).toEqual({
      nr: "8",
      lr: "2u",
      w: "50n",
      s: "50n",
      multi: "2",
    });
    expect(
      instanceNamed(project, "R1").importProvenance?.terminalMapping?.map(
        ({ sourcePosition }) => sourcePosition,
      ),
    ).toEqual([0, 1]);
    expect(fates(result)).toEqual([
      "top.scs:1 preserved",
      "top.scs:2 definition",
      "top.scs:3 instance",
      "top.scs:4 instance",
      "top.scs:5 instance",
      "top.scs:6 definition",
    ]);
    // A netlist handed out to run still refuses calls without bodies, naming
    // each; an interchange file prints them as the source wrote them.
    const handedOut = createDesignNetlistExport(project, { format: "spectre" });
    expect(handedOut.status).toBe("blocked");
    expect(
      handedOut.diagnostics
        .filter(({ code }) => code === "MODEL_LEGACY_IMPLEMENTATION_UNVERIFIED")
        .map(({ message }) => message)
        .join("\n"),
    ).toMatch(/cfmom_2t[\s\S]*rupolym[\s\S]*external_cell|cfmom_2t/u);
    const interchange = createDesignNetlistExport(project, {
      format: "spectre",
      callsWithoutBodies: true,
    });
    // Named parameters print in the printer's order, each as written.
    const printed = interchange.status === "ready" ? interchange.file.text : "";
    expect(printed).toContain(
      "C1 (a b) cfmom_2t lr=2u multi=2 nr=8 s=50n w=50n",
    );
    expect(printed).toContain("R1 (b c) rupolym l=17.13u m=1 multi=(2) w=1u");
    expect(printed).toContain("I0 (a c) external_cell");
  });

  it("classifies a call by its declaration in another file of the design", async () => {
    const project = importedProject(
      await importNetlistSources(
        [
          file(
            "top.scs",
            [
              "simulator lang=spectre",
              'include "cells.scs"',
              'include "models.scs"',
              "subckt top a b d g s",
              "I0 (a b) mycell",
              "M1 (d g s s) nch w=1u l=30n",
              "ends top",
            ].join("\n"),
          ),
          file(
            "cells.scs",
            "simulator lang=spectre\nsubckt mycell x y\nR0 (x y) resistor r=1k\nends mycell\n",
          ),
          file(
            "models.scs",
            "simulator lang=spectre\nmodel nch bsim3v3 type=n\n",
          ),
        ],
        "top.scs",
      ),
    );
    expect(instanceNamed(project, "XI0").netlist?.binding?.kind).toBe(
      "subcircuit",
    );
    expect(instanceNamed(project, "M1").symbolId).toBe("nmos");
  });

  it("brings a MOS no declaration names in as a call, and as the device the caller types", async () => {
    const netlist = file(
      "top.scs",
      "simulator lang=spectre\nsubckt top d g s b\nM1 (d g s b) nch_mac w=1u l=30n\nends top\n",
    );
    const untyped = await importNetlistSources([netlist], "top.scs");
    expect(masterOf(importedProject(untyped), "M1")).toBe("nch_mac");
    expect(
      untyped.diagnostics.find(
        ({ code }) => code === "SPICE_IMPORT_EXTERNAL_CALLS",
      )?.message,
    ).toContain("No declaration in the design names nch_mac (M1)");
    const typed = importedProject(
      await importNetlistSources([netlist], "top.scs", {
        modelTypes: { nch_mac: "nmos" },
      }),
    );
    expect(instanceNamed(typed, "M1").symbolId).toBe("nmos");
  });

  it("lists every refusal of every file, each with its location", async () => {
    const result = await importNetlistSources(
      [
        file(
          "top.scs",
          'simulator lang=spectre\ninclude "leaf.scs"\nR1 (a A) resistor r=1k\n',
        ),
        file(
          "leaf.scs",
          "simulator lang=spectre\nR2 (b 0) resistor r=1k tc1=1\nR3 (c C) resistor r=1k\n",
        ),
      ],
      "top.scs",
    );
    expect(result.status).toBe("refused");
    expect(
      result.diagnostics
        .filter(({ severity }) => severity === "error")
        .map(({ message }) => message.split(":").slice(0, 2).join(":")),
    ).toEqual(["top.scs:3", "leaf.scs:2", "leaf.scs:3"]);
  });

  it("keeps statements outside the drawing that have no SPICE form, without refusing the design", async () => {
    const result = await importNetlistSources(
      [
        file(
          "top.scs",
          [
            "simulator lang=spectre",
            'ahdl_include "block.va"',
            "subckt top a b",
            "R1 (a b) resistor r=1k",
            "U1 (a b) va_block gain=2",
            "ends top",
            "save a b",
            "simulatorOptions options reltol=1e-3",
            "tran1 tran stop=10n",
            "noise1 (a 0) noise start=1 stop=1G",
          ].join("\n"),
        ),
      ],
      "top.scs",
    );
    expect(result.status).toBe("imported");
    expect(fates(result)).toEqual([
      "top.scs:1 preserved",
      "top.scs:2 declaration",
      "top.scs:3 definition",
      "top.scs:4 instance",
      "top.scs:5 instance",
      "top.scs:6 definition",
      "top.scs:7 preserved",
      "top.scs:8 preserved",
      "top.scs:9 preserved",
      "top.scs:10 preserved",
    ]);
    expect(masterOf(importedProject(result), "U1")).toBe("va_block");
  });

  it("reads a Spectre library's sections as the sections an include selects", async () => {
    const project = importedProject(
      await importNetlistSources(
        [
          file(
            "top.scs",
            'simulator lang=spectre\ninclude "lib.scs" section=tt\nsubckt top d g s b\nM1 (d g s b) nch w=1u l=30n\nends top\n',
          ),
          file(
            "lib.scs",
            "simulator lang=spectre\nlibrary corners\nsection tt\nmodel nch bsim3v3 type=n\nendsection tt\nsection ff\nmodel nch bsim3v3 type=n\nendsection ff\nendlibrary corners\n",
          ),
        ],
        "top.scs",
      ),
    );
    expect(instanceNamed(project, "M1").symbolId).toBe("nmos");
  });

  it("refuses names one file spells in another case, as SPICE would join them", async () => {
    const result = await importNetlistSources(
      [
        file(
          "top.scs",
          'simulator lang=spectre\ninclude "leaf.scs"\nsubckt top a\nR1 (a vdd!) resistor r=1k\nX1 (a) leaf\nends top\n',
        ),
        file(
          "leaf.scs",
          "simulator lang=spectre\nsubckt leaf a\nR2 (a VDD!) resistor r=1k\nends leaf\nsubckt Leaf a\nR3 (a 0) resistor r=1k\nends Leaf\n",
        ),
      ],
      "top.scs",
    );
    expect(result.status).toBe("refused");
    expect(
      result.diagnostics
        .filter(({ severity }) => severity === "error")
        .map(({ message }) => message),
    ).toEqual([
      "Names differ only in case, which SPICE reads as one: vdd! (top.scs:4), VDD! (leaf.scs:3)",
      "Names differ only in case, which SPICE reads as one: leaf (leaf.scs:2), Leaf (leaf.scs:5)",
    ]);
  });

  it("refuses one master called with two port counts, naming each call", async () => {
    const result = await importNetlistSources(
      [
        file(
          "top.scs",
          "simulator lang=spectre\nsubckt top a b c\nXA (a b) blk\nXB (a b c) blk\nends top\n",
        ),
      ],
      "top.scs",
    );
    expect(result.status).toBe("refused");
    expect(result.diagnostics[0]?.message).toBe(
      "blk is called with 2 and 3 ports: top.scs:3 XA (2), top.scs:4 XB (3)",
    );
  });
});

describe("netlist source import: SPICE device cards without a model card", () => {
  const spice = (body: string) =>
    file("top.sp", `* untyped\n.subckt top a b c d\n${body}\n.ends top\n`);

  it("brings in a MOS card of unknown type as a MOS box, its pins in SPICE's order, printed as the card it was", async () => {
    const result = await importNetlistSources(
      [spice("M1 a b c d nch_mac w=1u l=30n")],
      "top.sp",
    );
    const project = importedProject(result);
    const m1 = instanceNamed(project, "M1");
    const component = project.componentDefinitions?.find(
      ({ symbol }) => symbol.id === m1.symbolId,
    );
    expect(component?.electrical).toMatchObject({
      deviceClass: "mos",
      referencePrefix: "M",
      pinOrder: ["D", "G", "S", "B"],
      targetPolicy: "required-model",
    });
    expect(component?.electrical?.mosBulkClass).toBeUndefined();
    expect(
      m1.importProvenance?.terminalMapping?.map(({ pinName }) => pinName),
    ).toEqual(["D", "G", "S", "B"]);
    expect(carriedModels(project)).toEqual([]);
    const exported = createDesignNetlistExport(project, { format: "spice" });
    expect(exported.status === "ready" ? exported.file.text : "").toMatch(
      /^M1 a b c d nch_mac /mu,
    );
    const finding = result.diagnostics.find(
      ({ code }) => code === "SPICE_IMPORT_UNTYPED_DEVICE",
    );
    expect(finding).toMatchObject({ severity: "warning" });
    expect(finding?.message).toContain("M1 uses nch_mac");
    expect(finding?.message).toContain("include the library that defines it");
    expect(
      result.diagnostics.map(({ message }) => message).join("\n"),
    ).not.toMatch(/\.model|bsim4/u);
  });

  it("brings in a BJT card of unknown type as a BJT box", async () => {
    const project = importedProject(
      await importNetlistSources([spice("Q1 a b c qmod")], "top.sp"),
    );
    const q1 = instanceNamed(project, "Q1");
    expect(
      project.componentDefinitions?.find(
        ({ symbol }) => symbol.id === q1.symbolId,
      )?.electrical,
    ).toMatchObject({ deviceClass: "bjt", pinOrder: ["C", "B", "E"] });
  });

  it("brings in a diode card as the diode SPICE says it is, its model the reader's", async () => {
    const project = importedProject(
      await importNetlistSources([spice("D1 a b dmod")], "top.sp"),
    );
    expect(instanceNamed(project, "D1").symbolId).toBe("diode");
    const exported = createDesignNetlistExport(project, { format: "spice" });
    expect(exported.status === "ready" ? exported.file.text : "").toMatch(
      /^D1 a b dmod$/mu,
    );
  });
});

describe("netlist source import: limits", () => {
  it("refuses a part with more terminals than a part takes, naming it and its line", async () => {
    const ports = Array.from({ length: 130 }, (_, index) => `p${index}`);
    const result = await importNetlistSources(
      [
        file(
          "top.sp",
          [
            "* wide block",
            `.subckt big ${ports.join(" ")}`,
            "R1 p0 p1 1k",
            ".ends big",
            `.subckt top ${ports.join(" ")}`,
            `X1 ${ports.join(" ")} big`,
            ".ends top",
          ].join("\n"),
        ),
      ],
      "top.sp",
    );
    expect(result.status).toBe("refused");
    expect(
      result.diagnostics.filter(({ severity }) => severity === "error"),
    ).toEqual([
      expect.objectContaining({
        code: "SPICE_IMPORT_LIMIT",
        message:
          "X1 has 130 terminals; a part takes at most 128, so the design cannot be imported as it is",
      }),
    ]);
  });
});
