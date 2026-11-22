import { expect, it } from "vitest";
import { parseProject } from "@icm/project-protocol";
import { createScalingInputs } from "./scaling-fixtures.mjs";

it("opens the same independent MOS pairs flat or through thirty-two callers", async () => {
  const inputs = await createScalingInputs();
  const flat = parseProject(inputs.get("flat-2048"));
  const [cell] = flat.documents;
  expect(cell.instances).toHaveLength(2048);
  expect(cell.routes).toHaveLength(2048);
  expect(cell.nets.find((net) => net.id === "net-D0").terminals).toEqual([
    { instanceId: "M1", pinName: "D" },
    { instanceId: "M2", pinName: "D" },
  ]);
  const hier = parseProject(inputs.get("hier-2048"));
  expect(hier.documents.map((document) => document.instances.length)).toEqual([
    32, 64,
  ]);
  expect(hier.documents[1].routes).toHaveLength(64);
  expect(
    hier.documents[0].instances.every(
      (call) => call.netlist.binding.childDocumentId === "bank",
    ),
  ).toBe(true);
}, 30_000);
