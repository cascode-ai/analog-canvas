import assert from "node:assert/strict";
import { sampleCount, sha256 } from "./scaling-metrics.mjs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { productModule, sharedSupply } from "./scaling-model.mjs";
import { browserContext } from "./scaling-browser.mjs";

function svgDrawing(page, bytes) {
  return page.evaluate((text) => {
    const document = new DOMParser().parseFromString(text, "image/svg+xml");
    if (document.querySelector("parsererror"))
      throw Error("Invalid exported SVG");
    const root = document.documentElement;
    return {
      viewBox: root
        .getAttribute("viewBox")
        .trim()
        .split(/[\s,]+/u)
        .map(Number),
      ids: [...root.querySelectorAll("[data-object-id]")].map((element) =>
        element.getAttribute("data-object-id"),
      ),
      overlay: !!root.querySelector(
        '[data-canvas-hit-kind],[data-layer="editor-overlay"],[data-testid="net-highlight-overlay"]',
      ),
    };
  }, bytes.toString("utf8"));
}

function rasterSignature(PNG, bytes, viewBox, selected) {
  const { width, height, data } = PNG.sync.read(bytes);
  assert.equal(width, Math.round(viewBox[2] * 3), "3× raster width");
  assert.equal(height, Math.round(viewBox[3] * 3), "3× raster height");
  assert.equal(data[3], selected ? 0 : 255, "Background alpha");
  assert.ok(
    data.some(
      (value, offset) =>
        offset % 4 === 0 && value < 200 && data[offset + 3] > 0,
    ),
    "Drawing contains visible ink",
  );
  return { width, height, pixelsSha256: sha256(data) };
}

function pdfSignature(bytes) {
  const raw = bytes.toString("latin1");
  assert.match(raw, /^%PDF-/u);
  assert.match(raw, /\/Type\s+\/Font\b/u);
  assert.match(raw, /\/Type\s+\/Page\b/u);
  assert.doesNotMatch(raw, /\/Subtype\s+\/Image\b/u, "PDF must remain vector");
  const id = /\/ID\s*\[\s*<([\da-f]{32})>\s*<\1>\s*\]/iu;
  assert.match(raw, id, "Expected a jsPDF document ID");
  const normalized = raw.replace(id, (field) =>
    field.replace(/<[\da-f]{32}>/giu, "<" + "0".repeat(32) + ">"),
  );
  return {
    bytes: bytes.length,
    vectorSha256: sha256(Buffer.from(normalized, "latin1")),
  };
}

async function fullDrawing(page, host, top, PNG) {
  const svgBytes = await host.downloadBytes(page, "File", "Export SVG");
  const svg = await svgDrawing(page, svgBytes);
  assert.equal(svg.overlay, false);
  const ids = new Set(svg.ids);
  for (const item of [...top.instances, ...top.routes])
    assert.ok(ids.has(item.id), "Missing formal object " + item.id);
  const png = await host.downloadBytes(page, "File", "Export PNG");
  const pdf = await host.downloadBytes(page, "File", "Export PDF");
  return {
    svg: {
      sha256: sha256(svgBytes),
      viewBox: svg.viewBox,
      orderedObjects: svg.ids,
    },
    png: rasterSignature(PNG, png, svg.viewBox, false),
    pdf: pdfSignature(pdf),
  };
}

async function selectedDrawing(page, host, top, PNG) {
  const selectedId = "M1";
  const hit = page
    .locator('[data-canvas-hit-kind="instance"][data-canvas-hit-id="M1"]')
    .first();
  await hit.click();
  assert.match(await hit.getAttribute("class"), /\bselected\b/u);
  async function copy(format, mime) {
    await host.clickCommand(page, "Edit", "Copy selection as " + format);
    await host.expectStatus(page, "Copied selection as " + format);
    const data = await page.evaluate(async (type) => {
      const [item] = await navigator.clipboard.read();
      const blob = await item.getType(type);
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    }, mime);
    return Buffer.from(data);
  }
  const bytes = await copy("SVG", "image/svg+xml");
  const svg = await svgDrawing(page, bytes);
  assert.equal(svg.overlay, false);
  const selectedIds = new Set(svg.ids);
  assert.deepEqual(
    top.instances
      .filter((item) => selectedIds.has(item.id))
      .map((item) => item.id),
    [selectedId],
  );
  assert.ok(
    top.routes.every(({ id }) => !selectedIds.has(id)),
    "Selection contains unrelated wires",
  );
  assert.ok(selectedIds.has("instance-label-M1"), "Selected transistor label");
  return {
    svg: {
      sha256: sha256(bytes),
      viewBox: svg.viewBox,
      orderedObjects: svg.ids,
    },
    png: rasterSignature(
      PNG,
      await copy("PNG", "image/png"),
      svg.viewBox,
      true,
    ),
  };
}

