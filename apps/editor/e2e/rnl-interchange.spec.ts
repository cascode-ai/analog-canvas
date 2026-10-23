import { expect, test, type Page } from "@playwright/test";
import { compareElectricalGraphs, projectElectricalGraph } from "@icm/netlist";

import {
  exampleProject,
  expectStatus,
  exportedProject,
  openEditor,
  openMenu,
  openProject,
  showNetlistPanel,
} from "./editor-fixtures.js";
import { labelCensus, labelDifferences } from "./label-census.js";
import { bipolarProject } from "./bipolar-project.js";

test("loads the Canvas package once for both RNL formats", async ({ page }) => {
  await page.route("https://rich-netlist.github.io/rnl-packages/**", (route) =>
    route.abort(),
  );
  const requested: string[] = [];
  page.on("request", (request) => {
    if (/analog-canvas-extensions[^/]*\.rnl/u.test(request.url()))
      requested.push(request.url());
  });
  const project = bipolarProject();
  const document = project.documents[0]!;
  document.instances.push({
    id: "E1",
    reference: "E1",
    symbolId: "vcvs",
    placement: { position: { x: 800, y: 100 }, rotation: 0, mirror: "none" },
    netlist: {
      binding: { kind: "primitive", deviceClass: "vcvs" },
      parameters: { gain: "2" },
      control: {
        kind: "voltage",
        positiveNetId: "bias",
        negativeNetId: "tail",
      },
    },
  });
  document.nets
    .find((net) => net.id === "out")!
    .terminals.push({ instanceId: "E1", pinName: "+" });
  document.nets
    .find((net) => net.id === "tail")!
    .terminals.push({ instanceId: "E1", pinName: "-" });
  await openProject(page, project);
  let rich = "";
  for (const mode of ["spice+rnl", "spectre+rnl"] as const) {
    const text = await copiedNetlist(page, mode);
    rich = text;
    expect(text).toContain(
      '@USE-PACKAGE(name="analog-canvas-extensions", version="0.1")',
    );
    expect(text).toContain("$CANVAS_VCVS_CIRCLE");
    await expect(
      page.getByTestId("rnl-findings").locator(".rnl-finding-error"),
    ).toHaveCount(0);
  }
  const before = projectElectricalGraph(await exportedProject(page));
  await page.getByTestId("rnl-files").setInputFiles({
    name: "canvas.scs",
    mimeType: "text/plain",
    buffer: Buffer.from(rich),
  });
  const unsaved = page.getByRole("dialog", { name: "Unsaved changes" });
  const ready = page
    .getByTestId("status")
    .filter({ hasText: /^Imported \d+ Documents?/u });
  await expect(unsaved.or(ready)).toBeVisible();
  if (await unsaved.isVisible())
    await unsaved
      .getByRole("button", { name: "Continue without saving" })
      .click();
  await expectStatus(page, /^Imported \d+ Documents?/u);
  const imported: typeof project = await exportedProject(page);
  const vcvs = imported.documents
    .flatMap((document) => document.instances)
    .find((instance) => instance.reference === "E1");
  expect(vcvs?.symbolId).toBe("vcvs");
  expect(vcvs?.symbolVariantId).not.toBe("diamond");
  expect(vcvs?.placement).toEqual(
    document.instances.find((instance) => instance.id === "E1")!.placement,
  );
  const after = projectElectricalGraph(imported);
  expect(before.status).toBe("ready");
  expect(after.status).toBe("ready");
  if (before.status === "ready" && after.status === "ready")
    expect(compareElectricalGraphs(before.graph, after.graph)).toBe("equal");
  expect(requested).toHaveLength(1);
  expect(new URL(requested[0]!).origin).toBe(new URL(page.url()).origin);
});

test("reports a failed Canvas package fetch and retries on the next request", async ({
  page,
}) => {
  const pattern = "**/*analog-canvas-extensions*.rnl*";
  await page.route(pattern, (route) =>
    route.fulfill({ status: 503, body: "package unavailable" }),
  );
  await openProject(page, exampleProject("two-stage-op-amp.icproj.json"));
  const panel = await showNetlistPanel(page);
  await panel.getByLabel("Netlist format").selectOption("spice+rnl");
  await expect(
    panel.getByText(/RNL Canvas package could not load.*HTTP 503/u),
  ).toBeVisible();
  await page.unroute(pattern);
  await panel.getByLabel("Netlist format").selectOption("spice");
  expect(await copiedNetlist(page, "spice+rnl")).toContain(
    '@RNL(type="header")',
  );
});

