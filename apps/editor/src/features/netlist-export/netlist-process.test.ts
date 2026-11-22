import { describe, expect, it, vi } from "vitest";
import * as engine from "@icm/edit-engine";
import * as devices from "@icm/devices";
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
  designExtractsNetlist,
} from "@icm/netlist";
import { createLibraryExampleProject } from "../../examples/library-examples";
import { importSpiceSources } from "@icm/spice";
import { placedInstanceNetlist } from "../component-insert/placed-instance-netlist";
import { createDefaultNetlistExportPreferences } from "./netlist-export-preferences";
import {
  createNetlistExportProfile,
  setNetlistDefaultTarget,
  type NetlistProfileId,
  NETLIST_PROFILE_IDS,
  processOwnDevice,
} from "./netlist-process-presets";
import {
  planNetlistProcess,
  planNetlistProcessReport,
  prepareNetlistProcess,
  createNetlistDefaultsCache,
  inferNetlistProcess,
  instanceModelTarget,
  netlistModelInclude,
  placementModelTarget,
  placementProcessFill,
  netlistProcessProjection,
  processPlacementTarget,
  processReviewedLibrary,
} from "./netlist-process";
import { initialInstanceNetlist } from "./netlist-authoring";
import { importNetlistSources } from "./netlist-source-import";
import { planNetlistCodeEdit } from "./netlist-code-edit";
import { workspaceNetlist } from "../../headless/artifacts";

/** The devices still waiting for a model, as the Process count reads them. */
const netlistProcessPendingInstances = (
  project: CircuitProject,
  profile: Parameters<typeof prepareNetlistProcess>[1],
) =>
  prepareNetlistProcess(project, profile, { onlyMissing: true }).instanceCount;

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

it("reads an ICS55 inverter and retains its threshold variants, bulk nets and sizes on export", async () => {
  const text = [
    ".subckt inverter A Y VDD VSS PW NW",
    "MN Y A VSS PW nm1p2_lvt_lp W=180n L=60n MR=1",
    "MP Y A VDD NW pm1p2_hvt_lp W=300n L=60n MR=2",
    ".ends inverter",
  ].join("\n");
  const imported = await importSpiceSources(
    [{ path: "inverter.sp", bytes: new TextEncoder().encode(text) }],
    "inverter.sp",
  );
  const project = imported.project!;
  expect(inferNetlistProcess(project, "sky130")).toBe("ics55");
  const netlist = exported(netlistProcessProjection(project, "ics55").project);
  expect(netlist).toMatch(
    /^MN Y A VSS PW nm1p2_lvt_lp .*l=60n.*mr=1.*w=180n/imu,
  );
  expect(netlist).toMatch(
    /^MP Y A VDD NW pm1p2_hvt_lp .*l=60n.*mr=2.*w=300n/imu,
  );
  expect(netlist).not.toMatch(/\.model\s+[np]m1p2/iu);
  const switched = apply(project, createNetlistExportProfile("ics55"), {
    family: "pmos",
  });
  expect(exported(switched)).toMatch(/^MP Y A VDD NW pm1p2_svt_lp .*mr=2/imu);
});

