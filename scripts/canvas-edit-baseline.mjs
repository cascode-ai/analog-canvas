// After pnpm build:
// node scripts/canvas-edit-baseline.mjs apps/editor/dist output/edits
// A deployed origin can replace the dist directory. ICM_EDIT_COUNTS=1 runs
// a separate instrumented arm; ICM_EDIT_REFERENCE compares saved content.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { chromium } from "@playwright/test";
import { preview } from "vite";
import { serializeProject } from "@icm/project-protocol";
import { buildProjectConnectivityIndex, deriveCrossings } from "@icm/derived";
import { createProjectSymbolResolver, builtInSymbols } from "@icm/symbols";
import {
  awaitTwoFrames,
  chooseComponent,
  clickDrawTool,
  exportedProject,
  openProjectFile,
} from "../apps/editor/e2e/editor-fixtures.ts";
import { createCanvasEditFixture } from "./lib/canvas-edit-fixture.mjs";
import { canvasPositions, sampleInputs } from "./lib/canvas-edit-input.mjs";
import { openEditorPage } from "./lib/scaling-browser.mjs";
import { sha256 } from "./lib/scaling-metrics.mjs";

const [build, directory] = process.argv.slice(2);
if (!build || !directory)
  throw Error(
    "Expected <built editor directory or origin> <evidence directory>",
  );
const sizes = (process.env.ICM_EDIT_SIZES ?? "16,2048,8192")
  .split(",")
  .map(Number);
const repetitions = Number(process.env.ICM_EDIT_REPS ?? 1);
for (const value of [...sizes, repetitions])
  assert.ok(Number.isSafeInteger(value) && value > 0);
const scenarios = {
  blank: [[-140, 0]],
  endpoint: [[50, -70]],
  interior: [[160, -40]],
  wire: [
    [0, -70],
    [0, 70],
  ],
  consecutive: [
    [0, -70],
    [140, -40],
    [140, -40],
    [0, 70],
  ],
};
const gestures =
  process.env.ICM_EDIT_GESTURES?.split(",") ?? Object.keys(scenarios);
for (const gesture of gestures) assert.ok(Object.hasOwn(scenarios, gesture));
const countWork = process.env.ICM_EDIT_COUNTS === "1";
const reference = process.env.ICM_EDIT_REFERENCE;
const server = /^https?:\/\//.test(build)
  ? undefined
  : await preview({
      root: resolve("apps/editor"),
      build: { outDir: resolve(build) },
      preview: { host: "127.0.0.1", port: 0 },
      logLevel: "silent",
    });
const origin = server?.resolvedUrls.local[0] ?? build;
const browser = await chromium.launch({
  channel: process.env.ICM_EDIT_BROWSER ?? "chrome",
});

