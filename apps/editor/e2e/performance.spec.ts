import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";

import { expect, test } from "@playwright/test";
import { preview, type PreviewServer } from "vite";

import { awaitEditorReady } from "./editor-fixtures.js";
import {
  BROWSER_PERFORMANCE_COUNTS,
  createBrowserPerformanceProject,
} from "./performance-fixture.js";
import {
  createDenseCopyPerformanceProject,
  DENSE_COPY_COUNTS,
} from "../src/features/clipboard/test-support/dense-copy-fixture.js";

/**
 * Browser-side latency harness for the editor.
 *
 * This is measurement, not a contract: it records what a large Project costs
 * while panning and while dragging, and only fails on a gross regression. Run
 * it against a fresh production build:
 *
 *   pnpm build
 *   ICM_PERF=1 pnpm test:e2e:local apps/editor/e2e/performance.spec.ts
 *
 * It measures the built bundle through Vite's preview server rather than the
 * Playwright dev server: the development build is unminified, resolves every
 * `@icm/*` through the `development` condition, and React double-invokes under
 * StrictMode, which together inflate a large Project by more than an order of
 * magnitude and say nothing about what ships.
 *
 * It is skipped unless ICM_PERF is set, because a timing assertion on shared
 * CI runners is a flaky gate rather than a useful one. Absolutes are
 * deliberately loose: the 2026-09-02 audit already found that these numbers do
 * not transfer between machines, so the artifact it writes is the comparable
 * value, not the threshold.
 */
const enabled = Boolean(process.env.ICM_PERF);
const previewPort = 4175;

let server: PreviewServer | undefined;
let origin = "";

