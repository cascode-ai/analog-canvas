import { describe, expect, it } from "vitest";
import { createAgentCircuitService } from "@icm/agent-adapter";
import {
  instanceCarriesReference,
  resolveAnnotationText,
  resolveEndpointPoint,
} from "@icm/derived";
import {
  createEmptyProject,
  flattenRichText,
  type CircuitProject,
} from "@icm/model";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { AgentSessionClient } from "../../../../packages/agent-client/src/session-client";
import { FakeAgentHttp } from "../../../../packages/agent-client/src/test-support/fake-relay";
import { EditorDocumentController } from "../document/document-controller";
import { planPropertyApply } from "../features/properties/property-apply-plan";
import { planMosBulkDefaultUpdate } from "../features/component-insert/mos-bulk-defaults";
import { BrowserAgentHost } from "./browser-agent-host";

/** An Agent session over the live editor controller, as MCP reaches it. */
async function session(
  project = createEmptyProject("project-1", "Properties"),
) {
  project.documents[0]!.id = "main";
  project.topDocumentId = "main";
  const controller = new EditorDocumentController(project);
  const service = createAgentCircuitService({
    agentId: "test",
    host: new BrowserAgentHost(controller),
    permissions: {
      snapshot: true,
      render: true,
      sourceSpans: false,
      semanticControl: false,
      edit: { geometry: true, connectivity: true, presentation: true },
    },
  });
  const http = new FakeAgentHttp();
  http.circuitHandler = async ({ request }) => service.handle(request);
  const client = new AgentSessionClient({ http });
  await client.connect("session-1.code");
  const apply = async (actions: unknown[]) => {
    const report = await client.applyActions(actions);
    expect(report.ok, report.message).toBe(true);
    return report;
  };
  const refuse = async (actions: unknown[]) => {
    const report = await client.applyActions(actions);
    expect(report.ok).toBe(false);
    return report.message ?? "";
  };
  const instance = (reference: string) =>
    controller.document.instances.find((item) => item.reference === reference)!;
  return { controller, client, apply, refuse, instance };
}

const place = (symbol: string, reference: string, x: number, y = 100) => ({
  kind: "place-component",
  symbol,
  reference,
  position: { x, y },
});

