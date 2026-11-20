import { expect, it } from "vitest";
import {
  createRoutePath,
  routeEndpoints,
  type Point,
  type SchematicDocument,
} from "@icm/model";
import {
  emptyAgentProject,
  liveAgentEditor,
} from "./live-agent-editor.test-support";
import { pinOrderOpProject } from "../../../../netlists/editor-pin-order/fixture.js";

const pin = (instanceId: string) => ({
  kind: "terminal" as const,
  instanceId,
  pinName: "1",
});

function circuit() {
  const project = emptyAgentProject("Route history");
  const document = project.documents[0]!;
  document.instances = (
    [
      ["a", 0, 0],
      ["b", 100, 0],
      ["c", 100, 100],
      ["e", 0, 300],
      ["f", 100, 300],
    ] as const
  ).map(([id, x, y]) => ({
    id,
    reference: id,
    symbolId: "resistor",
    placement: { position: { x, y }, rotation: 0, mirror: "none" },
  }));
  return project;
}

function path(
  id: string,
  from: string,
  to: string,
  netId: string,
  bends: Point[] = [],
) {
  return {
    kind: "set_route_path" as const,
    route: createRoutePath({
      id,
      netId,
      start: pin(from),
      end: pin(to),
      bends,
      modes: [...bends.map(() => "manual" as const), "manual"],
    }),
  };
}

function electricalState({
  nets,
  routes,
  junctions,
}: Pick<SchematicDocument, "nets" | "routes" | "junctions">) {
  return { nets, routes, junctions };
}

it("previews, cuts, reroutes and stretches through live Agent history", async () => {
  const { client } = liveAgentEditor({ project: circuit() });
  await client.connect("session-1.code");
  const documentId = "main";
  expect(
    await client.advancedTransact(
      [
        path("ab", "a", "b", "chain"),
        path("bc", "b", "c", "chain"),
        path("ef", "e", "f", "independent"),
      ],
      { documentId },
    ),
  ).toMatchObject({ ok: true, applied: true });
  const getCircuit = async () =>
    electricalState((await client.snapshot(documentId)).snapshot.document);
  const before = await getCircuit();
  const edits = [{ kind: "cut_connection", routeId: "bc" }];
  expect(
    await client.advancedTransact(edits, { documentId, dryRun: true }),
  ).toMatchObject({ ok: true, applied: false });
  expect(await getCircuit()).toEqual(before);

  expect(await client.advancedTransact(edits, { documentId })).toMatchObject({
    ok: true,
    applied: true,
  });
  const cut = await getCircuit();
  expect(cut.routes.map(({ id }) => id).sort()).toEqual(["ab", "ef"]);
  expect(
    cut.nets
      .map((net) =>
        net.terminals
          .map(({ instanceId }) => instanceId)
          .sort()
          .join(","),
      )
      .sort(),
  ).toEqual(["a,b", "c", "e,f"]);
  expect(cut.nets.find(({ id }) => id === "independent")).toEqual(
    before.nets.find(({ id }) => id === "independent"),
  );

  expect(
    await client.applyActions([{ kind: "undo" }], { documentId }),
  ).toMatchObject({ ok: true });
  expect(await getCircuit()).toEqual(before);
  expect(
    await client.applyActions([{ kind: "redo" }], { documentId }),
  ).toMatchObject({ ok: true });
  expect(await getCircuit()).toEqual(cut);

  const bends = [
    { x: 0, y: -80 },
    { x: 100, y: -80 },
  ];
  const reroute = [path("ab", "a", "b", "chain", bends)];
  expect(
    await client.advancedTransact(reroute, { documentId, dryRun: true }),
  ).toMatchObject({ ok: true, applied: false });
  expect(await getCircuit()).toEqual(cut);
  expect(await client.advancedTransact(reroute, { documentId })).toMatchObject({
    ok: true,
    applied: true,
  });
  const rerouted = await getCircuit();
  expect(rerouted.nets).toEqual(cut.nets);
  expect(
    rerouted.routes
      .find(({ id }) => id === "ab")
      ?.legs.flatMap(({ to }) => (to.kind === "bend" ? [to.position] : [])),
  ).toEqual(bends);

  const move = [
    {
      kind: "move",
      target: { kind: "instance", reference: "a" },
      position: { x: -60, y: 0 },
    },
  ];
  expect(
    await client.applyActions(move, { documentId, dryRunOnly: true }),
  ).toMatchObject({ ok: true, applied: false });
  expect(await getCircuit()).toEqual(rerouted);
  expect(await client.applyActions(move, { documentId })).toMatchObject({
    ok: true,
    applied: true,
  });
  const stretched = await getCircuit();
  expect(stretched.nets).toEqual(rerouted.nets);
  const branch = stretched.routes.find(({ id }) => id === "ab")!;
  expect(routeEndpoints(branch)).toEqual([pin("a"), pin("b")]);
  expect(branch.legs).not.toEqual(
    rerouted.routes.find(({ id }) => id === "ab")?.legs,
  );
  expect(
    await client.applyActions([{ kind: "undo" }], { documentId }),
  ).toMatchObject({ ok: true });
  expect(await getCircuit()).toEqual(rerouted);
  expect(
    await client.applyActions([{ kind: "redo" }], { documentId }),
  ).toMatchObject({ ok: true });
  expect(await getCircuit()).toEqual(stretched);
});

it("rejects the same noncanonical external pin in Agent preview and commit", async () => {
  const project = await pinOrderOpProject();
  const { client, controller } = liveAgentEditor({ project });
  await client.connect("session-1.code");
  const before = controller.project;
  const negative = controller.document.nets.find(({ terminals }) =>
    terminals.some(
      ({ instanceId, pinName }) => instanceId === "amp" && pinName === "IN-",
    ),
  );
  if (!negative) throw new Error("Expected the wired negative input");
  for (const dryRun of [true, false]) {
    const result = await client.advancedTransact(
      [
        {
          kind: "set_property_terminal_net",
          instanceId: "amp",
          pinName: "in+",
          netId: negative.id,
        },
      ],
      { documentId: project.topDocumentId, dryRun },
    );
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toContain("XAMP.in+");
    expect(controller.project).toEqual(before);
  }
});
