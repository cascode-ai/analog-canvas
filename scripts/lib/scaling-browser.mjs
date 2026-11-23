import assert from "node:assert/strict";
import { zoomCameraAtAnchor } from "../../apps/editor/src/canvas/fit-view.ts";
import { sampleCount, sha256 } from "./scaling-metrics.mjs";

const viewport = { width: 1600, height: 1000 };
export const browserContext = {
  viewport,
  deviceScaleFactor: 1,
  permissions: ["clipboard-read", "clipboard-write"],
};
const canvas = (page) => page.getByTestId("schematic-canvas");
const fitButton = (page) =>
  page.getByRole("button", { name: "Fit view", exact: true });
const camera = (page) => canvas(page).getAttribute("viewBox");

/** Installed before the editor registers listeners. Start on the real DOM input,
 * including command keys whose propagation the editor subsequently stops. */
function installObserver() {
  localStorage.setItem("icm.reference-window.v1", "closed");
  localStorage.setItem("icm.netlist-panel.v1", "closed");
  localStorage.setItem("icm.wheel-behavior.v1", "zoom");
  function physicalPoint(hit) {
    if (!hit) return;
    const b = hit.getBoundingClientRect();
    for (const fx of [0.56, 0.42, 0.66, 0.3, 0.8, 0.5, 0.24, 0.72]) {
      for (const fy of [0.5, 0.65, 0.37, 0.75, 0.3, 0.58, 0.43]) {
        const x = Math.round(b.left + b.width * fx),
          y = Math.round(b.top + b.height * fy);
        if (
          document.elementFromPoint(x, y)?.closest("[data-canvas-hit-id]") ===
          hit
        ) {
          return { x, y, id: hit.getAttribute("data-canvas-hit-id") };
        }
      }
    }
  }
  window.scalingPoint = physicalPoint;
  for (const event of [
    "change",
    "keydown",
    "pointermove",
    "pointerdown",
    "pointerup",
    "wheel",
  ]) {
    window.addEventListener(
      event,
      (input) => {
        const target = window.scalingAction;
        if (
          !target ||
          target.event !== input.type ||
          (target.key && input.key?.toLowerCase() !== target.key)
        )
          return;
        window.scalingAction = undefined;
        const start = performance.now();
        window.scalingLastInput = {
          type: input.type,
          target: input.target?.getAttribute("data-testid"),
          key: input.key,
          shift: input.shiftKey,
          dx: input.deltaX,
          dy: input.deltaY,
        };
        const svg = () =>
          document.querySelector('[data-testid="schematic-canvas"]');
        const hit = (id) =>
          svg()?.querySelector('[data-canvas-hit-id="' + CSS.escape(id) + '"]');
        const inputCamera = svg()?.getAttribute("viewBox");
        const settled = () => {
          switch (target.goal) {
            case "editResult":
              return window.scalingEditSettled(target);
            case "camera":
              return svg()?.getAttribute("viewBox") !== target.before;
            case "fit":
              return svg()?.getAttribute("viewBox") === target.expected;
            case "open": {
              if (
                document.querySelector('[data-testid="project-menu-toggle"]')
                  ?.title !== target.name
              )
                return false;
              const viewport = svg()?.viewBox.baseVal;
              if (
                !viewport ||
                !target.extremes.every(
                  ({ x, y }) =>
                    x >= viewport.x &&
                    y >= viewport.y &&
                    x <= viewport.x + viewport.width &&
                    y <= viewport.y + viewport.height,
                )
              )
                return false;
              return physicalPoint(hit(target.id));
            }
            case "select":
              return hit(target.id)?.classList.contains("selected");
            case "remove":
              return !hit(target.id);
            case "restore":
              return physicalPoint(hit(target.id));
            case "placement": {
              const el = hit(target.id);
              if (!el || svg().classList.contains("semantic-move-preview"))
                return false;
              const position = [
                el.getAttribute("x"),
                el.getAttribute("y"),
              ].join(",");
              return target.expected
                ? position === target.expected
                : position !== target.before;
            }
            case "cell":
              return target.ids.some((id) => hit(id)) && !hit(target.oldId);
            case "trace": {
              const overlay = svg()?.querySelector(
                '[data-testid="net-highlight-overlay"]',
              );
              return (
                overlay?.getAttribute("data-net-id") === target.netId &&
                overlay.querySelectorAll("circle,polyline,path").length === 1 &&
                Number(
                  overlay
                    .querySelector("circle.net-highlight-endpoint")
                    ?.getAttribute("cx"),
                ) === target.point.x &&
                Number(
                  overlay
                    .querySelector("circle.net-highlight-endpoint")
                    ?.getAttribute("cy"),
                ) === target.point.y
              );
            }
          }
        };
        let observer,
          finishing = false;
        const poll = () => {
          if (finishing) return;
          const state = settled();
          if (!state) return;
          finishing = true;
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const current = settled();
              if (!current) {
                finishing = false;
                requestAnimationFrame(poll);
                return;
              }
              observer.disconnect();
              const end = performance.now();
              window.scalingResult = {
                start,
                end,
                ms: end - start,
                camera: svg()?.getAttribute("viewBox"),
                inputCamera,
                point: target.goal === "open" ? current : null,
                ...(target.goal === "editResult" &&
                  Array.isArray(current) && { editWitness: current }),
              };
            }),
          );
        };
        observer = new MutationObserver(poll);
        if (["camera", "fit"].includes(target.goal)) {
          observer.observe(svg(), {
            attributes: true,
            attributeFilter: ["viewBox"],
          });
        } else {
          observer.observe(target.goal === "open" ? document.body : svg(), {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: [
              "class",
              "title",
              "x",
              "y",
              "data-net-id",
              "transform",
              ...(target.goal === "editResult" ? ["points", "d"] : []),
            ],
          });
        }
        requestAnimationFrame(poll);
      },
      true,
    );
  }
}

