import { readFileSync } from "node:fs";
import { createEmptyProject, createRoutePath } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { createScalingInputs } from "./scaling-fixtures.mjs";

function route(netId, id, start, end, bends = []) {
  return createRoutePath({
    id,
    netId,
    start: { kind: "junction", junctionId: start },
    end: { kind: "junction", junctionId: end },
    bends,
    modes: Array(bends.length + 1).fill("manual"),
  });
}

function wireProject(count, sparse = false) {
  const project = createEmptyProject(
    "wire-ui-" + count,
    "Wire operations " + count,
  );
  const cell = project.documents[0];
  function junction(netId, id, x, y) {
    cell.junctions.push({
      id,
      netId,
      position: { x, y },
      role: "route-anchor",
    });
  }
  function wire(...args) {
    cell.routes.push(route(...args));
  }
  for (let i = 0; i < count; i++) {
    const column = Math.floor(i / 128);
    const side = i % 2 === 0 ? -1 : 1;
    const x = side * (6200 + (sparse ? column * 60 : 0));
    const y = ((Math.floor(i / 2) % 64) - 32) * 40 + (sparse ? 0 : column * 2);
    const id = "bg" + i;
    cell.nets.push({ id, terminals: [] });
    junction(id, id + "l", x, y);
    junction(id, id + "r", x + 20, y);
    wire(id, id + "rte", id + "l", id + "r");
  }
  for (const [id, y, direction] of [
    ["a", -70, -1],
    ["b", 70, 1],
  ]) {
    cell.nets.push({ id, terminals: [] });
    junction(id, id + "0", 0, y);
    junction(id, id + "rootRight", 30, y);
    wire(id, id + "right-arm", id + "0", id + "rootRight");
    for (let i = 0; i < 16; i++) {
      junction(id, id + "tap" + i, -20 * i, y + direction * 30);
      wire(id, id + "tapR" + i, id + i, id + "tap" + i);
      junction(id, id + (i + 1), -20 * (i + 1), y);
      wire(id, id + "R" + (i + 1), id + i, id + (i + 1));
    }
  }
  cell.nets.push({ id: "local", terminals: [] });
  junction("local", "left", 100, -40);
  junction("local", "right", 260, 40);
  wire("local", "local-route", "left", "right", [
    { x: 180, y: -40 },
    { x: 180, y: 40 },
  ]);
  return project;
}

export function createBoundLabelProject(count, id, name) {
  const project = createEmptyProject(id, name);
  const cell = project.documents[0];
  for (let i = 0; i < count; i++) {
    const netId = "net-" + i;
    const y = i * 20;
    const left = "J" + i + "-left",
      right = "J" + i + "-right";
    cell.nets.push({ id: netId, terminals: [] });
    cell.junctions.push(
      { id: left, netId, position: { x: 0, y } },
      { id: right, netId, position: { x: 40, y } },
    );
    const wire = route(netId, "route-" + i, left, right);
    cell.routes.push(wire);
    const annotationId = "label-" + i;
    cell.annotations.push({
      id: annotationId,
      kind: "net-label",
      netId,
      binding: { kind: "net-name", netId },
      anchor: {
        kind: "route",
        routeId: wire.id,
        legId: wire.legs[0].id,
        t: 0.5,
        normalOffset: 10,
        direction: "forward",
        orientation: "horizontal",
        fallbackPosition: { x: 20, y: y - 10 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });
    cell.connectivityEvidence.push({
      id: "claim-" + i,
      kind: "name-claim",
      netId,
      name: "NET_" + i,
      owner: { kind: "net-label", annotationId },
      scope: "local",
    });
  }
  return project;
}

let scalingInputs;
export function diagnosticInput(name) {
  if (name.startsWith("example/"))
    return readFileSync(
      new URL(
        "../../apps/editor/src/examples/" + name.slice(8) + ".icproj.json",
        import.meta.url,
      ),
      "utf8",
    );
  if (name.startsWith("project/"))
    return readFileSync(
      new URL(
        "../../fixtures/projects/" + name.slice(8) + "/project.icproj.json",
        import.meta.url,
      ),
      "utf8",
    );
  if (name.startsWith("flat-") || name === "hier-2048") {
    scalingInputs ??= createScalingInputs();
    return scalingInputs.get(name);
  }
  if (name === "bound-labels-2048")
    return serializeProject(
      createBoundLabelProject(2048, "net-study", "Net Study"),
    );
  const project = wireProject(
    name === "wire-16" || name === "sibling-8192" ? 16 : 8192,
    name === "sparse-8192",
  );
  project.documents[0].revision = 2;
  if (name === "sibling-8192") {
    const sibling = wireProject(8192).documents[0];
    sibling.id = "unplaced-sibling";
    sibling.name = "Unplaced sibling";
    sibling.netlist.name = "unplaced_sibling";
    project.documents.push(sibling);
  }
  return serializeProject(project);
}