describe("GPDK045", () => {
  // Shaped like the Gallery's GPDK045 SerDes cells, read from Virtuoso.
  const source = [
    "simulator lang=spectre",
    "subckt cml_buf (vdd vss inp inn outp outn bias)",
    "NM0 (outp inn tail vss) nmos1v_lvt l=50n m=4 nf=1 w=2u",
    "NM1 (outn inp tail vss) nmos1v_lvt l=50n m=4 nf=1 w=2u",
    "NM2 (tail bias vss vss) nmos2v l=200n m=2 nf=2 w=1u",
    "PM0 (outp outn vdd vdd) pmos1v l=45n m=1 nf=1 w=500n",
    "PM1 (outn outp vdd vdd) pmos1v_hvt l=45n m=1 nf=1 w=500n",
    "ends cml_buf",
  ].join("\n");
  const read = async () => {
    const imported = await importNetlistSources(
      [{ path: "cml.scs", bytes: new TextEncoder().encode(source) }],
      "cml.scs",
    );
    if (imported.status !== "imported")
      throw new Error(JSON.stringify(imported.diagnostics));
    return imported.project;
  };

  it("opens a Project of GPDK045 names in GPDK045 and writes its kit's include in Spectre only", async () => {
    const project = await read();
    expect(inferNetlistProcess(project, "sky130")).toBe("gpdk045");
    const kept = netlistProcessProjection(project, "gpdk045").project;
    const spectre = createDesignNetlistExport(kept, {
      format: "spectre",
      includeLocations: true,
      modelInclude: netlistModelInclude(kept, "spectre"),
    });
    if (spectre.status !== "ready") throw new Error("Export blocked");
    expect(spectre.file.text).toMatch(
      /^simulator lang=spectre\ninclude "<models>\/gpdk045\.scs" section=tt\n\nsubckt /u,
    );
    // The whole Process keeps each device's threshold and oxide.
    expect(spectre.file.text).toMatch(
      /^MNM0 \(outp inn tail vss\) nmos1v_lvt l=50n m=4 nf=1 w=2u$/mu,
    );
    expect(spectre.file.text).toMatch(
      /^MNM2 .* nmos2v l=200n m=2 nf=2 w=1u$/mu,
    );
    expect(spectre.file.text).toMatch(/^MPM1 .* pmos1v_hvt /mu);
    // A value edited in the code still finds its field below the include.
    const edited = planNetlistCodeEdit(
      kept,
      spectre,
      spectre.file.text.replace("nmos2v l=200n", "nmos2v l=300n"),
    );
    expect(edited.ok, JSON.stringify(edited)).toBe(true);
    expect(
      netlistModelInclude(kept, "spectre", {
        directory: "/pdk/models/spectre/",
        corner: "ss",
      }),
    ).toEqual({ path: "/pdk/models/spectre/gpdk045.scs", section: "ss" });
    expect(netlistModelInclude(kept, "spice")).toBeUndefined();
    expect(exported(kept)).not.toMatch(/include|\.lib/iu);
    // Another Process's Project includes nothing.
    const sky130 = netlistProcessProjection(project, "sky130").project;
    expect(inferNetlistProcess(sky130, "gpdk045")).toBe("sky130");
    expect(netlistModelInclude(sky130, "spectre")).toBeUndefined();
  });

  it("chooses a family's device with the kit CDF's geometry", async () => {
    const profile = createNetlistExportProfile("gpdk045");
    expect(profile.devices.nmos).toMatchObject({
      target: "nmos1v",
      parameters: { l: "45n", w: "120n", m: "1", nf: "1" },
    });
    expect(profile.devices.pmos.target).toBe("pmos1v");
    expect(profile.models).toEqual({ directory: "<models>", corner: "tt" });
    const thick = setNetlistDefaultTarget(profile, "pmos", "pmos2v");
    expect(thick.devices.pmos.parameters).toMatchObject({
      l: "150n",
      w: "400n",
    });
    const switched = apply(await read(), thick, { family: "pmos" });
    expect(exported(switched)).toMatch(/^MPM1 .* pmos2v /mu);
    expect(exported(switched)).toMatch(/^MNM2 .* nmos2v /mu);
  });
});

