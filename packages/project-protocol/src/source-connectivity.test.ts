import { describe, expect, it } from "vitest";
import {
  createEmptyProject,
  createRoutePath,
  type CircuitProject,
} from "@icm/model";
import {
  serializeProject,
  parseProject,
  tryParseProjectWithMetadata,
} from "./index.js";
import { planProjectCodeCommit } from "../../../apps/editor/src/features/project-code/project-code.js";
import { executeTransaction } from "../../edit-engine/src/transaction.js";
import { createProjectSymbolResolver } from "@icm/symbols";

function fixture() {
  const project = createEmptyProject("graph", "Source graph");
  for (const [id, x, y] of [
    ["a", 0, 0],
    ["b", 100, 0],
    ["c", 100, 100],
    ["d", 200, 100],
  ] as const)
    project.documents[0]!.instances.push({
      id,
      symbolId: "resistor",
      placement: { position: { x, y }, rotation: 0, mirror: "none" },
    });
  return project;
}
const pin = (instanceId: string) => ({
  kind: "terminal" as const,
  instanceId,
  pinName: "1",
});
const wire = (id: string, from: string, to: string) => ({
  id,
  start: { terminal: [from, "1"] },
  end: { terminal: [to, "1"] },
  legId: `${id}-end`,
});
const source = (p = fixture()) => JSON.parse(serializeProject(p));
const read = (s: unknown) => parseProject(JSON.stringify(s));
const groups = (p: CircuitProject) =>
  p.documents[0]!.nets.map((n) =>
    n.terminals
      .map((t) => t.instanceId)
      .sort()
      .join(","),
  )
    .filter(Boolean)
    .sort();

