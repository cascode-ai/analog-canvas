import { expect, it } from "vitest";
import { createEmptyProject, createRoutePath } from "@icm/model";
import {
  buildCommittedProjectConnectivityIndex,
  buildProjectConnectivityIndex,
  computeNetHighlight,
} from "@icm/derived";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { EditorDocumentController } from "./document-controller.js";

it("the first connectivity read after a real bridge cut, Undo and Redo follows both resulting branches exactly", () => {
  const project = createEmptyProject("cut", "Cut");
  const cell = project.documents[0]!;
  for (const [i, id] of ["RA", "RB", "RC", "RD"].entries()) {
    cell.instances.push({
      id,
      reference: id,
      symbolId: "resistor",
      placement: {
        position: { x: i * 100, y: 0 },
        rotation: 0,
        mirror: "none",
      },
    });
  }
  cell.nets.push(
    {
      id: "signal",
      terminals: cell.instances.map((i) => ({
        instanceId: i.id,
        pinName: "1",
      })),
    },
    { id: "offscreen", terminals: [] },
  );
  cell.junctions.push({
    id: "far",
    netId: "offscreen",
    position: { x: 8000, y: 200 },
  });
  const pin = (instanceId: string) => ({
    kind: "terminal" as const,
    instanceId,
    pinName: "1",
  });
  for (const [id, from, to] of [
    ["left", "RA", "RB"],
    ["bridge", "RB", "RC"],
    ["right", "RC", "RD"],
  ] as const)
    cell.routes.push(
      createRoutePath({
        id,
        netId: "signal",
        start: pin(from),
        end: pin(to),
        bends: [],
        modes: ["manual"],
      }),
    );
  const controller = new EditorDocumentController(project);
  function read() {
    const actual = buildCommittedProjectConnectivityIndex(
      controller.project,
      controller.resolver,
    );
    const independentlyParsed = structuredClone(controller.project);
    const full = buildProjectConnectivityIndex(
      independentlyParsed,
      createProjectSymbolResolver(independentlyParsed, builtInSymbols),
    );
    const current = actual.documents.get(cell.id)!,
      fresh = full.documents.get(cell.id)!;
    expect([...current.endpointToBaseNetId]).toEqual([
      ...fresh.endpointToBaseNetId,
    ]);
    expect([...current.logicalNets]).toEqual([...fresh.logicalNets]);
    for (const net of controller.document.nets)
      expect(computeNetHighlight(actual, cell.id, net.id)).toEqual(
        computeNetHighlight(full, cell.id, net.id),
      );
    return current;
  }
  const initial = read();
  expect(
    controller.transact([{ kind: "cut_connection", routeId: "bridge" }]).ok,
  ).toBe(true);
  const split = read();
  expect(split.endpointToBaseNetId.get("terminal:RA:1")).not.toBe(
    split.endpointToBaseNetId.get("terminal:RD:1"),
  );
  expect(split.logicalNets.get("offscreen")).toBe(
    initial.logicalNets.get("offscreen"),
  );
  expect(controller.transact([{ kind: "undo" }]).ok).toBe(true);
  expect(read().endpointToBaseNetId.get("terminal:RD:1")).toBe("signal");
  expect(controller.transact([{ kind: "redo" }]).ok).toBe(true);
  expect([...read().logicalNets]).toEqual([...split.logicalNets]);
});
