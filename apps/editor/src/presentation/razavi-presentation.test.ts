import { createEmptyDocument, createEmptyProject } from "@icm/model";
import { validateLogicalNetContract } from "@icm/derived";
import { describe, expect, it } from "vitest";

import {
  materializeRazaviProjectBulkConnections,
  razaviManualBulkConnectionEdits,
} from "./razavi-presentation";

function manualMos(id: string, symbolId: "nmos" | "pmos") {
  return {
    id,
    symbolId,
    symbolVariantId: "textbook-3terminal",
    placement: null,
  };
}

describe("Razavi hidden bulk policy", () => {
  it("materializes a configured entry-boundary default without mutating the supplied Project", () => {
    const project = createEmptyProject("project-entry", "Entry");
    const document = project.documents[0]!;
    document.instances.push(manualMos("M1", "nmos"));
    document.nets.push({
      id: "net-ground",
      name: "0",
      scope: "global",
      powerDomain: "ground",
      terminals: [],
    });
    document.mosBulkDefaults = { nmosNetId: "net-ground" };

    const prepared = materializeRazaviProjectBulkConnections(project);

    expect(prepared.instanceCount).toBe(1);
    expect(project.documents[0]!.nets[0]!.terminals).toEqual([]);
    expect(prepared.project.documents[0]!.nets[0]).toMatchObject({
      id: "net-ground",
      terminals: [{ instanceId: "M1", pinName: "B" }],
    });
  });

  it("delegates matching-supply materialization to the Edit Engine", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push(manualMos("M4", "pmos"));
    document.nets.push({
      id: "net-vdd",
      name: "VDD",
      scope: "global",
      powerDomain: "vdd",
      terminals: [],
    });
    document.mosBulkDefaults = { pmosNetId: "net-vdd" };

    expect(
      razaviManualBulkConnectionEdits(document, document.instances),
    ).toEqual([
      {
        kind: "reconcile_mos_bulk",
        instanceIds: ["M4"],
      },
    ]);
  });

  it("does not infer bulk from an unconfigured VDD Net", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push(manualMos("M4", "pmos"));
    document.nets.push({
      id: "net-ui-2",
      name: "VDD",
      scope: "global",
      powerDomain: "vdd",
      terminals: [],
    });

    expect(
      razaviManualBulkConnectionEdits(document, document.instances),
    ).toEqual([]);
  });

  it("leaves imported and manual MOS unresolved without a configured default", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push(
      {
        ...manualMos("Ximported", "nmos"),
        sourceRef: {
          fileId: "source.sp",
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 1, line: 1, column: 2 },
        },
      },
      manualMos("MnoSupply", "nmos"),
    );
    expect(
      razaviManualBulkConnectionEdits(document, document.instances),
    ).toEqual([]);
  });

  it("does not create canonical supply Nets at Project entry", () => {
    const project = createEmptyProject("project-entry", "Entry");
    const document = project.documents[0]!;
    document.instances.push(manualMos("MN", "nmos"), manualMos("MP", "pmos"));

    const prepared = materializeRazaviProjectBulkConnections(project);
    const preparedDocument = prepared.project.documents[0]!;

    expect(prepared.instanceCount).toBe(0);
    expect(preparedDocument.nets).toEqual([]);
  });

  it("does not repair duplicate canonical Nets at Project entry", () => {
    const project = createEmptyProject("project-entry", "Entry");
    project.documents[0]!.nets.push(
      {
        id: "net-ground-a",
        name: "0",
        scope: "global",
        powerDomain: "ground",
        terminals: [],
      },
      {
        id: "net-ground-b",
        name: "0",
        scope: "global",
        powerDomain: "ground",
        terminals: [],
      },
    );
    project.documents[0]!.connectivityEvidence.push(
      {
        id: "ground-a-claim",
        kind: "name-claim",
        netId: "net-ground-a",
        name: "0",
        scope: "global",
        powerDomain: "ground",
        owner: { kind: "explicit-net-property" },
      },
      {
        id: "ground-b-claim",
        kind: "name-claim",
        netId: "net-ground-b",
        name: "0",
        scope: "global",
        powerDomain: "ground",
        owner: { kind: "explicit-net-property" },
      },
    );

    const prepared = materializeRazaviProjectBulkConnections(project);

    expect(prepared.project.documents[0]!.nets).toHaveLength(2);
    expect(validateLogicalNetContract(prepared.project.documents[0]!)).toEqual(
      [],
    );
  });
});
