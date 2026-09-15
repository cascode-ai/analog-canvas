import { createEmptyDocument, createEmptyProject } from "@icm/model";
import { executeProjectTransaction } from "@icm/edit-engine";
import { describe, expect, it } from "vitest";
import { formatInstanceCode, planInstanceCode } from "./instance-code";

function fixture() {
  const project = createEmptyProject("project", "Project", "main");
  project.documents.push(createEmptyDocument("child", "Child"));
  for (const document of project.documents) {
    document.instances.push(
      ...["M1", "M2"].map((id) => ({
        id,
        symbolId: "nmos",
        placement: null,
        reference: id,
        netlist: { parameters: { l: "60n", w: "1u" } },
      })),
    );
  }
  return project;
}
function apply(project: ReturnType<typeof fixture>, code: unknown) {
  const plan = planInstanceCode(project, JSON.stringify(code));
  if (!plan.ok) throw new Error(plan.message);
  return executeProjectTransaction(project, {
    transactionId: "instance-code",
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    actor: { kind: "human", id: "test" },
    edits: plan.edits,
  });
}

describe("instance code", () => {
  it("round-trips without edits and addresses instances independently of their reference", () => {
    const project = fixture();
    expect(planInstanceCode(project, formatInstanceCode(project))).toEqual({
      ok: true,
      edits: [],
    });
    const code = JSON.parse(formatInstanceCode(project));
    code.main.M1.reference = "M2";
    code.main.M2.reference = "M1";
    const result = apply(project, code);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.project.documents[0]!.instances.map((i) => [i.id, i.reference]),
    ).toEqual([
      ["M1", "M2"],
      ["M2", "M1"],
    ]);
  });

  it("treats reordered target keys as the same binding", () => {
    const project = fixture();
    project.documents[0]!.instances[0]!.netlist!.binding = {
      name: "NMOS",
      deviceClass: "mos",
      kind: "model",
    };
    expect(planInstanceCode(project, formatInstanceCode(project))).toEqual({
      ok: true,
      edits: [],
    });
  });

  it("applies parameters and model targets atomically across Cells while clearing removed parameters", () => {
    const project = fixture();
    const before = structuredClone(project);
    const target = { kind: "model", deviceClass: "mos", name: "MY_NMOS" };
    const result = apply(project, {
      main: { M1: { parameters: { l: "120n", w: "{WIDTH}" }, target } },
      child: { M2: { parameters: { l: "240n" } } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.documents[0]!.instances[0]!.netlist).toEqual({
      parameters: { l: "120n", w: "{WIDTH}" },
      binding: target,
    });
    expect(
      result.project.documents[1]!.instances[1]!.netlist!.parameters,
    ).toEqual({ l: "240n" });
    expect(result.project.documents[0]!.instances[1]).toEqual(
      project.documents[0]!.instances[1],
    );
    expect(project).toEqual(before);
  });

  it.each([
    {
      main: { M1: { parameters: { l: "120n" } } },
      child: { M2: { reference: "M1" } },
    },
    {
      main: { M1: { parameters: { l: "120n" } } },
      child: { M2: { parameters: { l: "120n", L: "240n" } } },
    },
  ])("rejects the whole transaction when a later Cell is invalid", (code) => {
    const project = fixture();
    const before = structuredClone(project);
    expect(apply(project, code).ok).toBe(false);
    expect(project).toEqual(before);
  });

  it.each([
    "{",
    "[]",
    '{"missing": {}}',
    '{"main": {"missing": {}}}',
    '{"main": {"M1": {"symbol": "pmos"}}}',
    '{"main": {"M1": {"placement": {}}}}',
    '{"main": {"M1": {"parameters": {"w": 10}}}}',
    '{"main": {"M1": {"target": {"kind": "model", "name": "test"}}}}',
    '{"main": {"M1": {"reference": null}}}',
  ])("rejects malformed or unsupported edits: %s", (source) => {
    expect(planInstanceCode(fixture(), source).ok).toBe(false);
  });

  it("rejects a stale multi-Cell plan without applying an earlier Cell", () => {
    const project = fixture();
    const plan = planInstanceCode(
      project,
      JSON.stringify({
        main: { M1: { reference: "M3" } },
        child: { M1: { reference: "M3" } },
      }),
    );
    if (!plan.ok) throw new Error(plan.message);
    project.documents[1]!.revision += 1;
    const result = executeProjectTransaction(project, {
      transactionId: "stale",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: plan.edits,
    });
    expect(result.ok).toBe(false);
    expect(project.documents[0]!.instances[0]!.reference).toBe("M1");
  });
});
