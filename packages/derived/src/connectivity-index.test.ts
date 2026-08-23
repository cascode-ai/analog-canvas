import { createEmptyProject } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { buildProjectConnectivityIndex } from "./connectivity-index.js";
import { computeNetHighlight } from "./net-highlight.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("Project Connectivity Index logical aliases", () => {
  it("aggregates evidence-equivalent Base Nets under every Base-Net lookup", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.instances.push(
      { id: "P1", symbolId: "port", placement: null },
      { id: "P2", symbolId: "port", placement: null },
    );
    document.nets.push(
      {
        id: "net-a",
        scope: "local",
        terminals: [{ instanceId: "P1", pinName: "P" }],
      },
      {
        id: "net-b",
        scope: "local",
        terminals: [{ instanceId: "P2", pinName: "P" }],
      },
    );
    document.connectivityEvidence.push(
      {
        id: "claim-a",
        kind: "name-claim",
        netId: "net-a",
        name: "BIAS",
        owner: { kind: "free-port", instanceId: "P1" },
        scope: "local",
      },
      {
        id: "claim-b",
        kind: "name-claim",
        netId: "net-b",
        name: "bias",
        owner: { kind: "free-port", instanceId: "P2" },
        scope: "local",
      },
    );

    const index = buildProjectConnectivityIndex(project, resolver);
    for (const netId of ["net-a", "net-b"]) {
      expect(
        index.documents.get(document.id)?.logicalNetByBaseNetId.get(netId),
      ).toMatchObject({
        baseNetIds: ["net-a", "net-b"],
        logicalEndpoints: expect.arrayContaining([
          { kind: "terminal", instanceId: "P1", pinName: "P" },
          { kind: "terminal", instanceId: "P2", pinName: "P" },
        ]),
      });
      expect(
        computeNetHighlight(index, document.id, netId)?.visibleEndpoints,
      ).toHaveLength(2);
    }
    expect(
      computeNetHighlight(index, document.id, "net-a", {
        kind: "terminal",
        instanceId: "P1",
        pinName: "P",
      })?.visibleEndpoints,
    ).toHaveLength(2);
  });
});
