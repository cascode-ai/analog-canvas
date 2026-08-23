import { createEmptyProject } from "@icm/model";
import { InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { buildProjectConnectivityIndex } from "./connectivity-index.js";
import { createEndpointConnectivityClassifier } from "./endpoint-connectivity.js";

const symbol = {
  schemaVersion: 1 as const,
  id: "assessment-symbol",
  name: "Assessment symbol",
  viewBox: { x: -20, y: -20, width: 40, height: 40 },
  pins: [
    {
      name: "L",
      role: "passive",
      at: { x: -20, y: 0 },
      direction: "west" as const,
      presentation: { visibility: "visible" as const },
    },
    {
      name: "R",
      role: "passive",
      at: { x: 20, y: 0 },
      direction: "east" as const,
      presentation: { visibility: "visible" as const },
    },
    {
      name: "I",
      role: "passive",
      at: { x: 0, y: 20 },
      direction: "south" as const,
      presentation: { visibility: "implicit" as const },
    },
  ],
  primitives: [],
  variants: [],
};

const resolver = new InMemorySymbolResolver([symbol]);
const endpoint = (instanceId: string, pinName: string) => ({
  kind: "terminal" as const,
  instanceId,
  pinName,
});

function fixture() {
  const project = createEmptyProject("assessment", "Assessment", "main");
  const document = project.documents[0]!;
  document.instances.push(
    ...["A", "B"].map((id) => ({
      id,
      symbolId: symbol.id,
      placement: null,
    })),
  );
  return { project, document };
}

function classifierFor(project: ReturnType<typeof fixture>["project"]) {
  const index = buildProjectConnectivityIndex(project, resolver);
  const document = project.documents[0]!;
  return createEndpointConnectivityClassifier(
    document,
    index.documents.get(document.id),
    resolver,
  );
}

describe("endpoint connectivity assessment", () => {
  it("distinguishes unbound, singleton, and peer-connected membership", () => {
    const { project, document } = fixture();
    document.nets.push(
      {
        id: "single",
        scope: "local",
        terminals: [{ instanceId: "A", pinName: "L" }],
      },
      {
        id: "peer",
        scope: "local",
        terminals: [
          { instanceId: "A", pinName: "R" },
          { instanceId: "B", pinName: "L" },
        ],
      },
    );
    const classifier = classifierFor(project);

    expect(classifier.assess(endpoint("B", "R"))).toMatchObject({
      membership: "unbound",
      electricallySatisfied: false,
    });
    expect(classifier.assess(endpoint("A", "L"))).toMatchObject({
      membership: "singleton",
      electricallySatisfied: false,
    });
    expect(classifier.assess(endpoint("A", "R"))).toMatchObject({
      membership: "peer-connected",
      electricallySatisfied: true,
      peerEndpoints: [endpoint("B", "L")],
    });
  });

  it("keeps explicit intents separate from physical membership", () => {
    const { project, document } = fixture();
    document.noConnects.push({
      id: "nc-b-r",
      endpoint: endpoint("B", "R"),
    });
    document.nets.push(
      {
        id: "formal",
        scope: "local",
        terminals: [{ instanceId: "A", pinName: "L" }],
      },
      {
        id: "supply",
        scope: "local",
        terminals: [{ instanceId: "A", pinName: "R" }],
      },
    );
    document.netlist = {
      name: "assessment",
      formalParameters: [],
      terminals: [
        {
          id: "formal-l",
          name: "L",
          netId: "formal",
          direction: "passive",
          interfaceInstanceIds: ["A"],
        },
      ],
    };
    document.connectivityEvidence.push({
      id: "claim-vdd",
      kind: "name-claim",
      netId: "supply",
      name: "VDD",
      owner: { kind: "explicit-net-property" },
      scope: "global",
      powerDomain: "vdd",
    });
    const classifier = classifierFor(project);

    expect(classifier.assess(endpoint("B", "R"))).toMatchObject({
      membership: "unbound",
      intent: { explicitNoConnect: true },
      electricallySatisfied: true,
    });
    expect(classifier.assess(endpoint("A", "I"))).toMatchObject({
      membership: "unbound",
      intent: { implicit: true },
      electricallySatisfied: true,
    });
    expect(classifier.assess(endpoint("A", "L"))).toMatchObject({
      membership: "singleton",
      intent: { formalBoundary: true },
      electricallySatisfied: true,
    });
    expect(classifier.assess(endpoint("A", "R"))).toMatchObject({
      membership: "singleton",
      intent: { globalSupply: true },
      electricallySatisfied: true,
    });
  });
});
