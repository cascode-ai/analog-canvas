import { describe, expect, it } from "vitest";
import { createEmptyDocument, createEmptyProject } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";

import {
  electricalTopologyHash,
  endpointBelongsToNet,
  resolveEndpointPoint,
} from "./index.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("current terminal-only connectivity contract", () => {
  it.each(["port", "port-filled"] as const)(
    "treats %s as an ordinary instance terminal",
    (symbolId) => {
      const document = createEmptyDocument("doc", "Doc");
      document.instances.push({
        id: "VIN",
        symbolId,
        placement: {
          position: { x: 100, y: 80 },
          rotation: 0,
          mirror: "none",
        },
      });
      document.nets.push({
        id: "net-in",

        terminals: [{ instanceId: "VIN", pinName: "P" }],
      });
      const endpoint = {
        kind: "terminal" as const,
        instanceId: "VIN",
        pinName: "P",
      };

      expect(endpointBelongsToNet(document, document.nets[0]!, endpoint)).toBe(
        true,
      );
      expect(resolveEndpointPoint(document, resolver, endpoint)).toEqual({
        x: 100,
        y: 80,
      });
    },
  );

  it("hashes the ordinary Port component through the same terminal topology", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    const before = electricalTopologyHash(project);
    document.instances.push({
      id: "VOUT",
      symbolId: "port-filled",
      placement: null,
    });
    document.nets.push({
      id: "net-out",

      terminals: [{ instanceId: "VOUT", pinName: "P" }],
    });
    expect(electricalTopologyHash(project)).not.toBe(before);
  });
});