export async function openEditorPage(browser, url) {
  const context = await browser.newContext(browserContext);
  const errors = [];
  try {
    await context.addInitScript(installObserver);
    const page = await context.newPage();
    page.setDefaultTimeout(90000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(new URL("/editor", url).href);
    await canvas(page).waitFor();
    return { page, errors, close: () => context.close() };
  } catch (error) {
    await context.close();
    throw error;
  }
}

export async function measured(page, event, goal, args, action) {
  await page.evaluate(
    (target) => {
      window.scalingResult = undefined;
      window.scalingAction = target;
    },
    { event, goal, ...args },
  );
  await action();
  try {
    await page.waitForFunction(() => !!window.scalingResult, undefined, {
      polling: 100,
      timeout: 90000,
    });
  } catch (error) {
    const observed = await page.evaluate(() => ({
      inputPending: window.scalingAction,
      last: window.scalingLastInput,
      project: document.querySelector('[data-testid="project-menu-toggle"]')
        ?.title,
      view: document
        .querySelector('[data-testid="schematic-canvas"]')
        ?.getAttribute("viewBox"),
      selection: document
        .querySelector("[data-canvas-hit-id].selected")
        ?.getAttribute("data-canvas-hit-id"),
    }));
    throw new Error(
      "No visible result for " +
        goal +
        " " +
        JSON.stringify({ args, observed }),
      { cause: error },
    );
  }
  return page.evaluate(() => window.scalingResult);
}

async function pickResult(page, point) {
  const current = await page
    .locator('[data-canvas-hit-id="' + point.id + '"]')
    .first()
    .evaluate((el) => window.scalingPoint(el));
  assert.ok(current, "Device moved out of the physical viewport: " + point.id);
  return measured(page, "pointerdown", "select", { id: current.id }, () =>
    page.mouse.click(current.x, current.y),
  );
}

const pick = async (page, point) => (await pickResult(page, point)).ms;

function middleInstance(name) {
  if (name === "hier-2048") return "X20";
  const n = Number(name.slice(5));
  return "M" + (n / 2 + Math.sqrt(n / 2) + 1);
}

async function loadFile(page, file) {
  await page.getByTestId("project-file").setInputFiles(file);
}

export async function loadDrawing(page, file, name) {
  await loadFile(page, file);
  await page.waitForFunction(
    (title) =>
      document.querySelector('[data-testid="project-menu-toggle"]')?.title ===
      title,
    name,
  );
  await fitButton(page).click();
}

export async function detail(page) {
  const box = await canvas(page).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 4; i++) {
    const width = Number((await camera(page)).split(/\s+/)[2]);
    if (Math.abs(width - 1100) <= 1) return;
    const dy = Math.round(Math.log(1100 / width) / 0.0012);
    await measured(
      page,
      "wheel",
      "camera",
      { before: await camera(page) },
      () => page.mouse.wheel(0, dy),
    );
  }
  throw new Error("Cannot reach the 1100 ± 1 world-unit detail viewport");
}

