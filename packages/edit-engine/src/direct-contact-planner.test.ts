import { createEmptyDocument } from "@icm/model";
import { describe, expect, it } from "vitest";

import { planDirectEndpointConnection } from "./direct-contact-planner.js";

const endpoint = (instanceId: string) => ({
  kind: "terminal" as const,
  instanceId,
  pinName: "P",
});

function fixture() {
  const document = createEmptyDocument("main", "Main");
  document.instances.push(
    { id: "A", symbolId: "port", placement: null },
    { id: "B", symbolId: "port", placement: null },
  );
  return document;
}

describe("direct endpoint connection planner", () => {
  it("creates a Base Net when both endpoints are unbound", () => {
    expect(
      planDirectEndpointConnection(fixture(), {
        from: endpoint("A"),
        to: endpoint("B"),
        newNetId: "net-contact",
      }),
    ).toMatchObject({
      ok: true,
      netId: "net-contact",
      edits: [{ kind: "connect_endpoints", newNetId: "net-contact" }],
    });
  });

  it("merges two compatible Base Nets before confirming contact", () => {
    const document = fixture();
    document.nets.push(
      {
        id: "net-a",

        terminals: [{ instanceId: "A", pinName: "P" }],
      },
      {
        id: "net-b",

        terminals: [{ instanceId: "B", pinName: "P" }],
      },
    );

    expect(
      planDirectEndpointConnection(document, {
        from: endpoint("A"),
        to: endpoint("B"),
        newNetId: "unused",
      }),
    ).toMatchObject({
      ok: true,
      netId: "net-a",
      edits: [
        { kind: "merge_nets", targetNetId: "net-a", sourceNetId: "net-b" },
        { kind: "connect_endpoints" },
      ],
    });
  });

  it("retires both labels when differently named Nets are joined", () => {
    const document = fixture();
    document.nets.push(
      {
        id: "net-a",

        terminals: [{ instanceId: "A", pinName: "P" }],
      },
      {
        id: "net-b",

        terminals: [{ instanceId: "B", pinName: "P" }],
      },
    );
    document.connectivityEvidence.push(
      {
        id: "claim-a",
        kind: "name-claim",
        netId: "net-a",
        name: "AVDD",
        scope: "global",
        powerDomain: "vdd",
        owner: { kind: "net-label", annotationId: "test-net-label-1" },
      },
      {
        id: "claim-b",
        kind: "name-claim",
        netId: "net-b",
        name: "DVDD",
        scope: "global",
        powerDomain: "vdd",
        owner: { kind: "net-label", annotationId: "test-net-label-2" },
      },
    );

    expect(
      planDirectEndpointConnection(document, {
        from: endpoint("A"),
        to: endpoint("B"),
        newNetId: "unused",
      }),
    ).toMatchObject({
      ok: true,
      // Neither AVDD nor DVDD describes the joined node, so both the claims
      // and the labels that own them go, and the node ends up unnamed.
      edits: [
        { kind: "remove_connectivity_evidence", evidenceId: "claim-a" },
        {
          kind: "remove_schematic_annotation",
          annotationId: "test-net-label-1",
        },
        { kind: "remove_connectivity_evidence", evidenceId: "claim-b" },
        {
          kind: "remove_schematic_annotation",
          annotationId: "test-net-label-2",
        },
        { kind: "merge_nets" },
        { kind: "connect_endpoints" },
      ],
    });
  });

  it("allows same-name local and global Nets to make explicit physical contact", () => {
    const document = fixture();
    document.nets.push(
      {
        id: "net-local",
        terminals: [{ instanceId: "A", pinName: "P" }],
      },
      {
        id: "net-global",
        terminals: [{ instanceId: "B", pinName: "P" }],
      },
    );
    document.connectivityEvidence.push(
      {
        id: "claim-local",
        kind: "name-claim",
        netId: "net-local",
        name: "VDD",
        scope: "local",
        owner: { kind: "net-label", annotationId: "label-local" },
      },
      {
        id: "claim-global",
        kind: "name-claim",
        netId: "net-global",
        name: "vdd",
        scope: "global",
        powerDomain: "vdd",
        owner: { kind: "power-marker", objectId: "VDD1" },
      },
    );

    expect(
      planDirectEndpointConnection(document, {
        from: endpoint("A"),
        to: endpoint("B"),
        newNetId: "unused",
      }),
    ).toMatchObject({
      ok: true,
      edits: [{ kind: "merge_nets" }, { kind: "connect_endpoints" }],
    });
    expect(document.connectivityEvidence).toHaveLength(2);
  });
});
