import { createEmptyProject, createRoutePath } from "@icm/model";

// The two trees and the bent Route stay fixed while offscreen scalar Nets grow.
export function createCanvasEditFixture(backgroundNets) {
  const project = createEmptyProject(
    "wire-ui-" + backgroundNets,
    "Wire operations " + backgroundNets,
  );
  const document = project.documents[0];
  function net(id) {
    document.nets.push({ id, terminals: [] });
  }
  function junction(netId, id, x, y) {
    document.junctions.push({
      netId,
      id,
      position: { x, y },
      role: "route-anchor",
    });
  }
  function route(netId, id, start, end, bends = []) {
    document.routes.push(
      createRoutePath({
        id,
        netId,
        start: { kind: "junction", junctionId: start },
        end: { kind: "junction", junctionId: end },
        bends,
        modes: Array(bends.length + 1).fill("manual"),
      }),
    );
  }
  for (let i = 0; i < backgroundNets; i++) {
    const id = "bg" + i;
    const x = i % 2 === 0 ? -6200 : 6200;
    const y = ((Math.floor(i / 2) % 64) - 32) * 40 + Math.floor(i / 128) * 2;
    net(id);
    junction(id, id + "l", x, y);
    junction(id, id + "r", x + 20, y);
    route(id, id + "rte", id + "l", id + "r");
  }
  for (const [id, y, direction] of [
    ["a", -70, -1],
    ["b", 70, 1],
  ]) {
    net(id);
    junction(id, id + "0", 0, y);
    junction(id, id + "rootRight", 30, y);
    route(id, id + "right-arm", id + "0", id + "rootRight");
    for (let i = 0; i < 16; i++) {
      junction(id, id + "tap" + i, -20 * i, y + direction * 30);
      route(id, id + "tapR" + i, id + i, id + "tap" + i);
      junction(id, id + (i + 1), -20 * (i + 1), y);
      route(id, id + "R" + (i + 1), id + i, id + (i + 1));
    }
  }
  net("local");
  junction("local", "left", 100, -40);
  junction("local", "right", 260, 40);
  route("local", "local-route", "left", "right", [
    { x: 180, y: -40 },
    { x: 180, y: 40 },
  ]);
  return project;
}
