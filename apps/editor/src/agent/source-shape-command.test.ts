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

  it("draws a current source as a diamond as Properties does", () => {
    const plan = planBrowserAgentCommand(project("vccs"), "main", resolver, {
      kind: "set-properties",
      instanceId: "x1",
      shape: "diamond",
    });
    expect("edits" in plan ? plan.edits : []).toContainEqual({
      kind: "set_instance_symbol",
      instanceId: "x1",
      symbolId: "vccs",
      symbolVariantId: "diamond",
    });
  });

  it("refuses a shape for a part that has none", () => {
    expect(() =>
      planBrowserAgentCommand(project("resistor"), "main", resolver, {
        kind: "set-properties",
        instanceId: "x1",
        shape: "diamond",
      }),
    ).toThrow("shape is for current-source, vccs and cccs");
  });
});