async function warm(count, action) {
  await action(0);
  const results = [];
  for (let i = 1; i <= count; i++) {
    results.push(await action(i));
  }
  return results;
}

async function pan(page, atDetail) {
  return warm(sampleCount.interaction, async () => {
    await fitButton(page).click();
    if (atDetail) await detail(page);
    const area = await canvas(page).boundingBox();
    await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
    // Start each discrete wheel input after the camera accepts its settled state.
    await page.waitForTimeout(250);
    const before = await camera(page);
    await page.keyboard.down("Shift");
    try {
      const { ms } = await measured(page, "wheel", "camera", { before }, () =>
        page.mouse.wheel(0, 32),
      );
      const [x, y, w, h] = (await camera(page)).split(" ").map(Number);
      const [oldX, oldY, oldW, oldH] = before.split(" ").map(Number);
      assert.ok(
        x > oldX && y === oldY && w === oldW && h === oldH,
        "Shift+wheel must pan horizontally at the same scale",
      );
      return ms;
    } finally {
      await page.keyboard.up("Shift");
    }
  });
}

/** Measure intervals between browser rAFs during actual consecutive wheel inputs.
 * Record the whole burst, including stalls with no intervening animation frame. */
async function frameGaps(page) {
  await page.evaluate(() => {
    const svg = document.querySelector('[data-testid="schematic-canvas"]');
    const frame = { running: true, events: 0, views: new Set(), times: [] };
    window.scalingGesture = frame;
    const observe = (time) => {
      if (frame.events) {
        frame.times.push(time);
        frame.views.add(svg.getAttribute("viewBox"));
      }
      if (frame.running) requestAnimationFrame(observe);
    };
    frame.onWheel = () => {
      frame.events++;
    };
    svg.addEventListener("wheel", frame.onWheel, { capture: true });
    requestAnimationFrame(observe);
  });
  await page.keyboard.down("Shift");
  try {
    let sent = 0;
    for (let batch = 0; batch < 8; batch++) {
      for (let i = 0; i < 32; i++) {
        await page.mouse.wheel(0, (sent++ % 2 ? 1 : -1) * 32);
      }
      if (
        await page.evaluate(
          (count) => window.scalingGesture.times.length > count,
          sampleCount.interaction,
        )
      )
        break;
    }
    const result = await page.evaluate(async () => {
      const frame = window.scalingGesture;
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      frame.running = false;
      const svg = document.querySelector('[data-testid="schematic-canvas"]');
      svg.removeEventListener("wheel", frame.onWheel, true);
      return {
        events: frame.events,
        views: frame.views.size,
        gaps: frame.times.slice(1).map((time, i) => time - frame.times[i]),
      };
    });
    assert.ok(
      result.events > 1 && result.views > 1,
      "Continuous pan did not visibly change the camera",
    );
    return result.gaps;
  } finally {
    await page.keyboard.up("Shift");
  }
}

async function zoomButton(page, direction) {
  const before = await camera(page);
  const zoom = page.getByRole("button", {
    name: "Zoom " + direction,
    exact: true,
  });
  const { ms } = await measured(page, "pointerdown", "camera", { before }, () =>
    zoom.click(),
  );
  const width = Number((await camera(page)).split(" ")[2]);
  const [x, y, w, h] = before.split(" ").map(Number);
  const expected = zoomCameraAtAnchor(
    { x, y, width: w, height: h },
    direction === "in" ? 0.84 : 1.2,
    { x: 0.5, y: 0.5 },
    await canvas(page).boundingBox(),
  ).width;
  assert.ok(
    Math.abs(width - expected) < 0.01,
    "Zoom " + direction + " must reach its expected scale",
  );
  return ms;
}