async function exampleSignatures(page, host, checkout, project) {
  const top = project.documents.find(({ id }) => id === project.topDocumentId);
  const require = createRequire(join(checkout, "package.json"));
  const { PNG } = require("pngjs");
  const { parseProject } = await productModule(checkout, "project-protocol");
  const file = await host.downloadBytes(page, "File", "Export Project File…");
  const saved = parseProject(file.toString("utf8"));
  assert.deepEqual(
    saved,
    project,
    "Canonical saved Project should match the imported Project",
  );
  const panel = await host.showNetlistPanel(page);
  const netlists = {};
  for (const format of ["spice", "spectre"]) {
    await panel.getByLabel("Netlist format").selectOption(format);
    const bytes = await host.downloadBytes(page, "File", "Export Netlist");
    const text = bytes.toString("utf8").replaceAll("\r\n", "\n");
    assert.deepEqual(
      [...text.matchAll(/^(M\d+)\s/gmu)].map((match) => match[1]),
      ["M1", "M2", "M3", "M4", "M5"],
    );
    assert.match(
      text,
      format === "spectre"
        ? /^subckt dut \(VDD VSS Vin Vout Vip VB\)/mu
        : /^\.subckt dut VDD VSS Vin Vout Vip VB$/mu,
    );
    assert.match(text, /nch_ulvt_mac/u);
    netlists[format] = sha256(bytes);
  }
  await host.closeProjectTools(page);
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.focus();
  await page.keyboard.press("f");
  await host.awaitTwoFrames(page);
  const full = await fullDrawing(page, host, top, PNG);
  const fitted = await canvas.getAttribute("viewBox");
  for (let step = 0; step < 6; step++) {
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  }
  await host.awaitTwoFrames(page);
  assert.ok(
    Number((await canvas.getAttribute("viewBox")).split(" ")[2]) <
      Number(fitted.split(" ")[2]) * 0.65,
    "Local viewport attained",
  );
  const local = await fullDrawing(page, host, top, PNG);
  assert.deepEqual(
    local,
    full,
    "Local-viewport export must still contain the whole drawing",
  );
  await canvas.focus();
  await page.keyboard.press("f");
  await host.awaitTwoFrames(page);
  const selection = await selectedDrawing(page, host, top, PNG);
  assert.ok(selection.svg.viewBox[2] < full.svg.viewBox[2]);
  assert.ok(selection.svg.viewBox[3] < full.svg.viewBox[3]);
  return { canonicalProject: sha256(file), netlists, full, local, selection };
}

