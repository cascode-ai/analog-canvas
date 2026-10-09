import { expect, it } from "vitest";
import {
  createEmptyProject,
  deriveStableId,
  resolveCircuitArtworkDraft,
  ComponentDefinitionSchema,
} from "@icm/model";
import { executeProjectTransaction } from "./project-transaction.js";
import { planExternalCopyDependencies } from "./project-copy-dependencies.js";

it("copies owned authoring drafts with their native identities while preserving invalid JSON and destination drafts", () => {
  const source = createEmptyProject("source", "Source");
  const owner = {
    id: "gain",
    name: "gain",
    terminals: [
      { id: "t-a", name: "A", direction: "input" as const },
      { id: "t-b", name: "B", direction: "output" as const },
    ],
    formalParameters: [],
    interfaceStatus: "declared" as const,
    implementation: {
      kind: "source" as const,
      sourceId: "gain-source",
      entry: "gain",
    },
  };
  source.externalSubcircuitDefinitions.push(owner);
  const invalid = '{ "circuitBinding": unfinished';
  source.modelSources = [
    {
      id: "gain-source",
      language: "spice",
      revision: 1,
      entry: "model.spice",
      files: [
        {
          path: "model.spice",
          text: ".subckt gain A B\nR1 A B 1k\n.ends gain\n",
        },
      ],
      dependencies: [],
      draft: {
        entry: "model.spice",
        baseRevision: 1,
        files: [
          {
            path: "model.spice",
            text: ".subckt gain A B C\nR1 A B 2k\n.ends gain\n",
          },
        ],
        authoring: [
          {
            definitionId: "gain",
            entry: "gain",
            symbolMode: "custom",
            artworkText: invalid,
            terminalDirections: {
              "t-a": "input",
              [deriveStableId("model-terminal", "gain", "C")]: "passive",
            },
            presentation: {
              pinPlacements: [{ terminalId: "t-a", side: "west", offset: 0 }],
            },
            portMaps: { gain: { A: "A", B: "B" } },
          },
        ],
      },
    },
  ];
  const instance = {
    id: "X1",
    reference: "X1",
    symbolId: "external-subcircuit:gain",
    placement: null,
    netlist: {
      parameters: {},
      binding: { kind: "external-subcircuit" as const, definitionId: "gain" },
    },
  };
  const target = createEmptyProject("target", "Target");
  const plan = planExternalCopyDependencies(target, source, [instance], []);
  const result = executeProjectTransaction(target, {
    projectId: target.id,
    transactionId: "copy",
    expectedStructureRevision: 0,
    actor: { kind: "human", id: "test" },
    edits: plan.edits,
  });
  if (!result.ok) throw Error(JSON.stringify(result.error));
  const copiedOwner = result.project.externalSubcircuitDefinitions[0]!;
  const draft = result.project.modelSources![0]!.draft!.authoring![0]!;
  expect(draft.definitionId).toBe(copiedOwner.id);
  expect(draft.artworkText).toBe(invalid);
  expect(draft.portMaps).toEqual({ [copiedOwner.id]: { A: "A", B: "B" } });
  expect(draft.terminalDirections).toEqual({
    [copiedOwner.terminals[0]!.id]: "input",
    [deriveStableId("model-terminal", copiedOwner.id, "C")]: "passive",
  });
  expect(draft.presentation!.pinPlacements![0]!.terminalId).toBe(
    copiedOwner.terminals[0]!.id,
  );
  draft.artworkText = "destination's private unfinished artwork";
  const repeated = planExternalCopyDependencies(
    result.project,
    source,
    [instance],
    [],
  );
  expect(repeated.edits).toEqual([]);
  expect(
    result.project.modelSources![0]!.draft!.authoring![0]!.artworkText,
  ).toBe("destination's private unfinished artwork");
  expect(source.modelSources![0]!.draft!.authoring![0]!.definitionId).toBe(
    "gain",
  );
  // Once the user repairs the original raw JSON, it binds only to the new owner,
  // including a port that was added in the native draft but not yet applied.
  const futureOwner = {
    ...copiedOwner,
    terminals: [
      ...copiedOwner.terminals,
      {
        id: deriveStableId("model-terminal", copiedOwner.id, "C"),
        name: "C",
        direction: "passive" as const,
      },
    ],
  };
  const artwork = ComponentDefinitionSchema.parse({
    symbol: {
      schemaVersion: 1,
      id: "draft-artwork",
      name: "Draft",
      viewBox: { x: -40, y: -40, width: 80, height: 80 },
      variants: [],
      primitives: [{ kind: "circle", center: { x: 0, y: 0 }, radius: 20 }],
      pins: ["A", "B", "C"].map((name, index) => ({
        name,
        role: "passive",
        at: { x: -40, y: index * 10 },
        direction: "west",
        presentation: { visibility: "visible" },
      })),
    },
    circuitBinding: {
      definitionId: "gain",
      terminals: [
        { terminalId: "t-a", pinName: "A" },
        { terminalId: "t-b", pinName: "B" },
        {
          terminalId: deriveStableId("model-terminal", "gain", "C"),
          pinName: "C",
        },
      ],
    },
  });
  const restored = resolveCircuitArtworkDraft(
    artwork,
    futureOwner,
    draft.artworkOrigin,
  );
  expect(restored.circuitBinding!.definitionId).toBe(copiedOwner.id);
  expect(
    restored.circuitBinding!.terminals.map((mapping) => mapping.terminalId),
  ).toEqual(futureOwner.terminals.map((terminal) => terminal.id));
  const model = result.project.modelSources![0]!;
  const applied = executeProjectTransaction(result.project, {
    projectId: target.id,
    expectedStructureRevision: result.project.structureRevision,
    transactionId: "apply-copied-draft",
    actor: { kind: "human", id: "test" },
    edits: [
      {
        kind: "apply_model_source",
        source: { ...model, files: model.draft!.files },
        definitions: [
          { definitionId: copiedOwner.id, entry: "gain", symbol: restored },
        ],
      },
    ],
  });
  expect(applied.ok, !applied.ok ? JSON.stringify(applied.error) : "").toBe(
    true,
  );
  if (applied.ok) {
    expect(applied.project.modelSources![0]!.draft).toBeUndefined();
    expect(
      applied.project.externalSubcircuitDefinitions[0]!.terminals.map(
        (terminal) => terminal.name,
      ),
    ).toEqual(["A", "B", "C"]);
  }
});
