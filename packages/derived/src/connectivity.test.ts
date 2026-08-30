/**
 * Wire-transform audit batch 4, #17: the shared per-document connectivity
 * context must be observationally identical to the per-net derivation —
 * it exists purely to stop an all-nets sweep from re-deriving full-document
 * contact evidence and routing geometry once per net.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createEmptyDocument, createRoutePath } from "@icm/model";
import { parseProject } from "@icm/project-protocol";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  deriveNetConnectivity,
  deriveNetConnectivityContext,
} from "./connectivity.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("shared connectivity context (#17)", () => {
  it("context-shared derivation matches the per-net derivation exactly", () => {
    const document = parseProject(
      readFileSync(
        resolve(
          process.cwd(),
          "fixtures/projects/phase-3-routing/project.icproj.json",
        ),
        "utf8",
      ),
    ).documents[0]!;
    const context = deriveNetConnectivityContext(document, resolver);
    expect(document.nets.length).toBeGreaterThan(0);
    for (const net of document.nets) {
      expect(deriveNetConnectivity(document, resolver, net, context)).toEqual(
        deriveNetConnectivity(document, resolver, net),
      );
    }
  });

  it("pre-resolves and orders net-label bindings without changing connectivity", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push({ id: "net-bias", terminals: [] });
    document.junctions.push(
      { id: "J1", netId: "net-bias", position: { x: 0, y: 0 } },
      { id: "J2", netId: "net-bias", position: { x: 40, y: 0 } },
      { id: "J3", netId: "net-bias", position: { x: 100, y: 0 } },
      { id: "J4", netId: "net-bias", position: { x: 140, y: 0 } },
    );
    const routes = [
      createRoutePath({
        id: "route-a",
        netId: "net-bias",
        start: { kind: "junction", junctionId: "J1" },
        end: { kind: "junction", junctionId: "J2" },
        bends: [],
        modes: ["manual"],
      }),
      createRoutePath({
        id: "route-b",
        netId: "net-bias",
        start: { kind: "junction", junctionId: "J3" },
        end: { kind: "junction", junctionId: "J4" },
        bends: [],
        modes: ["manual"],
      }),
    ];
    document.routes.push(...routes);
    for (const [id, route] of [
      ["label-z", routes[0]!],
      ["label-a", routes[1]!],
    ] as const) {
      document.annotations.push({
        id,
        kind: "net-label",
        binding: { kind: "net-name", netId: "net-bias" },
        netId: "net-bias",
        anchor: {
          kind: "route",
          routeId: route.id,
          legId: route.legs[0]!.id,
          t: 0.5,
          normalOffset: 10,
          direction: "forward",
          orientation: "horizontal",
          fallbackPosition: { x: 20, y: -10 },
        },
        alignment: "middle",
        rotation: 0,
        locked: false,
      });
      document.connectivityEvidence.push({
        id: `claim-${id}`,
        kind: "name-claim",
        netId: "net-bias",
        name: "BIAS",
        owner: { kind: "net-label", annotationId: id },
        scope: "local",
      });
    }

    const context = deriveNetConnectivityContext(document, resolver);
    expect(
      context.netLabelBindingsByNetId
        .get("net-bias")
        ?.map((binding) => binding.annotationId),
    ).toEqual(["label-a", "label-z"]);
    expect(
      deriveNetConnectivity(document, resolver, document.nets[0]!, context),
    ).toEqual(deriveNetConnectivity(document, resolver, document.nets[0]!));
  });
});