test("rejects changed Canvas package bytes and retries with the locked asset", async ({
  page,
}) => {
  const pattern = "**/*analog-canvas-extensions*.rnl*";
  await page.route(pattern, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: Buffer.concat([await response.body(), Buffer.from("\n")]),
    });
  });
  await openProject(page, bipolarProject());
  const panel = await showNetlistPanel(page);
  await panel.getByLabel("Netlist format").selectOption("spice+rnl");
  await expect(
    panel.getByText(/Canvas package SHA-256 mismatch/u),
  ).toBeVisible();
  await page.unroute(pattern);
  await panel.getByLabel("Netlist format").selectOption("spice");
  expect(await copiedNetlist(page, "spice+rnl")).toContain(
    '@RNL(type="header")',
  );
});

for (const mode of ["spice+rnl", "spectre+rnl"] as const)
  test(`imports bipolar devices, a diode and mirrored labels from ${mode}`, async ({
    page,
  }) => {
    const project = bipolarProject();
    await openProject(page, project);
    const drawn = await exportedProject(page);
    const text = await copiedNetlist(page, mode);
    await page.getByTestId("rnl-files").setInputFiles({
      name: `bipolar.${mode === "spice+rnl" ? "sp" : "scs"}`,
      mimeType: "text/plain",
      buffer: Buffer.from(text),
    });
    const unsaved = page.getByRole("dialog", { name: "Unsaved changes" });
    const imported = page
      .getByTestId("status")
      .filter({ hasText: /^Imported \d+ Documents?/u });
    await expect(unsaved.or(imported)).toBeVisible();
    if (await unsaved.isVisible())
      await unsaved
        .getByRole("button", { name: "Continue without saving" })
        .click();
    await expectStatus(page, /^Imported \d+ Documents?/u);
    const read = await exportedProject(page);
    expect(drawingCensus(read)).toEqual(drawingCensus(drawn));
    const before = projectElectricalGraph(drawn);
    const after = projectElectricalGraph(read);
    expect(before.status).toBe("ready");
    expect(after.status).toBe("ready");
    if (before.status === "ready" && after.status === "ready")
      expect(compareElectricalGraphs(before.graph, after.graph)).toBe("equal");
    expect(labelDifferences(labelCensus(drawn), labelCensus(read))).toEqual([]);
  });

/**
 * A netlist as the Netlist panel's Copy hands it out, in one of its formats,
 * an RNL one once the rnl runtime has written it in its Worker: the text a
 * reader pastes into a file and imports again. (In a browser the panel
 * copies; only the desktop app saves.) The page's clipboard is a stand-in
 * that keeps what is written, since only Chrome lets a test read the real
 * one; it takes text and a ClipboardItem alike, as the editor writes both.
 */
async function copiedNetlist(
  page: Page,
  mode: "spice" | "spectre" | "spice+rnl" | "spectre+rnl",
): Promise<string> {
  await page.evaluate(() => {
    const copied: string[] = [];
    Object.defineProperty(window, "__copied", {
      value: copied,
      configurable: true,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => void copied.push(text),
        write: async (items: ClipboardItem[]) => {
          for (const item of items)
            copied.push(await (await item.getType("text/plain")).text());
        },
      },
    });
  });
  const panel = await showNetlistPanel(page);
  await panel.getByLabel("Netlist format").selectOption(mode);
  if (mode.endsWith("+rnl"))
    await expect(
      panel.getByRole("textbox", { name: "RNL netlist code", exact: true }),
    ).toBeVisible();
  await panel.getByTestId("copy-netlist-panel").click();
  const read = () =>
    page.evaluate(
      () => (window as unknown as { __copied: string[] }).__copied.at(-1) ?? "",
    );
  await expect.poll(read).not.toBe("");
  return (await read()).replace(/\r\n?/gu, "\n");
}

