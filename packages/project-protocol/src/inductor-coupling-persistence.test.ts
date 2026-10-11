import { createEmptyProject } from "@icm/model";
import { describe, expect, it } from "vitest";
import {
  parseProject,
  serializeProject,
  CURRENT_PROJECT_FILE_VERSION,
} from "./index.js";

function fixture() {
  const project = createEmptyProject("coupling-persistence", "Coupling");
  const document = project.documents[0]!;
  for (const [id, x] of [
    ["L1", 100],
    ["L2", 300],
  ] as const)
    document.instances.push({
      id,
      reference: id,
      symbolId: "inductor",
      placement: { position: { x, y: 100 }, rotation: 0, mirror: "none" },
      netlist: { parameters: { value: "1u" } },
    });
  document.inductorCouplings = [
    {
      id: "K1",
      name: "TF1",
      members: [
        { instanceId: "L1", dotPin: "2" },
        { instanceId: "L2", dotPin: "1" },
      ],
      k: "0.95",
      arrow: false,
    },
  ];
  return project;
}

describe("inductor coupling portable persistence", () => {
  it("keeps every coupling field through repeated saves", () => {
    const before = fixture();
    const text = serializeProject(before);
    expect(JSON.parse(text).schemaVersion).toBe(CURRENT_PROJECT_FILE_VERSION);
    const reopened = parseProject(text);
    expect(reopened.documents[0]!.inductorCouplings).toEqual(
      before.documents[0]!.inductorCouplings,
    );
    expect(serializeProject(reopened)).toBe(text);
  });

  it("writes no field for a Document without couplings", () => {
    const project = fixture();
    delete project.documents[0]!.inductorCouplings;
    const text = serializeProject(project);
    expect(text).not.toContain("inductorCouplings");
    expect(
      Object.hasOwn(parseProject(text).documents[0]!, "inductorCouplings"),
    ).toBe(false);
  });

  it("refuses couplings in a file older than schema 70", () => {
    const raw = JSON.parse(serializeProject(fixture()));
    raw.schemaVersion = 69;
    expect(() => parseProject(JSON.stringify(raw))).toThrow(
      /Inductor couplings require Project schema 70/u,
    );
  });

  it("refuses a coupling naming a missing inductor or the same one twice", () => {
    const missing = JSON.parse(serializeProject(fixture()));
    missing.documents[0].inductorCouplings[0].members[1].instanceId = "L9";
    expect(() => parseProject(JSON.stringify(missing))).toThrow(
      /Unknown coupled inductor instance: L9/u,
    );
    const same = JSON.parse(serializeProject(fixture()));
    same.documents[0].inductorCouplings[0].members[1].instanceId = "L1";
    expect(() => parseProject(JSON.stringify(same))).toThrow(
      /two different inductors/u,
    );
    const twice = JSON.parse(serializeProject(fixture()));
    twice.documents[0].inductorCouplings.push({
      ...twice.documents[0].inductorCouplings[0],
      id: "K2",
      name: "TF2",
    });
    expect(() => parseProject(JSON.stringify(twice))).toThrow(
      /already coupled/u,
    );
  });
});
