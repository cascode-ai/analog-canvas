import { createEmptyDocument, createRoutePath } from "@icm/model";
import {
  resolveDocumentLogicalNets,
  deriveImportedRoutingGuidance,
} from "@icm/derived";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";
import {
  missingPowerMarkerClaims,
  withPowerMarkerOwnership,
} from "./power-marker-ownership.js";
import { executeTransaction } from "./transaction.js";
import { captureRoutingCopyFragment } from "./routing-copy-fragment.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function fixture() {
  const document = createEmptyDocument("ground", "Ground");
  for (const [index, x] of [0, 200, 400].entries()) {
    const r = `R${index}`,
      g = `G${index}`;
    document.instances.push(
      {
        id: r,
        symbolId: "resistor",
        placement: { position: { x, y: 0 }, rotation: 0, mirror: "none" },
      },
      {
        id: g,
        symbolId: "ground",
        placement: { position: { x, y: 80 }, rotation: 0, mirror: "none" },
      },
    );
    document.routes.push(
      createRoutePath({
        id: `wire${index}`,
        netId: "source-ground",
        start: { kind: "terminal", instanceId: r, pinName: "2" },
        end: { kind: "terminal", instanceId: g, pinName: "0" },
        bends: [],
        modes: ["manual"],
      }),
    );
  }
  document.nets.push({
    id: "source-ground",
    terminals: document.instances.map((i) => ({
      instanceId: i.id,
      pinName: i.symbolId === "ground" ? "0" : "2",
    })),
  });
  document.connectivityEvidence.push(
    {
      id: "source",
      kind: "spice-source",
      netId: "source-ground",
      sourceNetId: "original-0",
    },
    {
      id: "global",
      kind: "name-claim",
      netId: "source-ground",
      name: "0",
      scope: "global",
      powerDomain: "ground",
      owner: { kind: "global-declaration", sourceNetId: "original-0" },
    },
  );
  return document;
}

describe("power marker ownership across physical editing", () => {
  it("keeps untouched ground branches logically joined but releases the actually cut pin", () => {
    const document = fixture();
    const before = structuredClone(document);
    const result = executeTransaction(
      document,
      {
        transactionId: "cut",
        documentId: document.id,
        expectedRevision: 0,
        actor: { kind: "human", id: "test" },
        edits: [{ kind: "cut_connection", routeId: "wire0" }],
      },
      { symbolResolver: resolver },
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    const groups = resolveDocumentLogicalNets(result.document);
    const netFor = (id: string) =>
      result.document.nets.find((n) =>
        n.terminals.some((t) => t.instanceId === id),
      )!;
    expect(groups.byBaseNetId.get(netFor("R0").id)?.name).toBeUndefined();
    for (const id of ["G0", "G1", "G2", "R1", "R2"]) {
      expect(groups.byBaseNetId.get(netFor(id).id)).toMatchObject({
        name: "0",
        scope: "global",
      });
    }
    expect(new Set(["G0", "R1", "R2"].map((id) => netFor(id).id)).size).toBe(3);
    expect(document).toEqual(before);
    // Only the genuinely cut pin may remain a source-routing candidate.
    expect(deriveImportedRoutingGuidance(result.document, resolver)).toEqual(
      [],
    );
  });

  it("captures a legacy marker as a named copy owner without mutating its source", () => {
    const document = fixture();
    const capture = captureRoutingCopyFragment(document, {
      instanceIds: ["G1"],
      routeIds: [],
      junctionIds: [],
    });
    expect(capture.ownerNetIds).toEqual(["source-ground"]);
    const prepared = withPowerMarkerOwnership(document);
    expect(missingPowerMarkerClaims(prepared)).toEqual([]);
    expect(
      prepared.connectivityEvidence.filter(
        (e) => e.kind === "name-claim" && e.owner.kind === "power-marker",
      ),
    ).toHaveLength(3);
    expect(document.connectivityEvidence).toHaveLength(2);
  });

  it("recovers a source-backed split Ground only at import, never a bare detached device", () => {
    const document = fixture();
    document.nets[0]!.terminals = document.nets[0]!.terminals.filter(
      (t) => t.instanceId !== "G1" && t.instanceId !== "R1",
    );
    document.nets.push(
      { id: "split", terminals: [{ instanceId: "G1", pinName: "0" }] },
      { id: "detached", terminals: [{ instanceId: "R1", pinName: "2" }] },
    );
    for (const netId of ["split", "detached"])
      document.connectivityEvidence.push({
        id: `source-${netId}`,
        kind: "spice-source",
        netId,
        sourceNetId: "original-0",
      });
    expect(
      missingPowerMarkerClaims(document).some((c) => c.netId === "split"),
    ).toBe(false);
    const repairs = missingPowerMarkerClaims(document, {
      recoverImportedGround: true,
    });
    expect(repairs.some((c) => c.netId === "split")).toBe(true);
    expect(repairs.some((c) => c.netId === "detached")).toBe(false);
    document.connectivityEvidence.push({
      id: "bias",
      kind: "name-claim",
      netId: "split",
      name: "BIAS",
      scope: "local",
      owner: { kind: "power-marker", objectId: "G1" },
    });
    expect(
      missingPowerMarkerClaims(document, { recoverImportedGround: true }).some(
        (c) => c.netId === "split",
      ),
    ).toBe(false);
  });
});
