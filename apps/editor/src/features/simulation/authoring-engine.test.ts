import { expect, it } from "vitest";
import { createSimulationFolder } from "@icm/model";
import { authoringEngine } from "./authoring-engine";

it("keeps ngspice source editing available offline without guessing by Profile name", () => {
  const folder = createSimulationFolder({
    id: "f",
    name: "f",
    profileId: "arbitrary",
    engine: "ngspice",
  });
  expect(authoringEngine(folder)).toBe("ngspice");
});
it("refuses mixed or unidentified offline source rather than executing a fallback", () => {
  const folder = createSimulationFolder({
    id: "f",
    name: "f",
    profileId: "arbitrary",
  });
  const entry = folder.input.files.find((f) => f.path === folder.input.entry)!;
  entry.text = "title\ncontrol\n.control\n";
  expect(authoringEngine(folder)).toBeUndefined();
  entry.text = "control in title only\n// control\n* .control\n";
  expect(authoringEngine(folder)).toBeUndefined();
});
