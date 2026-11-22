import { createEmptyDocument } from "@icm/model";
import { describe, expect, it } from "vitest";

import { planEnsurePowerNet } from "./power-net-planner.js";

describe("power Net planner", () => {
  const marker = {
    evidenceId: "claim-marker",
    owner: { kind: "power-marker" as const, objectId: "VDD1" },
  };

  it("names a new VDD Base Net without merging an existing supply", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push(
      {
        id: "net-avdd",

        terminals: [],
      },
      {
        id: "net-vdd",

        terminals: [],
      },
    );

    expect(
      planEnsurePowerNet(document, {
        candidateNetId: "net-new-ground-marker",
        candidateState: "pending-connection",
        domain: "vdd",
        ...marker,
      }),
    ).toEqual({
      ok: true,
      netId: "net-new-ground-marker",
      edits: [
        {
          kind: "upsert_connectivity_evidence",
          evidence: {
            id: "claim-marker",
            kind: "name-claim",
            netId: "net-new-ground-marker",
            name: "VDD",
            owner: marker.owner,
            scope: "global",
            powerDomain: "vdd",
          },
        },
      ],
    });
  });

  it("promotes an unnamed contacted Net to the requested canonical supply", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push({ id: "net-contact", terminals: [] });

    expect(
      planEnsurePowerNet(document, {
        candidateNetId: "net-contact",
        candidateState: "existing",
        domain: "ground",
        ...marker,
      }),
    ).toEqual({
      ok: true,
      netId: "net-contact",
      edits: [
        {
          kind: "upsert_connectivity_evidence",
          evidence: {
            id: "claim-marker",
            kind: "name-claim",
            netId: "net-contact",
            name: "0",
            owner: marker.owner,
            scope: "global",
            powerDomain: "ground",
          },
        },
      ],
    });
  });

  it.each([
    [
      "Ground on an independently named signal Net",
      { name: "TAIL", scope: "local" as const },
    ],
    [
      "a requested supply attached to a differently named Net",
      { name: "AVDD", scope: "global" as const, powerDomain: "vdd" as const },
    ],
  ])("rejects %s", (_name, claim) => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push(
      { id: "net-named", terminals: [] },
      { id: "net-global-0", terminals: [] },
    );
    document.connectivityEvidence.push({
      id: "claim-named",
      kind: "name-claim",
      netId: "net-named",
      owner: { kind: "net-label", annotationId: "test-net-label-1" },
      ...claim,
    });

    expect(
      planEnsurePowerNet(document, {
        candidateNetId: "net-named",
        candidateState: "existing",
        domain: "ground",
        ...marker,
      }),
    ).toMatchObject({ ok: false, relatedNetIds: ["net-named"] });
  });
});
