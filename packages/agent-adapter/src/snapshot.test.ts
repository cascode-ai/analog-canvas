import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createEmptyDocument } from "@icm/model";
import { parseProject } from "@icm/project-protocol";
import type { CircuitProject } from "@icm/model";
import { resolveDocumentRoutingGeometry } from "@icm/derived";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  AgentCircuitRequestSchema,
  AgentSessionSnapshotSchema,
} from "./schema.js";
import {
  buildAgentSessionSnapshot,
  canonicalSnapshotContent,
} from "./snapshot.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function fixtureProject(): CircuitProject {
  return parseProject(
    readFileSync(
      resolve(
        process.cwd(),
        "fixtures/projects/phase-5-dense-analog/project.icproj.json",
      ),
      "utf8",
    ),
  );
}

describe("Agent Document Snapshot", () => {
  it("provides complete bidirectional topology and presentation facts", () => {
    const project = fixtureProject();
    const document = project.documents[0]!;
    const snapshot = buildAgentSessionSnapshot({
      project,
      document,
      resolver,
    });

    expect(AgentSessionSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(snapshot.document.revision).toBe(document.revision);
    expect(snapshot.document.presentation).toEqual(document.presentation);
    expect(snapshot.document.routes[0]).toMatchObject({
      start: expect.any(Object),
      legs: expect.any(Array),
      polyline: expect.any(Array),
    });
    const snapshotRoute = snapshot.document.routes[0]!;
    expect(snapshotRoute.polyline).toEqual(
      resolveDocumentRoutingGeometry(document, resolver).routes.get(
        snapshotRoute.id,
      )?.centerline ?? null,
    );
    expect(snapshot.document.layoutGroups[0]?.objectIds.length).toBeGreaterThan(
      0,
    );

    const m1 = snapshot.document.instances.find((item) => item.id === "M1")!;
    expect(m1.pins.find((pin) => pin.name === "G")).toMatchObject({
      netId: "net-vinp",
      connection: expect.objectContaining({
        contactPoint: expect.any(Object),
        gridLanding: expect.any(Object),
      }),
    });
    const vinp = snapshot.document.nets.find((item) => item.id === "net-vinp")!;
    expect(vinp.terminals).toContainEqual({ instanceId: "M1", pinName: "G" });
    const modelM1 = document.instances.find((item) => item.id === "M1")!;
    if (!modelM1.netlist) {
      expect(m1.netlist).toBeUndefined();
    } else {
      expect(m1.netlist).toMatchObject({
        reference: modelM1.reference,
        parameters: modelM1.netlist.parameters,
      });
      expect(m1.netlist?.binding).toEqual(modelM1.netlist.binding);
      expect(m1.netlist?.terminalMapping).toEqual(
        modelM1.importProvenance?.terminalMapping,
      );
    }

    for (const instance of snapshot.document.instances) {
      for (const pin of instance.pins) {
        if (!pin.netId) continue;
        const net = snapshot.document.nets.find(
          (candidate) => candidate.id === pin.netId,
        );
        expect(net?.terminals).toContainEqual({
          instanceId: instance.id,
          pinName: pin.name,
        });
      }
    }
    for (const net of snapshot.document.nets) {
      for (const terminal of net.terminals) {
        const instance = snapshot.document.instances.find(
          (candidate) => candidate.id === terminal.instanceId,
        );
        expect(instance).toBeDefined();
        expect(
          instance?.pins.find((pin) => pin.name === terminal.pinName)?.netId,
        ).toBe(net.id);
      }
    }

    const canonical = canonicalSnapshotContent({
      project: snapshot.project,
      document: snapshot.document,
    });
    expect(snapshot.byteLength).toBe(Buffer.byteLength(canonical, "utf8"));
    expect(snapshot.electricalTopologyHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("exposes the resolved marker-owned power-domain fact", () => {
    const document = createEmptyDocument("power-snapshot", "Power Snapshot");
    document.nets.push({
      id: "net-vdd",

      terminals: [],
    });
    document.connectivityEvidence.push({
      id: "claim-vdd",
      kind: "name-claim",
      netId: "net-vdd",
      name: "VDD",
      scope: "global",
      powerDomain: "vdd",
      owner: { kind: "net-label", annotationId: "test-net-label-1" },
    });
    const snapshot = buildAgentSessionSnapshot({ document, resolver });
    expect(snapshot.document.nets).toContainEqual(
      expect.objectContaining({ id: "net-vdd", powerDomain: "vdd" }),
    );
  });

  it("reports a materialized MOS supply default distinctly from an explicit B route", () => {
    const document = createEmptyDocument("bulk-snapshot", "Bulk Snapshot");
    document.instances.push({
      id: "M1",
      symbolId: "nmos",
      symbolVariantId: "textbook-3terminal",
      mosBulkBinding: {
        origin: "supply-default",
        netId: "net-global-0",
      },
      placement: null,
    });
    document.nets.push({
      id: "net-global-0",

      terminals: [{ instanceId: "M1", pinName: "B" }],
    });

    const snapshot = buildAgentSessionSnapshot({ document, resolver });

    expect(snapshot.document.instances[0]?.mosBulk).toEqual({
      status: "supply-default",
      netId: "net-global-0",
    });
    expect(AgentSessionSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });

  it("uses canonical Project ERC evidence in the Snapshot", () => {
    const project = fixtureProject();
    const document = createEmptyDocument("snapshot-erc", "Snapshot ERC");
    document.instances.push({
      id: "R-open",
      symbolId: "resistor",
      placement: {
        position: { x: 0, y: 0 },
        rotation: 0,
        mirror: "none",
      },
    });
    project.documents = [document];
    project.topDocumentId = document.id;

    const snapshot = buildAgentSessionSnapshot({ project, document, resolver });
    expect(snapshot.document.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          domain: "erc",
          code: "ERC_UNCONNECTED_PIN",
          objectIds: ["R-open:1"],
          parameters: { instanceId: "R-open", pinName: "1" },
        }),
      ]),
    );
  });

  it("cannot be submitted as a mutation request", () => {
    const project = fixtureProject();
    const snapshot = buildAgentSessionSnapshot({
      project,
      document: project.documents[0]!,
      resolver,
    });
    expect(
      AgentCircuitRequestSchema.safeParse({
        apiVersion: "2.0",
        requestId: "replace-document",
        operation: "transact",
        documentId: snapshot.document.id,
        expectedRevision: snapshot.document.revision,
        transactionId: "replace-document",
        snapshot,
      }).success,
    ).toBe(false);
  });

  it("keeps electricalTopologyHash stable across non-electrical edits", () => {
    const project = fixtureProject();
    const base = buildAgentSessionSnapshot({
      project,
      document: project.documents[0]!,
      resolver,
    });

    // Move an instance, change an annotation, and add drafting: none of
    // these are electrical facts, so the hash must not change (ADR 0010).
    const edited = structuredClone(project);
    const document = edited.documents[0]!;
    document.instances[0]!.placement = {
      position: { x: 1000, y: 1000 },
      rotation: 90,
      mirror: "x",
    };
    document.annotations[0]!.content = {
      runs: [{ kind: "text", value: "changed" }],
    };
    document.drafting = {
      objects: [
        {
          id: "d1",
          kind: "text",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 10, y: 10 } },
          content: { runs: [{ kind: "text", value: "note" }] },
          alignment: "start",
          rotation: 0,
        },
      ],
    };
    const after = buildAgentSessionSnapshot({
      project: edited,
      document,
      resolver,
    });
    expect(after.electricalTopologyHash).toBe(base.electricalTopologyHash);
  });

  it("changes electricalTopologyHash when Net membership changes", () => {
    const project = fixtureProject();
    const base = buildAgentSessionSnapshot({
      project,
      document: project.documents[0]!,
      resolver,
    });
    const edited = structuredClone(project);
    const document = edited.documents[0]!;
    // Remove a terminal from a Net: an electrical fact.
    document.nets[0]!.terminals.pop();
    const after = buildAgentSessionSnapshot({
      project: edited,
      document,
      resolver,
    });
    expect(after.electricalTopologyHash).not.toBe(base.electricalTopologyHash);
  });

  it("includes NoConnect declarations but excludes Route and Junction geometry from electricalTopologyHash", () => {
    const project = fixtureProject();
    const document = project.documents[0]!;
    const base = buildAgentSessionSnapshot({ project, document, resolver });

    const withNoConnect = structuredClone(project);
    const noConnectDocument = withNoConnect.documents[0]!;
    noConnectDocument.noConnects.push({
      id: "nc-hash-contract",
      endpoint: { kind: "terminal", instanceId: "M1", pinName: "B" },
    });
    const declared = buildAgentSessionSnapshot({
      project: withNoConnect,
      document: noConnectDocument,
      resolver,
    });
    expect(declared.electricalTopologyHash).not.toBe(
      base.electricalTopologyHash,
    );

    const geometryOnly = structuredClone(withNoConnect);
    const geometryDocument = geometryOnly.documents[0]!;
    geometryDocument.routes[0]!.legs[0]!.mode = "locked";
    geometryDocument.junctions.push({
      id: "junction-hash-contract",
      netId: geometryDocument.nets[0]!.id,
      position: { x: 10, y: 10 },
      role: "route-anchor",
    });
    const afterGeometry = buildAgentSessionSnapshot({
      project: geometryOnly,
      document: geometryDocument,
      resolver,
    });
    expect(afterGeometry.electricalTopologyHash).toBe(
      declared.electricalTopologyHash,
    );
  });

  it("exposes resolved drafting geometry matching the persisted anchor", () => {
    const project = fixtureProject();
    const document = project.documents[0]!;
    document.drafting = {
      objects: [
        {
          id: "d1",
          kind: "text",
          locked: false,
          zIndex: 0,
          anchor: {
            kind: "object",
            objectId: document.instances[0]!.id,
            localOffset: { x: 10, y: 10 },
            fallbackPosition: { x: 0, y: 0 },
          },
          content: { runs: [{ kind: "text", value: "note" }] },
          alignment: "start",
          rotation: 0,
        },
      ],
    };
    const snapshot = buildAgentSessionSnapshot({ project, document, resolver });
    const entry = snapshot.document.drafting.objects[0]!;
    expect(entry.object.id).toBe("d1");
    const geometry = entry.resolvedGeometry as {
      kind: string;
      position?: { x: number; y: number };
    };
    expect(geometry.kind).toBe("text");
    // The resolved position = instance placement + localOffset.
    const instance = document.instances[0]!.placement!.position;
    expect(geometry.position).toEqual({
      x: instance.x + 10,
      y: instance.y + 10,
    });
    // The persisted anchor is unchanged (still references the instance).
    expect(entry.object.anchor).toMatchObject({
      kind: "object",
      objectId: document.instances[0]!.id,
    });
  });
});
