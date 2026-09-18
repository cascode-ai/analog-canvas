import { describe, expect, it } from "vitest";
import {
  createEmptyProject,
  createSimulationFolder,
  type CircuitProject,
} from "@icm/model";
import { executeProjectTransaction } from "@icm/edit-engine";
import {
  createDesignNetlistExport,
  compileNgspiceSourceSimulation,
} from "@icm/netlist";
import { createLibraryExampleProject } from "../../examples/library-examples";
import {
  createNetlistExportProfile,
  setNetlistDefaultTarget,
} from "./netlist-process-presets";
import { planNetlistProcess, inferNetlistProcess } from "./netlist-process";

function apply(
  project: CircuitProject,
  profile = createNetlistExportProfile("abstract"),
  options: Parameters<typeof planNetlistProcess>[2] = {},
) {
  const edits = planNetlistProcess(project, profile, options);
  if (!edits.length) return project;
  const result = executeProjectTransaction(project, {
    transactionId: "process-test",
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    actor: { kind: "human", id: "test" },
    edits,
  });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.project;
}
function exported(
  project: CircuitProject,
  format: "spice" | "spectre" = "spice",
) {
  const result = createDesignNetlistExport(project, { format });
  expect(result.status, JSON.stringify(result.diagnostics)).toBe("ready");
  if (result.status !== "ready") throw new Error("Export blocked");
  return result.file.text;
}

