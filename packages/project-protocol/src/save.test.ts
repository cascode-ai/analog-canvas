import { createEmptyProject } from "@icm/model";
import { expect, it } from "vitest";
import {
  canonicalConnectionIndexes,
  parseProject,
  serializeCompactProject,
  serializeProject,
  tryParseProjectWithMetadata,
} from "./index.js";
import { legacyProjectFile } from "./legacy-project.test-support.js";

it("saves compact and readable JSON with the same Project content", () => {
  const project = createEmptyProject("both-formats", '偏置 "A" \\ B\n  C');
  const readable = serializeProject(project);
  const compact = serializeCompactProject(project);
  expect(readable).toContain('\n  "schemaVersion": ');
  expect(compact.trimEnd()).not.toContain("\n");
  expect(compact.endsWith("\n")).toBe(true);
  expect(Buffer.byteLength(compact)).toBeLessThan(Buffer.byteLength(readable));
  expect(JSON.parse(compact)).toEqual(JSON.parse(readable));
  const restored = parseProject(compact);
  expect(restored).toEqual(parseProject(readable));
  expect(restored.name).toBe('偏置 "A" \\ B\n  C');
  expect(serializeCompactProject(restored)).toBe(compact);
  expect(serializeProject(restored)).toBe(readable);
});

it("reopens short source locations and captured Symbol coordinates without changing the model", () => {
  const project = createEmptyProject("short-fields", "Captured symbol");
  const document = project.documents[0]!;
  const sourceRef = {
    fileId: "source-file",
    start: { offset: 2, line: 1, column: 3 },
    end: { offset: 18, line: 2, column: 4 },
  };
  const pin = {
    name: "P",
    role: "passive",
    at: { x: -4, y: 0 },
    direction: "west" as const,
    routing: { escape: "outward" as const, preferredLanding: { x: -6, y: 0 } },
    presentation: { visibility: "visible" as const },
  };
  document.sourceBinding = { cellName: "captured", sourceRef };
  document.instances.push({
    id: "part",
    symbolId: "captured",
    sourceRef,
    placement: null,
  });
  document.nets.push({ id: "base-net", terminals: [] });
  document.connectivityEvidence.push({
    id: "source-evidence",
    kind: "spice-source",
    netId: "base-net",
    sourceNetId: "source-net",
    sourceRef,
  });
  project.componentDefinitions = [
    {
      symbol: {
        schemaVersion: 1,
        id: "captured",
        name: "Captured",
        viewBox: { x: -10, y: -10, width: 20, height: 20 },
        pins: [pin],
        primitives: [
          {
            kind: "line",
            from: { x: -1.25, y: 0 },
            to: { x: 0, y: 2.125 },
            style: { lineCap: "round" },
          },
        ],
        variants: [
          {
            id: "alternate",
            hiddenPinNames: ["P"],
            auxiliaryPins: [
              {
                name: pin.name,
                at: pin.at,
                direction: pin.direction,
                routing: pin.routing,
              },
            ],
            additionalPrimitives: [
              { kind: "circle", center: { x: -0.5, y: 3 }, radius: 2 },
            ],
          },
        ],
      },
    },
  ];
  const text = serializeCompactProject(project);
  const source = JSON.parse(text);
  const legacy = legacyProjectFile(text, 82);
  const compactBytes = (value: unknown) =>
    Buffer.byteLength(JSON.stringify(value));
  expect(
    compactBytes(source.documents[0].sourceBinding.sourceRef),
  ).toBeLessThan(compactBytes(legacy.documents[0].sourceBinding.sourceRef));
  expect(compactBytes(source.componentDefinitions[0].symbol)).toBeLessThan(
    compactBytes(legacy.componentDefinitions[0].symbol),
  );
  for (const record of [
    source.documents[0].sourceBinding,
    source.documents[0].instances[0],
    source.documents[0].connectivityEvidence[0],
  ]) {
    expect(record.sourceRef).toEqual({
      fileId: "source-file",
      start: [2, 1, 3],
      end: [18, 2, 4],
    });
  }
  const artwork = source.componentDefinitions[0].symbol;
  expect(artwork.primitives[0]).toEqual({
    kind: "line",
    from: [-1.25, 0],
    to: [0, 2.125],
    style: { lineCap: "round" },
  });
  expect(artwork.pins[0].at).toEqual([-4, 0]);
  expect(artwork.pins[0].routing.preferredLanding).toEqual([-6, 0]);
  expect(artwork.variants[0].auxiliaryPins[0].at).toEqual([-4, 0]);
  expect(artwork.variants[0].auxiliaryPins[0].routing.preferredLanding).toEqual(
    [-6, 0],
  );
  expect(artwork.variants[0].additionalPrimitives[0].center).toEqual([-0.5, 3]);
  expect(source.documents[0]).not.toHaveProperty("layoutGroups");
  expect(source.documents[0]).not.toHaveProperty("constraints");
  expect(source.documents[0]).not.toHaveProperty("noConnects");
  expect(canonicalConnectionIndexes(parseProject(text))).toEqual(
    canonicalConnectionIndexes(project),
  );
  const oldEnvelope = { ...source, schemaVersion: 82 };
  expect(tryParseProjectWithMetadata(JSON.stringify(oldEnvelope)).ok).toBe(
    false,
  );

  const invalidGeometry = structuredClone(source);
  invalidGeometry.componentDefinitions[0].symbol.primitives[0].from = {
    x: -1.25,
    y: 0,
  };
  expect(
    tryParseProjectWithMetadata(JSON.stringify(invalidGeometry)),
  ).toMatchObject({
    ok: false,
    diagnostics: [
      { path: ["componentDefinitions", 0, "symbol", "primitives", 0, "from"] },
    ],
  });

  source.documents[0].instances[0].sourceRef.end = [1, 2];
  expect(tryParseProjectWithMetadata(JSON.stringify(source))).toMatchObject({
    ok: false,
    diagnostics: [
      { path: ["documents", 0, "instances", 0, "sourceRef", "end"] },
    ],
  });
});

it("preserves populated Document collections in authored order", () => {
  const project = createEmptyProject(
    "ordered-collections",
    "Ordered collections",
  );
  const document = project.documents[0]!;
  for (const [id, x] of [
    ["R2", 200],
    ["R1", 150],
  ] as const) {
    document.instances.push({
      id,
      symbolId: "resistor",
      reference: id,
      placement: { position: { x, y: 100 }, rotation: 0, mirror: "none" },
    });
  }
  for (const id of ["2", "1"]) {
    document.layoutGroups.push({
      id: `group-${id}`,
      kind: "custom",
      objectIds: [`R${id}`],
      locked: false,
    });
    document.constraints.push({
      id: `constraint-${id}`,
      kind: "align-y",
      objectIds: ["R2", "R1"],
      locked: true,
    });
    document.noConnects.push({
      id: `no-connect-${id}`,
      endpoint: { kind: "terminal", instanceId: `R${id}`, pinName: "1" },
    });
  }
  const restored = parseProject(serializeCompactProject(project)).documents[0]!;
  expect(restored.layoutGroups).toEqual(document.layoutGroups);
  expect(restored.constraints).toEqual(document.constraints);
  expect(restored.noConnects).toEqual(document.noConnects);
});
