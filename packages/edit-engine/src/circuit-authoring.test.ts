import { expect, it } from "vitest";
import { createEmptyProject } from "@icm/model";
import { builtInSymbols } from "@icm/symbols";
import {
  executeProjectTransaction,
  ProjectStructureEditSchema,
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
