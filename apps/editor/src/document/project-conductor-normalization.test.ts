import { createEmptyProject, createRoutePath } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { normalizeImportedProjectConductors } from "./project-conductor-normalization";
import { resolveDocumentLogicalNets } from "@icm/derived";
import { parseProject, serializeProject } from "@icm/project-protocol";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("imported Project conductor normalization", () => {
  it("repairs proven split Ground markers once, preserves geometry, and survives save/reopen", () => {
    const project = createEmptyProject("split-ground", "Ground");
    const document = project.documents[0]!;
    for (const id of ["G1", "G2"]) {
      document.instances.push({ id, symbolId: "ground", placement: null });
      document.nets.push({
        id: `net-${id}`,
        terminals: [{ instanceId: id, pinName: "0" }],
      });
      document.connectivityEvidence.push({
        id: `source-${id}`,
        kind: "spice-source",
        netId: `net-${id}`,
        sourceNetId: "original-0",
      });
    }
    document.connectivityEvidence.push({
      id: "global",
      kind: "name-claim",
      netId: "net-G1",
      name: "0",
      scope: "global",
      powerDomain: "ground",
      owner: { kind: "global-declaration", sourceNetId: "original-0" },
    });
    const repaired = normalizeImportedProjectConductors(project, resolver);
    expect(repaired.changedDocumentIds).toEqual([document.id]);
    expect(repaired.project.documents[0]!.nets).toEqual(document.nets);
    expect(repaired.project.documents[0]!.sourceStatus).toBe(
      "connectivity-modified",
    );
    expect(
      resolveDocumentLogicalNets(repaired.project.documents[0]!).groups,
    ).toHaveLength(1);
    const reopened = parseProject(serializeProject(repaired.project));
    expect(
      normalizeImportedProjectConductors(reopened, resolver).changedDocumentIds,
    ).toEqual([]);
    expect(document.connectivityEvidence).toHaveLength(3);
  });
  it("repairs every legacy overlap in the imported copy only", () => {
    const project = createEmptyProject("legacy-overlap", "Legacy overlap");
    const document = project.documents[0]!;
    document.sourceStatus = "in-sync";
    document.nets.push({ id: "net", terminals: [] });
    document.junctions.push(
      {
        id: "left",
        netId: "net",
        position: { x: 0, y: 0 },
        role: "route-anchor",
      },
      {
        id: "right",
        netId: "net",
        position: { x: 100, y: 0 },
        role: "route-anchor",
      },
      {
        id: "top",
        netId: "net",
        position: { x: 50, y: 50 },
        role: "route-anchor",
      },
    );
    document.routes.push(
      createRoutePath({
        id: "trunk",
        netId: "net",
        start: { kind: "junction", junctionId: "left" },
        end: { kind: "junction", junctionId: "right" },
        bends: [],
        modes: ["manual"],
      }),
      createRoutePath({
        id: "overlapping-branch",
        netId: "net",
        start: { kind: "junction", junctionId: "top" },
        end: { kind: "junction", junctionId: "right" },
        bends: [{ x: 50, y: 0 }],
        modes: ["manual", "manual"],
      }),
    );

    const normalized = normalizeImportedProjectConductors(project, resolver);

    expect(normalized.changedDocumentIds).toEqual([document.id]);
    expect(normalized.project).not.toBe(project);
    expect(project.documents[0]!.routes).toHaveLength(2);
    expect(normalized.project.documents[0]).toMatchObject({
      revision: 1,
      sourceStatus: "geometry-only-changed",
    });
    expect(normalized.project.documents[0]!.routes).toHaveLength(3);
    expect(
      normalized.project.documents[0]!.junctions.some(
        (junction) => junction.position.x === 50 && junction.position.y === 0,
      ),
    ).toBe(true);
  });

  it("returns an already canonical Project without a synthetic revision", () => {
    const project = createEmptyProject("canonical", "Canonical");

    const normalized = normalizeImportedProjectConductors(project, resolver);

    expect(normalized).toEqual({ project, changedDocumentIds: [] });
    expect(normalized.project).toBe(project);
  });

  it("converts a switch Route collapsed by current terminal geometry to direct contact", () => {
    const project = createEmptyProject("legacy-switch", "Legacy switch");
    const document = project.documents[0]!;
    document.instances.push(
      {
        id: "X1",
        symbolId: "ideal-switch",
        placement: {
          position: { x: 500, y: 200 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "P1",
        symbolId: "port",
        placement: {
          position: { x: 510, y: 200 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    document.nets.push({
      id: "net-contact",
      terminals: [
        { instanceId: "X1", pinName: "2" },
        { instanceId: "P1", pinName: "P" },
      ],
    });
    document.netlist!.terminals.push({
      id: "terminal-p1",
      name: "OUT",
      netId: "net-contact",
      direction: "passive",
      interfaceInstanceIds: ["P1"],
    });
    document.routes.push(
      createRoutePath({
        id: "legacy-ten-unit-route",
        netId: "net-contact",
        start: { kind: "terminal", instanceId: "P1", pinName: "P" },
        end: { kind: "terminal", instanceId: "X1", pinName: "2" },
        bends: [],
        modes: ["manual"],
      }),
    );

    const normalized = normalizeImportedProjectConductors(project, resolver);

    expect(normalized.changedDocumentIds).toEqual([document.id]);
    expect(normalized.project.documents[0]).toMatchObject({
      revision: 1,
      sourceStatus: "geometry-only-changed",
      routes: [],
      nets: [
        {
          id: "net-contact",
          terminals: [
            { instanceId: "X1", pinName: "2" },
            { instanceId: "P1", pinName: "P" },
          ],
        },
      ],
    });
    expect(project.documents[0]!.routes).toHaveLength(1);
  });
});