async function sharedSupplySignatures(page, url, host, checkout, project) {
  const { AgentHttpClient } = await productModule(checkout, "agent-client");
  const { traceHierarchyNet } = await productModule(checkout, "derived");
  const { index, top } = await sharedSupply(checkout, project);
  const trace = () => traceHierarchyNet(index, top.documentId, top.netId);
  const expected = trace();
  const fullTraceModel = [],
    fullTraceAgent = [];
  for (let i = 0; i < sampleCount.edit; i++) {
    const start = performance.now();
    const detail = trace();
    fullTraceModel.push(performance.now() - start);
    assert.deepEqual(
      detail,
      expected,
      "Full model trace must preserve every ordered path",
    );
  }
  const button = page.getByTestId("open-agent");
  assert.ok(
    await button.count(),
    "Rebuild the production editor with VITE_ICM_AGENT_UI=enabled (hosted deployment setting)",
  );
  await button.click();
  const panel = page.getByTestId("connect-agent-panel");
  const { claimCode } = await host.readAgentClaim(panel);
  const client = new AgentHttpClient({ baseUrl: new URL(url).origin });
  const { sessionId, agentToken } = await client.claim(claimCode);
  await panel.waitFor({ state: "hidden" });
  const requestTrace = (i) =>
    client.circuit(sessionId, agentToken, {
      apiVersion: "3.0",
      requestId: "bench-vdd-" + i,
      operation: "snapshot",
      documentId: top.documentId,
      traceNet: { netId: top.netId },
    });
  const response = await requestTrace("warmup");
  for (let i = 0; i < sampleCount.edit; i++) {
    const start = performance.now();
    const measured = await requestTrace(i);
    fullTraceAgent.push(performance.now() - start);
    assert.ok(measured.ok, JSON.stringify(measured.error));
    assert.deepEqual(measured.trace, response.trace);
  }
  assert.ok(response.ok, JSON.stringify(response.error));
  assert.equal(response.snapshot.document.id, project.topDocumentId);
  const { highlights, hops } = response.trace;
  assert.equal(highlights.length, 129);
  assert.equal(hops.length, 16_512);
  const key = (net) =>
    JSON.stringify([
      net.documentId,
      net.netId,
      net.hierarchyPath.map(({ instanceId }) => instanceId),
    ]);
  const positions = new Set(highlights.map(key));
  assert.equal(positions.size, 129);
  const paths = highlights.map((net) =>
    net.hierarchyPath.map(({ instanceId }) => instanceId).join("/"),
  );
  assert.deepEqual(
    new Set(paths),
    new Set(["", ...Array.from({ length: 128 }, (_, i) => "X" + (i + 1))]),
  );
  const pairs = new Set();
  for (const hop of hops) {
    assert.equal(hop.direction, "global");
    assert.equal(hop.foldedName, "vdd");
    const from = key(hop.from),
      to = key(hop.to);
    assert.ok(
      positions.has(from) && positions.has(to) && from !== to,
      "Directed VDD endpoints",
    );
    pairs.add(JSON.stringify([from, to]));
  }
  assert.equal(pairs.size, 129 * 128, "Every ordered pair occurs exactly once");
  const projected = expected.highlights.map(
    ({
      documentId,
      netId,
      hierarchyPath,
      routes,
      junctions,
      visibleEndpoints,
    }) => ({
      documentId,
      netId,
      hierarchyPath,
      routes,
      junctions,
      visibleEndpoints,
    }),
  );
  assert.deepEqual(
    highlights,
    projected,
    "Ordered highlights and their full endpoint geometry",
  );
  assert.deepEqual(
    hops,
    expected.hops,
    "Ordered global paths with all hierarchy frames",
  );
  return {
    metrics: { fullTraceModel, fullTraceAgent },
    signatures: {
      snapshotSha256: sha256(JSON.stringify(response.snapshot)),
      snapshotRevision: response.revision,
      diagnosticsSha256: sha256(JSON.stringify(response.diagnostics)),
      highlights: highlights.length,
      directedHops: hops.length,
      highlightsSha256: sha256(JSON.stringify(highlights)),
      hopsSha256: sha256(JSON.stringify(hops)),
    },
  };
}

export async function contractSignatures({
  checkout,
  browser,
  url,
  file,
  name,
  project,
}) {
  const host = await import("../../apps/editor/e2e/editor-fixtures.ts");
  const context = await browser.newContext({ ...browserContext, baseURL: url });
  try {
    const page = await context.newPage();
    await host.openEditor(page);

    await host.openProjectFile(page, await readFile(file, "utf8"));
    await page.waitForFunction(
      (name) =>
        document.querySelector('[data-testid="project-menu-toggle"]')?.title ===
        name,
      project.name,
    );
    if (name === "high-fanout")
      return await sharedSupplySignatures(page, url, host, checkout, project);
    assert.equal(name, "five-transistor-ota");
    return {
      metrics: {},
      signatures: await exampleSignatures(page, host, checkout, project),
    };
  } finally {
    await context.close();
  }
}