test.describe("editor latency on a large Project", () => {
  // Identical physical mixed-selection trajectory for before/after builds.
  // Timing is evidence only; commit and Undo are observable correctness gates.
  test("records mixed-selection drag through sub-pixel pointer steps", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1600, height: 1000 });
    const project = createBrowserPerformanceProject();
    project.documents[0]!.drafting = {
      objects: Array.from({ length: 32 }, (_, index) => ({
        id: `perf-text-${index}`,
        kind: "text" as const,
        content: { runs: [{ kind: "text" as const, value: `note-${index}` }] },
        anchor: {
          kind: "free" as const,
          position: {
            x: 93 + (index % 20) * 80,
            y: 111 + Math.floor(index / 20) * 80,
          },
        },
        alignment: "start" as const,
        rotation: 0,
        locked: false,
        zIndex: 0,
      })),
    };
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const perf = {
        frames: [] as number[],
        tasks: [] as { start: number; duration: number }[],
      };

      (
        window as unknown as {
          __mixedPerf: {
            frames: number[];
            tasks: { start: number; duration: number }[];
          };
        }
      ).__mixedPerf = perf;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          perf.tasks.push({ start: entry.startTime, duration: entry.duration });
      }).observe({ entryTypes: ["longtask"] });
      const tick = (time: number) => {
        perf.frames.push(time);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.goto(origin + "editor");
    await page.getByTestId("project-file").setInputFiles({
      name: "mixed-profile.icproj.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(project)),
    });
    await page.getByTestId("hit-R001").waitFor();
    const netlist = page.getByTestId("netlist-panel-toggle");
    if ((await netlist.getAttribute("aria-pressed")) === "true")
      await netlist.click();
    await page.waitForTimeout(2000);
    const measurements: unknown[] = [];
    for (let sample = 0; sample < 4; sample++) {
      await page.getByTestId("schematic-canvas").focus();
      await page.keyboard.press("Control+a");
      const start = await page.evaluate(() => {
        const canvas = document.querySelector(
          '[data-testid="schematic-canvas"]',
        ) as SVGSVGElement;
        for (const hit of document.querySelectorAll(
          '[data-canvas-hit-kind="instance"]',
        )) {
          const r = hit.getBoundingClientRect();
          for (const fx of [0.5, 0.25, 0.75])
            for (const fy of [0.5, 0.25, 0.75]) {
              const x = r.x + r.width * fx,
                y = r.y + r.height * fy;
              if (
                document
                  .elementFromPoint(x, y)
                  ?.closest("[data-canvas-hit-id]") === hit
              )
                return {
                  x,
                  y,
                  id: hit.getAttribute("data-canvas-hit-id")!,
                  scale: canvas.getScreenCTM()!.a,
                };
            }
        }
        throw new Error("No unoccluded instance body for a real mixed drag");
      });
      const hit = page.getByTestId(`hit-${start.id}`);
      const before = (await hit.boundingBox())!;
      await page.keyboard.down("Alt");
      await page.mouse.move(start.x, start.y);
      const from = await page.evaluate(() => performance.now());
      await page.mouse.down();
      for (let step = 1; step <= 60; step++)
        await page.mouse.move(
          start.x + step * start.scale,
          start.y + (step * start.scale) / 3,
        );
      await page.locator(".schematic-canvas.semantic-move-preview").waitFor();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await page.mouse.up();
      await page.keyboard.up("Alt");
      const to = await page.evaluate(() => performance.now());
      await expect
        .poll(async () =>
          Math.round(((await hit.boundingBox())!.x - before.x) / start.scale),
        )
        .toBe(60);
      measurements.push(
        await page.evaluate(
          ({ from, to }) => {
            const perf = (
              window as unknown as {
                __mixedPerf: {
                  frames: number[];
                  tasks: { start: number; duration: number }[];
                };
              }
            ).__mixedPerf as {
              frames: number[];
              tasks: { start: number; duration: number }[];
            };
            const frames = perf.frames.filter(
              (time) => time >= from && time <= to,
            );
            const gaps = frames
              .slice(1)
              .map((time, index) => time - frames[index]!)
              .sort((a, b) => a - b);
            return {
              durationMs: to - from,
              paintedFrames: frames.length,
              frameGapMedianMs: gaps[Math.floor(gaps.length / 2)],
              frameGapP95Ms: gaps[Math.ceil(gaps.length * 0.95) - 1],
              longTasks: perf.tasks.filter(
                (task) => task.start >= from && task.start <= to,
              ),
            };
          },
          { from, to },
        ),
      );
      await page.getByTestId("schematic-canvas").focus();
      await page.keyboard.press("Control+z");
      await expect
        .poll(async () =>
          Math.round(((await hit.boundingBox())!.x - before.x) / start.scale),
        )
        .toBe(0);
      await page.waitForTimeout(1000);
    }
    if (errors.length) throw new Error(JSON.stringify(errors));
    const report = {
      commit: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      dirty:
        execFileSync("git", ["status", "--porcelain"], {
          encoding: "utf8",
        }).trim().length > 0,
      builtIndexSha256: createHash("sha256")
        .update(readFileSync("apps/editor/dist/index.html"))
        .digest("hex"),
      browser: page.context().browser()?.version(),
      viewport: page.viewportSize(),
      fixture: {
        instances: 260,
        routes: 580,
        junctions: 232,
        annotations: 264,
        draftText: 32,
      },
      trajectory:
        "Ctrl+A; Alt+physical body drag, 60 CDP pointer steps over (60,20) logical units; Undo between samples",
      measurements,
      note: "Production build, synthetic dense fixture and browser bridge included; cold first sample, remaining warm. No timing assertions; no active test/build workload during comparable runs.",
    };
    mkdirSync("output/performance", { recursive: true });
    writeFileSync(
      `output/performance/mixed-profile-${process.env.PROFILE_LABEL ?? "trial"}-${Date.now()}.json`,
      JSON.stringify(report, null, 2),
    );
    process.stdout.write(JSON.stringify(report, null, 2));
  });
  test.skip(!enabled, "set ICM_PERF=1 to run the latency harness");

  test.beforeAll(async () => {
    server = await preview({
      root: resolve(process.cwd(), "apps/editor"),
      logLevel: "silent",
      preview: { host: "127.0.0.1", port: previewPort, strictPort: true },
    });
    origin =
      server.resolvedUrls?.local[0] ?? `http://127.0.0.1:${previewPort}/`;
  });

  test.afterAll(async () => {
    await server?.close();
  });

  test("records copy-to-ghost and drop-to-next-ghost on a dense Project", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1600, height: 1000 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const state = {
        tasks: [] as { start: number; duration: number }[],
        events: [] as { kind: string; start: number }[],
      };
      (window as unknown as { __copyPerf: typeof state }).__copyPerf = state;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          state.tasks.push({
            start: entry.startTime,
            duration: entry.duration,
          });
      }).observe({ entryTypes: ["longtask"] });
      for (const kind of ["keydown", "pointerdown"])
        window.addEventListener(
          kind,
          () => state.events.push({ kind, start: performance.now() }),
          true,
        );
    });
    const projectPath = process.env.ICM_PERF_PROJECT;
    const bytes = projectPath
      ? readFileSync(projectPath)
      : Buffer.from(JSON.stringify(createDenseCopyPerformanceProject()));
    await page.goto(`${origin}editor`);
    await page.getByTestId("project-file").setInputFiles({
      name: "copy-performance.icproj.json",
      mimeType: "application/json",
      buffer: bytes,
    });
    await awaitEditorReady(page);
    const netlist = page.getByTestId("netlist-panel-toggle");
    if ((await netlist.getAttribute("aria-pressed")) === "true")
      await netlist.click();
    const hits = page.locator('[data-canvas-hit-kind="instance"]');
    const originalCount = await hits.count();
    if (!projectPath) expect(originalCount).toBe(DENSE_COPY_COUNTS.instances);
    process.stdout.write(`\ncopy fixture loaded: ${originalCount} instances\n`);
    await page.waitForTimeout(1000);
    const painted = () =>
      page.evaluate(
        () =>
          new Promise<number>((resolve) =>
            requestAnimationFrame(() =>
              requestAnimationFrame(() => resolve(performance.now())),
            ),
          ),
      );
    const samples = Number(process.env.ICM_PERF_COPY_SAMPLES ?? "5");
    if (!Number.isInteger(samples) || samples < 2)
      throw new Error("ICM_PERF_COPY_SAMPLES must include cold + warm samples");
    const measurements: {
      ghostMs: number;
      dropMs: number;
      tasks: { start: number; duration: number }[];
    }[] = [];
    for (let sample = 0; sample < samples; sample++) {
      // Selection setup is outside measurement. At Fit scale these artificial
      // shorted tiles' Wire/flightline hit areas cover the bodies; the ordinary
      // copy gesture specs own physical hit-testing. Dispatch the existing
      // selection handler, then measure real keyboard and pointer input.
      await hits.first().dispatchEvent("click");
      await expect(hits.first()).toHaveClass(/selected/);
      await page.getByTestId("schematic-canvas").focus();
      const points = await page.evaluate(() => {
        const r = document
          .querySelector('[data-testid="schematic-canvas"]')!
          .getBoundingClientRect();
        let drop: { x: number; y: number } | undefined;
        for (const fx of [0.85, 0.65, 0.45, 0.3, 0.1])
          for (const fy of [0.85, 0.75, 0.55, 0.1]) {
            const x = r.x + r.width * fx,
              y = r.y + r.height * fy;
            const el = document.elementFromPoint(x, y);
            if (
              !drop &&
              el?.closest('[data-testid="schematic-canvas"]') &&
              !el.closest("[data-canvas-hit-kind]")
            )
              drop = { x, y };
          }
        return { drop };
      });
      if (!points.drop)
        throw new Error(`No unoccluded drop point: ${JSON.stringify(points)}`);
      // The ghost is pointer-local; keyboard focus alone does not establish a
      // canvas pointer position after file import.
      await page.mouse.move(points.drop.x, points.drop.y);
      await painted();
      const start = await painted();
      await page.keyboard.press("c");
      await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
      const ghost = await painted();
      await page.mouse.move(points.drop.x, points.drop.y);
      await painted();
      const beforeDrop = await painted();
      await page.mouse.click(points.drop.x, points.drop.y);
      await expect(hits).toHaveCount(originalCount + 1);
      await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
      const end = await painted();
      measurements.push(
        await page.evaluate(
          ({ start, ghost, beforeDrop, end }) => {
            const state = (
              window as unknown as {
                __copyPerf: {
                  tasks: { start: number; duration: number }[];
                  events: { kind: string; start: number }[];
                };
              }
            ).__copyPerf;
            const event = (kind: string, from: number) =>
              state.events.find(
                (event) => event.kind === kind && event.start >= from,
              )!.start;
            return {
              ghostMs: ghost - event("keydown", start),
              dropMs: end - event("pointerdown", beforeDrop),
              tasks: state.tasks.filter(
                (task) => task.start >= start && task.start <= end,
              ),
            };
          },
          { start, ghost, beforeDrop, end },
        ),
      );
      await page.keyboard.press("Escape");
      await page.keyboard.press("ControlOrMeta+z");
      await expect(hits).toHaveCount(originalCount);
      process.stdout.write(`copy sample ${sample + 1}/${samples} complete\n`);
    }
    expect(errors).toEqual([]);
    const warm = measurements.slice(1);
    const quantile = (key: "ghostMs" | "dropMs", fraction: number) => {
      const sorted = warm.map((item) => item[key]).sort((a, b) => a - b);
      return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
    };
    const report = {
      commit: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      browser: page.context().browser()?.version(),
      viewport: page.viewportSize(),
      source: projectPath ? basename(projectPath) : DENSE_COPY_COUNTS,
      originalCount,
      measurements,
      summary: {
        ghostMedianMs: quantile("ghostMs", 0.5),
        ghostP95Ms: quantile("ghostMs", 0.95),
        dropMedianMs: quantile("dropMs", 0.5),
        dropP95Ms: quantile("dropMs", 0.95),
      },
      note: "Production build; input-to-double-rAF includes assertion polling and the next copy ghost. Undo restores object count each sample; revisions/sequence advance. No timing gate or payload hashing.",
    };
    const dir = resolve(process.cwd(), "output/performance");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      resolve(dir, `editor-copy-${Date.now()}.json`),
      JSON.stringify(report, null, 2),
    );
    process.stdout.write(
      `\ncopy latency\n${JSON.stringify(report, null, 2)}\n`,
    );
  });

  test("records pan and drag frame cost", async ({ page }) => {
    test.setTimeout(180_000);

    await page.addInitScript(() => {
      const perf = {
        frames: [] as number[],
        longTasks: [] as { start: number; duration: number }[],
      };
      (window as unknown as { __icmPerf: typeof perf }).__icmPerf = perf;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          perf.longTasks.push({
            start: entry.startTime,
            duration: entry.duration,
          });
        }
      }).observe({ entryTypes: ["longtask"] });
      const tick = (timestamp: number) => {
        perf.frames.push(timestamp);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    // A real Project is the representative load; the generated fixture only
    // stands in when none is supplied. Point at one with
    // ICM_PERF_PROJECT=<path to .icproj.json>.
    const projectPath = process.env.ICM_PERF_PROJECT;
    const projectBytes = projectPath
      ? readFileSync(projectPath)
      : Buffer.from(JSON.stringify(createBrowserPerformanceProject()));
    await page.goto(`${origin}editor`);
    await page.getByTestId("project-file").setInputFiles({
      name: projectPath
        ? basename(projectPath)
        : "browser-performance.icproj.json",
      mimeType: "application/json",
      buffer: projectBytes,
    });
    await awaitEditorReady(page);
    // Let the import settle before measuring anything.
    await page.waitForTimeout(2000);

    const canvas = page.getByTestId("schematic-canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("schematic canvas has no box");

    // The move drag runs *before* the pan. An opened Project is auto-fitted, so
    // the content is on screen now; panning first moves the camera off it, and
    // the press would land on empty sheet. That is what this measured before,
    // and it was not a component drag at all.
    //
    // The press point is chosen by asking the page, not by taking the first
    // instance hit target: Routes sit above Instances in the hit order, so an
    // instance's own centre is often covered by a wire and a press there starts
    // a route drag instead. Walk the instance hit targets and take the first
    // whose centre the topmost hit element resolves back to an instance.
    const grab = await page.evaluate(() => {
      for (const element of document.querySelectorAll(
        '[data-canvas-hit-kind="instance"]',
      )) {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const x = rect.x + rect.width / 2;
        const y = rect.y + rect.height / 2;
        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight)
          continue;
        const top = document
          .elementFromPoint(x, y)
          ?.closest("[data-canvas-hit-kind]");
        if (top?.getAttribute("data-canvas-hit-kind") === "instance") {
          return { x, y, id: top.getAttribute("data-canvas-hit-id")! };
        }
      }
      return null;
    });
    if (!grab) {
      throw new Error("no instance is pressable without a Route on top of it");
    }

    const hit = page.getByTestId(`hit-${grab.id}`);
    const before = (await hit.boundingBox())!;
    const revision = page.getByTestId("revision");
    const beforeRevision = await revision.innerText();
    const painted = () =>
      page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            requestAnimationFrame(() =>
              requestAnimationFrame(() => resolve(performance.now())),
            );
          }),
      );
    const dragStart = await page.evaluate(() => performance.now());
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    // Past the drag session's start threshold, so the gesture is actually live.
    await page.mouse.move(grab.x + 24, grab.y + 12);
    // Set whenever an instance move preview exists, on both the imperative and
    // the rebuild path, so it proves the press picked up a component.
    await expect(canvas).toHaveClass(/semantic-move-preview/);
    for (let step = 2; step <= 30; step += 1) {
      await page.mouse.move(grab.x + step * 4, grab.y + step * 2);
    }
    const releaseStart = await page.evaluate(() => performance.now());
    await page.mouse.up();
    await expect(canvas).not.toHaveClass(/semantic-move-preview/);
    await expect(revision).not.toHaveText(beforeRevision);
    await expect
      .poll(async () => {
        const after = await hit.boundingBox();
        return after ? Math.hypot(after.x - before.x, after.y - before.y) : 0;
      })
      .toBeGreaterThan(1);
    const dragEnd = await painted();

    // Verify the measured operation was committed and remains undoable. Keep
    // this outside the drag window and wait for paint before starting pan.
    await page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(async () => {
        const restored = await hit.boundingBox();
        return restored
          ? Math.hypot(restored.x - before.x, restored.y - before.y)
          : Number.POSITIVE_INFINITY;
      })
      .toBeLessThan(0.5);
    await painted();

    // Pan from the same camera. A wheel over the sheet pans it.
    const panStart = await page.evaluate(() => performance.now());
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let step = 0; step < 40; step += 1) {
      await page.mouse.wheel(0, 40);
    }
    const panEnd = await painted();

    const collected = await page.evaluate(() => {
      const perf = (
        window as unknown as {
          __icmPerf: {
            frames: number[];
            longTasks: { start: number; duration: number }[];
          };
        }
      ).__icmPerf;
      return { frames: perf.frames, longTasks: perf.longTasks };
    });

    const windowStats = (from: number, to: number) => {
      const intervals: number[] = [];
      let previous: number | null = null;
      for (const frame of collected.frames) {
        if (frame < from || frame > to) continue;
        if (previous !== null) intervals.push(frame - previous);
        previous = frame;
      }
      intervals.sort((left, right) => left - right);
      const percentile = (fraction: number) =>
        intervals.length === 0
          ? 0
          : Math.round(
              (intervals[
                Math.min(
                  intervals.length - 1,
                  Math.floor(intervals.length * fraction),
                )
              ] ?? 0) * 100,
            ) / 100;
      const tasks = collected.longTasks.filter(
        (task) => task.start >= from && task.start <= to,
      );
      return {
        durationMs: Math.round((to - from) * 100) / 100,
        framesInWindow: intervals.length === 0 ? 0 : intervals.length + 1,
        frameIntervalP50Ms: percentile(0.5),
        frameIntervalP95Ms: percentile(0.95),
        frameIntervalMaxMs:
          intervals.length === 0
            ? 0
            : Math.round(intervals[intervals.length - 1]! * 100) / 100,
        // Anything past a 60 Hz budget plus slack is a visibly dropped frame.
        framesOver33Ms: intervals.filter((interval) => interval > 33).length,
        longTaskCount: tasks.length,
        longTaskTotalMs:
          Math.round(
            tasks.reduce((sum, task) => sum + task.duration, 0) * 100,
          ) / 100,
        longTaskMaxMs:
          Math.round(
            tasks.reduce((max, task) => Math.max(max, task.duration), 0) * 100,
          ) / 100,
      };
    };

    const report = {
      recordedAt: new Date().toISOString(),
      commit: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      dirty:
        execFileSync("git", ["status", "--porcelain"], {
          encoding: "utf8",
        }).trim().length > 0,
      projectSha256: createHash("sha256").update(projectBytes).digest("hex"),
      builtIndexSha256: createHash("sha256")
        .update(readFileSync("apps/editor/dist/index.html"))
        .digest("hex"),
      browserVersion: page.context().browser()?.version(),
      viewport: page.viewportSize(),
      draggedInstanceId: grab.id,
      source: projectPath ? basename(projectPath) : "generated fixture",
      ...(projectPath ? {} : { fixture: BROWSER_PERFORMANCE_COUNTS }),
      pan: windowStats(panStart, panEnd),
      drag: windowStats(dragStart, dragEnd),
      pointerDrag: windowStats(dragStart, releaseStart),
      releaseToPaint: windowStats(releaseStart, dragEnd),
      undoRestoredPosition: true,
      draggedWhat:
        "an instance whose hit target is topmost at its own centre, asserted to start a move preview",
      note: "Machine-dependent rAF frame intervals, not input latency. longTaskTotalMs sums entire long-task durations, not Total Blocking Time. releaseToPaint includes assertion polling. Compare only matched builds, inputs and machines; this harness now includes commit/paint verification and undoes before pan.",
    };

    const outputDir = resolve(process.cwd(), "output/performance");
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(
      resolve(
        outputDir,
        `editor-browser-${report.commit.slice(0, 8)}-${Date.now()}.json`,
      ),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    process.stdout.write(
      `\neditor browser latency\n${JSON.stringify(report, null, 2)}\n\n`,
    );

    // Gross-regression ceilings only. These are wide on purpose: the point of
    // this harness is the recorded artifact, not the threshold.
    expect(report.pan.frameIntervalMaxMs).toBeLessThan(500);
    expect(report.drag.longTaskMaxMs).toBeLessThan(2000);
  });
});