// docs/specs/rnl-interchange.md: the RNL formats the rnl runtime writes in
// its Worker, and File > Import > RNL… reading what they wrote.
test("writes SPICE+RNL and Spectre+RNL, and imports the file it wrote as it was drawn", async ({
  page,
}) => {
  const project = exampleProject("two-stage-op-amp.icproj.json");
  await openProject(page, project);
  const spice = await copiedNetlist(page, "spice");

  const rich = await copiedNetlist(page, "spice+rnl");
  expect(rich).toContain('* @RNL(type="header")');
  expect(rich).toContain(
    '@USE-PACKAGE(name="rnl-std-functional", version="0.3")',
  );
  expect(rich).toMatch(/#X1 @SET-SYMBOL \$OPAMP_5TERM/u);
  // The netlist it carries is the plain one, the op-amp's body printed in
  // the port order of its RNL symbol.
  expect(rich).toMatch(/^X1 Vin Vout 0 VSS net0 opamp$/mu);
  const spectre = await copiedNetlist(page, "spectre+rnl");
  expect(spectre).toMatch(/^\/\/ @RNL\(type="header"\)/mu);
  expect(spectre).toMatch(/^X1 \(Vin Vout 0 VSS net0\) opamp$/mu);

  await page.getByTestId("rnl-files").setInputFiles({
    name: "two-stage-op-amp.sp",
    mimeType: "text/plain",
    buffer: Buffer.from(rich),
  });
  // The opened example has never been saved, so the import asks first.
  await page
    .getByRole("dialog", { name: "Unsaved changes" })
    .getByRole("button", { name: "Continue without saving" })
    .click();
  await expectStatus(page, /^Imported 1 Document/u);
  // Every part where it was drawn, the op-amp and amplifier as built-in
  // blocks again, and the plain netlist the same.
  const imported = await exportedProject(page);
  const placement = (from: typeof project, reference: string) =>
    from.documents
      .flatMap((document) => document.instances)
      .find((instance) => instance.reference === reference)?.placement
      ?.position;
  for (const reference of ["X1", "X2", "CC", "CL"])
    expect(placement(imported, reference), reference).toEqual(
      placement(project, reference),
    );
  expect(
    imported.documents
      .flatMap(
        (document: (typeof project.documents)[number]) => document.instances,
      )
      .filter((instance: { reference?: string }) =>
        ["X1", "X2"].includes(instance.reference ?? ""),
      )
      .map((instance: { symbolId: string }) => instance.symbolId)
      .sort(),
  ).toEqual(["opamp-inputs-swapped", "voltage-amplifier"]);
  expect(await copiedNetlist(page, "spice")).toBe(spice);
});

// File > Export > Netlist saves what the panel shows, and the RNL formats are
// among them: the file is the RNL text, named for its dialect.
test("File > Export > Netlist saves SPICE+RNL and Spectre+RNL as they are shown", async ({
  page,
}) => {
  await openEditor(page, "/editor?example=two-stage-op-amp");
  const panel = await showNetlistPanel(page);
  for (const [mode, extension, header] of [
    ["spice+rnl", ".spi", '* @RNL(type="header")'],
    ["spectre+rnl", ".scs", '// @RNL(type="header")'],
  ] as const) {
    await panel.getByLabel("Netlist format").selectOption(mode);
    await expect(
      panel.getByRole("textbox", { name: "RNL netlist code", exact: true }),
    ).toBeVisible();
    const details = await openMenu(page, "File");
    const group = details.getByRole("button", { name: "Export", exact: true });
    if ((await group.getAttribute("aria-expanded")) !== "true")
      await group.click();
    const item = details.getByRole("button", {
      name: "Export Netlist",
      exact: true,
    });
    await expect(item).toHaveText("Netlist…");
    const download = page.waitForEvent("download");
    await item.click();
    const file = await download;
    const chunks: Buffer[] = [];
    for await (const chunk of await file.createReadStream())
      chunks.push(Buffer.from(chunk));
    expect(file.suggestedFilename().endsWith(extension)).toBe(true);
    expect(Buffer.concat(chunks).toString("utf8")).toContain(header);
  }
});

// The RNL formats say what RNL is: a link to its introduction, in a new tab.
test("links the RNL formats to the introduction to RNL, and only them", async ({
  page,
}) => {
  const introduction = "https://rich-netlist.github.io/rnl/en/";
  // The page itself is not this test's business: answer it from here.
  await page.context().route("https://rich-netlist.github.io/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<title>RNL</title><p>About RNL</p>",
    }),
  );
  await openEditor(page, "/editor?example=two-stage-op-amp");
  const panel = await showNetlistPanel(page);
  const about = panel.getByRole("link", { name: /^About RNL/u });
  const viewer = panel.getByRole("link", { name: /^Open RNL Viewer/u });
  for (const plain of ["spice", "spectre"] as const) {
    await panel.getByLabel("Netlist format").selectOption(plain);
    await expect(about).toHaveCount(0);
    await expect(viewer).toHaveCount(0);
  }
  for (const mode of ["spice+rnl", "spectre+rnl"] as const) {
    await panel.getByLabel("Netlist format").selectOption(mode);
    await expect(about).toBeVisible();
    await expect(about).toHaveAttribute("href", introduction);
    await expect(about).toHaveAttribute("target", "_blank");
    await expect(about).toHaveAttribute("rel", /noopener/u);
    await expect(viewer).toBeVisible();
    await expect(viewer).toBeEnabled();
    await expect(about.locator("..")).toHaveText(/About RNL.*Open RNL Viewer/u);
  }
  const opened = page.context().waitForEvent("page");
  await about.click();
  const tab = await opened;
  await tab.waitForLoadState("domcontentloaded");
  expect(tab.url()).toBe(introduction);
  // The drawing stays open here.
  await expect(page.getByTestId("schematic-canvas")).toBeVisible();
});

