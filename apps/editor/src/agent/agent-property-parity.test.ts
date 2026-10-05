import { describe, expect, it } from "vitest";
import { createAgentCircuitService } from "@icm/agent-adapter";
import { instanceCarriesReference, resolveAnnotationText } from "@icm/derived";
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
    // A sign is + or -: not a Unicode minus, not a word.
    expect(
      await refuse([{ kind: "set-property", target, set: { signB: "−" } }]),
    ).toContain('must be one of: +, -; received "−"');
    expect(
      await refuse([
        { ...place("adder", "X3", 500), parameters: { signA: "minus" } },
      ]),
    ).toContain("must be one of: +, -");
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
