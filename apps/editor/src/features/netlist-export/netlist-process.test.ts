import { describe, expect, it } from "vitest";
import {
  createEmptyProject,
  createSimulationFolder,
  type CircuitProject,
} from "@icm/model";
import {
  executeProjectTransaction,
  type ProjectStructureEdit,
} from "@icm/edit-engine";
import {
  createDesignNetlistExport,
  compileNgspiceSourceSimulation,
} from "@icm/netlist";
import { createLibraryExampleProject } from "../../examples/library-examples";
import { createDefaultNetlistExportPreferences } from "./netlist-export-preferences";
import {
  createNetlistExportProfile,
  setNetlistDefaultTarget,
  type NetlistProfileId,
} from "./netlist-process-presets";
import {
  planNetlistProcess,
  inferNetlistProcess,
  instanceModelTarget,
  netlistProcessPendingInstances,
  placementModelTarget,
  placementProcessFill,
  processPlacementTarget,
  processReviewedLibrary,
} from "./netlist-process";

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

describe("what the process still owes a circuit", () => {
  function twoBareDevices(): CircuitProject {
    const project = createEmptyProject("bare", "Bare");
    project.documents[0]!.instances.push(
      {
        id: "M1",
        reference: "M1",
        symbolId: "nmos",
        placement: null,
        netlist: { parameters: {} },
      },
      {
        id: "M2",
        reference: "M2",
        symbolId: "pmos",
        placement: null,
        netlist: { parameters: {} },
      },
    );
    return project;
  }

  it("counts the devices a circuit drawn before the process would gain", () => {
    const project = twoBareDevices();
    const sky130 = createNetlistExportProfile("sky130");
    expect(netlistProcessPendingInstances(project, sky130)).toBe(2);

    // Applying it settles the debt, and asking again costs nothing.
    const filled = apply(project, sky130, { onlyMissing: true });
    expect(netlistProcessPendingInstances(filled, sky130)).toBe(0);
    expect(
      planNetlistProcess(filled, sky130, { onlyMissing: true }),
    ).toHaveLength(0);
  });

  it("fills devices drawn with no netlist record at all", () => {
    // As an Agent or an early editor drew them: a symbol and a Reference only.
    const project = createEmptyProject("unrecorded", "Unrecorded");
    project.documents[0]!.instances.push(
      { id: "Q1", reference: "M1", symbolId: "nmos", placement: null },
      { id: "CF1", reference: "CF1", symbolId: "capacitor", placement: null },
      { id: "RL", reference: "RL", symbolId: "resistor", placement: null },
    );
    const sky130 = createNetlistExportProfile("sky130");
    expect(netlistProcessPendingInstances(project, sky130)).toBe(3);

    const filled = apply(project, sky130, { onlyMissing: true });
    const [mos, capacitor, resistor] = filled.documents[0]!.instances;
    expect(instanceModelTarget(filled, mos!)).toBe("sky130_fd_pr__nfet_01v8");
    expect(mos!.netlist?.parameters).toMatchObject({ w: "1u", l: "150n" });
    expect(capacitor!.netlist?.parameters.value).toBe("1p");
    expect(resistor!.netlist?.parameters.value).toBe("1k");
    expect(netlistProcessPendingInstances(filled, sky130)).toBe(0);
  });

  describe("drain-extended devices", () => {
    function mixedDevices(): CircuitProject {
      const project = createEmptyProject("dmos", "DMOS");
      project.documents[0]!.instances.push(
        ...(
          [
            ["M1", "ndmos"],
            ["M2", "pdmos"],
            ["M3", "nmos"],
          ] as const
        ).map(([id, symbolId]) => ({
          id,
          reference: id,
          symbolId,
          placement: null,
          netlist: { parameters: {} },
        })),
      );
      return project;
    }

    it("take the process's 16 V device with its own geometry", () => {
      const sky130 = createNetlistExportProfile("sky130");
      const project = mixedDevices();
      expect(netlistProcessPendingInstances(project, sky130)).toBe(3);

      const filled = apply(project, sky130, { onlyMissing: true });
      const [ndmos, pdmos, mos] = filled.documents[0]!.instances;
      expect(instanceModelTarget(filled, ndmos!)).toBe(
        "sky130_fd_pr__nfet_g5v0d16v0",
      );
      expect(ndmos!.netlist?.parameters).toMatchObject({
        w: "5u",
        l: "700n",
      });
      expect(instanceModelTarget(filled, pdmos!)).toBe(
        "sky130_fd_pr__pfet_g5v0d16v0",
      );
      expect(pdmos!.netlist?.parameters).toMatchObject({
        w: "5u",
        l: "660n",
      });
      expect(instanceModelTarget(filled, mos!)).toBe("sky130_fd_pr__nfet_01v8");
      expect(mos!.netlist?.parameters).toMatchObject({ w: "1u", l: "150n" });
      expect(inferNetlistProcess(filled, "abstract")).toBe("sky130");
    });

    it("follow a family choice only when the model fits them", () => {
      const sky130 = createNetlistExportProfile("sky130");
      const filled = apply(mixedDevices(), sky130, { onlyMissing: true });
      // A core model for the NMOS family leaves the DMOS on 16 V ...
      const lvt = apply(
        filled,
        setNetlistDefaultTarget(sky130, "nmos", "sky130_fd_pr__nfet_01v8_lvt"),
        { family: "nmos" },
      );
      const [ndmos, , mos] = lvt.documents[0]!.instances;
      expect(instanceModelTarget(lvt, ndmos!)).toBe(
        "sky130_fd_pr__nfet_g5v0d16v0",
      );
      expect(instanceModelTarget(lvt, mos!)).toBe(
        "sky130_fd_pr__nfet_01v8_lvt",
      );
      // ... and the 20 V device moves only the DMOS, with only its count.
      const hv20 = apply(
        lvt,
        setNetlistDefaultTarget(sky130, "nmos", "sky130_fd_pr__nfet_20v0"),
        { family: "nmos" },
      );
      const [ndmos20, , mos20] = hv20.documents[0]!.instances;
      expect(instanceModelTarget(hv20, ndmos20!)).toBe(
        "sky130_fd_pr__nfet_20v0",
      );
      expect(ndmos20!.netlist?.parameters).toEqual({ m: "1" });
      expect(instanceModelTarget(hv20, mos20!)).toBe(
        "sky130_fd_pr__nfet_01v8_lvt",
      );
    });

    it("keep their finding where the process has no high-voltage device", () => {
      // A custom process naming SKY130's core model offers no DMOS device.
      const custom = setNetlistDefaultTarget(
        createNetlistExportProfile("custom"),
        "nmos",
        "sky130_fd_pr__nfet_01v8",
      );
      const project = mixedDevices();
      const filled = apply(project, custom, { onlyMissing: true });
      const [ndmos, , mos] = filled.documents[0]!.instances;
      expect(instanceModelTarget(filled, ndmos!)).toBe("");
      expect(instanceModelTarget(filled, mos!)).toBe("sky130_fd_pr__nfet_01v8");
    });
  });

  it("fills the rest when a device's Reference refuses netlist edits", () => {
    // A MOS drawn as Q1 cannot take a netlist edit until it is renamed.
    const project = createEmptyProject("misnamed", "Misnamed");
    project.documents[0]!.instances.push(
      { id: "Q1", reference: "Q1", symbolId: "nmos", placement: null },
      { id: "M2", reference: "M2", symbolId: "nmos", placement: null },
    );
    const sky130 = createNetlistExportProfile("sky130");
    expect(netlistProcessPendingInstances(project, sky130)).toBe(1);

    const filled = apply(project, sky130, { onlyMissing: true });
    const [misnamed, mos] = filled.documents[0]!.instances;
    expect(misnamed!.netlist).toBeUndefined();
    expect(instanceModelTarget(filled, mos!)).toBe("sky130_fd_pr__nfet_01v8");
  });

  it("leaves what the author already said alone", () => {
    const project = twoBareDevices();
    project.documents[0]!.instances[0]!.netlist = {
      binding: { kind: "model", deviceClass: "mos", name: "NMOS" },
      parameters: { w: "4u", l: "180n", m: "1", nf: "1" },
    };
    const sky130 = createNetlistExportProfile("sky130");
    expect(netlistProcessPendingInstances(project, sky130)).toBe(1);
    const filled = apply(project, sky130, { onlyMissing: true });
    const authored = filled.documents[0]!.instances[0]!;
    expect(authored.netlist?.parameters.w).toBe("4u");
    expect(
      authored.netlist?.binding?.kind === "model" &&
        authored.netlist.binding.name,
    ).toBe("NMOS");
  });
});

