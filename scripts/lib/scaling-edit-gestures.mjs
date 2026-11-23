import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  exportedProject,
  clickDrawTool,
} from "../../apps/editor/e2e/editor-fixtures.ts";
import {
  detail,
  loadDrawing,
  measured,
  openEditorPage,
} from "./scaling-browser.mjs";
import { sha256 } from "./scaling-metrics.mjs";

export const editActions = [
  "copy",
  "groupCopy",
  "move",
  "wire",
  "rotate",
  "box",
];

function installEditObserver({
  id,
  boxIds,
  instanceIds,
  routeIds,
  diagnostics,
  size,
}) {
  const svg = document.querySelector('[data-testid="schematic-canvas"]');
  const hit = (id) => document.querySelector('[data-testid="hit-' + id + '"]');
  const face = () =>
    svg.querySelector('[data-layer="formal"] [data-object-id="' + id + '"]');
  const known = { instance: new Set(instanceIds), route: new Set(routeIds) };
  const fresh = (kind) =>
    [...svg.querySelectorAll('[data-canvas-hit-kind="' + kind + '"]')].filter(
      (el) => !known[kind].has(el.getAttribute("data-canvas-hit-id")),
    );
  const pose = (el) => {
    const transform = svg
      .getCTM()
      .inverse()
      .multiply(el.firstElementChild.getCTM());
    return [
      el.getAttribute("data-symbol-id"),
      Math.round(transform.e * 1000),
      Math.round(transform.f * 1000),
    ].join(",");
  };
  const preview = (name) => svg.querySelector('[data-testid="' + name + '"]');
  window.scalingEditState = (goal) => {
    switch (goal) {
      case "copyPreview":
        return (
          preview("copy-placement-preview")?.getAttribute("transform") ??
          (preview("copy-placement-preview") ? "present" : "")
        );
      case "wirePreview":
        return preview("wire-preview")?.getAttribute("points") ?? "";
      case "movePreview": {
        if (!svg.classList.contains("semantic-move-preview")) return "";
        const box = face()?.getBoundingClientRect();
        return box ? [box.x, box.y].join(",") : "";
      }
      case "moveCommit": {
        const target = hit(id);
        if (
          !target?.hasAttribute("x") ||
          !target.hasAttribute("y") ||
          svg.classList.contains("semantic-move-preview")
        )
          return "";
        return [target.getAttribute("x"), target.getAttribute("y")].join(",");
      }
      case "rotate":
        return face()?.outerHTML;
      case "box":
        return (
          [...svg.querySelectorAll("[data-canvas-hit-id].selected")]
            .map((el) => el.getAttribute("data-canvas-hit-id"))
            .sort()
            .join("|") === boxIds
        );
      case "copyPoses":
        return [
          ...svg.querySelectorAll(
            '[data-testid="copy-placement-preview"] [data-symbol-id]',
          ),
        ]
          .map(pose)
          .sort();
      case "devices":
      case "wires": {
        const devices = goal === "devices";
        return fresh(devices ? "instance" : "route").flatMap((hit) => {
          const id = hit.getAttribute("data-canvas-hit-id");
          if (!devices) return [{ id, geometry: hit.getAttribute("points") }];
          const face = svg.querySelector(
            '[data-layer="formal"] [data-object-id="' +
              CSS.escape(id) +
              '"][data-symbol-id]',
          );
          return face ? [{ id, geometry: pose(face) }] : [];
        });
      }
      default:
        throw Error("Unknown edit goal " + goal);
    }
  };
  window.scalingEditSettled = ({ state, before, expected }) => {
    const value = window.scalingEditState(state);
    if (state === "box") return value;
    if (state === "devices" || state === "wires") {
      const geometries = value.map((item) => item.geometry).sort();
      return (
        expected.length === geometries.length &&
        geometries.every((geometry, i) => geometry === expected[i]) &&
        value
      );
    }
    if (expected !== undefined)
      return value === expected && window.scalingPoint(hit(id));
    return value && value !== before;
  };
  if (diagnostics) {
    if (!window.scalingEditDiagnostics)
      throw Error("Build a diagnostic bundle before collecting diagnostics");
    const clone = window.structuredClone;
    window.scalingFullCellClones = 0;
    const fullCell = (cell) =>
      Array.isArray(cell?.instances) &&
      cell.instances.length >= size &&
      Array.isArray(cell.routes) &&
      Array.isArray(cell.nets);
    window.structuredClone = (value, ...args) => {
      // Preparation wraps the same complete Cell in a transaction result.
      // Count each clone call once, including Project snapshots.
      const kind = fullCell(value)
        ? "document"
        : fullCell(value?.document)
          ? "transaction"
          : Array.isArray(value?.documents) && value.documents.some(fullCell)
            ? "project"
            : null;
      if (kind) {
        window.scalingFullCellClones++;
        window.scalingEditDiagnostics.count("clone." + kind);
      }
      return clone(value, ...args);
    };
  }
}

