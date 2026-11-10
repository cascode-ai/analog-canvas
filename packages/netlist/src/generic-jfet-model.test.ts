import { describe, expect, it } from "vitest";

import { createEmptyProject, type CircuitProject } from "@icm/model";
import { convertNetlist, importSpiceSources } from "@icm/spice";

import { createDesignNetlistExport, designExtractsNetlist } from "./export.js";
import { analyzeDesignNetlist } from "./extract.js";
import { printVacaskWithLocations } from "./vacask-printer.js";

const NJF_CARD = ".model NJF NJF(VTO=-2 BETA=1e-3 LAMBDA=0.01)";
const PJF_CARD = ".model PJF PJF(VTO=-2 BETA=1e-3 LAMBDA=0.01)";

/** A Cell `dut` of junction FETs in parallel, each bound as a placed one is. */
function jfetProject(
  transistors: ReadonlyArray<{
    id: string;
    reference: string;
    symbolId?: "njfet" | "pjfet";
    model?: string;
    parameters?: Record<string, string>;
  }>,
) {
  const project = createEmptyProject("jfets", "JFETs", "dut");
  const document = project.documents[0]!;
  document.netlist!.name = "dut";
  for (const transistor of transistors)
    document.instances.push({
      id: transistor.id,
      symbolId: transistor.symbolId ?? "njfet",
      reference: transistor.reference,
      placement: null,
      netlist: {
        binding: {
          kind: "model",
          deviceClass: "jfet",
          name:
            transistor.model ??
            (transistor.symbolId === "pjfet" ? "PJF" : "NJF"),
        },
        parameters: transistor.parameters ?? { m: "1" },
      },
    });
  for (const [pinName, name] of [
    ["D", "drain"],
    ["G", "gate"],
    ["S", "source"],
  ] as const) {
    document.nets.push({
      id: name,
      terminals: transistors.map((item) => ({ instanceId: item.id, pinName })),
    });
    document.connectivityEvidence.push({
      id: `${name}-name`,
      kind: "net-name-hint",
      netId: name,
      sourceName: name,
      origin: "spice-import",
    });
  }
  return project;
}

function exported(project: CircuitProject, format: "spice" | "spectre") {
  const result = createDesignNetlistExport(project, {
    format,
    includeLocations: true,
  });
  if (result.status !== "ready")
    throw new Error(JSON.stringify(result.diagnostics));
  return result;
}

async function imported(text: string, path: string) {
  const result = await importSpiceSources(
    [{ path, bytes: new TextEncoder().encode(text) }],
    path,
  );
  expect(result.successful, JSON.stringify(result.diagnostics)).toBe(true);
  return result.project!.documents.flatMap((document) => document.instances);
}

const pair = () =>
  jfetProject([
    { id: "j2", reference: "J2", symbolId: "pjfet" },
    { id: "j1", reference: "J1", parameters: { m: "2", area: "3" } },
  ]);

describe("the generic junction FET models", () => {
  it("prints J cards in D G S order and carries NJF and PJF once, saying so", () => {
    const project = pair();
    const result = exported(project, "spice");
    const text = result.file.text;
    expect(text).toContain("J1 drain gate source NJF area=3 m=2");
    expect(text).toContain("J2 drain gate source PJF m=1");
    for (const card of [NJF_CARD, PJF_CARD]) {
      expect(text.split(card)).toHaveLength(2);
      expect(text.indexOf(card)).toBeGreaterThan(text.indexOf(".subckt dut"));
      expect(text.indexOf(card)).toBeLessThan(text.indexOf("J1 drain"));
    }
    expect(
      result.diagnostics.filter((item) => item.code === "GENERIC_JFET_MODEL"),
    ).toEqual([
      expect.objectContaining({
        severity: "info",
        objectIds: ["j1", "j2"],
        message:
          "J1 uses the generic JFET model NJF (VTO=-2, BETA=1e-3, LAMBDA=0.01), J2 uses the generic JFET model PJF (VTO=-2, BETA=1e-3, LAMBDA=0.01); set a model for a real device",
      }),
    ]);
    expect(designExtractsNetlist(project)).toBe(true);
    expect(
      result.locations.fields.find(
        (field) => field.instanceId === "j1" && field.kind === "target",
      )?.rawValue,
    ).toBe("NJF");
  });

  it("leaves a JFET bound to any other model, or to a Project's own NJF, as it was", () => {
    const own = exported(
      jfetProject([{ id: "j1", reference: "J1", model: "J2N3819" }]),
      "spice",
    );
    expect(own.file.text).toContain("J1 drain gate source J2N3819 m=1");
    expect(own.file.text).not.toContain(".model");
    const project = jfetProject([{ id: "j1", reference: "J1" }]);
    project.source.files.push({
      id: "deck",
      path: "deck.cir",
      hash: "deck",
      content: {
        text: "J1 drain gate source NJF\n.model NJF NJF(VTO=-3 BETA=2e-3)\n",
        encoding: "utf-8",
      },
    });
    const replaced = exported(project, "spice");
    expect(replaced.file.text).not.toContain(".model");
    expect(
      replaced.diagnostics.filter((item) => item.code === "GENERIC_JFET_MODEL"),
    ).toEqual([]);
  });

  it("prints Spectre's native jfet stand-ins ahead of the transistors", () => {
    const text = exported(pair(), "spectre").file.text;
    expect(text).toContain("J1 (drain gate source) NJF area=3 m=2");
    expect(text).toContain("J2 (drain gate source) PJF m=1");
    expect(text).toContain(
      "model NJF jfet type=n vto=-2 beta=1e-3 lambda=0.01",
    );
    expect(text).toContain(
      "model PJF jfet type=p vto=-2 beta=1e-3 lambda=0.01",
    );
    const run = analyzeDesignNetlist(pair(), {
      format: "spectre",
      deckSources: [],
    });
    expect(run.ir!.cells.flatMap((cell) => cell.models ?? [])).toEqual([]);
  });

  it("reports the JFET stand-in as VACASK reports any model it has no mapping for", () => {
    const printed = printVacaskWithLocations(analyzeDesignNetlist(pair()).ir!);
    expect(printed.ok).toBe(false);
    if (printed.ok) return;
    expect(printed.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "VACASK_UNSUPPORTED_MODEL",
          message:
            "Cell-owned model NJF (NJF) needs a qualified native mapping.",
        }),
      ]),
    );
  });

  it.each(["spice", "spectre"] as const)(
    "reads its own %s netlist back as the same junction FETs",
    async (format) => {
      let text = exported(pair(), format).file.text;
      if (format === "spectre") {
        const converted = convertNetlist({
          text,
          source: "spectre",
          target: "spice",
          fragment: true,
        });
        if (converted.status !== "converted")
          throw new Error(JSON.stringify(converted.issues));
        text = converted.text;
      }
      const parts = await imported(text, "dut.sp");
      const part = (reference: string) =>
        parts.find((instance) => instance.reference === reference)!;
      expect(part("J1")).toMatchObject({
        symbolId: "njfet",
        netlist: {
          binding: { kind: "model", deviceClass: "jfet", name: "NJF" },
          parameters: { m: "2", area: "3" },
        },
      });
      expect(part("J2")).toMatchObject({
        symbolId: "pjfet",
        netlist: {
          binding: { kind: "model", deviceClass: "jfet", name: "PJF" },
        },
      });
      expect(
        part("J1").importProvenance?.terminalMapping?.map(
          (terminal) => terminal.pinName,
        ),
      ).toEqual(["D", "G", "S"]);
    },
  );
});
