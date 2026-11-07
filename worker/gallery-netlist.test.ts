import { describe, expect, it } from "vitest";
import { parseProject, serializeProject } from "@icm/project-protocol";

import { spiceNetlistOf } from "./gallery-netlist";
import { wiredProjectText } from "./gallery.test-support";

describe("a stored Project's SPICE netlist", () => {
  it("names each top-level device's line, to find it in the drawing", () => {
    const project = parseProject(wiredProjectText());
    for (const instance of project.documents[0]!.instances)
      instance.netlist = { ...instance.netlist, parameters: { value: "1k" } };
    const netlist = spiceNetlistOf(serializeProject(project));
    if (!("text" in netlist)) throw new Error(netlist.blocked.join("; "));
    const lines = netlist.text.split("\n");
    expect(netlist.instances.map((place) => place.instanceId).sort()).toEqual([
      "R1",
      "R2",
    ]);
    for (const place of netlist.instances)
      expect(lines[place.line]).toMatch(new RegExp(`^${place.instanceId}\\b`));
  });
});