describe("connections authored once in Project Code", () => {
  it("retains empty Nets and orders joined terminals under the first Net identity", () => {
    const s = source();
    const document = s.documents[0];
    document.nets = [
      { id: "spare", at: null },
      { id: "signal", at: { terminal: ["d", "1"] } },
      { id: "alias", at: { terminal: ["b", "1"] } },
    ];
    document.routes = [wire("db", "d", "b"), wire("ba", "b", "a")];
    const nets = read(s).documents[0]!.nets;
    expect(nets).toEqual([
      { id: "spare", terminals: [] },
      {
        id: "signal",
        terminals: [
          { instanceId: "a", pinName: "1" },
          { instanceId: "b", pinName: "1" },
          { instanceId: "d", pinName: "1" },
        ],
      },
    ]);
  });

  it("adds, joins, splits and repoints networks by editing only routes", () => {
    const s = source();
    s.documents[0].routes.push(wire("ab", "a", "b"), wire("cd", "c", "d"));
    expect(groups(read(s))).toEqual(["a,b", "c,d"]);
    s.documents[0].routes.push(wire("bc", "b", "c"));
    const joined = read(s);
    expect(groups(joined)).toEqual(["a,b,c,d"]);
    const saved = source(joined);
    saved.documents[0].routes = saved.documents[0].routes.filter(
      (r: any) => r.id !== "bc",
    );
    expect(groups(read(saved))).toEqual(["a,b", "c,d"]);
    saved.documents[0].routes[0].end = { terminal: ["c", "1"] };
    expect(groups(read(saved))).toEqual(["a,c,d"]);
  });

  it("keeps formal port ownership when a source wire is removed", () => {
    const p = fixture(),
      d = p.documents[0]!;
    d.instances.push({ id: "port", symbolId: "port", placement: null });
    d.nets.push({
      id: "signal",
      terminals: [
        { instanceId: "a", pinName: "1" },
        { instanceId: "port", pinName: "P" },
      ],
    });
    d.netlist = {
      name: "dut",
      formalParameters: [],
      terminals: [
        {
          id: "out",
          name: "OUT",
          direction: "output",
          netId: "signal",
          interfaceInstanceIds: ["port"],
        },
      ],
    };
    d.routes.push(
      createRoutePath({
        id: "ap",
        netId: "signal",
        start: pin("a"),
        end: { kind: "terminal", instanceId: "port", pinName: "P" },
        bends: [],
        modes: ["manual"],
      }),
    );
    const s = source(p);
    s.documents[0].routes = [];
    const after = read(s).documents[0]!;
    const portNet = after.nets.find((n) =>
      n.terminals.some((t) => t.instanceId === "port"),
    )!;
    expect(portNet.terminals).toEqual([{ instanceId: "port", pinName: "P" }]);
    expect(after.netlist!.terminals[0]!.netId).toBe(portNet.id);
  });

  it("keeps implicit body ownership on the final network after removing a route", () => {
    const p = fixture(),
      d = p.documents[0]!;
    d.instances.push({
      id: "mos",
      symbolId: "nmos",
      placement: null,
      mosBulkBinding: { origin: "instance-override", netId: "body" },
    });
    d.nets.push({
      id: "body",
      terminals: [
        { instanceId: "a", pinName: "1" },
        { instanceId: "mos", pinName: "B" },
      ],
    });
    d.routes.push(
      createRoutePath({
        id: "ab",
        netId: "body",
        start: pin("a"),
        end: { kind: "terminal", instanceId: "mos", pinName: "B" },
        bends: [],
        modes: ["manual"],
      }),
    );
    const s = source(p);
    s.documents[0].routes = [];
    const after = read(s).documents[0]!;
    const bodyNet = after.nets.find((n) =>
      n.terminals.some((t) => t.instanceId === "mos"),
    )!;
    expect(bodyNet.terminals).toEqual([{ instanceId: "mos", pinName: "B" }]);
    expect(
      after.instances.find((i) => i.id === "mos")!.mosBulkBinding!.netId,
    ).toBe(bodyNet.id);
  });

  it("does not connect paths merely because they cross", () => {
    const s = source();
    s.documents[0].instances[1].coordinate = [100, 100];
    s.documents[0].instances[2].coordinate = [0, 100];
    s.documents[0].instances[3].coordinate = [100, 0];
    s.documents[0].routes.push(wire("ab", "a", "b"), wire("cd", "c", "d"));
    expect(groups(read(s))).toEqual(["a,b", "c,d"]);
  });

  it("keeps explicit unrouted intent and allows it to be removed independently", () => {
    const s = source();
    s.documents[0].routes.push(wire("ab", "a", "b"), wire("cd", "c", "d"));
    s.documents[0].connections.unrouted.push([
      { terminal: ["b", "1"] },
      { terminal: ["c", "1"] },
    ]);
    expect(groups(read(s))).toEqual(["a,b,c,d"]);
    s.documents[0].connections.unrouted = [];
    expect(groups(read(s))).toEqual(["a,b", "c,d"]);
  });

  it("commits direct source edits atomically with the same topology as a drawn-wire transaction", () => {
    const before = read(source());
    const s = source(before);
    s.documents[0].routes.push(wire("ab", "a", "b"), wire("bc", "b", "c"));
    const commit = planProjectCodeCommit(
      before,
      JSON.stringify(s),
      before.topDocumentId,
    );
    expect(commit.ok).toBe(true);
    if (!commit.ok) throw new Error(commit.message);
    const drawn = executeTransaction(
      before.documents[0]!,
      {
        transactionId: "draw",
        documentId: before.topDocumentId,
        expectedRevision: 0,
        actor: { kind: "human", id: "test" },
        edits: [
          ["ab", "a", "b"],
          ["bc", "b", "c"],
        ].map(([id, a, b]) => ({
          kind: "set_route_path",
          route: createRoutePath({
            id: id!,
            netId: "stale",
            start: pin(a!),
            end: pin(b!),
            bends: [],
            modes: ["manual"],
          }),
        })),
      },
      { symbolResolver: createProjectSymbolResolver(before, []) },
    );
    expect(drawn.ok).toBe(true);
    if (!drawn.ok) throw new Error(drawn.error.message);
    expect(groups(commit.project)).toEqual(
      groups({ ...before, documents: [drawn.document] }),
    );
    expect(commit.project.structureRevision).toBe(1);
    expect(before.documents[0]!.routes).toHaveLength(0);
    expect(
      planProjectCodeCommit(
        commit.project,
        serializeProject(commit.project),
        before.topDocumentId,
      ),
    ).toMatchObject({ ok: true, changed: false });
  });

  it("breaks a direct endpoint contact when code moves a device away", () => {
    const s = source();
    s.documents[0].instances[1].coordinate = [0, 0];
    s.documents[0].connections.contacts = [
      [{ terminal: ["a", "1"] }, { terminal: ["b", "1"] }],
    ];
    expect(groups(read(s))).toEqual(["a,b"]);
    s.documents[0].instances[1].coordinate = [100, 0];
    expect(groups(read(s))).toEqual(["a", "b"]);
  });

  it.each(["netId", "legs"])(
    "rejects duplicate route representation %s",
    (key) => {
      const s = source();
      s.documents[0].routes.push({
        ...wire("ab", "a", "b"),
        [key]: key === "legs" ? [] : "old-net",
      });
      expect(tryParseProjectWithMetadata(JSON.stringify(s)).ok).toBe(false);
    },
  );

  it("rejects unknown endpoints without changing the original source", () => {
    const s = source();
    s.documents[0].routes.push(wire("ab", "a", "missing"));
    const original = JSON.stringify(s);
    expect(tryParseProjectWithMetadata(original).ok).toBe(false);
    expect(JSON.stringify(s)).toBe(original);
  });

  it("retains independent label placement instead of reconnecting labels during migration", () => {
    const s = source();
    s.documents[0].routes.push(wire("ab", "a", "b"), wire("cd", "c", "d"));
    const project = read(s);
    project.documents[0]!.annotations.push({
      id: "placed-elsewhere",
      kind: "net-label",
      netId: project.documents[0]!.nets[1]!.id,
      anchor: {
        kind: "object",
        objectId: "a",
        localOffset: { x: 0, y: 0 },
        fallbackPosition: { x: 0, y: 0 },
      },
      content: { runs: [{ kind: "text", value: "note" }] },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });
    expect(read(source(project)).documents[0]!.annotations).toEqual(
      project.documents[0]!.annotations,
    );
  });
});