async function view(page, name, action, workload) {
  const fit = await camera(page);
  workload.fit = fit;
  const box = await canvas(page).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  if (action === "fitPan") return pan(page, false);
  if (action === "fitZoomIn") {
    return warm(sampleCount.interaction, async () => {
      await fitButton(page).click();
      return zoomButton(page, "in");
    });
  }
  if (action === "fitFromDetail") {
    return warm(sampleCount.interaction, async () => {
      await detail(page);
      workload.detail = await camera(page);
      await canvas(page).focus();
      const { ms } = await measured(
        page,
        "keydown",
        "fit",
        { expected: fit, key: "f" },
        () => page.keyboard.press("f"),
      );
      const ids =
        name === "hier-2048" ? ["X1", "X32"] : ["M1", "M" + name.slice(5)];
      for (const id of ids) {
        const contained = await page
          .getByTestId("hit-" + id)
          .evaluate((hit) => {
            const r = hit.getBoundingClientRect(),
              v = hit.ownerSVGElement.getBoundingClientRect();
            return (
              r.left >= v.left - 2 &&
              r.right <= v.right + 2 &&
              r.top >= v.top - 2 &&
              r.bottom <= v.bottom + 2
            );
          });
        assert.ok(contained, "Fit missed " + id);
      }
      return ms;
    });
  }
  await detail(page);
  workload.detail = await camera(page);
  if (action === "detailPan") return pan(page, true);
  if (action === "frameGap") {
    await page.keyboard.down("Shift");
    try {
      for (const dy of [-32, 32])
        await measured(
          page,
          "wheel",
          "camera",
          { before: await camera(page) },
          () => page.mouse.wheel(0, dy),
        );
    } finally {
      await page.keyboard.up("Shift");
    }
    return frameGaps(page);
  }
  if (action === "detailZoom")
    return warm(sampleCount.interaction, (i) =>
      zoomButton(page, i % 2 ? "out" : "in"),
    );
  assert.equal(action, "detailPick");
  const center = middleInstance(name);
  const neighbor = center[0] + (Number(center.slice(1)) + 1);
  workload.targets = [center, neighbor];
  const body = (id) =>
    page.getByTestId("hit-" + id).evaluate((el) => window.scalingPoint(el));
  const select = async (id) => {
    const point = await body(id);
    assert.ok(point, "Expected physically pickable detail instance " + id);
    return pick(page, point);
  };
  await select(center);
  return warm(sampleCount.interaction, (i) =>
    select(workload.targets[(i + 1) % 2]),
  );
}