describe("Agent property actions are planned as Apply in Properties", () => {
  it("leaves a part exactly as Properties would", async () => {
    const { controller, apply, instance } = await session();
    await apply([
      { ...place("resistor", "R1", 100), parameters: { value: "1k" } },
    ]);
    const before = structuredClone(controller.project);
    const resistor = instance("R1");
    await apply([
      {
        kind: "set-reference",
        target: { kind: "instance", reference: "R1" },
        reference: "R9",
      },
      // Names resolve against the call's Snapshot; an ID survives the rename.
      {
        kind: "set-property",
        target: { kind: "instance", id: resistor.id },
        set: { value: "2k" },
      },
      {
        kind: "rotate",
        target: { kind: "instance", id: resistor.id },
        rotation: 90,
      },
    ]);
    // The same three fields applied through the GUI's planner.
    const document = before.documents[0]!;
    const plan = planPropertyApply(
      {
        project: before,
        document,
        resolver: createProjectSymbolResolver(before, builtInSymbols),
        instance: document.instances.find((item) => item.id === resistor.id)!,
      },
      {
        netlistName: "R9",
        parameters: { value: "2k" },
        placement: {
          coordinate: [100, 100],
          rotation: 90,
          mirror: "none",
        },
        appearance: { color: "auto" },
      },
    );
    expect(plan.kind).toBe("edits");
    const gui = new EditorDocumentController(before);
    if (plan.kind === "edits") expect(gui.transact(plan.edits).ok).toBe(true);
    const strip = (project: CircuitProject) => ({
      instances: project.documents[0]!.instances,
      annotations: project.documents[0]!.annotations,
      nets: project.documents[0]!.nets,
    });
    expect(strip(controller.project)).toEqual(strip(gui.project));
  });

  it("changes and clears a control without losing the call's parameters", async () => {
    const { apply, instance } = await session();
    await apply([
      { ...place("resistor", "R1", 300), parameters: { value: "1k" } },
      { ...place("cccs", "F1", 100), parameters: { gain: "2" } },
    ]);
    const source = { kind: "instance", reference: "F1" };
    const control = {
      kind: "terminal-current",
      instanceId: instance("R1").id,
      pinName: "1",
      direction: "into",
    };
    await apply([
      { kind: "set-property", target: source, set: { gain: "3" } },
      { kind: "set-source-control", target: source, control },
    ]);
    expect(instance("F1").netlist).toMatchObject({
      parameters: { gain: "3" },
      control,
    });
    await apply([
      { kind: "set-property", target: source, set: { gain: "4" } },
      { kind: "set-source-control", target: source, control: null },
    ]);
    expect(instance("F1").netlist?.parameters).toEqual({ gain: "4" });
    expect(instance("F1").netlist).not.toHaveProperty("control");
  });

  it("switches a gate's input count as its Properties Inputs choice does (#1457)", async () => {
    const { controller, apply, refuse, instance } = await session();
    await apply([place("nor-gate", "X1", 100)]);
    const before = structuredClone(controller.project);
    const gate = { kind: "instance", reference: "X1" };
    await apply([{ kind: "set-property", target: gate, set: { inputs: "3" } }]);
    // The same choice in Properties.
    const document = before.documents[0]!;
    const plan = planPropertyApply(
      {
        project: before,
        document,
        resolver: createProjectSymbolResolver(before, builtInSymbols),
        instance: document.instances.find((item) => item.reference === "X1")!,
      },
      { placement: null, appearance: { color: "auto" }, inputs: 3 },
    );
    expect(plan.kind).toBe("edits");
    const gui = new EditorDocumentController(before);
    if (plan.kind === "edits") expect(gui.transact(plan.edits).ok).toBe(true);
    expect(instance("X1")).toEqual(
      gui.document.instances.find((item) => item.reference === "X1"),
    );
    expect(instance("X1").symbolId).toBe("nor-gate-3");
    await apply([{ kind: "set-property", target: gate, set: { inputs: "2" } }]);
    expect(instance("X1").symbolId).toBe("nor-gate");
    expect(
      await refuse([
        { kind: "set-property", target: gate, set: { inputs: "5" } },
      ]),
    ).toContain("inputs must be 2, 3, or 4");
    // An input wired to something stays: dropping it is refused, as in
    // Properties, and nothing changes.
    await apply([{ kind: "set-property", target: gate, set: { inputs: "3" } }]);
    await apply([place("resistor", "R1", 100, 300)]);
    await apply([
      {
        kind: "connect",
        from: { kind: "pin", instance: "X1", pin: "C" },
        to: { kind: "pin", instance: "R1", pin: "1" },
      },
    ]);
    const wired = structuredClone(controller.project);
    expect(
      await refuse([
        { kind: "set-property", target: gate, set: { inputs: "2" } },
      ]),
    ).toContain("X1.C is connected; disconnect it before choosing 2 inputs");
    expect(controller.project).toEqual(wired);
    // A pin marked No Connect is named too; a block without the choice
    // refuses it rather than exporting it as a parameter.
    await apply([place("nor-gate-3", "X2", 300), place("inverter", "X3", 500)]);
    await apply([
      {
        kind: "disconnect",
        target: { kind: "pin", instance: "X2", pin: "C" },
        noConnect: true,
      },
    ]);
    expect(
      await refuse([
        {
          kind: "set-property",
          target: { kind: "instance", reference: "X2" },
          set: { inputs: "2" },
        },
      ]),
    ).toContain("X2.C is marked No Connect; remove the mark");
    expect(
      await refuse([
        {
          kind: "set-property",
          target: { kind: "instance", reference: "X3" },
          set: { inputs: "3" },
        },
      ]),
    ).toContain("X3 (inverter) has no input count");
  });

  it("places a 3- or 4-input gate as the Inputs choice leaves one (#1457)", async () => {
    const { apply, instance } = await session();
    await apply([
      place("nor-gate-3", "X1", 100),
      place("and-gate-4", "X2", 300),
      place("nor-gate", "X3", 500),
      place("and-gate", "X4", 700),
    ]);
    // Names resolve against the call's Snapshot, so the switch is a call
    // of its own.
    await apply([
      {
        kind: "set-property",
        target: { kind: "instance", reference: "X3" },
        set: { inputs: "3" },
      },
      {
        kind: "set-property",
        target: { kind: "instance", reference: "X4" },
        set: { inputs: "4" },
      },
    ]);
    const gate = (reference: string) => {
      const { symbolId, symbolVariantId, netlist } = instance(reference);
      return { symbolId, symbolVariantId, netlist };
    };
    expect(gate("X1")).toEqual(gate("X3"));
    expect(gate("X2")).toEqual(gate("X4"));
    expect(gate("X2").symbolId).toBe("and-gate-4");
  });

  it("makes an adder input subtract as its Properties sign does (#1324)", async () => {
    const { controller, apply, refuse, instance } = await session();
    await apply([
      { ...place("adder", "X1", 100), parameters: { signB: "-" } },
      place("adder", "X2", 300),
    ]);
    expect(instance("X1").netlist?.parameters).toEqual({
      signA: "+",
      signB: "-",
    });
    // Without parameters an adder lands adding both inputs, as from the GUI.
    expect(instance("X2").netlist?.parameters).toEqual({
      signA: "+",
      signB: "+",
    });
    const before = structuredClone(controller.project);
    const x2 = instance("X2");
    const target = { kind: "instance", reference: "X2" };
    await apply([{ kind: "set-property", target, set: { signA: "-" } }]);
    expect(instance("X2").netlist?.parameters).toEqual({
      signA: "-",
      signB: "+",
    });
    // The same sign chosen in Properties.
    const document = before.documents[0]!;
    const plan = planPropertyApply(
      {
        project: before,
        document,
        resolver: createProjectSymbolResolver(before, builtInSymbols),
        instance: document.instances.find((item) => item.id === x2.id)!,
      },
      {
        parameters: { signA: "-", signB: "+" },
        placement: { coordinate: [300, 100], rotation: 0, mirror: "none" },
        appearance: { color: "auto" },
      },
    );
    expect(plan.kind).toBe("edits");
    const gui = new EditorDocumentController(before);
    if (plan.kind === "edits") expect(gui.transact(plan.edits).ok).toBe(true);
    expect(controller.document.instances).toEqual(gui.document.instances);

    // #1324 spells the minus as U+2212. Typed so, by an Agent or in
    // Properties, it is taken and stored as -.
    await apply([{ kind: "set-property", target, set: { signB: "−" } }]);
    expect(instance("X2").netlist?.parameters).toEqual({
      signA: "-",
      signB: "-",
    });
    await apply([{ ...place("adder", "X3", 500), parameters: { signA: "−" } }]);
    expect(instance("X3").netlist?.parameters).toEqual({
      signA: "-",
      signB: "+",
    });
    const typed = structuredClone(controller.project);
    const typedDocument = typed.documents[0]!;
    const x1 = typedDocument.instances.find((item) => item.reference === "X1")!;
    const typedPlan = planPropertyApply(
      {
        project: typed,
        document: typedDocument,
        resolver: createProjectSymbolResolver(typed, builtInSymbols),
        instance: x1,
      },
      {
        parameters: { signA: "−", signB: "-" },
        placement: { coordinate: [100, 100], rotation: 0, mirror: "none" },
        appearance: { color: "auto" },
      },
    );
    expect(typedPlan).toMatchObject({
      kind: "edits",
      edits: [
        {
          kind: "patch_instance_netlist_parameters",
          instanceId: x1.id,
          set: { signA: "-" },
        },
      ],
    });

    // Anything else is refused: a word, or another dash.
    expect(
      await refuse([{ kind: "set-property", target, set: { signB: "minus" } }]),
    ).toContain('must be one of: +, -; received "minus"');
    expect(
      await refuse([
        { ...place("adder", "X4", 700), parameters: { signA: "–" } },
      ]),
    ).toContain('must be one of: +, -; received "–"');
  });

  it("takes VDD as a comparator's high level, as Properties does (#1306)", async () => {
    const { controller, apply, refuse, instance } = await session();
    await apply([place("comparator", "X1", 100)]);
    // Without parameters a comparator lands as from the GUI: its output
    // swings up to its own VDD, as the logic it drives reads it.
    expect(instance("X1").netlist?.parameters).toEqual({
      vhigh: "VDD",
      vlow: "0",
      vtransition: "1m",
    });
    const target = { kind: "instance", reference: "X1" };
    await apply([{ kind: "set-property", target, set: { vhigh: "3.3" } }]);
    expect(instance("X1").netlist?.parameters.vhigh).toBe("3.3");
    const before = structuredClone(controller.project);
    const x1 = instance("X1");
    // VDD in any case, kept as typed.
    await apply([{ kind: "set-property", target, set: { vhigh: "vdd" } }]);
    expect(instance("X1").netlist?.parameters).toEqual({
      vhigh: "vdd",
      vlow: "0",
      vtransition: "1m",
    });
    // The same value applied in Properties.
    const document = before.documents[0]!;
    const plan = planPropertyApply(
      {
        project: before,
        document,
        resolver: createProjectSymbolResolver(before, builtInSymbols),
        instance: document.instances.find((item) => item.id === x1.id)!,
      },
      {
        parameters: { vhigh: "vdd", vlow: "0", vtransition: "1m" },
        placement: { coordinate: [100, 100], rotation: 0, mirror: "none" },
        appearance: { color: "auto" },
      },
    );
    expect(plan.kind).toBe("edits");
    const gui = new EditorDocumentController(before);
    if (plan.kind === "edits") expect(gui.transact(plan.edits).ok).toBe(true);
    expect(controller.document.instances).toEqual(gui.document.instances);
    // Anything else is refused, with the forms it takes named; export
    // checks a number, so not an expression either.
    for (const vhigh of ["VSS", "{vdd/2}"])
      expect(
        await refuse([{ kind: "set-property", target, set: { vhigh } }]),
      ).toContain(
        `must be a SPICE number such as 1k or 2.5n, or VDD; received "${vhigh}"`,
      );
  });

  it("refuses an upper-case M before a unit with both readings (#1409)", async () => {
    const { apply, refuse, instance } = await session();
    await apply([
      { ...place("resistor", "R1", 100), parameters: { value: "1k" } },
    ]);
    const target = { kind: "instance", reference: "R1" };
    expect(
      await refuse([{ kind: "set-property", target, set: { value: "1MΩ" } }]),
    ).toContain(
      'Parameter "value" is "1MΩ", which reads as 1 mΩ in SPICE (M is milli): write 1MegΩ for mega or 1mΩ for milli',
    );
    expect(instance("R1").netlist?.parameters.value).toBe("1k");
    await apply([{ kind: "set-property", target, set: { value: "1MegΩ" } }]);
    expect(instance("R1").netlist?.parameters.value).toBe("1MegΩ");
  });

  it("refuses spice.* keys and names the parameters the model owns", async () => {
    const { apply, refuse } = await session();
    await apply([place("nmos", "M1", 100)]);
    const set = (values: Record<string, string>) => [
      {
        kind: "set-property",
        target: { kind: "instance", reference: "M1" },
        set: values,
      },
    ];
    expect(await refuse(set({ "spice.model": "nch" }))).toContain("spice.*");
    expect(await refuse(set({ madeUp: "1" }))).toContain("Unknown parameter");
    expect(await refuse(set({ nf: "two" }))).toContain("finite decimal number");
  });

  it("checks a resistor bound to a reviewed SKY130 model against that model", async () => {
    // Issue #1274: the SKY130 resistor takes w, l and mult, not value.
    const project = createEmptyProject("project-1", "Sky130");
    project.externalSubcircuitDefinitions = [
      {
        id: "def-res",
        name: "sky130_fd_pr__res_high_po",
        terminals: ["R0", "R1", "B"].map((name, index) => ({
          id: `def-res-terminal-${index}`,
          name,
          direction: "passive" as const,
        })),
        formalParameters: [],
        interfaceStatus: "declared" as const,
      },
    ];
    project.documents[0]!.instances.push({
      id: "R1",
      symbolId: "resistor",
      reference: "R1",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
      netlist: {
        binding: { kind: "external-subcircuit", definitionId: "def-res" },
        parameters: {},
      },
    } as never);
    const { apply, refuse, instance } = await session(project);
    const target = { kind: "instance", reference: "R1" };
    expect(
      await refuse([{ kind: "set-property", target, set: { value: "1k" } }]),
    ).toContain("allowed parameters: w, l, mult");
    await apply([
      { kind: "set-property", target, set: { w: "2", l: "6", mult: "1" } },
    ]);
    expect(instance("R1").netlist?.parameters).toEqual({
      w: "2",
      l: "6",
      mult: "1",
    });
  });

  it("binds a block's supply, returns it to Auto, and refuses a part without one", async () => {
    const { controller, apply, refuse, instance } = await session();
    await apply([
      place("vdd-port", "VDD", 100, 0),
      place("inverter", "X1", 300),
    ]);
    const marker = controller.document.instances.find(
      (item) => item.symbolId === "vdd-port",
    )!;
    const vddNet = controller.document.nets.find((net) =>
      net.terminals.some((pin) => pin.instanceId === marker.id),
    )!;
    const target = { kind: "instance", reference: "X1" };
    const supplyNet = () =>
      controller.document.nets.find((net) =>
        net.terminals.some(
          (pin) =>
            pin.instanceId === instance("X1").id && pin.pinName === "VDD",
        ),
      );
    await apply([
      {
        kind: "set-block-supply",
        target,
        supply: "VDD",
        net: { kind: "net", id: vddNet.id },
      },
    ]);
    expect(supplyNet()?.id).toBe(vddNet.id);
    await apply([
      { kind: "set-block-supply", target, supply: "VDD", net: null },
    ]);
    expect(supplyNet()).toBeUndefined();
    await apply([place("nmos", "M1", 500)]);
    expect(
      await refuse([
        {
          kind: "set-block-supply",
          target: { kind: "instance", reference: "M1" },
          supply: "VDD",
          net: null,
        },
      ]),
    ).toContain("has no VDD supply to choose");
  });

  it("changes a Cell's body default as Properties does, moving the bodies that followed the old one (#1520)", async () => {
    const { controller, apply, refuse, instance } = await session();
    // The supply placed after them gives their bodies the Cell default.
    await apply([
      place("pmos", "M1", 100),
      place("pmos", "M2", 300),
      place("vdd-port", "VDD", 100, 0),
      place("port", "VB", 400, 0),
    ]);
    // M2's body is wired to its source, a body the default does not own.
    await apply([
      {
        kind: "connect",
        from: { kind: "pin", instance: "M2", pin: "B" },
        to: { kind: "pin", instance: "M2", pin: "S" },
      },
    ]);
    const netOf = (instanceId: string, pinName: string) =>
      controller.document.nets.find((net) =>
        net.terminals.some(
          (pin) => pin.instanceId === instanceId && pin.pinName === pinName,
        ),
      )?.id;
    const m1 = instance("M1").id;
    const m2 = instance("M2").id;
    const vdd = netOf(m1, "B");
    const vb = netOf(
      controller.document.instances.find((item) => item.symbolId === "port")!
        .id,
      "P",
    )!;
    expect(vdd).toBeDefined();
    expect(controller.document.mosBulkDefaults?.pmosNetId).toBe(vdd);
    // What the Cell settings in Properties commit for the same choice.
    const gui = new EditorDocumentController(
      structuredClone(controller.project),
    );
    expect(
      gui.transact(
        planMosBulkDefaultUpdate(gui.project, gui.document, "pmos", vb),
      ).ok,
    ).toBe(true);

    await apply([{ kind: "set-mos-bulk-default", mos: "pmos", net: "VB" }]);
    expect(controller.document.nets).toEqual(gui.document.nets);
    expect(controller.document.instances).toEqual(gui.document.instances);
    expect(controller.document.mosBulkDefaults?.pmosNetId).toBe(vb);
    expect(netOf(m1, "B")).toBe(vb);
    expect(netOf(m2, "B")).toBe(netOf(m2, "S"));

    // One undo step; null clears the default.
    await apply([{ kind: "undo" }]);
    expect(netOf(m1, "B")).toBe(vdd);
    await apply([{ kind: "set-mos-bulk-default", mos: "pmos", net: null }]);
    expect(controller.document.mosBulkDefaults?.pmosNetId).toBeUndefined();
    expect(
      await refuse([{ kind: "set-mos-bulk-default", mos: "nmos", net: "VX" }]),
    ).toContain("Net not found: VX");
  });

  it("sets a formula block's drawing and drops an old formula's look", async () => {
    const { apply, refuse, instance, controller } = await session();
    await apply([
      {
        kind: "place-component",
        symbol: "integrator",
        position: { x: 100, y: 100 },
        signalFlow: { formula: "1/s" },
      },
      { ...place("resistor", "R1", 400), parameters: { value: "1k" } },
    ]);
    const block = controller.document.instances.find(
      (item) => item.symbolId === "integrator",
    )!;
    const target = { kind: "instance", id: block.id };
    const current = () =>
      controller.document.instances.find((item) => item.id === block.id)!
        .signalFlowParameters;
    await apply([
      {
        kind: "set-signal-flow",
        target,
        formula: "1/(1-z^-1)",
        coefficient: "b",
      },
    ]);
    expect(current()).toEqual({ formula: "1/(1-z^-1)", coefficient: "b" });
    await apply([{ kind: "set-signal-flow", target, formula: null }]);
    expect(current()).toEqual({ coefficient: "b" });
    expect(
      await refuse([{ kind: "set-property", target, set: { formula: "x" } }]),
    ).toContain("use set-signal-flow");
    expect(
      await refuse([
        {
          kind: "set-signal-flow",
          target: { kind: "instance", reference: "R1" },
          formula: "R",
        },
      ]),
    ).toContain("draws no formula");
    expect(instance("R1").signalFlowParameters).toBeUndefined();
  });

  it("reflects a part from where it is and sets an orientation as a state", async () => {
    const { apply, instance } = await session();
    await apply([place("nmos", "M1", 100)]);
    const m1 = { kind: "instance", reference: "M1" };
    const mirrors: string[] = [];
    for (const axis of ["y", "x", "y"]) {
      await apply([{ kind: "mirror", target: m1, axis }]);
      mirrors.push(instance("M1").placement!.mirror);
    }
    expect(mirrors).toEqual(["horizontal", "both", "vertical"]);
    await apply([
      { kind: "set-orientation", target: m1, rotation: 90, mirror: "none" },
    ]);
    expect(instance("M1").placement).toMatchObject({
      rotation: 90,
      mirror: "none",
    });
  });

  it("names the nearest landing when a pin cannot land where asked", async () => {
    const { apply, refuse } = await session();
    await apply([place("nmos", "M1", 100)]);
    expect(
      await refuse([
        {
          kind: "move",
          target: { kind: "instance", reference: "M1" },
          pinAnchor: { pinName: "D", position: { x: 103, y: 100 } },
        },
      ]),
    ).toContain("nearest reachable landing is");
  });

  it("moves a ground that only touches the part's pin along with it, and names it (#1531)", async () => {
    const { controller, apply, instance } = await session();
    const pinAt = (instanceId: string, pinName: string) =>
      resolveEndpointPoint(controller.document, controller.resolver, {
        kind: "terminal",
        instanceId,
        pinName,
      })!;
    // A VDD marker wired to R2 has another connection when R1's pin 1
    // lands on it; the ground stands on R1's pin 2 with no wire (house style).
    await apply([
      { ...place("resistor", "R2", 400, 200), parameters: { value: "1k" } },
      {
        kind: "place-component",
        symbol: "vdd-port",
        id: "vdd-r1",
        pinAnchor: { pinName: "P", position: { x: 200, y: 180 } },
      },
    ]);
    await apply([
      {
        kind: "connect",
        from: {
          kind: "pin",
          instance: { kind: "instance", id: "vdd-r1" },
          pin: "P",
        },
        to: { kind: "pin", instance: "R2", pin: "1" },
      },
    ]);
    await apply([
      {
        kind: "place-component",
        symbol: "resistor",
        reference: "R1",
        parameters: { value: "1k" },
        pinAnchor: { pinName: "1", position: { x: 200, y: 180 } },
      },
    ]);
    const r1 = instance("R1").id;
    await apply([
      {
        kind: "place-component",
        symbol: "ground",
        id: "gnd-r1",
        pinAnchor: { pinName: "0", position: pinAt(r1, "2") },
      },
    ]);
    const netOf = (instanceId: string, pinName: string) =>
      controller.document.nets.find((net) =>
        net.terminals.some(
          (terminal) =>
            terminal.instanceId === instanceId && terminal.pinName === pinName,
        ),
      )?.id;
    const at = (id: string) =>
      controller.document.instances.find((item) => item.id === id)!.placement!
        .position;
    expect(netOf("gnd-r1", "0")).toBe(netOf(r1, "2"));
    const routes = controller.document.routes.map((route) => route.id);
    const ground = at("gnd-r1");
    const vdd = at("vdd-r1");
    const pin1 = pinAt(r1, "1");

    const moved = await apply([
      {
        kind: "move",
        target: { kind: "instance", reference: "R1" },
        pinAnchor: { pinName: "1", position: { x: pin1.x + 20, y: pin1.y } },
      },
    ]);
    // The ground rides along as one piece with R1: same step, no jog wire.
    expect(at("gnd-r1")).toEqual({ x: ground.x + 20, y: ground.y });
    expect(pinAt("gnd-r1", "0")).toEqual(pinAt(r1, "2"));
    expect(netOf("gnd-r1", "0")).toBe(netOf(r1, "2"));
    expect(
      controller.document.routes.filter(
        (route) => route.netId === netOf(r1, "2"),
      ),
    ).toEqual([]);
    // The wired VDD marker keeps its place; its contact becomes a wire.
    expect(at("vdd-r1")).toEqual(vdd);
    expect(netOf("vdd-r1", "P")).toBe(netOf(r1, "1"));
    expect(controller.document.routes.length).toBe(routes.length + 1);
    expect(moved.diagnosticDelta?.added).toContainEqual(
      expect.objectContaining({
        code: "MARKERS_MOVED_ALONG",
        severity: "info",
        objectIds: ["gnd-r1"],
        message:
          "R1 moved with the ground gnd-r1 on pin 2, which touched it with no wire",
      }),
    );

    // Among other moves in one call, too.
    const both = await apply([
      {
        kind: "move",
        target: { kind: "instance", reference: "R2" },
        position: { x: 400, y: 260 },
      },
      {
        kind: "move",
        target: { kind: "instance", reference: "R1" },
        position: { x: 240, y: 200 },
      },
    ]);
    expect(at("gnd-r1")).toEqual({ x: ground.x + 40, y: ground.y });
    expect(both.diagnosticDelta?.added).toContainEqual(
      expect.objectContaining({
        code: "MARKERS_MOVED_ALONG",
        objectIds: ["gnd-r1"],
      }),
    );

    // Beside a command that plans a Project transaction, as a model change
    // does, the receipt still names the marker.
    await apply([
      { ...place("nmos", "M1", 500), parameters: { w: "1u", l: "150n" } },
    ]);
    const withModel = await apply([
      {
        kind: "move",
        target: { kind: "instance", reference: "R1" },
        position: { x: 260, y: 200 },
      },
      {
        kind: "set-model",
        instanceId: instance("M1").id,
        model: "sky130_fd_pr__nfet_01v8",
      },
    ]);
    expect(withModel.ok, withModel.message).toBe(true);
    expect(at("gnd-r1")).toEqual({ x: ground.x + 60, y: ground.y });
    expect(JSON.stringify(withModel)).toContain("MARKERS_MOVED_ALONG");

    // A marker whose label is locked stays, joined by a wire, rather than
    // failing the move: here a VDD marker standing on R3's pin.
    await apply([
      {
        kind: "place-component",
        symbol: "resistor",
        reference: "R3",
        parameters: { value: "1k" },
        pinAnchor: { pinName: "1", position: { x: 600, y: 180 } },
      },
    ]);
    const r3 = instance("R3").id;
    await apply([
      {
        kind: "place-component",
        symbol: "vdd-port",
        id: "vdd-r3",
        pinAnchor: { pinName: "P", position: pinAt(r3, "1") },
      },
    ]);
    const label = controller.document.annotations.find(
      (annotation) =>
        annotation.anchor.kind === "object" &&
        annotation.anchor.objectId === "vdd-r3",
    )!;
    expect(
      controller.transact([
        {
          kind: "upsert_schematic_annotation",
          annotation: { ...label, locked: true },
        },
      ]).ok,
    ).toBe(true);
    const held = at("vdd-r3");
    const stayed = await apply([
      {
        kind: "move",
        target: { kind: "instance", reference: "R3" },
        position: { x: 640, y: 200 },
      },
    ]);
    expect(stayed.ok, stayed.message).toBe(true);
    expect(at("vdd-r3")).toEqual(held);
    expect(netOf("vdd-r3", "P")).toBe(netOf(r3, "1"));
  });

  it("disconnects a wired pin as its Delete connection does", async () => {
    const { controller, apply, instance } = await session();
    await apply([
      { ...place("resistor", "R1", 100), parameters: { value: "1k" } },
      { ...place("resistor", "R2", 300), parameters: { value: "1k" } },
    ]);
    await apply([
      {
        kind: "connect",
        from: { kind: "pin", instance: "R1", pin: "2" },
        to: { kind: "pin", instance: "R2", pin: "1" },
      },
    ]);
    const routes = controller.document.routes.length;
    await apply([
      { kind: "disconnect", target: { kind: "pin", instance: "R1", pin: "2" } },
    ]);
    const shared = controller.document.nets.find((net) =>
      net.terminals.some(
        (pin) => pin.instanceId === instance("R2").id && pin.pinName === "1",
      ),
    );
    expect(
      shared?.terminals.some((pin) => pin.instanceId === instance("R1").id) ??
        false,
    ).toBe(false);
    expect(controller.document.routes.length).toBeLessThan(routes);
  });

  it("shows a placed Cell's X1 on request, as the Properties Reference switch does (#1317)", async () => {
    const { controller, client, apply, instance } = await session();
    const inCell = async (actions: unknown[]) => {
      const report = await client.applyActions(actions, { documentId: "inv" });
      expect(report.ok, report.message).toBe(true);
    };
    await apply([{ kind: "create-cell", id: "inv", name: "inv" }]);
    await inCell([
      {
        kind: "place-component",
        symbol: "port",
        reference: "in",
        position: { x: 0, y: 0 },
      },
    ]);
    await apply([
      {
        kind: "place-cell",
        childDocumentId: "inv",
        placement: { position: { x: 200, y: 200 } },
      },
    ]);
    const cell = instance("X1");
    const labels = (project: CircuitProject) =>
      project.documents[0]!.annotations.filter(
        (item) =>
          item.anchor.kind === "object" && item.anchor.objectId === cell.id,
      );
    const at = (project: CircuitProject, kind: string) => {
      const label = labels(project).find((item) => item.kind === kind);
      return label?.anchor.kind === "object"
        ? label.anchor.fallbackPosition
        : undefined;
    };
    // By default only the Cell's name shows, in the Reference's slot (#803);
    // Properties still offers the Reference switch for it.
    expect(labels(controller.project).map((item) => item.kind)).toEqual([
      "instance-value",
    ]);
    expect(instanceCarriesReference(cell, controller.project)).toBe(true);
    const nameSlot = at(controller.project, "instance-value");

    const before = structuredClone(controller.project);
    const document = before.documents[0]!;
    const plan = planPropertyApply(
      {
        project: before,
        document,
        resolver: createProjectSymbolResolver(before, builtInSymbols),
        instance: document.instances.find((item) => item.id === cell.id)!,
      },
      {
        placement: { coordinate: [200, 200], rotation: 0, mirror: "none" },
        display: { visualAnnotation: true },
        appearance: { color: "auto" },
      },
    );
    expect(plan.kind).toBe("edits");
    const gui = new EditorDocumentController(before);
    if (plan.kind === "edits") expect(gui.transact(plan.edits).ok).toBe(true);

    await apply([
      {
        kind: "set-instance-display",
        instanceIds: [cell.id],
        showReference: true,
      },
    ]);
    expect(labels(controller.project)).toEqual(labels(gui.project));
    const reference = labels(controller.project).find(
      (item) => item.binding?.kind === "instance-reference",
    )!;
    expect(reference.visible).toBeUndefined();
    expect(
      flattenRichText(resolveAnnotationText(controller.document, reference)),
    ).toBe("X1");
    // X1 takes the slot the Cell's name had; the name moves a row below.
    expect(at(controller.project, "instance-label")).toEqual(nameSlot);
    expect(at(controller.project, "instance-value")!.y).toBe(nameSlot!.y + 20);
    // Hidden again, the Cell's name returns to its slot.
    await apply([
      {
        kind: "set-instance-display",
        instanceIds: [cell.id],
        showReference: false,
      },
    ]);
    expect(at(controller.project, "instance-value")).toEqual(nameSlot);
  });
});
