import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { serializeProject } from "@icm/project-protocol";
import { liveAgentEditor } from "../agent/live-agent-editor.test-support";
import { compareNetlists, workspaceNetlist, workspaceSvg } from "./artifacts";
import {
  createWorkspace,
  lockWorkspace,
  openLocalWorkspace,
  readWorkspace,
} from "./workspace";

const made: string[] = [];
async function workspaceDir() {
  const dir = await mkdtemp(join(tmpdir(), "icm-headless-"));
  made.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true });
});

let request = 0;
function transact(
  handle: (request: never) => unknown,
  revision: number,
  actions: unknown[],
  structureRevision?: number,
) {
  request += 1;
  return handle({
    apiVersion: "3.0",
    requestId: `req-${request}`,
    operation: "transact",
    documentId: "main",
    transactionId: `txn-${request}`,
    expectedRevision: revision,
    ...(structureRevision === undefined
      ? {}
      : { expectedStructureRevision: structureRevision }),
    dryRun: false,
    actions,
  } as never);
}

// A divider: two resistors, a supply and a ground, wired by name.
const DIVIDER = [
  {
    kind: "place-component",
    symbol: "resistor",
    id: "r1",
    reference: "R1",
    position: { x: 100, y: 100 },
    parameters: { value: "1k" },
  },
  {
    kind: "place-component",
    symbol: "resistor",
    id: "r2",
    reference: "R2",
    position: { x: 100, y: 200 },
    parameters: { value: "2k" },
  },
  {
    kind: "place-component",
    symbol: "ground",
    id: "gnd",
    position: { x: 100, y: 260 },
  },
];

describe("headless workspace (#1498)", () => {
  it("draws through the editor's own host and keeps the drawing on disk", async () => {
    const dir = await workspaceDir();
    await createWorkspace(dir, { name: "Divider", reference: "* ref\n" });
    const first = await openLocalWorkspace(dir);
    const answer = transact(
      first.editor.circuit as never,
      first.editor.controller.document.revision,
      DIVIDER,
    );
    expect(answer).toMatchObject({ ok: true, applied: true });
    await first.close();

    const stored = await readWorkspace(dir);
    expect(
      stored.documents[0]!.instances.map((instance) => instance.reference),
    ).toEqual(expect.arrayContaining(["R1", "R2"]));

    // A later call resumes from the file, revision and all.
    const second = await openLocalWorkspace(dir);
    expect(second.editor.controller.document.revision).toBe(
      stored.documents[0]!.revision,
    );
    expect(
      transact(
        second.editor.circuit as never,
        second.editor.controller.document.revision,
        [
          {
            kind: "connect",
            from: { kind: "pin", instance: "R1", pin: "2" },
            to: { kind: "pin", instance: "R2", pin: "1" },
          },
        ],
      ),
    ).toMatchObject({ ok: true, applied: true });
    expect(await second.save()).toBe(true);
    expect(await second.save()).toBe(false);
    await second.close();
  });

  it("hands out the netlist and figure, and compares the netlist with a reference", async () => {
    const dir = await workspaceDir();
    await createWorkspace(dir);
    const local = await openLocalWorkspace(dir, { process: "abstract" });
    const port = (reference: string, y: number) => ({
      kind: "place-component",
      symbol: "port",
      reference,
      position: { x: 200, y },
    });
    const wire = (from: [string, string], to: [string, string]) => ({
      kind: "connect",
      from: { kind: "pin", instance: from[0], pin: from[1] },
      to: { kind: "pin", instance: to[0], pin: to[1] },
    });
    // Placement and wiring go in two calls, as the MCP client splits them.
    // Cell Pins are structural, so the call names the structure.
    const placed = transact(
      local.editor.circuit as never,
      0,
      [...DIVIDER, port("IN", 20), port("OUT", 150)],
      local.editor.project.structureRevision,
    );
    expect(placed, JSON.stringify(placed)).toMatchObject({ ok: true });
    const wired = transact(
      local.editor.circuit as never,
      local.editor.controller.document.revision,
      [
        wire(["IN", "P"], ["R1", "1"]),
        wire(["R1", "2"], ["R2", "1"]),
        wire(["OUT", "P"], ["R1", "2"]),
        wire(["R2", "2"], ["gnd", "0"]),
      ],
    );
    expect(wired, JSON.stringify(wired)).toMatchObject({ ok: true });
    const netlist = workspaceNetlist(local.editor.project);
    expect(netlist.status, netlist.messages.join("; ")).toBe("ready");
    expect(await workspaceSvg(local.editor.project)).toContain("<svg");
    // By name, as MCP verify compares a drawing with an expected netlist.
    const reference = [
      ".subckt dut VSS IN OUT",
      "R1 IN OUT 1k",
      "R2 OUT VSS 2k",
      ".ends dut",
    ].join("\n");
    expect(await compareNetlists(netlist.text!, reference)).toMatchObject({
      status: "match",
    });
    const wrong = reference.replace("R2 OUT VSS 2k", "R2 IN VSS 2k");
    expect(await compareNetlists(netlist.text!, wrong)).toMatchObject({
      status: "mismatch",
    });
    await local.close();
  });

  it("commits what the editor commits for the same calls", async () => {
    const dir = await workspaceDir();
    await createWorkspace(dir);
    const local = await openLocalWorkspace(dir, { process: "abstract" });
    const live = liveAgentEditor({ project: local.editor.project });
    for (const handle of [
      local.editor.circuit as never,
      live.service.handle as never,
    ])
      expect(transact(handle, 0, DIVIDER)).toMatchObject({ ok: true });
    expect(serializeProject(local.editor.project)).toBe(
      serializeProject(live.controller.project),
    );
    await local.close();
  });

  it("places a transistor in the editor's default Process, as a person would", async () => {
    const dir = await workspaceDir();
    await createWorkspace(dir);
    const local = await openLocalWorkspace(dir);
    // A Process fill is a structural edit, so the call names the structure.
    const placed = transact(
      local.editor.circuit as never,
      0,
      [
        {
          kind: "place-component",
          symbol: "nmos",
          reference: "M1",
          position: { x: 200, y: 200 },
        },
      ],
      local.editor.project.structureRevision,
    );
    expect(placed, JSON.stringify(placed)).toMatchObject({
      ok: true,
      applied: true,
    });
    const nmos = local.editor.project.documents[0]!.instances.find(
      (instance) => instance.reference === "M1",
    );
    // Bound to the Process's reviewed model, which the Project now carries.
    const binding = nmos?.netlist?.binding;
    const model = local.editor.project.externalSubcircuitDefinitions.find(
      (definition) =>
        binding?.kind === "external-subcircuit" &&
        definition.id === binding.definitionId,
    );
    expect(model?.name).toMatch(/sky130.*nfet/u);
    await local.close();
  });

  it("refuses a workspace another live process holds, and takes one left behind", async () => {
    const dir = await workspaceDir();
    await createWorkspace(dir);
    // The parent of this test process is alive and is not this process.
    await writeFile(join(dir, ".lock"), String(process.ppid));
    await expect(lockWorkspace(dir)).rejects.toThrow(
      `in use by process ${process.ppid}`,
    );
    await writeFile(join(dir, ".lock"), "999999999");
    const release = await lockWorkspace(dir);
    await release();
    await expect(createWorkspace(dir)).rejects.toThrow("already holds");
  });
});
