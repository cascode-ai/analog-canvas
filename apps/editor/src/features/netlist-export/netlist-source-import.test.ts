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