async function edit(page, name, action, project, workload) {
  const { exportedProject } =
    await import("../../apps/editor/e2e/editor-fixtures.ts");
  await detail(page);
  workload.detail = await camera(page);
  const id = middleInstance(name);
  workload.target = id;
  const hit = page.getByTestId("hit-" + id);
  const position = () =>
    hit.evaluate((el) =>
      [el.getAttribute("x"), el.getAttribute("y")].join(","),
    );
  const point = () => hit.evaluate((el) => window.scalingPoint(el));
  const original = await position();
  const initial = project.documents.find(
    (cell) => cell.id === project.topDocumentId,
  );
  const first = initial.instances.find((item) => item.id === id).placement
    .position;
  const cellFromFile = async () =>
    (await exportedProject(page)).documents.find(
      (cell) => cell.id === initial.id,
    );
  const withoutRevision = ({ revision: _revision, ...content }) => content;
  const connectedNets = new Set(
    initial.nets
      .filter((net) => net.terminals.some((pin) => pin.instanceId === id))
      .map((net) => net.id),
  );
  function unrelated(doc) {
    const {
      instances,
      nets,
      routes,
      junctions,
      annotations,
      sourceStatus: _sourceStatus,
      ...rest
    } = withoutRevision(doc);
    return {
      ...rest,
      instances: instances.filter((instance) => instance.id !== id),
      nets: nets.filter((net) => !connectedNets.has(net.id)),
      routes: routes.filter((route) => !connectedNets.has(route.netId)),
      junctions: junctions.filter((node) => !connectedNets.has(node.netId)),
      annotations: annotations.filter(
        (label) =>
          label.anchor?.objectId !== id && label.binding?.instanceId !== id,
      ),
    };
  }
  const untouched = unrelated(initial);
  const removedContacts = new Map();
  if (action === "delete") {
    for (const route of initial.routes.filter((r) =>
      connectedNets.has(r.netId),
    )) {
      assert.equal(
        route.start.instanceId,
        id,
        "The central PMOS is the start of both independent routes",
      );
      const pin = await page
        .getByTestId("terminal-" + id + "-" + route.start.pinName)
        .evaluate((el) => ({
          x: Number(el.getAttribute("cx")),
          y: Number(el.getAttribute("cy")),
        }));
      removedContacts.set(route.id, pin);
    }
  }
  workload.committedCellSha256 = [];
  function verifyCommitted(doc, sample) {
    assert.equal(
      doc.sourceStatus,
      action === "move" ? "geometry-only-changed" : "connectivity-modified",
    );
    assert.deepEqual(
      unrelated(doc),
      untouched,
      "A single edit must preserve unrelated instances and wires",
    );
    // A deletion assigns fresh Junction IDs from the editor session. Compare
    // each complete committed Cell to the corresponding baseline sample.
    if (sample) workload.committedCellSha256.push(sha256(JSON.stringify(doc)));
  }
  await pick(page, await point());
  const results = await warm(sampleCount.edit, async (sample) => {
    const p = await point();
    assert.ok(p, "No physical pick at restored MOS");
    if (!(await hit.getAttribute("class")).split(" ").includes("selected"))
      await pick(page, p);
    await canvas(page).focus();
    let result;
    if (action === "delete") {
      const remove = (
        await measured(page, "keydown", "remove", { id, key: "delete" }, () =>
          page.keyboard.press("Delete"),
        )
      ).ms;
      const removed = await cellFromFile();
      verifyCommitted(removed, sample);
      const newNodes = removed.junctions.filter((j) =>
        connectedNets.has(j.netId),
      );
      assert.equal(newNodes.length, removedContacts.size);
      for (const [routeId, position] of removedContacts) {
        const old = initial.routes.find((r) => r.id === routeId);
        const kept = removed.routes.find((r) => r.id === routeId);
        const node = newNodes.find((j) => j.id === kept?.start.junctionId);
        assert.equal(kept?.start.kind, "junction");
        assert.equal(node?.netId, old.netId);
        assert.deepEqual(node.position, position);
        assert.deepEqual(
          kept.legs.at(-1).to,
          old.legs.at(-1).to,
          "Opposite terminal must stay attached",
        );
      }
      assert.ok(!removed.instances.some((instance) => instance.id === id));
      assert.ok(
        removed.nets.every((net) =>
          net.terminals.every((pin) => pin.instanceId !== id),
        ),
      );
      await canvas(page).focus();
      const undoDelete = (
        await measured(page, "keydown", "restore", { id, key: "z" }, () =>
          page.keyboard.press("Control+z"),
        )
      ).ms;
      result = { delete: remove, undoDelete };
    } else {
      const delta = await canvas(page).evaluate((svg) => {
        const m = svg.getScreenCTM();
        return { x: 40 * m.a, y: 30 * m.d };
      });
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.mouse.move(p.x + delta.x, p.y + delta.y, { steps: 4 });
      await page.waitForFunction(() =>
        document
          .querySelector('[data-testid="schematic-canvas"]')
          .classList.contains("semantic-move-preview"),
      );
      const move = (
        await measured(
          page,
          "pointerup",
          "placement",
          { id, before: original },
          () => page.mouse.up(),
        )
      ).ms;
      const saved = await cellFromFile();
      verifyCommitted(saved, sample);
      assert.deepEqual(
        saved.instances.find((instance) => instance.id === id).placement
          .position,
        { x: first.x + 40, y: first.y + 30 },
      );
      assert.deepEqual(
        saved.nets,
        initial.nets,
        "The independent pair must keep its electrical connections",
      );
      await canvas(page).focus();
      const undoMove = (
        await measured(
          page,
          "keydown",
          "placement",
          { id, expected: original, key: "z" },
          () => page.keyboard.press("Control+z"),
        )
      ).ms;
      result = { move, undoMove };
    }
    assert.deepEqual(
      withoutRevision(await cellFromFile()),
      withoutRevision(initial),
      "Undo must restore every instance, wire, pin, and annotation",
    );
    return result;
  });
  return Object.fromEntries(
    Object.keys(results[0]).map((key) => [key, results.map((r) => r[key])]),
  );
}