describe("what the process still owes a circuit", () => {
  it("prepares many devices with one complete validation, preserving the exact Fill plan", () => {
    const project = createEmptyProject(
      "dense-preparation",
      "Dense preparation",
    );
    for (let index = 0; index < 120; index++)
      project.documents[0]!.instances.push({
        id: `M${index + 1}`,
        reference: `M${index + 1}`,
        symbolId: "nmos",
        placement: null,
        netlist: { parameters: { w: "7u", l: "240n", m: "4" } },
      });
    const before = structuredClone(project);
    const execute = vi.spyOn(engine, "executeProjectTransaction");
    const references = vi.spyOn(devices, "createReferenceIndex");
    try {
      const prepared = prepareNetlistProcess(
        project,
        createNetlistExportProfile("abstract"),
        { onlyMissing: true },
      );
      expect(execute).toHaveBeenCalledTimes(1);
      // Filling defaults does not change References: build their complete
      // index once for planning and once for the authoritative transaction.
      expect(references.mock.calls.length).toBeLessThanOrEqual(3);
      expect(prepared.instanceCount).toBe(120);
      expect(project).toEqual(before);
      const result = executeProjectTransaction(project, {
        transactionId: "prepared-fill",
        projectId: project.id,
        expectedStructureRevision: project.structureRevision,
        actor: { kind: "human", id: "test" },
        edits: prepared.edits,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      for (const instance of result.project.documents[0]!.instances)
        expect(instance.netlist!.parameters).toMatchObject({
          w: "7u",
          l: "240n",
          m: "4",
        });
      expect(
        prepareNetlistProcess(
          result.project,
          createNetlistExportProfile("abstract"),
          { onlyMissing: true },
        ),
      ).toEqual({ edits: [], instanceCount: 0, conversions: [] });
    } finally {
      execute.mockRestore();
      references.mockRestore();
    }
  });
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

  it("gives a placed DMOS the 16 V device's own size, which SKY130 models (#1483)", () => {
    const project = createEmptyProject("dmos", "DMOS");
    for (const [symbolId, master, length] of [
      ["ndmos", "sky130_fd_pr__nfet_g5v0d16v0", "700n"],
      ["pdmos", "sky130_fd_pr__pfet_g5v0d16v0", "660n"],
    ] as const) {
      // A GUI or Agent placement carries the catalog's W 1u / L 150n, a size
      // SKY130's 16 V models do not have.
      const placement = place(symbolId);
      const netlist = placedInstanceNetlist(
        symbolId,
        {},
        placementModelTarget(project, preferences("sky130"), symbolId),
      );
      expect(netlist?.parameters).toMatchObject({ w: "1u", l: "150n" });
      const placed = commit(
        project,
        placementProcessFill(
          project,
          preferences("sky130"),
          project.topDocumentId,
          [
            {
              ...placement,
              instance: {
                ...placement.instance,
                reference: "M1",
                netlist: netlist!,
              },
            },
          ],
        )!,
      );
      const [part] = placed.documents[0]!.instances;
      expect(instanceModelTarget(placed, part!)).toBe(master);
      expect(part!.netlist?.parameters).toMatchObject({ w: "5u", l: length });
    }
  });

  it("leaves a placed Zener's model to its BV or its author", () => {
    const project = createEmptyProject("zener", "Zener");
    const fill = (symbolId: string, parameters: Record<string, string>) => {
      const edit = place(symbolId, parameters);
      return placementProcessFill(
        project,
        preferences("sky130"),
        project.topDocumentId,
        [
          {
            ...edit,
            instance: { ...edit.instance, id: "D1", reference: "D1" },
          },
        ],
      );
    };
    // A plain diode takes the generic model. A Zener's BV builds its own
    // model in the netlist, which the generic one would refuse.
    expect(fill("diode", {})).toBeDefined();
    // An LED is the diode, drawn emitting light: the same model fill.
    expect(
      processPlacementTarget(project, preferences("sky130"), "led"),
    ).toEqual(processPlacementTarget(project, preferences("sky130"), "diode"));
    expect(
      processPlacementTarget(project, preferences("sky130"), "led"),
    ).toBeDefined();
    expect(fill("zener-diode", { bv: "5.6" })).toBeUndefined();
    expect(
      processPlacementTarget(project, preferences("sky130"), "zener-diode"),
    ).toBeUndefined();
  });

  it.each(NETLIST_PROFILE_IDS)(
    "binds a placed JFET to the generic NJF or PJF under %s",
    (process) => {
      // No Process ships a JFET: every one names the netlist's own stand-in.
      const project = createEmptyProject("jfet", "JFET");
      for (const [symbolId, model] of [
        ["njfet", "NJF"],
        ["pjfet", "PJF"],
      ] as const) {
        expect(
          processPlacementTarget(project, preferences(process), symbolId),
        ).toBe(model);
        const edit = place(symbolId);
        const placed = commit(
          project,
          placementProcessFill(
            project,
            preferences(process),
            project.topDocumentId,
            [{ ...edit, instance: { ...edit.instance, reference: "J1" } }],
          )!,
        );
        const [part] = placed.documents[0]!.instances;
        expect(instanceModelTarget(placed, part!)).toBe(model);
        expect(part!.netlist?.binding).toMatchObject({ deviceClass: "jfet" });
        expect(part!.netlist?.parameters).toMatchObject({ m: "1" });
      }
    },
  );

  it.each(NETLIST_PROFILE_IDS)(
    "binds a placed depletion MOS to the generic NMOS_DEP or PMOS_DEP under %s",
    (process) => {
      // No Process ships a depletion MOS: none of its enhancement devices,
      // off at VGS = 0, may stand in for one.
      const project = createEmptyProject("depletion", "Depletion");
      for (const [symbolId, model, body] of [
        ["depletion-nmos", "NMOS_DEP", "VSS"],
        ["depletion-pmos", "PMOS_DEP", "VDD"],
      ] as const) {
        expect(
          processPlacementTarget(project, preferences(process), symbolId),
        ).toBe(model);
        expect(
          createNetlistExportProfile(process).devices[symbolId].substrate,
        ).toBe(body);
        const edit = place(symbolId);
        const placed = commit(
          project,
          placementProcessFill(
            project,
            preferences(process),
            project.topDocumentId,
            [{ ...edit, instance: { ...edit.instance, reference: "M1" } }],
          )!,
        );
        const [part] = placed.documents[0]!.instances;
        expect(instanceModelTarget(placed, part!)).toBe(model);
        expect(part!.netlist?.binding).toMatchObject({ deviceClass: "mos" });
      }
    },
  );

  it.each([
    ["ammeter", "A1"],
    ["thermocouple", "TC1"],
    ["noise-voltage-source", "VN1"],
  ])(
    "leaves a %s at its own levels: Apply process gives it no source defaults",
    (symbolId, reference) => {
      let project = createEmptyProject(symbolId, symbolId);
      const edit = place(symbolId);
      project = commit(project, [
        {
          kind: "transact_document",
          documentId: project.topDocumentId,
          expectedRevision: project.documents[0]!.revision,
          edits: [{ ...edit, instance: { ...edit.instance, reference } }],
        },
      ]);
      for (const process of NETLIST_PROFILE_IDS)
        expect(
          planNetlistProcess(project, createNetlistExportProfile(process)),
        ).toEqual([]);
    },
  );

  it.each(NETLIST_PROFILE_IDS)(
    "binds a placed Schottky diode to the generic DSCH under %s",
    (process) => {
      // No Process ships a Schottky diode: every one names the netlist's own.
      const project = createEmptyProject("schottky", "Schottky");
      expect(
        processPlacementTarget(project, preferences(process), "schottky-diode"),
      ).toBe("DSCH");
      const edit = place("schottky-diode");
      const placed = commit(
        project,
        placementProcessFill(
          project,
          preferences(process),
          project.topDocumentId,
          [{ ...edit, instance: { ...edit.instance, reference: "D1" } }],
        )!,
      );
      const [part] = placed.documents[0]!.instances;
      expect(instanceModelTarget(placed, part!)).toBe("DSCH");
      expect(part!.netlist?.binding).toMatchObject({ deviceClass: "diode" });
    },
  );

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

  it("binds a MOS Varactor to IHP's varactor under SG13G2, on placement and when the Process fills (#2321)", () => {
    const sg13g2 = preferences("sg13g2");
    const add = (instanceId: string, x: number) =>
      ({
        kind: "add_instance",
        instance: {
          id: instanceId,
          symbolId: "mos-varactor",
          reference: instanceId,
          placement: { position: { x, y: 0 }, rotation: 0, mirror: "none" },
          netlist: { parameters: {} },
        },
      }) as const;
    // SKY130 and Abstract have no varactor of their own: nothing to bind.
    expect(processOwnDevice("sg13g2", "mos-varactor")).toBe("sg13_hv_svaricap");
    expect(processOwnDevice("sky130", "mos-varactor")).toBeUndefined();
    expect(processOwnDevice("abstract", "mos-varactor")).toBeUndefined();
    // Nor does a choice of three: SKY130's centre-tapped inductors.
    expect(processOwnDevice("sky130", "center-tap-inductor")).toBeUndefined();

    let project = createEmptyProject("ihp-varactor", "IHP varactor");
    const id = project.topDocumentId;
    project = commit(
      project,
      placementProcessFill(project, sg13g2, id, [add("C1", 0)])!,
    );
    const instance = (reference: string) =>
      project.documents[0]!.instances.find(
        (item) => item.reference === reference,
      )!;
    expect(instanceModelTarget(project, instance("C1"))).toBe(
      "sg13_hv_svaricap",
    );
    // Its own defaults, not the capacitor family's cap_cmim sizes.
    expect(instance("C1").netlist?.parameters).toEqual({
      w: "3.74u",
      l: "300n",
      Nx: "1",
      m: "1",
    });

    // One drawn without a model is filled by the Process.
    const document = project.documents[0]!;
    project = commit(project, [
      {
        kind: "transact_document",
        documentId: id,
        expectedRevision: document.revision,
        edits: [add("C2", 200)],
      },
    ]);
    expect(instanceModelTarget(project, instance("C2"))).toBe("");
    project = commit(
      project,
      planNetlistProcess(project, sg13g2.profiles.sg13g2, {
        onlyMissing: true,
      }),
    );
    expect(instanceModelTarget(project, instance("C2"))).toBe(
      "sg13_hv_svaricap",
    );
    // The substrate follows ground, as every PDK substrate does.
    expect(
      project.documents[0]!.nets.some((net) =>
        net.terminals.some(
          (terminal) =>
            terminal.instanceId === instance("C2").id &&
            terminal.pinName === "B",
        ),
      ),
    ).toBe(true);
  });

  it("places SG13 R/C as physical devices by default and honors an explicit Ideal choice", () => {
    const selected = preferences("sg13g2");
    let project = createEmptyProject("sg13-rc", "SG13 R/C");
    for (const [id, symbol, target] of [
      ["R1", "resistor", "rppd"],
      ["C1", "capacitor", "cap_cmim"],
    ] as const) {
      expect(selected.profiles.sg13g2.devices[symbol].target).toBe(target);
      const document = project.documents[0]!;
      const placement = [
        {
          kind: "add_instance" as const,
          instance: {
            id,
            reference: id,
            symbolId: symbol,
            placement: null,
            netlist: initialInstanceNetlist(symbol, {
              value: symbol === "resistor" ? "1k" : "1p",
            })!,
          },
        },
      ];
      const edits = placementProcessFill(
        project,
        selected,
        document.id,
        placement,
      );
      expect(edits).toBeDefined();
      const result = executeProjectTransaction(project, {
        transactionId: id,
        projectId: project.id,
        expectedStructureRevision: project.structureRevision,
        actor: { kind: "human", id: "test" },
        edits: edits!,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      project = result.project;
      expect(
        instanceModelTarget(
          project,
          project.documents[0]!.instances.find((i) => i.id === id)!,
        ),
      ).toBe(target);
    }
    // A placed part takes the device's own size; Ideal carries its value
    // (0.5 × 0.5 µm rppd, 7 × 7 µm cmim).
    for (const [family, value] of [
      ["resistor", "260Ω"],
      ["capacitor", "74.6fF"],
    ] as const) {
      const ideal = setNetlistDefaultTarget(
        selected.profiles.sg13g2,
        family,
        "",
      );
      const result = apply(project, ideal, { family });
      expect(
        result.documents[0]!.instances.find((i) => i.symbolId === family)!
          .netlist,
      ).toMatchObject({
        binding: { kind: "primitive" },
        parameters: { value },
      });
      expect(
        Object.keys(
          result.documents[0]!.instances.find((i) => i.symbolId === family)!
            .netlist!.parameters,
        ),
      ).toEqual(["value"]);
    }
    selected.profiles.sg13g2.devices.resistor.target = "";
    expect(
      placementProcessFill(project, selected, project.topDocumentId, [
        {
          kind: "add_instance",
          instance: {
            id: "R2",
            reference: "R2",
            symbolId: "resistor",
            placement: null,
            netlist: initialInstanceNetlist("resistor", { value: "2k" })!,
          },
        },
      ]),
    ).toBeUndefined();
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
    // A Process naming no PNP leaves the part its missing-model finding.
    const noPnp = preferences("custom");
    noPnp.profiles.custom = setNetlistDefaultTarget(
      noPnp.profiles.custom,
      "pnp",
      "",
    );
    expect(
      placementProcessFill(project, noPnp, id, [place("pnp")]),
    ).toBeUndefined();
    // A part that needs no model is placed exactly as before.
    expect(
      placementProcessFill(project, preferences("sky130"), id, [
        place("resistor", { value: "1k" }),
      ]),
    ).toBeUndefined();
  });

  it("binds a placed NPN's substrate to the Cell's negative rail unless its NMOS body default names another Net than ground (#1530)", () => {
    // A Cell drawing ground, a VNEG supply marker and a labelled VSUB.
    const project = createEmptyProject("substrate", "Substrate");
    const document = project.documents[0]!;
    document.instances.push(
      { id: "GND", symbolId: "ground", placement: null },
      { id: "VNEG", symbolId: "vdd-port", placement: null },
      { id: "R1", symbolId: "resistor", reference: "R1", placement: null },
    );
    document.nets.push(
      { id: "net-0", terminals: [{ instanceId: "GND", pinName: "0" }] },
      { id: "net-vneg", terminals: [{ instanceId: "VNEG", pinName: "P" }] },
      { id: "net-vsub", terminals: [{ instanceId: "R1", pinName: "1" }] },
    );
    document.annotations.push({
      id: "vsub-label",
      kind: "net-label",
      binding: { kind: "net-name", netId: "net-vsub" },
      netId: "net-vsub",
      anchor: { kind: "free", position: { x: 0, y: 0 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    document.connectivityEvidence.push(
      {
        id: "gnd-claim",
        kind: "name-claim",
        netId: "net-0",
        name: "0",
        scope: "global",
        powerDomain: "ground",
        owner: { kind: "power-marker", objectId: "GND" },
      },
      {
        id: "vneg-claim",
        kind: "name-claim",
        netId: "net-vneg",
        name: "VNEG",
        scope: "global",
        powerDomain: "vdd",
        owner: { kind: "power-marker", objectId: "VNEG" },
      },
      {
        id: "vsub-claim",
        kind: "name-claim",
        netId: "net-vsub",
        name: "VSUB",
        scope: "local",
        owner: { kind: "net-label", annotationId: "vsub-label" },
      },
    );
    const substrate = (nmosNetId?: string, rail = true) => {
      const cell = structuredClone(project);
      if (nmosNetId) cell.documents[0]!.mosBulkDefaults = { nmosNetId };
      if (!rail) {
        const drawn = cell.documents[0]!;
        drawn.instances = drawn.instances.filter((item) => item.id !== "VNEG");
        drawn.nets = drawn.nets.filter((net) => net.id !== "net-vneg");
        drawn.connectivityEvidence = drawn.connectivityEvidence.filter(
          (item) => item.netId !== "net-vneg",
        );
      }
      const placed = commit(
        cell,
        placementProcessFill(cell, preferences("sky130"), cell.topDocumentId, [
          place("npn"),
        ])!,
      );
      return placed.documents[0]!.nets.find((net) =>
        net.terminals.some(
          (terminal) =>
            terminal.instanceId === "Q1" && terminal.pinName === "S",
        ),
      )?.id;
    };
    // The rail with no NMOS default, or ground as it (a first ground marker
    // sets it), whichever came first.
    expect(substrate()).toBe("net-vneg");
    expect(substrate("net-0")).toBe("net-vneg");
    // Another Net as the NMOS default is the substrate: the person said so.
    expect(substrate("net-vsub")).toBe("net-vsub");
    expect(substrate("net-vneg")).toBe("net-vneg");
    // Without a rail, ground.
    expect(substrate("net-0", false)).toBe("net-0");
    expect(substrate(undefined, false)).toBe("net-0");
  });
});

describe("persisted netlist process authoring", () => {
  it.each(NETLIST_PROFILE_IDS)(
    "keeps both copy syntaxes available under %s without a simulator profile",
    (process) => {
      const project = apply(
        createLibraryExampleProject("common-source-amplifier")!,
        createNetlistExportProfile(process),
      );
      const before = structuredClone(project);
      for (const format of ["spice", "spectre"] as const) {
        const result = createDesignNetlistExport(project, {
          format,
          includeLocations: true,
        });
        expect(result.status, JSON.stringify(result.diagnostics)).toBe("ready");
        if (result.status !== "ready") continue;
        expect(result.file.text).toContain(
          createNetlistExportProfile(process).devices.nmos.target,
        );
        expect(result.locations.instances.length).toBeGreaterThan(0);
        expect(result.file.text).not.toContain("TODO");
      }
      expect(project).toEqual(before);
    },
  );
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

  it("keeps exporting the TSMC models a Project already uses, read as Custom", () => {
    // Saved while TSMC 28 was a Process: a transistor on its model, counted
    // by multi, and a NAND on its standard cell.
    let project = createEmptyProject("tsmc", "TSMC");
    const document = project.documents[0]!;
    document.instances.push(
      {
        id: "M1",
        reference: "M1",
        symbolId: "nmos",
        placement: null,
        netlist: {
          binding: { kind: "model", deviceClass: "mos", name: "nch_ulvt_mac" },
          parameters: { w: "1u", l: "30n", multi: "2" },
        },
      },
      {
        id: "X1",
        reference: "X1",
        symbolId: "nand-gate",
        placement: null,
        netlist: {
          binding: { kind: "external-subcircuit", definitionId: "nand" },
          parameters: {},
        },
      },
    );
    project.externalSubcircuitDefinitions.push({
      id: "nand",
      name: "ND2D1BWP12T30P140",
      terminals: ["A1", "A2", "ZN", "VDD", "VSS"].map((name) => ({
        id: `nand-${name}`,
        name,
        direction: "passive",
      })),
      formalParameters: [],
      interfaceStatus: "declared",
    });
    for (const [instanceId, pinName] of [
      ["M1", "D"],
      ["M1", "G"],
      ["M1", "S"],
      ["M1", "B"],
      ["X1", "A"],
      ["X1", "B"],
      ["X1", "Y"],
    ] as const)
      document.noConnects.push({
        id: `${instanceId}-${pinName}`,
        endpoint: { kind: "terminal", instanceId, pinName },
      });
    expect(inferNetlistProcess(project, "sky130")).toBe("custom");
    const preferred = {
      ...createDefaultNetlistExportPreferences(),
      selected: "sky130" as const,
    };
    expect(processReviewedLibrary(project, preferred)).toBeUndefined();
    // Filling what is missing leaves both models and their values alone.
    project = apply(project, createNetlistExportProfile("sky130"), {
      onlyMissing: true,
    });
    const text = exported(project);
    expect(text).toMatch(
      /^M1 NC\d+ NC\d+ NC\d+ NC\d+ nch_ulvt_mac l=30n multi=2 w=1u$/mu,
    );
    expect(text).toMatch(/^X1 NC\d+ NC\d+ NC\d+ VDD VSS ND2D1BWP12T30P140$/mu);
    expect(exported(project, "spectre")).toContain("ND2D1BWP12T30P140");
  });

  it.each([
    ["resistor", "sky130_fd_pr__res_high_po"],
    ["capacitor", "sky130_fd_pr__cap_mim_m3_1"],
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
          parameters: {
            value: { resistor: "10k", capacitor: "1p", inductor: "1n" }[family],
          },
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
      // The tap a 2-pin spiral floats on its own node is its device's
      // design, not an unfinished wire, so the netlist mark holds.
      expect(designExtractsNetlist(mapped)).toBe(true);
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

it("reuses immutable defaults across tab remounts but respects profile content and snapshot changes", () => {
  const project = createEmptyProject("defaults-cache", "Defaults cache");
  project.documents[0]!.instances.push({
    id: "M1",
    reference: "M1",
    symbolId: "nmos",
    placement: null,
  });
  const profile = createNetlistExportProfile("abstract");
  const read = createNetlistDefaultsCache();
  const first = read(project, profile);
  expect(first.instanceCount).toBe(1);
  expect(read(project, structuredClone(profile))).toBe(first);
  const changedProfile = structuredClone(profile);
  changedProfile.devices.nmos.parameters.w = "9u";
  expect(read(project, changedProfile)).not.toBe(first);
  const replaced = { ...project, name: "Changed snapshot" };
  expect(read(replaced, profile)).not.toBe(first);
  expect(project.documents[0]!.instances[0]!.netlist).toBeUndefined();
});

describe("resistors and capacitors keep their value across Processes", () => {
  const MIM = "sky130_fd_pr__cap_mim_m3_1";
  const XHIGH = "sky130_fd_pr__res_xhigh_po";
  function drawn(values: Record<string, string>) {
    const project = createEmptyProject("rc", "RC");
    for (const [id, value] of Object.entries(values)) {
      const symbolId = id.startsWith("R") ? "resistor" : "capacitor";
      project.documents[0]!.instances.push({
        id,
        reference: id,
        symbolId,
        placement: null,
        netlist: initialInstanceNetlist(symbolId, { value })!,
      });
      for (const pinName of ["1", "2"])
        project.documents[0]!.noConnects.push({
          id: `${id}-${pinName}`,
          endpoint: { kind: "terminal", instanceId: id, pinName },
        });
    }
    return project;
  }
  const part = (project: CircuitProject, id: string) =>
    project.documents[0]!.instances.find((instance) => instance.id === id)!
      .netlist!;

  it("sizes ideal parts for a PDK by value, and gives them back as values", () => {
    const project = drawn({ R1: "145kΩ", C1: "25pF" });
    const sg13g2 = createNetlistExportProfile("sg13g2");
    const report = planNetlistProcessReport(project, sg13g2);
    expect(
      report.conversions.map(({ reference, from, to, status, value }) => ({
        reference,
        from,
        to,
        status,
        value,
      })),
    ).toEqual([
      {
        reference: "R1",
        from: "ideal",
        to: "rppd",
        status: "converted",
        value: "145kΩ",
      },
      {
        reference: "C1",
        from: "ideal",
        to: "cap_cmim",
        status: "converted",
        value: "25pF",
      },
    ]);
    const physical = apply(project, sg13g2);
    expect(part(physical, "R1").parameters).toEqual({
      w: "0.5u",
      l: "278.845u",
      b: "0",
      m: "1",
    });
    // Past cmim's 8 pF a copy, 25 pF is four copies in parallel.
    expect(part(physical, "C1").parameters).toMatchObject({ m: "4" });
    expect(exported(physical)).toMatch(
      /^XC1 .* cap_cmim w=64\.\d+u l=64\.\d+u m=4$/mu,
    );
    const ideal = apply(physical, createNetlistExportProfile("abstract"));
    expect(part(ideal, "R1")).toMatchObject({ parameters: { value: "145kΩ" } });
    expect(part(ideal, "C1")).toMatchObject({ parameters: { value: "25pF" } });
  });

  it("carries a SKY130 part's value to SG13G2, multiplier included", () => {
    let sky130 = createNetlistExportProfile("sky130");
    sky130 = setNetlistDefaultTarget(sky130, "capacitor", MIM);
    sky130 = setNetlistDefaultTarget(sky130, "resistor", XHIGH);
    const project = apply(drawn({ R1: "145kΩ", C1: "25pF" }), sky130);
    expect(part(project, "C1").parameters).toMatchObject({ mf: "14" });
    expect(part(project, "R1").parameters).toMatchObject({ w: "0.35u" });
    const sg13g2 = apply(project, createNetlistExportProfile("sg13g2"));
    expect(part(sg13g2, "C1").parameters).toMatchObject({ m: "4" });
    expect(
      planNetlistProcessReport(
        project,
        createNetlistExportProfile("sg13g2"),
      ).conversions.map((conversion) => conversion.result),
    ).toEqual(["145kΩ", "25pF"]);
  });

  it("keeps a part whose value or density is not known, and says so", () => {
    const project = drawn({ R1: "{rload}", C1: "1p" });
    const { conversions } = planNetlistProcessReport(
      project,
      createNetlistExportProfile("sg13g2"),
    );
    expect(conversions[0]).toMatchObject({
      reference: "R1",
      status: "kept",
      message: "R1 keeps ideal {rload}: its value is not a number",
    });
    const kept = apply(project, createNetlistExportProfile("sg13g2"));
    expect(part(kept, "R1")).toEqual(part(project, "R1"));
    // IHP's RF MIM is a network, not a density: the ideal part stays.
    const rf = setNetlistDefaultTarget(
      createNetlistExportProfile("sg13g2"),
      "capacitor",
      "cap_rfcmim",
    );
    expect(
      planNetlistProcessReport(project, rf, { family: "capacitor" })
        .conversions,
    ).toMatchObject([
      {
        reference: "C1",
        status: "kept",
        message: "C1 keeps ideal 1p: the density of cap_rfcmim is not known",
      },
    ]);
  });

  it("stops a value the device cannot reach at its limit, and says so", () => {
    const rsil = setNetlistDefaultTarget(
      createNetlistExportProfile("sg13g2"),
      "resistor",
      "rsil",
    );
    const { conversions } = planNetlistProcessReport(
      drawn({ R1: "1MegΩ" }),
      rsil,
      { family: "resistor" },
    );
    expect(conversions).toMatchObject([
      { reference: "R1", status: "clamped", result: "14kΩ" },
    ]);
    expect(conversions[0]!.message).toContain("the largest rsil allowed");
  });

  it("warns of each conversion where the export override reads it", () => {
    const warnings = workspaceNetlist(
      drawn({ C1: "20pF" }),
      "spice",
      "sg13g2",
    ).warnings;
    expect(warnings).toEqual([
      expect.stringMatching(
        /^PROCESS_VALUE_CONVERTED: C1: ideal 20pF → cap_cmim w=\S+ l=\S+ m=3 ≈ 20pF \(approximate\)$/u,
      ),
    ]);
  });
});
