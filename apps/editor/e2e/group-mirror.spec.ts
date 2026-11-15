import { expect, test, type Page } from "@playwright/test";
import { createEmptyProject, createRoutePath, routeBends } from "@icm/model";

import { expectStatus, openProject } from "./editor-fixtures";
import { exportedDocument } from "./manual-editor-fixtures.js";
import { placedInstance, segmentPoint } from "./canvas-fixtures.js";

/** The on-screen midpoint of one wire leg; a thin polyline's CSS box misses. */
async function wireLegPoint(page: Page, routeId: string, leg: number) {
  const route = page.getByTestId(`route-hit-${routeId}`);
  await expect(route).toBeAttached();
  return segmentPoint(route, 0.5, leg);
}

test("a free wire mirrors from its context menu; one held by an unselected part says why it stays", async ({
  page,
}) => {
  const project = createEmptyProject("wire-mirror", "Wire mirror");
  const document = project.documents[0]!;
  document.instances.push({
    ...placedInstance("R1", "resistor", 200, 460),
    reference: "R1",
    netlist: { parameters: { value: "1k" } },
  });
  document.nets.push(
    { id: "net-w", terminals: [] },
    { id: "net-held", terminals: [{ instanceId: "R1", pinName: "1" }] },
  );
  document.junctions.push(
    { id: "J1", netId: "net-w", position: { x: 200, y: 200 } },
    { id: "J2", netId: "net-w", position: { x: 320, y: 280 } },
    { id: "J3", netId: "net-held", position: { x: 300, y: 380 } },
  );
  document.routes.push(
    // An L: right along the top, then down.
    createRoutePath({
      id: "wire",
      netId: "net-w",
      start: { kind: "junction", junctionId: "J1" },
      end: { kind: "junction", junctionId: "J2" },
      bends: [{ x: 320, y: 200 }],
      modes: ["manual", "manual"],
    }),
    // Up from the resistor's top pin, then right to a loose end.
    createRoutePath({
      id: "held",
      netId: "net-held",
      start: { kind: "terminal", instanceId: "R1", pinName: "1" },
      end: { kind: "junction", junctionId: "J3" },
      bends: [{ x: 200, y: 380 }],
      modes: ["manual", "manual"],
    }),
  );
  await openProject(page, project, "group-mirror.icproj.json");
  await expectStatus(page, "group-mirror.icproj.json");
  const initial = await exportedDocument(page);
  const mirrorFromMenu = async (routeId: string, leg: number) => {
    const point = await wireLegPoint(page, routeId, leg);
    await page.mouse.click(point.x, point.y, { button: "right" });
    const menu = page.getByTestId("canvas-context-menu");
    await menu
      .getByRole("menuitem", { name: "Transform", exact: true })
      .hover();
    await menu
      .getByRole("menu", { name: "Transform" })
      .getByRole("menuitem", { name: "Mirror left/right (Shift+R)" })
      .click();
  };

  await mirrorFromMenu("wire", 0);
  await expectStatus(page, "Flipped the selection left to right");
  const mirrored = await exportedDocument(page);
  const position = (id: string) =>
    mirrored.junctions.find((junction: { id: string }) => junction.id === id)
      .position;
  // About the wire's own centre line, x = 260: left along the top, then down.
  expect(position("J1")).toEqual({ x: 320, y: 200 });
  expect(position("J2")).toEqual({ x: 200, y: 280 });
  const wire = mirrored.routes.find(
    (route: { id: string }) => route.id === "wire",
  );
  expect(routeBends(wire)).toEqual([{ x: 200, y: 200 }]);
  expect(wire.start).toEqual({ kind: "junction", junctionId: "J1" });
  expect(mirrored.nets).toEqual(initial.nets);
  // Mirroring again puts it back exactly.
  await page.keyboard.press("Shift+R");
  expect((await exportedDocument(page)).junctions).toEqual(initial.junctions);

  await mirrorFromMenu("held", 1);
  await expectStatus(page, "Nothing here can mirror");
  const after = await exportedDocument(page);
  expect(after.routes).toEqual(initial.routes);
  expect(after.junctions).toEqual(initial.junctions);
});
