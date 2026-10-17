import { describe, expect, it } from "vitest";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { planBrowserAgentCommand } from "./browser-agent-command";
import { emptyAgentProject } from "./live-agent-editor.test-support";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("an Agent's set-properties shape", () => {
  function project(symbolId: string) {
    const value = emptyAgentProject();
    value.documents[0]!.instances.push({
      id: "x1",
      reference: "G1",
      symbolId,
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    });
    return value;
  }

  it.each(["vccs", "cccs", "vcvs", "ccvs"])(
    "draws %s as a diamond as Properties does",
    (symbolId) => {
      const plan = planBrowserAgentCommand(
        project(symbolId),
        "main",
        resolver,
        {
          kind: "set-properties",
          instanceId: "x1",
          shape: "diamond",
        },
      );
      expect("edits" in plan ? plan.edits : []).toContainEqual({
        kind: "set_instance_symbol",
        instanceId: "x1",
        symbolId,
        symbolVariantId: "diamond",
      });
    },
  );

  it.each(["resistor", "current-source", "voltage-source"])(
    "refuses a shape choice for %s",
    (symbolId) => {
      expect(() =>
        planBrowserAgentCommand(project(symbolId), "main", resolver, {
          kind: "set-properties",
          instanceId: "x1",
          shape: "diamond",
        }),
      ).toThrow("shape is for vccs, cccs, vcvs and ccvs");
    },
  );
});