const withoutRevision = ({ revision: _revision, ...content }) => content;

// Capture actual artwork after the timed input, including the centerlines of
// attached routes and any temporary transforms applied by an ancestor group.
function previewArtwork(svg, ids) {
  const objects = ids.flatMap((id) => [
    ...svg.querySelectorAll(
      '[data-layer="formal"] [data-object-id="' + id + '"]',
    ),
  ]);
  objects.push(
    ...svg.querySelectorAll(
      '[data-testid="copy-placement-preview"],[data-testid="wire-preview"],[data-testid="wire-snap-target"]',
    ),
  );
  return JSON.stringify(
    objects.map((el) => {
      const m = el.getCTM();
      return [el.outerHTML, m && [m.a, m.b, m.c, m.d, m.e, m.f]];
    }),
  );
}

function verifyEdit(base, after, op, selected) {
  const [id, , adj] = selected;
  const byId = (items, key) => items.find((item) => item.id === key);
  const original = byId(base.instances, id);
  const instance = byId(after.instances, id);
  const existing = (items, prior) => {
    const ids = new Set(prior.map((item) => item.id));
    return items.filter((item) => ids.has(item.id));
  };
  if (op === "move" || op === "rotate") {
    if (op === "move")
      assert.deepEqual(instance.placement.position, {
        x: original.placement.position.x + 40,
        y: original.placement.position.y + 30,
      });
    else assert.equal(instance.placement.rotation, 90);
    assert.deepEqual(
      after.instances.filter((item) => item.id !== id),
      base.instances.filter((item) => item.id !== id),
    );
    assert.deepEqual(after.nets, base.nets);
    const endpoints = (routes) =>
      routes.map((r) => [r.id, r.netId, r.start, r.legs.at(-1).to]);
    assert.deepEqual(endpoints(after.routes), endpoints(base.routes));
  } else if (op === "wire") {
    assert.deepEqual(after.instances, base.instances);
    assert.deepEqual(existing(after.routes, base.routes), base.routes);
    assert.deepEqual(existing(after.nets, base.nets), base.nets);
    assert.equal(after.routes.length, base.routes.length + 1);
    const originalIds = new Set(base.routes.map((r) => r.id));
    const route = after.routes.find((r) => !originalIds.has(r.id));
    const net = byId(after.nets, route.netId);
    assert.deepEqual(
      new Set(net.terminals.map((t) => t.instanceId + "." + t.pinName)),
      new Set([id + ".S", adj + ".S"]),
    );
  } else {
    assert.deepEqual(existing(after.instances, base.instances), base.instances);
    assert.deepEqual(existing(after.routes, base.routes), base.routes);
    assert.deepEqual(existing(after.nets, base.nets), base.nets);
    const group = op === "groupCopy";
    assert.equal(
      after.instances.length,
      base.instances.length + (group ? 4 : 1),
    );
    assert.equal(after.routes.length, base.routes.length + (group ? 4 : 0));
    const oldInstances = new Set(base.instances.map((i) => i.id));
    const oldRoutes = new Set(base.routes.map((r) => r.id));
    const copies = new Set(
      after.instances.filter((i) => !oldInstances.has(i.id)).map((i) => i.id),
    );
    for (const route of after.routes.filter((r) => !oldRoutes.has(r.id))) {
      assert.ok(copies.has(route.start.instanceId));
      assert.ok(copies.has(route.legs.at(-1).to.endpoint.instanceId));
    }
  }
}

// During this sweep the driver sends real pointer events continuously. Read
// visible geometry on animation frames, independently of event delivery.
async function continuousMotion(page, goal, from, to) {
  await page.evaluate((goal) => {
    let last = window.scalingEditState(goal);
    const frames = [],
      burst = { events: 0, running: true };
    const pointer = () => {
      burst.events++;
    };
    const observe = (time) => {
      if (!burst.running) return;
      const state = window.scalingEditState(goal);
      if (burst.events && state && state !== last) {
        frames.push(time);
        last = state;
      }
      requestAnimationFrame(observe);
    };
    window.addEventListener("pointermove", pointer, true);
    window.scalingStopMotion = () => {
      burst.running = false;
      window.removeEventListener("pointermove", pointer, true);
      return { events: burst.events, times: frames };
    };
    requestAnimationFrame(observe);
  }, goal);
  let result;
  try {
    await page.mouse.move(from.x, from.y, { steps: 12 });
    await page.mouse.move(to.x, to.y, { steps: 12 });
  } finally {
    result = await page.evaluate(async () => {
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      return window.scalingStopMotion();
    });
  }
  assert.ok(
    result.events > 1 && result.times.length > 1,
    "Expected multiple displayed positions in continuous motion",
  );
  return result.times.slice(1).map((time, index) => time - result.times[index]);
}