describe("persisted netlist process authoring", () => {
  it("keeps AC-only sources free of a preset DC offset and honors custom missing-value defaults", () => {
    const project = createEmptyProject("source", "Source");
    project.documents[0]!.instances.push({
      id: "V1",
      reference: "V1",
      symbolId: "voltage-source",
      placement: null,
      netlist: {
        binding: { kind: "primitive", deviceClass: "voltage-source" },
        parameters: { acMagnitude: "1" },
      },
    });
    expect(
      apply(project).documents[0]!.instances[0]!.netlist!.parameters,
    ).toEqual({ acMagnitude: "1" });
    const profile = createNetlistExportProfile("sky130");
    profile.devices.nmos.parameters.w = "8u";
    const mapped = apply(
      createLibraryExampleProject("common-source-amplifier")!,
      profile,
    );
    expect(
      mapped.documents[0]!.instances.find(
        (instance) => instance.symbolId === "nmos",
      )!.netlist!.parameters.w,
    ).toBe("8u");
  });
  it("fills missing abstract models/values while preserving existing geometry, values and identities", () => {
    const source = createLibraryExampleProject("common-source-amplifier")!;
    const original = structuredClone(source);
    const project = apply(source, undefined, { onlyMissing: true });
    const text = exported(project);
    expect(text).not.toContain("TODO");
    expect(text).toContain("NMOS");
    expect(source).toEqual(original);
    expect(
      project.documents[0]!.instances.map(({ id, reference, placement }) => ({
        id,
        reference,
        placement,
      })),
    ).toEqual(
      source.documents[0]!.instances.map(({ id, reference, placement }) => ({
        id,
        reference,
        placement,
      })),
    );
    expect(project.documents[0]!.routes).toEqual(source.documents[0]!.routes);
    expect(
      planNetlistProcess(project, createNetlistExportProfile("abstract"), {
        onlyMissing: true,
      }),
    ).toEqual([]);
  });

  it("persists SKY130 wrappers and retains ideal passives by default in both syntaxes", () => {
    const source = createLibraryExampleProject("common-source-amplifier")!;
    const project = apply(source, createNetlistExportProfile("sky130"));
    expect(inferNetlistProcess(project, "abstract")).toBe("sky130");
    expect(project.externalSubcircuitDefinitions).toHaveLength(1);
    expect(exported(project)).toMatch(
      /^XM1 .*sky130_fd_pr__nfet_01v8 l=0.15 .*w=1/mu,
    );
    expect(exported(project)).toMatch(/^CGS .* 1p$/mu);
    const scs = exported(project, "spectre");
    expect(scs).toContain("simulator lang=spectre");
    expect(scs).not.toContain("simulator lang=spice");
    expect(scs).not.toContain("TODO");
    expect(scs).toMatch(/^M1 \(.*sky130_fd_pr__nfet_01v8 /mu);
    const names = (p: CircuitProject) =>
      p.documents[0]!.instances.map((i) => i.reference);
    expect(names(project)).toEqual(names(source));
    expect(names(apply(project))).toEqual(names(source));
    expect(exported(apply(project))).toMatch(/^M1 .* NMOS /mu);
  });

  it("keeps copied external References unchanged on open and unique when explicitly converting", () => {
    let project = apply(
      createLibraryExampleProject("current-mirror-loaded-differential-pair")!,
      createNetlistExportProfile("sky130"),
    );
    const document = project.documents[0]!;
    const source = document.instances.find(
      (instance) => instance.reference === "M1",
    )!;
    const copy = {
      ...structuredClone(source),
      id: "copied",
      reference: "X1",
      placement: null,
    };
    delete copy.mosBulkBinding;
    document.instances.push(copy);
    for (const pinName of ["D", "G", "S", "B"])
      document.noConnects.push({
        id: `copy-${pinName}`,
        endpoint: { kind: "terminal", instanceId: copy.id, pinName },
      });
    expect(
      planNetlistProcess(project, createNetlistExportProfile("abstract"), {
        onlyMissing: true,
      }),
    ).toEqual([]);
    const before = project.documents[0]!.instances.map((i) => i.reference);
    project = apply(project);
    expect(project.documents[0]!.instances.map((i) => i.reference)).toEqual(
      before,
    );
    const references = project.documents[0]!.instances.flatMap((instance) =>
      instance.reference ? [instance.reference] : [],
    );
    expect(new Set(references).size).toBe(references.length);
    expect(exported(project)).not.toContain("TODO");
  });

  it("leaves an unknown external interface and its parameters untouched", () => {
    const project = createEmptyProject("custom", "custom");
    project.externalSubcircuitDefinitions.push({
      id: "custom-device",
      name: "custom_nfet",
      interfaceStatus: "declared",
      terminals: ["D", "G", "S", "B"].map((name) => ({
        id: name,
        name,
        direction: "passive",
      })),
      formalParameters: [],
    });
    project.documents[0]!.instances.push({
      id: "X1",
      reference: "X1",
      symbolId: "nmos",
      placement: null,
      netlist: {
        binding: { kind: "external-subcircuit", definitionId: "custom-device" },
        parameters: { special: "42" },
      },
    });
    expect(
      planNetlistProcess(project, createNetlistExportProfile("sky130")),
    ).toEqual([]);
  });

  it("maps the TSMC multiplier both ways without changing authored W/L", () => {
    let project = apply(
      createLibraryExampleProject("current-mirror-loaded-differential-pair")!,
    );
    const mos = project.documents[0]!.instances.find(
      (instance) => instance.reference === "M1",
    )!;
    mos.netlist!.parameters = { w: "7u", l: "240n", m: "4" };
    project = apply(project, createNetlistExportProfile("tsmc28"));
    expect(
      project.documents[0]!.instances.find(
        (instance) => instance.id === mos.id,
      )!.netlist!.parameters,
    ).toMatchObject({ w: "7u", l: "240n", multi: "4" });
    expect(exported(project)).toContain("pch_ulvt_mac");
    project = apply(project, createNetlistExportProfile("tsmc180"));
    const params = project.documents[0]!.instances.find(
      (instance) => instance.id === mos.id,
    )!.netlist!.parameters;
    expect(params).toMatchObject({ w: "7u", l: "240n", m: "4" });
    expect(params).not.toHaveProperty("multi");
  });

  it.each([
    ["resistor", "sky130_fd_pr__res_high_po"],
    ["capacitor", "sky130_fd_pr__cap_var_lvt"],
    ["inductor", "sky130_fd_pr__ind_05_220"],
  ] as const)(
    "authors physical %s geometry and property terminals without stray visible labels",
    (family, target) => {
      const project = createEmptyProject("passive", "passive");
      const id = { resistor: "R", capacitor: "C", inductor: "L" }[family] + "1";
      project.documents[0]!.instances.push({
        id,
        reference: id,
        symbolId: family,
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
        netlist: {
          binding: { kind: "primitive", deviceClass: family },
          parameters: { value: "1p" },
        },
      });
      for (const pinName of ["1", "2"])
        project.documents[0]!.noConnects.push({
          id: pinName,
          endpoint: { kind: "terminal", instanceId: id, pinName },
        });
      const mapped = apply(
        project,
        setNetlistDefaultTarget(
          createNetlistExportProfile("sky130"),
          family,
          target,
        ),
        { family },
      );
      expect(exported(mapped)).toContain(target);
      expect(
        mapped.documents[0]!.instances[0]!.netlist!.parameters,
      ).not.toHaveProperty("value");
      expect(
        mapped.documents[0]!.annotations.every(
          (annotation) => annotation.visible === false,
        ),
      ).toBe(true);
      expect(exported(apply(mapped))).not.toContain(target);
    },
  );

  it("keeps direct export and generated simulation cards identical after process selection", () => {
    const project = apply(
      createLibraryExampleProject("current-mirror-loaded-differential-pair")!,
      createNetlistExportProfile("sky130"),
    );
    const folder = createSimulationFolder({
      id: "simulation",
      name: "Simulation",
      profileId: "sky130-test",
      engine: "ngspice",
      documentId: project.topDocumentId,
    });
    const simulation = compileNgspiceSourceSimulation(project, folder);
    expect(simulation.ok, JSON.stringify(simulation)).toBe(true);
    if (!simulation.ok) return;
    // Design blocks name their ground VSS; the simulator's flat root uses 0.
    const cards = (text: string) =>
      text
        .replace(/\bVSS\b/gu, "0")
        .split(/\r?\n/u)
        .filter((line) => /^XM\d+ /u.test(line));
    expect(cards(exported(project))).toEqual(
      cards(simulation.generated[0]!.text),
    );
  });
});