describe("a part placed into a Process (#1251)", () => {
  const preferences = (selected: NetlistProfileId) => ({
    ...createDefaultNetlistExportPreferences(),
    selected,
  });
  const place = (symbolId: string, parameters: Record<string, string> = {}) =>
    ({
      kind: "add_instance",
      instance: {
        id: "Q1",
        symbolId,
        reference: symbolId === "resistor" ? "R1" : "Q1",
        placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
        netlist: { parameters },
      },
    }) as const;
  const commit = (project: CircuitProject, edits: ProjectStructureEdit[]) => {
    const result = executeProjectTransaction(project, {
      transactionId: "place",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits,
    });
    if (!result.ok) throw new Error(result.error.message);
    return result.project;
  };

  it("binds a SKY130 BJT to its reviewed subcircuit in the placing transaction", () => {
    const project = createEmptyProject("bjt", "BJT");
    const placement = place("pnp", { m: "8" });
    const fill = placementProcessFill(
      project,
      preferences("sky130"),
      project.topDocumentId,
      [placement],
    );
    expect(fill?.map((edit) => edit.kind)).toEqual([
      "upsert_external_subcircuit_definition",
      "transact_document",
    ]);
    const placed = commit(project, fill!);
    const [q1] = placed.documents[0]!.instances;
    expect(instanceModelTarget(placed, q1!)).toBe(
      "sky130_fd_pr__pnp_05v5_W0p68L0p68",
    );
    expect(q1!.netlist?.parameters).toEqual({ m: "8" });
    // The second one reuses the definition the first one brought.
    const again = placementProcessFill(
      placed,
      preferences("sky130"),
      placed.topDocumentId,
      [
        {
          ...placement,
          instance: { ...placement.instance, id: "Q2", reference: "Q2" },
        },
      ],
    );
    expect(again?.map((edit) => edit.kind)).toEqual(["transact_document"]);
  });

  it("names the device a placed part becomes, as Apply process chooses it", () => {
    const project = createEmptyProject("targets", "Targets");
    const target = (selected: NetlistProfileId, symbolId: string) =>
      processPlacementTarget(project, preferences(selected), symbolId);
    expect(target("sky130", "nmos")).toBe("sky130_fd_pr__nfet_01v8");
    expect(target("sky130", "pnp")).toBe("sky130_fd_pr__pnp_05v5_W0p68L0p68");
    // A drain-extended part takes the high-voltage device.
    expect(target("sky130", "ndmos")).toBe("sky130_fd_pr__nfet_g5v0d16v0");
    expect(target("abstract", "nmos")).toBe("NMOS");
    expect(target("sky130", "resistor")).toBeUndefined();
  });

  it("places IHP SG13G2 transistors and HBTs as the PDK's own X calls", () => {
    const sg13g2 = preferences("sg13g2");
    let project = createEmptyProject("ihp", "IHP");
    const id = project.topDocumentId;
    // A transistor takes no model card: its placement fill binds it.
    expect(placementModelTarget(project, sg13g2, "nmos")).toBeUndefined();
    const add = (
      instanceId: string,
      symbolId: string,
      x: number,
      parameters: Record<string, string>,
    ) =>
      ({
        kind: "add_instance",
        instance: {
          id: instanceId,
          symbolId,
          reference: instanceId,
          placement: { position: { x, y: 0 }, rotation: 0, mirror: "none" },
          netlist: { parameters },
        },
      }) as const;
    const parts = [
      add("M1", "nmos", 0, { w: "1u", l: "130n", nf: "1", m: "1" }),
      add("Q2", "npn", 200, { Nx: "2" }),
    ];
    const fill = placementProcessFill(project, sg13g2, id, parts);
    project = commit(project, fill!);
    const instance = (reference: string) =>
      project.documents[0]!.instances.find(
        (item) => item.reference === reference,
      )!;
    expect(instanceModelTarget(project, instance("M1"))).toBe("sg13_lv_nmos");
    expect(instanceModelTarget(project, instance("Q2"))).toBe("npn13G2");
    // Finger count is ng in SG13G2; the drawn values stay, in metres.
    expect(instance("M1").netlist?.parameters).toEqual({
      w: "1u",
      l: "130n",
      ng: "1",
      m: "1",
    });
    expect(inferNetlistProcess(project, "sky130")).toBe("sg13g2");
    expect(processReviewedLibrary(project, sg13g2)).toBe("sg13g2_pr");

    const wired = structuredClone(project);
    for (const [reference, pins] of [
      ["M1", ["D", "G", "S", "B"]],
      ["Q2", ["C", "B", "E"]],
    ] as const)
      for (const pinName of pins)
        wired.documents[0]!.nets.push({
          id: `net-${reference}-${pinName}`,
          terminals: [{ instanceId: instance(reference).id, pinName }],
        });
    const exported = createDesignNetlistExport(wired, { format: "spice" });
    const text =
      exported.status === "ready"
        ? exported.file.text
        : JSON.stringify(exported.diagnostics);
    // As IHP's xschem symbols write them: `XM1 d g s b sg13_lv_nmos w l ng m`
    // and `XQ1 c b e bn npn13G2 le we Nx`, with the substrate on ground.
    expect(text).toMatch(
      /^XM1 \S+ \S+ \S+ \S+ sg13_lv_nmos w=1u l=130n ng=1 m=1$/mu,
    );
    expect(text).toMatch(/^XQ2 \S+ \S+ \S+ \S+ npn13G2 le=900n we=70n Nx=2$/mu);
  });

  it("gives a BJT the Process's plain model where it names one, and nothing where not", () => {
    const project = createEmptyProject("bjt", "BJT");
    const id = project.topDocumentId;
    const abstract = commit(
      project,
      placementProcessFill(project, preferences("abstract"), id, [
        place("pnp"),
      ]) ?? [],
    );
    expect(abstract.documents[0]!.instances[0]!.netlist?.binding).toEqual({
      kind: "model",
      deviceClass: "bjt",
      name: "PNP",
    });
    // TSMC 28 names no PNP; the part keeps its missing-model finding.
    expect(
      placementProcessFill(project, preferences("tsmc28"), id, [place("pnp")]),
    ).toBeUndefined();
    // A part that needs no model is placed exactly as before.
    expect(
      placementProcessFill(project, preferences("sky130"), id, [
        place("resistor", { value: "1k" }),
      ]),
    ).toBeUndefined();
  });
});

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
