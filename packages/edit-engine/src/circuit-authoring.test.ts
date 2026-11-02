import { describe, expect, it } from "vitest";
import {
  CircuitProjectSchema,
  createEmptyProject,
  type CircuitProject,
  type ComponentDefinition,
} from "@icm/model";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  drawnPinNames,
  externalSubcircuitSymbolId,
} from "@icm/symbols";
import { createExternalSubcircuitInstance } from "./hierarchy-planner.js";
import {
  executeProjectTransaction,
  ProjectStructureEditSchema,
  type ProjectStructureEdit,
} from "./project-transaction.js";

it("applies raw custom artwork and formal-name metadata through the ordinary source transaction", () => {
  const project = createEmptyProject("authoring", "Authoring");
  const resistor = structuredClone(
    builtInSymbols.find((symbol) => symbol.id === "resistor")!,
  );
  const graphicalNames = resistor.pins.map((pin) => pin.name);
  const edit = ProjectStructureEditSchema.parse({
    kind: "apply_model_source",
    source: {
      id: "source",
      revision: 0,
      language: "spice",
      entry: "model.spice",
      dependencies: [],
      files: [
        {
          path: "model.spice",
          text: ".subckt stage IN OUT params: R=1k\nR1 IN OUT {R}\n.ends stage\n",
        },
      ],
    },
    definitions: [
      {
        definitionId: "stage",
        entry: "stage",
        authoring: {
          symbolMode: "custom",
          artworkText: JSON.stringify({
            symbol: { ...resistor, id: "custom-stage" },
          }),
          terminalDirections: { IN: "input", OUT: "output" },
          pinMap: {
            IN: { pinName: graphicalNames[1] },
            OUT: { pinName: graphicalNames[0] },
          },
        },
      },
    ],
  });
  const result = executeProjectTransaction(project, {
    projectId: project.id,
    expectedStructureRevision: 0,
    transactionId: "author",
    actor: { kind: "agent", id: "test" },
    edits: [edit],
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw Error(result.error.message);
  const owner = result.project.externalSubcircuitDefinitions[0]!;
  expect(
    owner.terminals.map((terminal) => [terminal.name, terminal.direction]),
  ).toEqual([
    ["IN", "input"],
    ["OUT", "output"],
  ]);
  expect(owner.formalParameters).toEqual([{ name: "R", defaultValue: "1k" }]);
  expect(result.project.componentDefinitions![0]!.circuitBinding).toEqual({
    definitionId: "stage",
    terminals: [
      { terminalId: owner.terminals[0]!.id, pinName: graphicalNames[1] },
      { terminalId: owner.terminals[1]!.id, pinName: graphicalNames[0] },
    ],
  });
  expect(project.externalSubcircuitDefinitions).toEqual([]);
  const next = executeProjectTransaction(result.project, {
    projectId: project.id,
    expectedStructureRevision: result.project.structureRevision,
    transactionId: "directions-only",
    actor: { kind: "agent", id: "test" },
    edits: [
      {
        ...edit,
        source: result.project.modelSources![0]!,
        definitions: [
          {
            definitionId: owner.id,
            entry: "stage",
            authoring: {
              symbolMode: "custom",
              terminalDirections: { OUT: "inout" },
            },
          },
        ],
      },
    ],
  });
  expect(next.ok).toBe(true);
  if (!next.ok) throw Error(next.error.message);
  expect(next.project.componentDefinitions).toEqual(
    result.project.componentDefinitions,
  );
  expect(
    next.project.externalSubcircuitDefinitions[0]!.terminals[1]!.direction,
  ).toBe("inout");
  const remapped = executeProjectTransaction(next.project, {
    projectId: project.id,
    expectedStructureRevision: next.project.structureRevision,
    transactionId: "mapping-only",
    actor: { kind: "agent", id: "test" },
    edits: [
      {
        ...edit,
        source: next.project.modelSources![0]!,
        definitions: [
          {
            definitionId: owner.id,
            entry: "stage",
            authoring: {
              symbolMode: "custom",
              pinMap: {
                IN: { pinName: graphicalNames[0]! },
                OUT: { pinName: graphicalNames[1]! },
              },
            },
          },
        ],
      },
    ],
  });
  expect(remapped.ok, JSON.stringify(remapped)).toBe(true);
  if (!remapped.ok) throw Error(remapped.error.message);
  const capture = remapped.project.componentDefinitions!.find(
    (component) =>
      component.symbol.id ===
      remapped.project.externalSubcircuitDefinitions[0]!.symbolId,
  )!;
  expect(capture.symbol.primitives).toEqual(resistor.primitives);
  expect(
    capture.circuitBinding!.terminals.map(
      (mapping) => "pinName" in mapping && mapping.pinName,
    ),
  ).toEqual(graphicalNames);
});

it.each([
  { symbolMode: "custom" },
  { symbolMode: "custom", artworkText: "{ unfinished" },
  { symbolMode: "automatic", terminalDirections: { MISSING: "input" } },
  { symbolMode: "automatic", pinMap: { IN: { supply: "VDD" } } },
  {
    symbolMode: "custom",
    artworkText: JSON.stringify({
      symbol: builtInSymbols.find((s) => s.id === "resistor"),
    }),
    pinMap: { IN: { supply: "VDD" }, OUT: { supply: "VSS" } },
  },
])(
  "refuses invalid authoring atomically without manufacturing contacts: %j",
  (authoring) => {
    const project = createEmptyProject("refusal", "Refusal");
    const before = structuredClone(project);
    const edit = ProjectStructureEditSchema.parse({
      kind: "apply_model_source",
      source: {
        id: "source",
        revision: 0,
        language: "spice",
        entry: "model.spice",
        files: [
          {
            path: "model.spice",
            text: ".subckt stage IN OUT\nR1 IN OUT 1k\n.ends stage\n",
          },
        ],
        dependencies: [],
      },
      definitions: [{ definitionId: "stage", entry: "stage", authoring }],
    });
    const result = executeProjectTransaction(project, {
      projectId: project.id,
      expectedStructureRevision: 0,
      transactionId: "refuse",
      actor: { kind: "agent", id: "test" },
      edits: [edit],
    });
    expect(result.ok).toBe(false);
    expect(project).toEqual(before);
  },
);

/** A native owner `amp` with its automatic symbol, as Apply in the GUI leaves it. */
function nativeAmp() {
  const project = createEmptyProject("native-amp", "Native amp");
  const applied = transact(
    project,
    [
      {
        kind: "apply_model_source",
        source: {
          id: "amp-source",
          revision: 0,
          language: "spice",
          entry: "model.spice",
          dependencies: [],
          files: [
            {
              path: "model.spice",
              text: ".subckt amp IN OUT VSS\nR1 IN OUT 1k\nR2 OUT VSS 1k\n.ends amp\n",
            },
          ],
        },
        definitions: [{ definitionId: "amp", entry: "amp" }],
      },
    ],
    "human",
  );
  if (!applied.ok) throw Error(applied.error.message);
  const owner = applied.project.externalSubcircuitDefinitions[0]!;
  const automatic = createProjectSymbolResolver(
    applied.project,
    builtInSymbols,
  ).resolve(externalSubcircuitSymbolId(owner.id))!.definition;
  const terminal = (name: string) =>
    owner.terminals.find((item) => item.name === name)!.id;
  return { project: applied.project, owner, automatic, terminal };
}

function transact(
  project: CircuitProject,
  edits: ProjectStructureEdit[],
  actor: "agent" | "human" = "agent",
) {
  return executeProjectTransaction(project, {
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    transactionId: crypto.randomUUID(),
    actor: { kind: actor, id: "test" },
    edits,
  });
}

/** Captures `artwork` as the owner's custom symbol and places X1 with it. */
function placedCustomAmp(
  artwork: (amp: ReturnType<typeof nativeAmp>) => ComponentDefinition,
) {
  const amp = nativeAmp();
  const custom = artwork(amp);
  const result = transact(amp.project, [
    {
      kind: "apply_model_source",
      source: amp.project.modelSources![0]!,
      definitions: [{ definitionId: "amp", entry: "amp", symbol: custom }],
    },
  ]);
  if (!result.ok) throw Error(result.error.message);
  const caller = createExternalSubcircuitInstance("X1", amp.owner, {
    position: { x: 200, y: 200 },
    rotation: 0,
    mirror: "none",
  });
  caller.symbolId = custom.symbol.id;
  result.project.documents[0]!.instances.push(caller);
  return { ...amp, project: result.project, custom };
}

describe("custom native artwork through the Project transaction", () => {
  it("initializes a same-name custom artwork's checked mapping and refuses an unknown formal terminal", () => {
    const { project, owner, automatic, terminal } = nativeAmp();
    const applied = transact(project, [
      {
        kind: "apply_model_source",
        source: project.modelSources![0]!,
        definitions: [
          {
            definitionId: "amp",
            entry: "amp",
            authoring: {
              symbolMode: "custom",
              artworkText: JSON.stringify({
                symbol: {
                  ...automatic,
                  id: "same-name-artwork",
                  pins: automatic.pins.map((pin) =>
                    pin.name === "IN" ? { ...pin, role: "gate" } : pin,
                  ),
                },
              }),
            },
          },
        ],
      },
    ]);
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    if (!applied.ok) return;
    const captured = applied.project.componentDefinitions!.find(
      (item) => item.symbol.id === "same-name-artwork",
    )!;
    expect(captured.circuitBinding!.terminals).toEqual(
      ["IN", "OUT", "VSS"].map((name) => ({
        terminalId: terminal(name),
        pinName: name,
      })),
    );
    expect(captured.symbol.pins.find((pin) => pin.name === "IN")!.role).toBe(
      "gate",
    );
    expect(applied.project.modelSources![0]!.files).toEqual(
      project.modelSources![0]!.files,
    );
    const invalid = structuredClone(captured);
    invalid.symbol.id = "unknown-terminal-artwork";
    invalid.circuitBinding!.terminals[0]!.terminalId = "unknown-formal-port";
    const caller = createExternalSubcircuitInstance("X1", owner, {
      position: { x: 200, y: 200 },
      rotation: 0,
      mirror: "none",
    });
    caller.symbolId = captured.symbol.id;
    applied.project.documents[0]!.instances.push(caller);
    const before = structuredClone(applied.project);
    const refused = transact(applied.project, [
      { kind: "capture_component_definition", definition: invalid },
      {
        kind: "transact_document",
        documentId: before.documents[0]!.id,
        expectedRevision: before.documents[0]!.revision,
        edits: [
          {
            kind: "set_instance_symbol",
            instanceId: "X1",
            symbolId: invalid.symbol.id,
          },
        ],
      },
    ]);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toContain("circuitBinding");
    expect(applied.project).toEqual(before);
  });

  it("refuses dropping a caller's property supply mapping and refuses collapsed ports", () => {
    const { project, owner, custom, terminal } = placedCustomAmp(
      ({ automatic, terminal }) => ({
        symbol: {
          ...automatic,
          id: "supply-artwork",
          pins: automatic.pins.filter((pin) => pin.name !== "VSS"),
        },
        circuitBinding: {
          definitionId: "amp",
          terminals: [
            { terminalId: terminal("IN"), pinName: "IN" },
            { terminalId: terminal("OUT"), pinName: "OUT" },
            { terminalId: terminal("VSS"), supply: "VSS" },
          ],
        },
      }),
    );
    const before = structuredClone(project);
    const automaticArtwork = transact(project, [
      {
        kind: "apply_model_source",
        source: project.modelSources![0]!,
        definitions: [
          {
            definitionId: owner.id,
            entry: "amp",
            symbol: null,
            callers: [
              {
                documentId: project.documents[0]!.id,
                instanceId: "X1",
                expectedSymbolId: custom.symbol.id,
              },
            ],
          },
        ],
      },
    ]);
    expect(automaticArtwork.ok).toBe(false);
    if (!automaticArtwork.ok)
      expect(automaticArtwork.error.message).toContain("property supply");
    const directSwitch = transact(project, [
      {
        kind: "transact_document",
        documentId: project.documents[0]!.id,
        expectedRevision: project.documents[0]!.revision,
        edits: [
          {
            kind: "set_instance_symbol",
            instanceId: "X1",
            symbolId: externalSubcircuitSymbolId(owner.id),
          },
        ],
      },
    ]);
    expect(directSwitch.ok).toBe(false);
    if (!directSwitch.ok)
      expect(directSwitch.error.message).toContain("property supply");
    const collapsed = structuredClone(custom);
    collapsed.symbol.id = "collapsed-artwork";
    collapsed.circuitBinding!.terminals[1] = {
      terminalId: terminal("OUT"),
      pinName: "IN",
    };
    const refused = transact(project, [
      {
        kind: "apply_model_source",
        source: project.modelSources![0]!,
        definitions: [
          { definitionId: owner.id, entry: "amp", symbol: collapsed },
        ],
      },
    ]);
    expect(refused.ok).toBe(false);
    expect(project).toEqual(before);
  });

  it("refuses a caller whose custom artwork maps another native owner", () => {
    const { project, owner } = placedCustomAmp(({ automatic, terminal }) => ({
      symbol: { ...automatic, id: "owned-artwork" },
      circuitBinding: {
        definitionId: "amp",
        terminals: ["IN", "OUT", "VSS"].map((name) => ({
          terminalId: terminal(name),
          pinName: name,
        })),
      },
    }));
    expect(CircuitProjectSchema.safeParse(project).success).toBe(true);
    const { symbolId: _preferred, ...other } = owner;
    project.externalSubcircuitDefinitions.push({ ...other, id: "other" });
    project.documents[0]!.instances[0]!.netlist!.binding = {
      kind: "external-subcircuit",
      definitionId: "other",
    };
    const parsed = CircuitProjectSchema.safeParse(project);
    expect(parsed.error?.issues.map((issue) => issue.message)).toContain(
      "Native artwork owner does not match the instance target",
    );
  });

  it("removes native ports with repaired caller artwork, pruning their Net terminals and No Connects atomically", () => {
    const { project, owner, custom, terminal } = placedCustomAmp(
      ({ automatic, terminal }) => ({
        symbol: { ...automatic, id: "full-artwork" },
        circuitBinding: {
          definitionId: "amp",
          terminals: ["IN", "OUT", "VSS"].map((name) => ({
            terminalId: terminal(name),
            pinName: name,
          })),
        },
      }),
    );
    const document = project.documents[0]!;
    document.nets.push({
      id: "shared",
      terminals: [
        { instanceId: "X1", pinName: "IN" },
        { instanceId: "X1", pinName: "VSS" },
      ],
    });
    document.noConnects.push({
      id: "out-nc",
      endpoint: { kind: "terminal", instanceId: "X1", pinName: "OUT" },
    });
    const repaired = structuredClone(custom);
    repaired.symbol.id = "repaired-artwork";
    repaired.symbol.pins = repaired.symbol.pins.filter(
      (pin) => pin.name === "VSS",
    );
    repaired.circuitBinding!.terminals = [
      { terminalId: terminal("VSS"), pinName: "VSS" },
    ];
    const before = structuredClone(project);
    const result = transact(project, [
      {
        kind: "apply_model_source",
        source: {
          ...project.modelSources![0]!,
          files: [
            {
              path: "model.spice",
              text: ".subckt amp VSS\nR1 VSS 0 1k\n.ends amp\n",
            },
          ],
        },
        definitions: [
          {
            definitionId: owner.id,
            entry: "amp",
            portMap: { IN: null, OUT: null },
            symbol: repaired,
            callers: [
              {
                documentId: document.id,
                instanceId: "X1",
                expectedSymbolId: custom.symbol.id,
              },
            ],
          },
        ],
      },
    ]);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    const after = result.project.documents[0]!;
    expect(
      result.project.externalSubcircuitDefinitions[0]!.terminals.map(
        (item) => item.name,
      ),
    ).toEqual(["VSS"]);
    expect(after.nets.flatMap((net) => net.terminals)).toEqual([
      { instanceId: "X1", pinName: "VSS" },
    ]);
    expect(after.noConnects).toEqual([]);
    expect(after.instances[0]!.symbolId).toBe(repaired.symbol.id);
    expect(project).toEqual(before);
  });

  it("migrates an unplaced preferred custom artwork when a native port is removed", () => {
    const amp = nativeAmp();
    const preferred = transact(amp.project, [
      {
        kind: "apply_model_source",
        source: amp.project.modelSources![0]!,
        definitions: [
          {
            definitionId: "amp",
            entry: "amp",
            authoring: {
              symbolMode: "custom",
              artworkText: JSON.stringify({
                symbol: {
                  ...amp.automatic,
                  id: "preferred-artwork",
                  primitives: [
                    ...amp.automatic.primitives,
                    { kind: "circle", center: { x: 0, y: 0 }, radius: 6 },
                  ],
                },
              }),
            },
          },
        ],
      },
    ]);
    if (!preferred.ok) throw Error(preferred.error.message);
    const oldPreference =
      preferred.project.externalSubcircuitDefinitions[0]!.symbolId!;
    const oldArtwork = preferred.project.componentDefinitions!.find(
      (item) => item.symbol.id === oldPreference,
    )!;
    const removed = transact(
      preferred.project,
      [
        {
          kind: "apply_model_source",
          source: {
            ...preferred.project.modelSources![0]!,
            files: [
              {
                path: "model.spice",
                text: ".subckt amp IN VSS\nR1 IN VSS 1k\n.ends amp\n",
              },
            ],
          },
          definitions: [
            { definitionId: "amp", entry: "amp", portMap: { OUT: null } },
          ],
        },
      ],
      "human",
    );
    expect(removed.ok, JSON.stringify(removed)).toBe(true);
    if (!removed.ok) return;
    const owner = removed.project.externalSubcircuitDefinitions[0]!;
    expect(owner.terminals.map((item) => item.name)).toEqual(["IN", "VSS"]);
    expect(owner.symbolId).not.toBe(oldPreference);
    const migrated = removed.project.componentDefinitions!.find(
      (item) => item.symbol.id === owner.symbolId,
    )!;
    expect(migrated.symbol.pins.map((pin) => pin.name)).toEqual(["IN", "VSS"]);
    expect(migrated.symbol.primitives).toEqual(oldArtwork.symbol.primitives);
  });
});

describe("op-amp artwork, its supply pins drawn on request (#1833)", () => {
  const opamp = builtInSymbols.find((symbol) => symbol.id === "opamp")!;
  /** Applies `ports` as native owner ea with the op-amp artwork as Custom. */
  function applyOpampArtwork(
    ports: string,
    authoring: { artwork?: typeof opamp; pinMap?: Record<string, object> },
  ) {
    const project = createEmptyProject("ea", "Error amplifier");
    const result = transact(project, [
      {
        kind: "apply_model_source",
        source: {
          id: "ea-source",
          revision: 0,
          language: "spice",
          entry: "ea.spice",
          dependencies: [],
          files: [
            {
              path: "ea.spice",
              text: `.subckt ea ${ports}\nR1 VIP VOUT 1k\nR2 VIN VOUT 1k\n.ends ea\n`,
            },
          ],
        },
        definitions: [
          {
            definitionId: "ea",
            entry: "ea",
            authoring: {
              symbolMode: "custom",
              artworkText: JSON.stringify({
                symbol: { ...(authoring.artwork ?? opamp), id: "ea-artwork" },
              }),
              ...(authoring.pinMap ? { pinMap: authoring.pinMap } : {}),
            },
          },
        ],
      } as ProjectStructureEdit,
    ]);
    if (!result.ok) throw Error(result.error.message);
    const owner = result.project.externalSubcircuitDefinitions[0]!;
    const resolver = createProjectSymbolResolver(
      result.project,
      builtInSymbols,
    );
    const drawn = (variant?: string) =>
      drawnPinNames(resolver.resolve(owner.symbolId!, variant)!);
    return { project: result.project, owner, resolver, drawn };
  }
  const signalPins = {
    VIP: { pinName: "IN+" },
    VIN: { pinName: "IN-" },
    VOUT: { pinName: "OUT" },
  };

  it("binds a three-terminal model by name, leaving VDD and VSS unmapped and undrawn", () => {
    // The artwork names its signal pins as the model does; VDD and VSS no
    // terminal names.
    const artwork = {
      ...opamp,
      pins: opamp.pins.map((pin) => ({
        ...pin,
        name: { "IN+": "VIP", "IN-": "VIN", OUT: "VOUT" }[pin.name] ?? pin.name,
      })),
    };
    const { project, owner, drawn } = applyOpampArtwork("VIP VIN VOUT", {
      artwork,
    });
    const component = project.componentDefinitions!.find(
      (item) => item.symbol.id === owner.symbolId,
    )!;
    expect(
      component.circuitBinding!.terminals.map((mapping) =>
        "pinName" in mapping ? mapping.pinName : mapping.supply,
      ),
    ).toEqual(["VIP", "VIN", "VOUT"]);
    expect(drawn()).toEqual(["VIP", "VIN", "VOUT"]);
    expect(drawn("supply-pins")).toEqual(["VIP", "VIN", "VOUT"]);
  });

  it("keeps a five-terminal model's supplies on their rails, drawn by no pin", () => {
    const { owner, resolver, drawn } = applyOpampArtwork(
      "VIP VIN VOUT VDD VSS",
      {
        pinMap: {
          ...signalPins,
          VDD: { supply: "VDD" },
          VSS: { supply: "VSS" },
        },
      },
    );
    expect(drawn("supply-pins")).toEqual(["VIP", "VIN", "VOUT"]);
    expect(
      resolver
        .resolve(owner.symbolId!)!
        .definition.pins.filter(
          (pin) => pin.presentation.visibility === "implicit",
        )
        .map((pin) => pin.name),
    ).toEqual(["VDD", "VSS"]);
  });

  it("draws VDD and VSS mapped to pins only when shown, as plain pins", () => {
    const { owner, resolver, drawn } = applyOpampArtwork(
      "VIP VIN VOUT VDD VSS",
      {
        pinMap: {
          ...signalPins,
          VDD: { pinName: "VDD" },
          VSS: { pinName: "VSS" },
        },
      },
    );
    expect(drawn()).toEqual(["VIP", "VIN", "VOUT"]);
    expect(drawn("supply-pins")).toEqual(["VIP", "VIN", "VOUT", "VDD", "VSS"]);
    // Mapped, VDD is its terminal's pin: unwired, it is unconnected.
    expect(
      resolver
        .resolve(owner.symbolId!)!
        .definition.pins.filter((pin) => ["VDD", "VSS"].includes(pin.name))
        .map((pin) => pin.role),
    ).toEqual(["inout", "inout"]);
  });
});
