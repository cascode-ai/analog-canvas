import { createEmptyDocument } from "@icm/model";
import { describe, expect, it } from "vitest";

import { planEnsureNamedNet } from "./named-net-planner.js";

const owner = { kind: "explicit-net-property" as const };

describe("named Net planner", () => {
  it("writes an unused name only as an owner-addressed claim", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push({ id: "net-source", scope: "local", terminals: [] });
    expect(
      planEnsureNamedNet(document, {
        candidateNetId: "net-source",
        name: "Bias",
        evidenceId: "claim-source",
        owner,
      }),
    ).toEqual({
      ok: true,
      netId: "net-source",
      name: "Bias",
      edits: [
        {
          kind: "upsert_connectivity_evidence",
          evidence: {
            id: "claim-source",
            kind: "name-claim",
            netId: "net-source",
            name: "Bias",
            owner,
            scope: "local",
          },
        },
      ],
    });
  });

  it("keeps same-name Base Nets separate and emits no semantic merge", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push(
      { id: "net-a", name: "BIAS", scope: "local", terminals: [] },
      { id: "net-source", scope: "local", terminals: [] },
    );
    const plan = planEnsureNamedNet(document, {
      candidateNetId: "net-source",
      name: "Bias",
      evidenceId: "claim-source",
      owner,
    });
    expect(plan).toMatchObject({
      ok: true,
      netId: "net-source",
      edits: [
        {
          kind: "upsert_connectivity_evidence",
          evidence: { id: "claim-source", netId: "net-source" },
        },
      ],
    });
    expect(
      plan.ok && plan.edits.some((edit) => edit.kind === "merge_nets"),
    ).toBe(false);
  });

  it("rejects same-name evidence across incompatible power roles", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push(
      {
        id: "net-vdd",
        name: "VDD",
        scope: "local",
        powerDomain: "vdd",
        terminals: [],
      },
      {
        id: "net-source",
        scope: "local",
        powerDomain: "ground",
        terminals: [],
      },
    );
    document.connectivityEvidence.push({
      id: "claim-vdd",
      kind: "name-claim",
      netId: "net-vdd",
      name: "VDD",
      scope: "local",
      powerDomain: "vdd",
      owner: { kind: "explicit-net-property" },
    });
    expect(
      planEnsureNamedNet(document, {
        candidateNetId: "net-source",
        name: "vdd",
        evidenceId: "claim-source",
        owner,
        powerDomain: "ground",
      }),
    ).toMatchObject({ ok: false, relatedNetIds: ["net-vdd", "net-source"] });
  });

  it("adopts an existing explicit or imported name without leaving a conflict", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push({
      id: "net-source",
      name: "OLD",
      scope: "local",
      terminals: [],
    });
    document.connectivityEvidence.push({
      id: "claim-explicit",
      kind: "name-claim",
      netId: "net-source",
      name: "OLD",
      owner,
      scope: "local",
    });

    expect(
      planEnsureNamedNet(document, {
        candidateNetId: "net-source",
        name: "NEW",
        evidenceId: "claim-label",
        owner: { kind: "net-label", annotationId: "label-source" },
      }),
    ).toMatchObject({
      ok: true,
      edits: [
        {
          kind: "upsert_connectivity_evidence",
          evidence: { id: "claim-explicit", name: "NEW" },
        },
        {
          kind: "upsert_connectivity_evidence",
          evidence: { id: "claim-label", name: "NEW" },
        },
      ],
    });
  });
});
