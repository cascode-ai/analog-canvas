import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { awaitTwoFrames } from "../../apps/editor/e2e/editor-fixtures.ts";

export async function canvasPositions(page, positions) {
  const canvas = page.getByTestId("schematic-canvas");
  await page.getByRole("button", { name: "Fit view", exact: true }).click();
  function project(svg, [x, y]) {
    const p = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM());
    const box = svg.getBoundingClientRect();
    if (
      p.x < box.left ||
      p.x >= box.right ||
      p.y < box.top ||
      p.y >= box.bottom
    )
      throw Error("Gesture lies outside Canvas");
    return { x: p.x, y: p.y };
  }
  const center = await canvas.evaluate(project, [0, 0]);
  await page.mouse.move(center.x, center.y);
  for (let i = 0; i < 5; i++) {
    const before = await canvas.getAttribute("viewBox");
    const width = Number(before.split(/\s+/)[2]);
    if (Math.abs(width - 1100) < 2) break;
    await page.mouse.wheel(0, Math.round(Math.log(1100 / width) / 0.0012));
    await page.waitForFunction(
      (previous) =>
        document
          .querySelector('[data-testid="schematic-canvas"]')
          .getAttribute("viewBox") !== previous,
      before,
    );
    await awaitTwoFrames(page);
  }
  return Promise.all(positions.map((point) => canvas.evaluate(project, point)));
}

// Only the driver clock schedules input. CDP receives every event even when the
// previous commit blocks the renderer. Its input timestamps share the page's
// time origin after conversion, exposing the actual input queue delay.
export async function sampleInputs(
  page,
  points,
  expectedCommits,
  countWork,
  snapTarget,
) {
  const session = await page.context().newCDPSession(page);
  await page.evaluate(
    ({ countWork, snapTarget }) => {
      const revision = document.querySelector('[data-testid="revision"]');
      const observed = {
        startRevision: Number(revision.textContent),
        inputs: [],
        commits: [],
        clones: {},
      };
      window.canvasEditObservation = observed;
      if (countWork) {
        const original = window.structuredClone;
        const isCell = (value) =>
          Array.isArray(value?.nets) &&
          Array.isArray(value.routes) &&
          Array.isArray(value.instances);
        window.structuredClone = function (value, ...args) {
          const kind = isCell(value)
            ? "document"
            : isCell(value?.document)
              ? "transaction"
              : value?.documents?.some?.(isCell)
                ? "project"
                : undefined;
          if (kind) observed.clones[kind] = (observed.clones[kind] ?? 0) + 1;
          return original(value, ...args);
        };
      }
      addEventListener(
        "pointerdown",
        (event) => {
          observed.inputs.push({
            x: event.clientX,
            y: event.clientY,
            eventMs: performance.timeOrigin + event.timeStamp,
            handledMs: performance.timeOrigin + performance.now(),
          });
        },
        { capture: true },
      );
      if (snapTarget) {
        const canvas = document.querySelector(
          '[data-testid="schematic-canvas"]',
        );
        const observer = new MutationObserver(() => {
          if (observed.inputs.length < 2) return;
          const snap = canvas.querySelector('[data-testid="wire-snap-target"]');
          if (
            snap &&
            Number(snap.getAttribute("cx")) === snapTarget[0] &&
            Number(snap.getAttribute("cy")) === snapTarget[1]
          ) {
            observed.secondSnapMs = performance.timeOrigin + performance.now();
            observer.disconnect();
          }
        });
        observer.observe(canvas, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ["cx", "cy"],
        });
      }
      new MutationObserver(() => {
        const current = Number(revision.textContent);
        if (
          current <=
          (observed.commits.at(-1)?.revision ?? observed.startRevision)
        )
          return;
        const commit = {
          revision: current,
          domMs: performance.timeOrigin + performance.now(),
        };
        observed.commits.push(commit);
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            commit.frameMs = performance.timeOrigin + performance.now();
            commit.frameRevision = Number(revision.textContent);
          }),
        );
      }).observe(revision, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    },
    { countWork, snapTarget },
  );
  const sent = [];
  const pending = [];
  let hoverSentMs;
  const started = performance.now();
  try {
    for (const [i, point] of points.entries()) {
      if (snapTarget && i === 2) {
        await delay(Math.max(0, started + 225 - performance.now()));
        hoverSentMs = Date.now();
        pending.push(
          session.send("Input.dispatchMouseEvent", {
            ...point,
            type: "mouseMoved",
            timestamp: hoverSentMs / 1000,
          }),
        );
      }
      await delay(Math.max(0, started + 150 * i - performance.now()));
      const sentMs = Date.now();
      sent.push(sentMs);
      for (const type of snapTarget && i === 2
        ? ["mousePressed", "mouseReleased"]
        : ["mouseMoved", "mousePressed", "mouseReleased"]) {
        const down = type === "mousePressed";
        pending.push(
          session.send("Input.dispatchMouseEvent", {
            ...point,
            type,
            timestamp: sentMs / 1000,
            button: type === "mouseMoved" ? "none" : "left",
            buttons: down ? 1 : 0,
            clickCount: type === "mouseMoved" ? 0 : 1,
          }),
        );
      }
    }
    await Promise.all(pending);
    await page.waitForFunction(
      (count) => {
        const last = window.canvasEditObservation.commits.at(-1);
        return (
          last?.revision ===
            window.canvasEditObservation.startRevision + count && last.frameMs
        );
      },
      expectedCommits,
      { timeout: 90000 },
    );
    const sample = await page.evaluate(() => window.canvasEditObservation);
    assert.equal(sample.inputs.length, points.length);
    assert.deepEqual(
      sample.commits.map((c) => c.revision),
      Array.from(
        { length: expectedCommits },
        (_, i) => sample.startRevision + i + 1,
      ),
    );
    return { sent, hoverSentMs, ...sample };
  } finally {
    await session.detach();
  }
}
