import { createEmptyDocument } from "@icm/model";
import { expect, it } from "vitest";
import { terminalConnectivity } from "./terminal-connectivity.js";

it("ignores geometry and net IDs, but detects terminal disconnection", () => {
  const before = createEmptyDocument("doc", "Connectivity");
  before.nets = [
    {
      id: "n",
      terminals: [
        { instanceId: "a", pinName: "1" },
        { instanceId: "b", pinName: "1" },
      ],
    },
  ];
  const after = structuredClone(before);
  after.nets[0]!.id = "renamed";
  after.nets[0]!.terminals.reverse();
  expect(terminalConnectivity(after)).toBe(terminalConnectivity(before));
  after.nets[0]!.terminals.pop();
  expect(terminalConnectivity(after)).not.toBe(terminalConnectivity(before));
});