test("opens both current RNL exports and the Canvas package in one reusable Viewer tab", async ({
  page,
  browserName,
}) => {
  const viewerUrl = "https://rich-netlist.github.io/rnl/viewer/";
  const candidate = process.env.RNL_VIEWER_TEST_URL;
  await page.context().route(`${viewerUrl}**`, async (route) => {
    const requested = route.request().url();
    if (candidate) {
      const suffix = requested.slice(viewerUrl.length);
      if (suffix.startsWith("fonts/")) {
        await route.continue();
        return;
      }
      const response = await route.fetch({
        url: `${candidate.replace(/\/$/u, "")}/${suffix}`,
      });
      await route.fulfill({ response });
    } else if (requested.endsWith("viewer-api.json")) {
      await route.fulfill({
        json: { rnl: 1, features: ["requestId", "packages", "opener"] },
        headers: { "access-control-allow-origin": "*" },
      });
    } else {
      // The external Viewer is isolated at its public postMessage boundary in AC's suite.
      await route.fulfill({
        contentType: "text/html",
        body: `<title>RNL Viewer</title><script>
        const params=new URLSearchParams(location.search), token=params.get('token'), origin=params.get('origin');
        window.imports=[];
        addEventListener('message', event=>{
          if(event.source!==opener || event.origin!==origin || event.data?.token!==token || event.data?.rnl!==1) return;
          imports.push(event.data);
          opener.postMessage({rnl:1,token,type:'loaded',requestId:event.data.requestId},origin);
        });
        opener.postMessage({rnl:1,token,type:'ready',features:['requestId','packages','opener']},origin);
      </script>`,
      });
    }
  });
  await openEditor(page, "/editor?example=two-stage-op-amp");
  let viewer: Page | undefined;
  for (const mode of ["spice+rnl", "spectre+rnl"] as const) {
    const expected = await copiedNetlist(page, mode);
    const link = page.getByRole("link", { name: /^Open RNL Viewer/u });
    await expect(link).toBeEnabled();
    const opened = viewer ? null : page.waitForEvent("popup");
    await link.click();
    viewer ??= await opened!;
    await expect(link).toBeEnabled();
    if (candidate) {
      await expect
        .poll(() =>
          viewer!.evaluate(() => {
            const state = (
              window as unknown as {
                viewer: { doc: { files: { text: string }[] } | null };
              }
            ).viewer;
            return state.doc?.files[0]?.text;
          }),
        )
        .toBe(expected);
      await expect(viewer.locator("#canvas > svg")).toBeVisible();
      await viewer.locator("#tab-files").click();
      await expect(
        viewer.getByRole("button", {
          name: "Open analog-canvas-extensions 0.1",
          exact: true,
        }),
      ).toBeVisible();
      await viewer.locator("#tab-netlist").click();
    } else {
      const imported = await viewer.evaluate(() =>
        (
          window as unknown as { imports: Record<string, unknown>[] }
        ).imports.at(-1),
      );
      expect(imported).toMatchObject({
        type: "open",
        name: mode === "spice+rnl" ? "circuit.sp" : "circuit.scs",
        text: expected,
        packages: [{ name: "analog-canvas-extensions", version: "0.1" }],
      });
    }
    expect(page.context().pages()).toHaveLength(2);
    expect(viewer.url()).not.toContain(encodeURIComponent(expected));
  }
  if (browserName === "chromium") {
    await page.bringToFront();
    await page.screenshot({ path: "test-results/rnl-viewer-link.png" });
    if (candidate) {
      await viewer!.bringToFront();
      await viewer!.screenshot({
        path: "test-results/rnl-viewer-imported.png",
      });
    }
  }
  await expect(page.getByTestId("schematic-canvas")).toBeVisible();
});