/** Each action owns a fresh context so generated IDs and undo history match in independent runs. */
export async function measureEdit({
  browser,
  url,
  file,
  name,
  project,
  group: op,
  samples,
  diagnostics,
}) {
  const session = await openEditorPage(browser, url);
  const { page } = session;
  try {
    await loadDrawing(page, file, project.name);
    await detail(page);
    const svg = page.getByTestId("schematic-canvas");
    const baseProject = await exportedProject(page);
    const base = baseProject.documents.find(
      (d) => d.id === baseProject.topDocumentId,
    );
    const size = base.instances.length;
    const first = size / 2 + Math.sqrt(size / 2) + 1;
    const selected = [0, 1, 2, 3].map((offset) => "M" + (first + offset));
    const [id, , adj] = selected;
    const selectedIds = new Set(selected);
    const previewIds = [
      ...selected,
      ...base.routes
        .filter((route) => selectedIds.has(route.start.instanceId))
        .map((route) => route.id),
    ];
    const world = base.instances.find((item) => item.id === id).placement
      .position;
    await page.evaluate(installEditObserver, {
      id,
      boxIds: [...previewIds, ...selected.map((id) => "label-" + id)]
        .sort()
        .join("|"),
      instanceIds: base.instances.map((item) => item.id),
      routeIds: base.routes.map((item) => item.id),
      diagnostics,
      size,
    });
    const point = async () => {
      const p = await page
        .getByTestId("hit-" + id)
        .evaluate((el) => window.scalingPoint(el));
      assert.ok(p);
      return p;
    };
    const screen = (x, y) =>
      svg.evaluate(
        (el, p) => {
          const q = new DOMPoint(p.x, p.y).matrixTransform(el.getScreenCTM());
          return { x: q.x, y: q.y };
        },
        { x, y },
      );
    const terminal = (instance) =>
      page.getByTestId("terminal-" + instance + "-S").evaluate((e) => {
        const b = e.getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      });
    const state = (goal) =>
      page.evaluate((goal) => window.scalingEditState(goal), goal);
    const initialPosition = await state("moveCommit");
    const [hitX, hitY] = initialPosition.split(",").map(Number);
    const movedPosition = [hitX + 40, hitY + 30].join(",");
    const metrics = {},
      signatures = [],
      counters = [];
    for (let i = 0; i <= samples; i++) {
      const record = {},
        frames = [],
        counts = {};
      await svg.focus();
      await page.keyboard.press("Escape");
      let commitWitness;
      async function time(label, event, goal, act, extra = {}) {
        const before = await state(goal);
        if (diagnostics)
          await page.evaluate(() => {
            window.scalingEditDiagnostics.reset();
            window.scalingFullCellClones = 0;
          });
        const { ms, editWitness } = await measured(
          page,
          event,
          "editResult",
          { state: goal, before, ...extra },
          act,
        );
        if (diagnostics)
          counts[label] = await page.evaluate(() => ({
            phases: window.scalingEditDiagnostics.read(),
            fullCellClones: window.scalingFullCellClones,
          }));
        if (label === "commit") commitWitness = editWitness;
        record[label] = ms;
        if (label.startsWith("pointer"))
          frames.push(sha256(await svg.evaluate(previewArtwork, previewIds)));
      }
      if (op === "box" || op === "groupCopy") {
        const a = await screen(world.x - 54, world.y - 49),
          // Four-digit reference labels extend beyond their device hit boxes.
          b = await screen(world.x + 275, world.y + 142);
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        await page.mouse.move(b.x, b.y, { steps: 3 });
        await time("select", "pointerup", "box", () => page.mouse.up());
      } else if (op !== "wire") {
        const p = await point();
        await page.mouse.click(p.x, p.y);
        assert.ok(
          (await page.getByTestId("hit-" + id).getAttribute("class")).includes(
            "selected",
          ),
        );
      }
      let commitGoal, undoGoal;
      async function sweep(goal, from, to) {
        if (diagnostics) return;
        const gaps = await continuousMotion(page, goal, from, to);
        if (i) (metrics.displayedFrameGap ??= []).push(...gaps);
      }
      if (op === "move") {
        const p = await point(),
          origin = await screen(0, 0);
        await page.mouse.move(p.x, p.y);
        await page.mouse.down();
        for (const [j, [x, y]] of [
          [10, 10],
          [20, 20],
          [30, 20],
          [40, 30],
        ].entries()) {
          const dest = await screen(x, y);
          await time("pointer" + j, "pointermove", "movePreview", () =>
            page.mouse.move(p.x + dest.x - origin.x, p.y + dest.y - origin.y),
          );
        }
        const endPoint = await screen(40, 30);
        await sweep("movePreview", p, {
          x: p.x + endPoint.x - origin.x,
          y: p.y + endPoint.y - origin.y,
        });
        await time("commit", "pointerup", "moveCommit", () => page.mouse.up(), {
          expected: movedPosition,
        });
        undoGoal = "moveCommit";
      } else if (op === "copy" || op === "groupCopy") {
        await svg.focus();
        const p = await point();
        await page.mouse.move(p.x, p.y);
        await time(
          "start",
          "keydown",
          "copyPreview",
          () => page.keyboard.press("c"),
          { key: "c" },
        );
        let end;
        for (const [j, f] of [0.25, 0.5, 0.75, 1].entries()) {
          end = await screen(
            world.x + 70 * f,
            world.y + (op === "groupCopy" ? 120 : 60) * f,
          );
          await time("pointer" + j, "pointermove", "copyPreview", () =>
            page.mouse.move(end.x, end.y),
          );
        }
        await sweep("copyPreview", p, end);
        commitGoal = "devices";
        await time(
          "commit",
          "pointerdown",
          commitGoal,
          () => page.mouse.click(end.x, end.y),
          { expected: await state("copyPoses") },
        );
        await page.keyboard.press("Escape");
      } else if (op === "wire") {
        await clickDrawTool(page, "wire");
        const a = await terminal(id),
          b = await terminal(adj);
        await page.mouse.click(a.x, a.y);
        for (const [j, f] of [0.25, 0.5, 0.75, 1].entries()) {
          await time("pointer" + j, "pointermove", "wirePreview", () =>
            page.mouse.move(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f),
          );
        }
        await sweep("wirePreview", a, b);
        commitGoal = "wires";
        await time(
          "commit",
          "pointerdown",
          commitGoal,
          () => page.mouse.click(b.x, b.y),
          { expected: [await state("wirePreview")] },
        );
        await page.keyboard.press("Escape");
      } else if (op === "rotate") {
        await svg.focus();
        await time(
          "commit",
          "keydown",
          "rotate",
          () => page.keyboard.press("r"),
          { key: "r" },
        );
        undoGoal = "rotate";
      }
      const readStart = performance.now();
      const after = await exportedProject(page);
      record.readProject = performance.now() - readStart;
      const afterCell = after.documents.find((d) => d.id === base.id);
      if (op === "box") assert.deepEqual(after, baseProject);
      else {
        verifyEdit(base, afterCell, op, selected);
        if (commitGoal) {
          const field = commitGoal === "wires" ? "routes" : "instances";
          const prior = new Set(base[field].map((item) => item.id));
          const expected = afterCell[field]
            .filter((item) => !prior.has(item.id))
            .map((item) => item.id)
            .sort();
          assert.deepEqual(
            commitWitness.map((item) => item.id).sort(),
            expected,
            "Painted identities must match committed objects",
          );
        }
        await svg.focus();
        await time(
          "undo",
          "keydown",
          undoGoal ?? commitGoal,
          () => page.keyboard.press("Control+z"),
          {
            key: "z",
            ...(commitGoal
              ? { expected: [] }
              : op === "move"
                ? { expected: initialPosition }
                : {}),
          },
        );
        const restored = await exportedProject(page);
        assert.ok(restored.structureRevision >= after.structureRevision);
        assert.ok(
          restored.documents.find((d) => d.id === base.id).revision >
            afterCell.revision,
        );
        const contents = ({
          structureRevision: _structureRevision,
          documents,
          ...rest
        }) => ({
          ...rest,
          documents: documents.map(withoutRevision),
        });
        assert.deepEqual(
          contents(restored),
          contents(baseProject),
          "Undo restores complete project",
        );
        if (op === "rotate") {
          await svg.focus();
          await time(
            "redo",
            "keydown",
            "rotate",
            () => page.keyboard.press("Control+Shift+z"),
            { key: "z" },
          );
          assert.deepEqual(
            contents(await exportedProject(page)),
            contents(after),
          );
          await svg.focus();
          await page.keyboard.press("Control+z");
          assert.deepEqual(
            contents(await exportedProject(page)),
            contents(baseProject),
          );
        }
      }
      if (i) {
        for (const [name, value] of Object.entries(record))
          (metrics[name] ??= []).push(value);
        signatures.push({ project: sha256(JSON.stringify(after)), frames });
        if (diagnostics) counters.push(counts);
      }
    }
    assert.deepEqual(session.errors, []);
    return {
      metrics,
      signatures,
      counters,
      workload: { name, id, view: await svg.getAttribute("viewBox") },
    };
  } finally {
    await session.close();
  }
}