async function hierarchy(page) {
  const tree = page.getByTestId("hierarchy-toggle");
  if ((await tree.getAttribute("aria-pressed")) !== "true") await tree.click();
  const result = await warm(sampleCount.interaction, async (i) => {
    const caller = "X" + ((i % 2) + 1);
    const descend = (
      await measured(
        page,
        "pointerdown",
        "cell",
        { ids: ["M1", "M33"], oldId: caller },
        () =>
          page
            .getByRole("button", { name: caller + ": bank", exact: true })
            .click(),
      )
    ).ms;
    const ascend = (
      await measured(
        page,
        "pointerdown",
        "cell",
        { ids: [caller], oldId: "M1" },
        () =>
          page
            .getByRole("button", { name: "Up to the caller", exact: true })
            .click(),
      )
    ).ms;
    assert.ok(
      (await page.getByTestId("hit-" + caller).getAttribute("class"))
        .split(" ")
        .includes("selected"),
      "Up must return to the actual caller",
    );
    return { descend, ascend };
  });
  return {
    descend: result.map((r) => r.descend),
    ascend: result.map((r) => r.ascend),
  };
}

async function trace(page, supply) {
  const netId = supply.top.netId;
  return {
    firstVdd: await warm(sampleCount.interaction, async () => {
      await canvas(page).focus();
      await page.keyboard.press("Control+f");
      await page.getByTestId("project-search-input").fill("VDD");
      const row = page.getByTestId("project-search-result-" + netId);
      await row.waitFor();
      const { ms } = await measured(
        page,
        "pointerdown",
        "trace",
        { netId, point: supply.point },
        () => row.click(),
      );
      await canvas(page).focus();
      await page.keyboard.press("h");
      await page
        .getByTestId("net-highlight-overlay")
        .waitFor({ state: "detached" });
      return ms;
    }),
  };
}

export async function measureBrowser({
  browser,
  url,
  file,
  name,
  project,
  group,
  family,
  supply,
  workload,
}) {
  const errors = [];
  if (group === "open") {
    const open = [],
      openToSelectedInstance = [];
    const id =
      name === "hier-2048"
        ? middleInstance(name)
        : "label-" + middleInstance(name);
    const top = project.documents.find(
      (cell) => cell.id === project.topDocumentId,
    );
    const last = name === "hier-2048" ? "X32" : "M" + name.slice(5);
    const first = name === "hier-2048" ? "X1" : "M1";
    const extremes = [first, last].map(
      (ref) =>
        top.instances.find((instance) => instance.id === ref).placement
          .position,
    );
    for (let i = 0; i < sampleCount.open; i++) {
      const session = await openEditorPage(browser, url);
      try {
        const ready = await measured(
          session.page,
          "change",
          "open",
          { name: project.name, id, extremes },
          () => loadFile(session.page, file),
        );
        workload.openTarget ??= ready.point.id;
        workload.initialCamera ??= ready.camera;
        assert.equal(ready.point.id, workload.openTarget);
        assert.equal(ready.camera, workload.initialCamera);
        const confirmed = await measured(
          session.page,
          "pointerdown",
          "select",
          { id },
          () => session.page.mouse.click(ready.point.x, ready.point.y),
        );
        assert.equal(
          confirmed.inputCamera,
          ready.camera,
          "First physical click must use the recorded open camera",
        );
        const target = session.page.getByTestId("hit-" + middleInstance(name));
        let selected = confirmed;
        if (id !== middleInstance(name)) {
          const bodyPoint = () =>
            target.evaluate((el) => window.scalingPoint(el));
          if (!(await bodyPoint())) await detail(session.page);
          const point = await bodyPoint();
          assert.ok(
            point,
            "Expected a physical pick on " + middleInstance(name),
          );
          selected = await pickResult(session.page, point);
        }
        assert.equal(
          await target.getAttribute("data-canvas-hit-kind"),
          "instance",
        );
        openToSelectedInstance.push(selected.end - ready.start);
        open.push(ready.ms);
        errors.push(...session.errors);
      } finally {
        await session.close();
      }
    }
    assert.deepEqual(errors, []);
    return { open, openToSelectedInstance };
  }
  const session = await openEditorPage(browser, url);
  try {
    await loadDrawing(session.page, file, project.name);
    const measurements =
      family === "view"
        ? { [group]: await view(session.page, name, group, workload) }
        : family === "edit"
          ? await edit(session.page, name, group, project, workload)
          : group === "hierarchy"
            ? await hierarchy(session.page)
            : await trace(session.page, supply);
    assert.deepEqual(session.errors, []);
    return measurements;
  } finally {
    await session.close();
  }
}