interface CensusProject {
  documents: {
    name: string;
    netlist?: { name: string };
    instances: { id: string; symbolId: string }[];
    junctions: unknown[];
    annotations: { kind: string }[];
    routes: {
      presentation?: string;
      start: { kind: string; instanceId?: string; pinName?: string };
      legs: {
        to:
          | {
              kind: "endpoint";
              endpoint: { kind: string; instanceId?: string; pinName?: string };
            }
          | { kind: string };
      }[];
    }[];
  }[];
}

/**
 * What a drawing must keep through RNL, Cell by Cell: its parts by kind (the
 * two op-amp variants RNL draws alike count as one), its junctions, the pins
 * its wires reach by part kind and pin, its wires by how they are drawn, and
 * its net and power labels.
 */
function drawingCensus(project: CensusProject) {
  const kind = (symbolId: string) =>
    symbolId === "opamp-inputs-swapped" ? "opamp" : symbolId;
  const tally = (keys: readonly string[]) => {
    const counts = new Map<string, number>();
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
    return [...counts].sort().map(([key, count]) => `${key}:${count}`);
  };
  return Object.fromEntries(
    project.documents.map((document) => {
      const symbolOf = new Map(
        document.instances.map((instance) => [
          instance.id,
          kind(instance.symbolId),
        ]),
      );
      const reached = document.routes.flatMap((route) =>
        [
          route.start,
          ...route.legs.flatMap((leg) =>
            "endpoint" in leg.to ? [leg.to.endpoint] : [],
          ),
        ].flatMap((endpoint) =>
          endpoint.kind === "terminal"
            ? [`${symbolOf.get(endpoint.instanceId!)}.${endpoint.pinName}`]
            : [],
        ),
      );
      return [
        (document.netlist?.name ?? document.name).toLowerCase(),
        {
          parts: tally(
            document.instances.map((instance) => kind(instance.symbolId)),
          ),
          junctions: document.junctions.length,
          wiredPins: tally(reached),
          // Each wire as drawn, a power rail as a rail and a body tie dashed;
          // a wire through a junction stays one wire.
          wires: tally(
            document.routes.map((route) => route.presentation ?? "wire"),
          ),
          // A power label stays a power label, not a net label.
          labels: tally(
            document.annotations
              .filter(
                (annotation) =>
                  annotation.kind === "net-label" ||
                  annotation.kind === "power-label",
              )
              .map((annotation) => annotation.kind),
          ),
        },
      ];
    }),
  );
}

// The path a reader takes: an example opened from the library (its devices
// bound to the default process), switched to another process in the Netlist
// panel, its RNL copied from the panel, and that file imported again. One
// multi-Cell example carries this GUI wiring; rnl-round-trip.test.ts brings
// every library example back under each process and format, including this
// switch, with the same census and label checks.
test("brings five-transistor-ota-sky130 (abstract) back through spectre+rnl with every part, ground, wire and label", async ({
  page,
}) => {
  await openEditor(page, "/editor?example=five-transistor-ota-sky130");
  await expectStatus(page, /^Opened example:/u);
  const panel = await showNetlistPanel(page);
  await panel.getByLabel("Netlist process").selectOption("abstract");
  const drawn = await exportedProject(page);
  const text = await copiedNetlist(page, "spectre+rnl");
  await page.getByTestId("rnl-files").setInputFiles({
    name: "five-transistor-ota-sky130.scs",
    mimeType: "text/plain",
    buffer: Buffer.from(text),
  });
  // An example the reader changed asks before the import replaces it.
  const unsaved = page.getByRole("dialog", { name: "Unsaved changes" });
  const imported = page
    .getByTestId("status")
    .filter({ hasText: /^Imported \d+ Documents?/u });
  await expect(unsaved.or(imported)).toBeVisible();
  if (await unsaved.isVisible())
    await unsaved
      .getByRole("button", { name: "Continue without saving" })
      .click();
  await expectStatus(page, /^Imported \d+ Documents?/u);
  const read = await exportedProject(page);
  // Each Cell the file carries is drawn as it was: parts, junctions,
  // wired pins, wires and net and power labels counted ...
  const was = drawingCensus(drawn);
  const now = drawingCensus(read);
  expect(Object.keys(now).length).toBeGreaterThan(0);
  for (const [cell, census] of Object.entries(now))
    for (const item of [
      "parts",
      "junctions",
      "wiredPins",
      "wires",
      "labels",
    ] as const)
      expect(census[item], `${cell} ${item}`).toEqual(was[cell]?.[item]);
  // ... and every label of them, where it was, as big, with its text
  // and none twice, including source values and decoded net names.
  expect(labelDifferences(labelCensus(drawn), labelCensus(read))).toEqual([]);
});
