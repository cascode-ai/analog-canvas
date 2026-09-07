import { describe, expect, it } from "vitest";
import { CURRENT_PROJECT_SCHEMA_VERSION, createEmptyProject } from "@icm/model";

import { tryParseProjectWithMetadata } from "./load.js";
import { upgradeSchema42To43WithReport } from "./previous-to-current.js";

function schema42Project() {
  const project = createEmptyProject(
    "project",
    "Project",
    "tb",
  ) as unknown as Record<string, unknown>;
  const documents = project.documents as Array<Record<string, unknown>>;
  const document = documents[0]!;
  document.nets = [
    {
      id: "net-out",
      terminals: [{ instanceId: "source", pinName: "P" }],
    },
  ];
  document.instances = [
    {
      id: "source",
      symbolId: "voltage-source",
      placement: {
        position: { x: 0, y: 0 },
        rotation: 0,
        mirror: "none",
      },
      reference: "VOUT",
      netlist: {
        binding: { kind: "primitive", deviceClass: "voltage-source" },
        parameters: {},
      },
    },
  ];
  project.schemaVersion = 42;
  project.simulationSetups = [
    {
      id: "setup-op",
      name: "Operating point",
      version: 1,
      input: {
        kind: "structured",
        rootDocumentId: "tb",
        analyses: [{ kind: "op" }],
        probes: [
          {
            id: "probe-out",
            kind: "net-voltage",
            documentId: "tb",
            anchor: { kind: "base-net", netId: "net-out" },
            occurrence: [],
          },
          {
            id: "probe-current",
            kind: "source-current",
            documentId: "tb",
            instanceId: "source",
            occurrence: [],
          },
        ],
        environment: { profileId: "profile" },
      },
    },
    {
      id: "setup-raw",
      name: "Raw deck",
      version: 1,
      input: {
        kind: "raw",
        entry: "tb.cir",
        files: [{ path: "tb.cir", text: ".end\n" }],
        dependencies: [],
        environment: { profileId: "profile" },
      },
    },
  ];
  return project;
}

describe("schema 42 to 43 simulation outputs", () => {
  it("migrates every named setup and gives leaf outputs meaningful unique labels", () => {
    const migrated = upgradeSchema42To43WithReport(schema42Project());
    expect(migrated.report).toEqual({
      changed: true,
      migratedOutputIds: ["probe-out", "probe-current"],
    });
    expect(migrated.project).toMatchObject({
      schemaVersion: 43,
      simulationSetups: [
        {
          id: "setup-op",
          version: 2,
          input: {
            outputs: [
              {
                id: "probe-out",
                label: "VOUT_P",
                expression: {
                  kind: "voltage",
                  documentId: "tb",
                  anchor: { kind: "base-net", netId: "net-out" },
                  occurrence: [],
                },
              },
              {
                id: "probe-current",
                label: "VOUT_current",
                expression: {
                  kind: "current",
                  documentId: "tb",
                  instanceId: "source",
                  occurrence: [],
                },
              },
            ],
          },
        },
        { id: "setup-raw", version: 2, input: { kind: "raw" } },
      ],
    });
    expect(
      (
        migrated.project.simulationSetups as Array<{
          input: Record<string, unknown>;
        }>
      )[0]!.input,
    ).not.toHaveProperty("probes");
  });

  it("uses a subcircuit formal pin name instead of fabricating an instance prefix", () => {
    const project = schema42Project();
    const document = (project.documents as Array<Record<string, unknown>>)[0]!;
    document.instances = [
      {
        id: "supply",
        reference: "V3",
        netlist: {
          binding: { kind: "primitive", deviceClass: "voltage-source" },
          parameters: {},
        },
      },
      {
        id: "dut",
        reference: "X1",
        netlist: {
          binding: { kind: "subcircuit", childDocumentId: "dut-cell" },
          parameters: {},
        },
      },
    ];
    document.nets = [
      {
        id: "net-out",
        terminals: [
          { instanceId: "supply", pinName: "+" },
          { instanceId: "dut", pinName: "VDD" },
        ],
      },
    ];
    const setup = (
      project.simulationSetups as Array<{
        input: { probes?: Array<Record<string, unknown>> };
      }>
    )[0]!;
    setup.input.probes = [
      {
        id: "probe-out",
        kind: "net-voltage",
        documentId: "tb",
        anchor: { kind: "base-net", netId: "net-out" },
        occurrence: [],
      },
    ];

    const migrated = upgradeSchema42To43WithReport(project).project;
    expect(
      (
        migrated.simulationSetups as Array<{
          input: { outputs: Array<Record<string, unknown>> };
        }>
      )[0]!.input.outputs,
    ).toMatchObject([{ id: "probe-out", label: "VDD" }]);
  });

  it("loads a schema-42 Project through the public compatibility chain", () => {
    const result = tryParseProjectWithMetadata(
      JSON.stringify(schema42Project()),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sourceSchemaVersion).toBe(42);
    expect(result.project.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
    expect(result.project.simulationSetups).toHaveLength(2);
    expect(result.project.simulationSetups[0]).toMatchObject({
      version: 2,
      input: {
        kind: "structured",
        outputs: [
          { label: "VOUT_P" },
          {
            label: "VOUT_current",
            expression: { kind: "current", pinName: "+" },
          },
        ],
      },
    });
  });
});
