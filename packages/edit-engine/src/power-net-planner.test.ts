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
        name: "AVDD",
        scope: "global",
        powerDomain: "vdd",
        terminals: [],
      },
      {
        id: "net-vdd",
        name: "VDD",
        scope: "global",
        powerDomain: "vdd",
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
    document.nets.push({ id: "net-contact", scope: "local", terminals: [] });

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

  it("rejects Ground on an independently named signal Net", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push(
      {
        id: "net-tail",
        name: "TAIL",
        scope: "local",
        terminals: [],
      },
      {
        id: "net-global-0",
        name: "0",
        scope: "global",
        powerDomain: "ground",
        terminals: [],
      },
    );
    document.connectivityEvidence.push({
      id: "claim-tail",
      kind: "name-claim",
      netId: "net-tail",
      name: "TAIL",
      owner: { kind: "explicit-net-property" },
      scope: "local",
    });

    expect(
      planEnsurePowerNet(document, {
        candidateNetId: "net-tail",
        candidateState: "existing",
        domain: "ground",
        ...marker,
      }),
    ).toMatchObject({ ok: false, relatedNetIds: ["net-tail"] });
  });

  it("adds a Ground marker claim to an unnamed Base Net", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push({
      id: "net-tail",
      scope: "local",
      terminals: [],
    });
    expect(
      planEnsurePowerNet(document, {
        candidateNetId: "net-tail",
        candidateState: "existing",
        domain: "ground",
        ...marker,
      }),
    ).toEqual({
      ok: true,
      netId: "net-tail",
      edits: [
        {
          kind: "upsert_connectivity_evidence",
          evidence: expect.objectContaining({
            netId: "net-tail",
            name: "0",
            powerDomain: "ground",
          }),
        },
      ],
    });
  });

  it("rejects a requested supply attached to a differently named Net", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push({
      id: "net-avdd",
      name: "AVDD",
      scope: "global",
      powerDomain: "vdd",
      terminals: [],
    });
    document.connectivityEvidence.push({
      id: "claim-avdd",
      kind: "name-claim",
      netId: "net-avdd",
      name: "AVDD",
      owner: { kind: "explicit-net-property" },
      scope: "global",
      powerDomain: "vdd",
    });

    expect(
      planEnsurePowerNet(document, {
        candidateNetId: "net-avdd",
        candidateState: "existing",
        domain: "ground",
        ...marker,
      }),
    ).toMatchObject({ ok: false, relatedNetIds: ["net-avdd"] });
  });
});
