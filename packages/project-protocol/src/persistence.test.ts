import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createEmptyProject,
  CURRENT_PROJECT_SCHEMA_VERSION,
  deriveStableId,
} from "@icm/model";
import {
  ProjectFormatError,
  loadProject,
  parseProject,
  parseProjectWithMetadata,
  PREVIOUS_PROJECT_SCHEMA_VERSION,
  saveProject,
  serializeProject,
  type ProjectStorage,
  upgradeSchema24To25WithReport,
  upgradeSchema25To26,
  upgradeSchema25To26WithReport,
  upgradeSchema26To27,
  upgradeSchema27To28,
  upgradeSchema28To29,
  upgradeSchema29To30,
  upgradeSchema30To31,
  upgradeSchema31To32,
  upgradeSchema32To33,
} from "./index.js";

class MemoryStorage implements ProjectStorage {
  readonly files = new Map<string, string>();

  async readText(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`Missing file: ${path}`);
    return content;
  }

  async writeTextAtomically(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
}

describe("Project persistence", () => {
  it("accepts the canonical fixture and rejects the invalid fixture", () => {
    const validPath = resolve(
      process.cwd(),
      "fixtures/projects/minimal/project.icproj.json",
    );
    const rejectedPath = resolve(
      process.cwd(),
      "fixtures/projects/rejected-missing-top/project.icproj.json",
    );
    const validText = readFileSync(validPath, "utf8");
    expect(serializeProject(parseProject(validText))).toBe(validText);
    expect(() => parseProject(readFileSync(rejectedPath, "utf8"))).toThrow(
      /Unknown top document/,
    );
  });

  it("is canonical across save, load, and save", async () => {
    const storage = new MemoryStorage();
    const project = createEmptyProject("project-test", "Test Project");
    await saveProject(storage, "project.icproj.json", project);
    const first = storage.files.get("project.icproj.json");
    const loaded = await loadProject(storage, "project.icproj.json");
    await saveProject(storage, "project.icproj.json", loaded);
    expect(storage.files.get("project.icproj.json")).toBe(first);
    expect(first?.endsWith("\n")).toBe(true);
  });

  it("round-trips annotation textColor through persistence", async () => {
    const storage = new MemoryStorage();
    const project = createEmptyProject("project-text-color", "Text color");
    project.documents[0]!.annotations.push({
      id: "note-1",
      kind: "route-marker",
      markerKind: "current",
      content: { runs: [{ kind: "text", value: "I_bias" }] },
      anchor: { kind: "free", position: { x: 20, y: 20 } },
      alignment: "middle",
      rotation: 0,
      locked: false,
      textColor: "#224488",
    });

    await saveProject(storage, "project.icproj.json", project);
    const loaded = await loadProject(storage, "project.icproj.json");

    expect(loaded.documents[0]!.annotations[0]!.textColor).toBe("#224488");
    expect(storage.files.get("project.icproj.json")).toContain("textColor");
  });

  it("rejects invalid JSON with a typed diagnostic", () => {
    try {
      parseProject("{");
      throw new Error("Expected parseProject to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectFormatError);
      expect((error as ProjectFormatError).diagnostics[0]?.code).toBe(
        "INVALID_JSON",
      );
    }
  });

  it("splits schema-24 repeated markers into independent Cell Pins without changing topology", () => {
    const source = JSON.parse(
      serializeProject(createEmptyProject("project-test", "Test Project")),
    ) as Record<string, any>;
    source.schemaVersion = 24;
    const document = source.documents[0];
    document.instances.push(
      { id: "P1", symbolId: "port", placement: null },
      { id: "P2", symbolId: "port-filled", placement: null },
    );
    document.nets.push({
      id: "net-in",
      terminals: [
        { instanceId: "P1", pinName: "P" },
        { instanceId: "P2", pinName: "P" },
      ],
    });
    document.routes.push({
      id: "route-in",
      netId: "net-in",
      from: { kind: "terminal", instanceId: "P1", pinName: "P" },
      to: { kind: "terminal", instanceId: "P2", pinName: "P" },
      waypoints: [],
      segmentModes: ["auto"],
    });
    document.junctions.push({
      id: "junction-in",
      netId: "net-in",
      position: { x: 0, y: 0 },
    });
    document.netlist.terminals.push({
      id: "terminal-in",
      name: "IN",
      netId: "net-in",
      direction: "input",
      interfaceInstanceIds: ["P1", "P2"],
    });
    document.annotations.push(
      {
        id: "label-p1",
        kind: "instance-label",
        binding: { kind: "cell-terminal-name", terminalId: "terminal-in" },
        anchor: {
          kind: "object",
          objectId: "P1",
          localOffset: { x: 0, y: 0 },
          fallbackPosition: { x: 0, y: 0 },
        },
        alignment: "start",
        rotation: 0,
        locked: false,
      },
      {
        id: "label-p2",
        kind: "instance-label",
        binding: { kind: "cell-terminal-name", terminalId: "terminal-in" },
        anchor: {
          kind: "object",
          objectId: "P2",
          localOffset: { x: 0, y: 0 },
          fallbackPosition: { x: 0, y: 0 },
        },
        alignment: "start",
        rotation: 0,
        locked: false,
      },
    );
    document.presentation.cellSymbol = {
      pinPlacements: [{ terminalId: "terminal-in", side: "west", offset: 0 }],
    };
    const topology = structuredClone({
      nets: document.nets,
      routes: document.routes,
      junctions: document.junctions,
    });

    const direct = upgradeSchema24To25WithReport(source);
    expect(direct.report).toMatchObject({
      splitRepeatedTerminalCount: 1,
      reboundAnnotationIds: ["label-p2"],
      preservedLegacySharedNets: [
        {
          documentId: document.id,
          sourceTerminalId: "terminal-in",
          netId: "net-in",
        },
      ],
    });
    expect(direct.report.independentCellPins).toHaveLength(2);
    const directDocument = (
      direct.project.documents as Array<Record<string, any>>
    )[0]!;
    expect({
      nets: directDocument.nets,
      routes: directDocument.routes,
      junctions: directDocument.junctions,
    }).toEqual(topology);

    const migrated = parseProjectWithMetadata(
      JSON.stringify(
        upgradeSchema32To33(
          upgradeSchema31To32(
            upgradeSchema30To31(
              upgradeSchema29To30(
                upgradeSchema28To29(
                  upgradeSchema27To28(
                    upgradeSchema26To27(upgradeSchema25To26(direct.project)),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    expect(migrated).toMatchObject({
      sourceSchemaVersion: PREVIOUS_PROJECT_SCHEMA_VERSION,
      migrated: true,
      project: { schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION },
    });
    const migratedDocument = migrated.project.documents[0]!;
    expect(migratedDocument.netlist?.terminals).toMatchObject([
      {
        id: "terminal-in",
        name: "IN",
        netId: "net-in",
        interfaceInstanceIds: ["P1"],
      },
      { name: "IN", netId: "net-in", interfaceInstanceIds: ["P2"] },
    ]);
    expect(
      migratedDocument.annotations.find((item) => item.id === "label-p1")
        ?.binding,
    ).toEqual({ kind: "cell-terminal-name", terminalId: "terminal-in" });
    expect(
      migratedDocument.annotations.find((item) => item.id === "label-p2")
        ?.binding,
    ).toEqual({
      kind: "cell-terminal-name",
      terminalId: migratedDocument.netlist!.terminals[1]!.id,
    });
    expect(migratedDocument.presentation.cellSymbol?.pinPlacements).toEqual([
      { terminalId: "terminal-in", side: "west", offset: 0 },
    ]);
  });

  it("allocates deterministic collision-safe terminal IDs during migration", () => {
    const source = JSON.parse(
      serializeProject(createEmptyProject("project-test", "Test Project")),
    ) as Record<string, any>;
    source.schemaVersion = 24;
    const document = source.documents[0];
    const collidingId = deriveStableId("cell-terminal", "terminal-in", "P2");
    document.instances.push(
      { id: "P1", symbolId: "port", placement: null },
      { id: "P2", symbolId: "port", placement: null },
      { id: "P3", symbolId: "port", placement: null },
    );
    document.nets.push(
      {
        id: "net-in",
        terminals: [
          { instanceId: "P1", pinName: "P" },
          { instanceId: "P2", pinName: "P" },
        ],
      },
      {
        id: "net-other",
        terminals: [{ instanceId: "P3", pinName: "P" }],
      },
    );
    document.netlist.terminals.push(
      {
        id: "terminal-in",
        name: "IN",
        netId: "net-in",
        direction: "input",
        interfaceInstanceIds: ["P1", "P2"],
      },
      {
        id: collidingId,
        name: "OTHER",
        netId: "net-other",
        direction: "passive",
        interfaceInstanceIds: ["P3"],
      },
    );

    const first = upgradeSchema24To25WithReport(source);
    const second = upgradeSchema24To25WithReport(source);
    const firstDocument = (
      first.project.documents as Array<Record<string, any>>
    )[0]!;
    const secondDocument = (
      second.project.documents as Array<Record<string, any>>
    )[0]!;
    const splitId = firstDocument.netlist.terminals[1].id;
    expect(splitId).not.toBe(collidingId);
    expect(secondDocument.netlist.terminals[1].id).toBe(splitId);
    expect(first.report.independentCellPins[1]).toMatchObject({
      sourceTerminalId: "terminal-in",
      terminalId: splitId,
      interfaceInstanceId: "P2",
    });
  });

  it("migrates schema-25 Route arrays and attachments to deterministic leg IDs", () => {
    const source = JSON.parse(
      serializeProject(
        createEmptyProject("route-migration", "Route migration"),
      ),
    ) as Record<string, any>;
    source.schemaVersion = 25;
    const document = source.documents[0];
    document.nets.push({ id: "net-1", terminals: [] });
    document.junctions.push(
      { id: "J1", netId: "net-1", position: { x: 0, y: 0 } },
      { id: "J2", netId: "net-1", position: { x: 100, y: 100 } },
    );
    document.routes.push({
      id: "route-1",
      netId: "net-1",
      from: { kind: "junction", junctionId: "J1" },
      to: { kind: "junction", junctionId: "J2" },
      waypoints: [{ x: 100, y: 0 }],
      segmentModes: ["manual", "trunk"],
    });
    document.annotations.push({
      id: "route-label",
      kind: "net-label",
      netId: "net-1",
      binding: { kind: "net-name", netId: "net-1" },
      anchor: {
        kind: "route",
        routeId: "route-1",
        segmentIndex: 1,
        t: 0.5,
        normalOffset: -10,
        direction: "forward",
        orientation: "follow",
        fallbackPosition: { x: 100, y: 50 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });

    const first = upgradeSchema25To26WithReport(source);
    const second = upgradeSchema25To26WithReport(source);
    expect(first).toEqual(second);
    expect(first.report.routes[0]).toMatchObject({
      documentId: document.id,
      routeId: "route-1",
      reboundAnnotationIds: ["route-label"],
    });
    // Schema 25 has left the rolling window; retained transforms can still
    // replay the complete history before the current boundary validates it.
    const parsed = parseProjectWithMetadata(
      JSON.stringify(
        upgradeSchema32To33(
          upgradeSchema31To32(
            upgradeSchema30To31(
              upgradeSchema29To30(
                upgradeSchema28To29(
                  upgradeSchema27To28(
                    upgradeSchema26To27(upgradeSchema25To26(source)),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    expect(parsed).toMatchObject({
      sourceSchemaVersion: PREVIOUS_PROJECT_SCHEMA_VERSION,
      migrated: true,
      project: { schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION },
    });
    const route = parsed.project.documents[0]!.routes[0]!;
    const annotation = parsed.project.documents[0]!.annotations[0]!;
    expect(route.start).toEqual({ kind: "junction", junctionId: "J1" });
    expect(route.legs.map((leg) => leg.mode)).toEqual(["manual", "trunk"]);
    expect(annotation.anchor).toMatchObject({
      kind: "route",
      routeId: route.id,
      legId: route.legs[1]!.id,
    });
    expect(
      serializeProject(parseProject(serializeProject(parsed.project))),
    ).toBe(serializeProject(parsed.project));
  });

  it("rejects schemas outside the supported chain window", () => {
    const project = createEmptyProject("project-test", "Test Project");
    for (const schemaVersion of [1, 22, 23, 36, 99]) {
      expect(() =>
        parseProject(JSON.stringify({ ...project, schemaVersion })),
      ).toThrow(/must be between 24 and 35/);
    }
  });
});
