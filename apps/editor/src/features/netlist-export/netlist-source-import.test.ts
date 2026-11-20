import { describe, expect, it } from "vitest";
import { buildProjectConnectivityIndex, runErcChecks } from "@icm/derived";
import type { CircuitProject } from "@icm/model";
import { analyzeDesignNetlist } from "@icm/netlist";
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
      design.diagnostics.find(
        ({ code }) => code === "IMPORTED_MODEL_EXTERNAL",
      ),
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
      findings.filter(({ code }) => code === "ERC_UNVERIFIED_DEVICE_PARAMETERS"),
    ).toEqual([
      expect.objectContaining({
        severity: "info",
        message: expect.stringContaining(
          "M1 (nch_mac): ad, as, nrd, multi, dfm_flag",
        ),
      }),
    ]);
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
      erc(project).filter(({ code }) => code === "ERC_UNKNOWN_DEVICE_PARAMETER"),
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
      severity: "info",
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