function content(project) {
  return {
    ...project,
    structureRevision: 0,
    documents: project.documents.map((d) => ({ ...d, revision: 0 })),
  };
}
function checkEndpointOwners(before, after, gesture) {
  const owner = (id) => {
    const route = after.routes.find((r) => r.id === id);
    assert.ok(route?.netId, "missing route owner: " + id);
    return route.netId;
  };
  const landsAt = (route, id) =>
    [route.start, route.legs.at(-1).to.endpoint].some(
      (e) => e?.kind === "junction" && e.junctionId === id,
    );
  const bg = (d) => d.routes.filter((r) => r.id.startsWith("bg"));
  assert.deepEqual(bg(after), bg(before));
  if (gesture === "wire" || gesture === "consecutive") {
    assert.equal(owner("aR1"), owner("bR1"));
    assert.equal(
      after.nets.length,
      before.nets.length - (gesture === "wire" ? 1 : 2),
    );
    if (gesture === "consecutive") {
      const join = after.junctions.find(
        (j) => j.position.x === 140 && j.position.y === -40,
      );
      assert.ok(join, "second wire starts from newly split segment");
      assert.equal(join.netId, owner("bR1"));
      const incident = after.routes.filter((route) => landsAt(route, join.id));
      for (const end of ["a0", "b0"]) {
        assert.ok(
          incident.some((route) => landsAt(route, end)),
          "each drawn wire meets the split junction",
        );
      }
    }
  } else {
    assert.equal(after.instances.length, before.instances.length + 1);
    const mos = after.instances.find((i) => i.symbolId === "nmos");
    assert.ok(mos.netlist?.binding);
    const terminals = after.nets.flatMap((n) =>
      n.terminals
        .filter((t) => t.instanceId === mos.id)
        .map((t) => [t.pinName, n.id]),
    );
    assert.deepEqual(
      terminals,
      gesture === "blank"
        ? []
        : [
            [
              "G",
              gesture === "endpoint"
                ? owner("aright-arm")
                : after.junctions.find((j) => j.id === "left").netId,
            ],
          ],
    );
  }
}
// A receiving Net can acquire Routes or Junctions while its terminal row is unchanged.
function affectedNets(before, after) {
  const touched = new Set();
  for (const kind of ["nets", "routes", "junctions"]) {
    const rows = (p) =>
      new Map(p.documents[0][kind].map((row) => [row.id, row]));
    const old = rows(before),
      next = rows(after);
    for (const id of new Set([...old.keys(), ...next.keys()])) {
      const a = old.get(id),
        b = next.get(id);
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      for (const row of [a, b]) {
        if (!row) continue;
        touched.add(kind === "nets" ? row.id : row.netId);
        for (const m of row.members ?? []) touched.add(m.netId);
      }
    }
  }
  return [...touched].sort();
}
async function run(project, size, gesture, rep) {
  const runDir = join(directory, String(size), gesture, String(rep));
  await mkdir(runDir, { recursive: true });
  const { page, errors, close } = await openEditorPage(browser, origin);
  const file = (name, bytes) => writeFile(join(runDir, name), bytes);
  try {
    const raw = serializeProject(project);
    await openProjectFile(page, raw, "work.icproj.json");
    await page.waitForFunction(
      (name) =>
        document.querySelector('[data-testid="project-menu-toggle"]')?.title ===
        name,
      project.name,
    );
    await page.evaluate(() => document.fonts.ready);
    const before = await exportedProject(page);
    const points = await canvasPositions(page, scenarios[gesture]);
    const wire = gesture === "wire" || gesture === "consecutive";
    if (wire) {
      await clickDrawTool(page, "wire");
      const first = points.shift();
      await page.mouse.click(first.x, first.y);
    } else await chooseComponent(page, "nmos");
    await page.mouse.move(points[0].x, points[0].y);
    await awaitTwoFrames(page);
    const steps = gesture === "consecutive" ? 2 : 1;
    const sample = await sampleInputs(
      page,
      points,
      steps,
      countWork,
      steps === 2 ? scenarios.consecutive.at(-1) : undefined,
    );
    await page.keyboard.press("Escape");
    const after = await exportedProject(page);
    checkEndpointOwners(before.documents[0], after.documents[0], gesture);
    const states = { before, after };
    for (let i = steps - 1; i >= 0; i--) {
      await page.keyboard.press("Control+z");
      await awaitTwoFrames(page);
      const undo = await exportedProject(page);
      if (i === 0) assert.deepEqual(content(undo), content(before));
      else {
        const d = undo.documents[0],
          root = (id) => d.junctions.find((j) => j.id === id).netId;
        assert.equal(d.nets.length, before.documents[0].nets.length - 1);
        assert.equal(root("left"), root("a0"));
        assert.notEqual(root("a0"), root("b0"));
        states.first = undo;
      }
    }
    for (let i = 1; i <= steps; i++) {
      await page.keyboard.press("Control+Shift+z");
      await awaitTwoFrames(page);
      assert.deepEqual(
        content(await exportedProject(page)),
        content(i === steps ? after : states.first),
      );
    }
    const digests = {};
    for (const [key, state] of Object.entries(states)) {
      const bytes = serializeProject(content(state));
      digests[key] = sha256(bytes);
      await file(key + ".icproj.json", serializeProject(state));
      // Detached documents force the independent full computation even on a
      // build which reuses records between live editor commits.
      const snapshot = structuredClone(state);
      const resolver = createProjectSymbolResolver(snapshot, builtInSymbols);
      const document = snapshot.documents[0];
      const index = buildProjectConnectivityIndex(
        snapshot,
        resolver,
      ).documents.get(document.id);
      const ordered = JSON.stringify({
        crossings: deriveCrossings(document, resolver, index.routingGeometry),
        members: [...index.endpointToBaseNetId],
        nets: [...index.logicalNets],
      });
      digests[key + "Connectivity"] = sha256(ordered);
      await file(key + "-connectivity.json", ordered);
    }
    if (reference) {
      const prior = JSON.parse(
        await readFile(
          join(reference, String(size), gesture, "0", "sample.json"),
          "utf8",
        ),
      );
      assert.deepEqual(
        digests,
        prior.digests,
        "ordered full-file reference for every committed state",
      );
    }
    const entry = await page.evaluate(() =>
      Array.from(document.scripts, (s) => s.src).find(
        (url) => url && new URL(url).pathname.startsWith("/assets/"),
      ),
    );
    const entrySha256 = sha256(await (await page.request.get(entry)).body());
    assert.deepEqual(errors, []);
    const report = {
      size,
      gesture,
      rep,
      browser: browser.version(),
      build,
      entrySha256,
      countWork,
      inputSha256: sha256(raw),
      affectedNetIds:
        steps === 2
          ? [
              affectedNets(before, states.first),
              affectedNets(states.first, after),
            ]
          : [affectedNets(before, after)],
      digests,
      ...sample,
      timing: sample.commits.map((commit, i) => {
        const pointer = i === 0 ? 0 : 2;
        return {
          inputQueueMs:
            sample.inputs[pointer].handledMs - sample.inputs[pointer].eventMs,
          handledToDomMs: commit.domMs - sample.inputs[pointer].handledMs,
          handledToFrameMs:
            commit.frameRevision === commit.revision
              ? commit.frameMs - sample.inputs[pointer].handledMs
              : null,
          sentToFrameMs:
            commit.frameRevision === commit.revision
              ? commit.frameMs - sample.sent[pointer]
              : null,
        };
      }),
      ...(steps === 2
        ? {
            firstState: {
              source: "undo-second-wire",
              exportRevision: states.first.documents[0].revision,
              commitRevision: sample.commits[0].revision,
            },
            secondWire: {
              sourceQueueMs:
                sample.inputs[1].handledMs - sample.inputs[1].eventMs,
              hoverToObservedTargetMs:
                sample.secondSnapMs === undefined
                  ? null
                  : sample.secondSnapMs - sample.hoverSentMs,
              hoverToVerifiedCommitMs:
                sample.commits[1].domMs - sample.hoverSentMs,
              sourceSentToCommittedFrameMs:
                sample.commits[1].frameMs - sample.sent[1],
            },
          }
        : {}),
    };
    await file("sample.json", JSON.stringify(report, null, 2));
    console.log(
      size,
      gesture,
      rep,
      report.timing
        .map((t) =>
          t.sentToFrameMs === null ? "coalesced" : Math.round(t.sentToFrameMs),
        )
        .join("/"),
    );
  } finally {
    await close();
  }
}
try {
  for (const size of sizes) {
    const project = createCanvasEditFixture(size);
    await mkdir(join(directory, String(size)), { recursive: true });
    await writeFile(
      join(directory, String(size), "input.icproj.json"),
      serializeProject(project),
    );
    for (let rep = 0; rep < repetitions; rep++)
      for (const gesture of gestures) await run(project, size, gesture, rep);
  }
} finally {
  await browser.close();
  server?.httpServer.closeAllConnections();
  await server?.close();
}
