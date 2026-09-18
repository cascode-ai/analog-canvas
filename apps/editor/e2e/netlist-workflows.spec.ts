import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { createEmptyProject } from "@icm/model";
import {
  awaitEditorReady,
  clickCommand,
  downloadBytes,
  copyNetlistText,
  expectComponentCodeField,
  openMenu,
} from "./editor-fixtures.js";
import {
  placeComponent,
  openSelectionShelf,
} from "./manual-editor-fixtures.js";

function pdfTextRuns(pdf: Buffer): PdfTextRun[] {
  const streamStartMarker = Buffer.from("stream\n", "ascii");
  const streamEndMarker = Buffer.from("\nendstream", "ascii");
  const dictionaryStartMarker = Buffer.from("<<", "ascii");
  const streams: string[] = [];
  let cursor = 0;
  while (cursor < pdf.length) {
    const streamStart = pdf.indexOf(streamStartMarker, cursor);
    if (streamStart < 0) break;
    const streamEnd = pdf.indexOf(
      streamEndMarker,
      streamStart + streamStartMarker.length,
    );
    if (streamEnd < 0) break;
    const dictionaryStart = pdf.lastIndexOf(dictionaryStartMarker, streamStart);
    const dictionary = pdf
      .subarray(dictionaryStart, streamStart)
      .toString("ascii");
    const bytes = pdf.subarray(
      streamStart + streamStartMarker.length,
      streamEnd,
    );
    if (dictionary.includes("/FlateDecode")) {
      streams.push(inflateSync(bytes).toString("latin1"));
    }
    cursor = streamEnd + streamEndMarker.length;
  }

  const runs: PdfTextRun[] = [];
  const textBlock = /BT\s+([\s\S]*?)\s+ET/gu;
  const font = /\/F\d+\s+([\d.]+)\s+Tf/u;
  const matrix =
    /[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s+([-\d.]+)\s+Tm/u;
  const text = /\(([^)]*)\)\s+Tj/u;
  for (const stream of streams) {
    for (const block of stream.matchAll(textBlock)) {
      const fontMatch = font.exec(block[1]!);
      const matrixMatch = matrix.exec(block[1]!);
      const textMatch = text.exec(block[1]!);
      if (!fontMatch || !matrixMatch || !textMatch) continue;
      runs.push({
        fontSize: Number(fontMatch[1]),
        x: Number(matrixMatch[1]),
        y: Number(matrixMatch[2]),
        text: textMatch[1]!,
      });
    }
  }
  return runs;
}

interface PdfTextRun {
  fontSize: number;
  text: string;
  x: number;
  y: number;
}

test("opens netlist preflight and navigates its canonical finding", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 360, y: 240 });
  await clickCommand(page, "Netlist", "Check Report…");
  const dialog = page.getByRole("dialog", { name: "Check Report" });
  await expect(dialog).toContainText("blocking issue");
  await dialog
    .getByRole("button", { name: /MISSING_PIN_NET/u })
    .first()
    .click();
  await expect(page.getByTestId("active-document-name")).toHaveText("dut");
  await expect(page.getByTestId("status")).toContainText("Preflight:");
  await expect(dialog).toBeVisible();

  const reportBody = dialog.locator(".netlist-preflight-body");
  const diagnostics = dialog.getByLabel("Netlist diagnostics");
  const reportBodyBox = await reportBody.boundingBox();
  const diagnosticsBox = await diagnostics.boundingBox();
  expect(reportBodyBox).not.toBeNull();
  expect(diagnosticsBox).not.toBeNull();
  expect(diagnosticsBox!.width).toBeGreaterThan(reportBodyBox!.width * 0.9);
});

test("previews a validated structural netlist in both export dialects", async ({
  page,
}) => {
  await page.goto("/editor");
  if (
    (await page
      .getByTestId("netlist-panel-toggle")
      .getAttribute("aria-pressed")) !== "true"
  )
    await page.getByTestId("netlist-panel-toggle").click();
  const netlistPanel = page.getByRole("region", {
    name: "Live netlist",
    exact: true,
  });
  await clickCommand(page, "Netlist", "Check Report…");
  const dialog = page.getByRole("dialog", { name: "Check Report" });
  const preview = dialog.getByTestId("netlist-preview");
  await expect(preview).toContainText(".subckt dut");
  await dialog.getByTestId("check-report-close").click();
  await netlistPanel.getByLabel("Netlist format").selectOption("spectre");
  await clickCommand(page, "Netlist", "Check Report…");
  await expect(preview).toContainText("simulator lang=spectre");
});

test("keeps rejected SPICE import diagnostics in a historical report", async ({
  page,
}) => {
  await page.goto("/editor");
  await openMenu(page, "File");
  await page
    .getByTestId("spice-files")
    .setInputFiles([
      resolve(process.cwd(), "netlists/mixed-device-acceptance/circuit.spi"),
      resolve(process.cwd(), "netlists/mixed-device-acceptance/models.inc"),
    ]);

  await expect(page.getByTestId("status")).toContainText(
    "approved Razavi catalog has no symbol",
  );
  const telemetry = page.getByTestId("editor-test-telemetry");
  await expect(telemetry.getByTestId("document-count")).toHaveText("1");
  await expect(telemetry.getByTestId("instance-count")).toHaveText("0");
  await expect(page.getByTestId("import-report-lifecycle")).toContainText(
    "they are not current ERC results",
  );
  await expect(page.getByTestId("import-report-diagnostics")).toContainText(
    "approved Razavi catalog has no symbol",
  );
  await expect(page.getByTestId("project-diagnostics")).not.toContainText(
    "approved Razavi catalog has no symbol",
  );

  const replacement = createEmptyProject("replacement", "Replacement");
  await page.getByTestId("project-file").setInputFiles({
    name: "replacement.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(replacement)),
  });
  await expect(page.getByTestId("import-report-lifecycle")).toHaveCount(0);
});

test("imports a parameterized hierarchy and re-exports its structural semantics", async ({
  page,
}) => {
  await page.goto("/editor");
  await page.getByTestId("spice-files").setInputFiles({
    name: "circuit.spi",
    mimeType: "application/x-spice",
    buffer: Buffer.from(`
.subckt leaf A B params: scale=1
R1 A B 1k
.ends leaf
.subckt top IN OUT
X1 IN OUT leaf scale=2
X2 OUT IN EXT_MASTER l=1u nf=4
.ends top
`),
  });

  await expect(page.getByTestId("status")).toContainText(
    "Imported 2 Documents",
  );
  const spice = await copyNetlistText(page);
  await expect(page.getByRole("dialog", { name: "Check Report" })).toHaveCount(
    0,
  );
  expect(spice).toContain(".subckt leaf A B params: scale=1");
  expect(spice).toContain("X1 IN OUT leaf scale=2");
  expect(spice).toContain("X2 OUT IN EXT_MASTER l=1u nf=4");
});

test("shows imported instance references after Place all", async ({ page }) => {
  await page.goto("/editor");
  await page.getByTestId("spice-files").setInputFiles({
    name: "circuit.spi",
    mimeType: "application/x-spice",
    buffer: Buffer.from(`
.subckt top IN OUT
R7 IN OUT 10k
.ends top
`),
  });

  await expect(page.getByTestId("status")).toContainText(
    "Imported 1 Documents",
  );
  await page
    .getByRole("region", { name: "Placement Tray" })
    .locator(":scope > summary")
    .click();
  await page
    .getByRole("region", { name: "Placement Tray" })
    .getByRole("button", { name: "Place all" })
    .click();
  await expect(
    page
      .getByTestId("schematic-canvas")
      .locator("text")
      .filter({ hasText: "R7" }),
  ).toBeVisible();
  await expect(
    page
      .getByTestId("schematic-canvas")
      .locator("text")
      .filter({ hasText: "OUT" }),
  ).toBeVisible();
  await expect(
    page
      .getByTestId("schematic-canvas")
      .locator("text")
      .filter({ hasText: "P1" }),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("annotation-hit-instance-label-R7"),
  ).toBeVisible();
});

test("copies generated NoConnect nodes immediately and retains the optional Check Report", async ({
  page,
}) => {
  const project = createEmptyProject("warning-project", "Warning Project");
  const document = project.documents[0]!;
  document.instances.push({
    id: "R1",
    symbolId: "resistor",
    placement: null,
    reference: "R1",
    netlist: {
      binding: { kind: "primitive", deviceClass: "resistor" },
      parameters: { value: "10k" },
    },
  });
  document.nets.push({
    id: "net-in",

    terminals: [{ instanceId: "R1", pinName: "1" }],
  });
  document.connectivityEvidence.push({
    id: "claim-net-in",
    kind: "name-claim",
    netId: "net-in",
    name: "IN",
    owner: { kind: "net-label", annotationId: "test-net-label-3" },
    scope: "local",
  });
  document.annotations.push({
    id: "test-net-label-3",
    kind: "net-label",
    netId: "net-in",
    binding: { kind: "net-name", netId: "net-in" },
    anchor: { kind: "free", position: { x: 0, y: 0 } },
    alignment: "start",
    rotation: 0,
    locked: false,
  });
  document.noConnects.push({
    id: "r1-open",
    endpoint: { kind: "terminal", instanceId: "R1", pinName: "2" },
  });

  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "warning.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  expect(await copyNetlistText(page)).toContain("R1 IN NC0001 10k");
  await expect(page.getByRole("dialog", { name: "Check Report" })).toHaveCount(
    0,
  );
  await clickCommand(page, "Netlist", "Check Report…");
  const dialog = page.getByRole("dialog", { name: "Check Report" });
  await expect(dialog).toContainText("GENERATED_NO_CONNECT_NODE");
  await expect(dialog.getByTestId("netlist-preview")).toContainText(
    "R1 IN NC0001 10k",
  );
  await expect(dialog.getByLabel("Preflight findings")).toBeVisible();
  await expect(dialog.getByLabel("Electrical findings")).toBeVisible();

  const previewPane = dialog.locator(".netlist-preflight-export");
  const diagnosticsPane = dialog.getByLabel("Netlist diagnostics");
  const desktopPreviewBox = await previewPane.boundingBox();
  const desktopDiagnosticsBox = await diagnosticsPane.boundingBox();
  expect(desktopPreviewBox).not.toBeNull();
  expect(desktopDiagnosticsBox).not.toBeNull();
  expect(desktopDiagnosticsBox!.x).toBeGreaterThanOrEqual(
    desktopPreviewBox!.x + desktopPreviewBox!.width - 1,
  );
  expect(
    Math.abs(desktopDiagnosticsBox!.y - desktopPreviewBox!.y),
  ).toBeLessThan(2);

  await page.setViewportSize({ width: 760, height: 800 });
  const narrowPreviewBox = await previewPane.boundingBox();
  const narrowDiagnosticsBox = await diagnosticsPane.boundingBox();
  expect(narrowPreviewBox).not.toBeNull();
  expect(narrowDiagnosticsBox).not.toBeNull();
  expect(narrowDiagnosticsBox!.y).toBeGreaterThanOrEqual(
    narrowPreviewBox!.y + narrowPreviewBox!.height - 1,
  );

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await dialog.getByRole("button", { name: "Copy SPICE netlist" }).click();
  await expect(page.getByTestId("status")).toContainText(
    "SPICE netlist copied",
  );
  const spice = await page.evaluate(() => navigator.clipboard.readText());
  expect(spice).toContain("R1 IN NC0001 10k");
  expect(spice).not.toContain("GENERATED_NO_CONNECT_NODE");
});

test("exports one formal visual scene as Project, SVG, PNG, and PDF", async ({
  page,
}) => {
  await page.goto("/editor?example=common-source-amplifier");
  await awaitEditorReady(page);

  const projectBytes = await downloadBytes(
    page,
    "File",
    "Export Project File…",
  );
  expect(JSON.parse(projectBytes.toString("utf8")).topDocumentId).toBeTruthy();
  const svg = (await downloadBytes(page, "File", "Export SVG")).toString(
    "utf8",
  );
  expect(svg).toContain('data-layer="formal"');
  expect(svg).toContain('data-text-run="subscript"');
  expect(svg).not.toContain("baseline-shift=");
  expect(svg).not.toMatch(/font-size="[\d.]+%"/u);
  expect(svg).not.toMatch(/selection|route-hit|editor-overlay/u);

  const png = await downloadBytes(page, "File", "Export PNG");
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const pdf = await downloadBytes(page, "File", "Export PDF");
  expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  const pdfText = pdf.toString("latin1");
  // A page-cover PNG was the former PDF implementation. The browser PDF must
  // retain the formal SVG as PDF paths/text, so it cannot contain an image XObject.
  expect(pdfText).not.toContain("/Subtype /Image");
  expect(pdfText).toContain("/Type /Font");

  const textRuns = pdfTextRuns(pdf);
  for (const [baseText, scriptText] of [
    ["I", "out"],
    ["C", "GS"],
    ["C", "GD"],
    ["M", "1"],
    ["R", "D"],
    ["R", "S"],
    ["V", "in"],
    ["V", "DD"],
  ]) {
    const scriptIndex = textRuns.findIndex(
      (run, index) =>
        index > 0 &&
        run.text.trim() === scriptText &&
        textRuns[index - 1]!.text === baseText,
    );
    expect(scriptIndex, `${baseText}_${scriptText} is present`).toBeGreaterThan(
      0,
    );
    const base = textRuns[scriptIndex - 1]!;
    const script = textRuns[scriptIndex]!;
    expect(script.fontSize).toBeCloseTo(base.fontSize * 0.76, 2);
    expect(script.x).toBeGreaterThan(base.x);
    expect(script.y).toBeGreaterThan(base.y);
  }
});

test("copies structural SPICE and Spectre netlists while exposing instance authoring", async ({
  page,
}) => {
  await page.goto("/editor");
  const spice = await copyNetlistText(page, "spice");
  expect(spice).toContain(".subckt dut");
  expect(spice).not.toMatch(/^(?:\*|\/\/)/mu);
  const spectre = await copyNetlistText(page, "spectre");
  expect(spectre).toContain("simulator lang=spectre");
  const primary = page.getByTestId("copy-netlist");
  await expect(primary).toHaveAccessibleName("Copy netlist");
  await expect(primary).not.toContainText("Copy");
  await expect(primary).toHaveAttribute("title", /Spectre \(\.scs\)/u);
  expect(await copyNetlistText(page)).toBe(spectre);
  await expect(page.getByRole("dialog", { name: "Check Report" })).toHaveCount(
    0,
  );

  await placeComponent(page, "nmos", { x: 360, y: 220 });
  await page.getByTestId("netlist-panel-toggle").click();
  await expect(
    page.getByRole("textbox", { name: "Netlist code", exact: true }),
  ).toHaveText("");
  // The panel surfaces the first structural error for the Instance just
  // placed. Which one comes first is diagnostic order, not a contract — a
  // lone MOS is missing a model target and its connections both — so this
  // asserts the Instance is named rather than pinning one message.
  await expect(
    page.getByRole("region", { name: "Live netlist" }).getByRole("alert"),
  ).toContainText("M1");
  await page.evaluate(() => navigator.clipboard.writeText("unchanged"));
  await primary.click();
  await expect(page.getByTestId("status")).toContainText(
    "Resolve the Check Report",
  );
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "unchanged",
  );
  await page.keyboard.press("q");
  await openSelectionShelf(page);
  const properties = page.getByRole("complementary", { name: "Properties" });
  await expect(properties.getByLabel("Cell netlist name")).toHaveCount(0);
  await expect(properties.getByLabel("Cell netlist port order")).toHaveCount(0);
  await expectComponentCodeField(page, "netlistName", "M1");
  await expectComponentCodeField(page, "netlistTarget", "");
  await expect(properties.getByText(/^Model:/u)).toHaveCount(0);
});

test("shows and copies a live MOS netlist with explicitly connected bulk terminals", async ({
  page,
}) => {
  const project = createEmptyProject("explicit-bulk", "Explicit Bulk");
  const document = project.documents[0]!;
  for (const [reference, symbolId] of [
    ["M1", "nmos"],
    ["M2", "pmos"],
  ] as const) {
    document.instances.push({
      id: reference,
      reference,
      symbolId,
      placement: null,
      netlist: {
        binding: {
          kind: "model",
          deviceClass: "mos",
          name: symbolId === "nmos" ? "NMOS" : "PMOS",
        },
        parameters: { w: "1u", l: "150n", nf: "1", m: "1" },
      },
    });
    // Source and bulk share a node per device — that is what this test is
    // about. Drain and gate are shared between the two devices, because a
    // node only one pin reaches is a dead end and the export refuses one.
    document.nets.push({
      id: `${reference}-S`,
      terminals: [
        { instanceId: reference, pinName: "S" },
        { instanceId: reference, pinName: "B" },
      ],
    });
  }
  for (const pinName of ["D", "G"] as const)
    document.nets.push({
      id: `shared-${pinName}`,
      terminals: [
        { instanceId: "M1", pinName },
        { instanceId: "M2", pinName },
      ],
    });

  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "explicit-bulk.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });

  const spice = await copyNetlistText(page, "spice");
  expect(spice).toMatch(/M1 \S+ \S+ (\S+) \1 NMOS/u);
  expect(spice).toMatch(/M2 \S+ \S+ (\S+) \1 PMOS/u);
  expect(spice).toContain(".subckt dut\n");
  const spectre = await copyNetlistText(page, "spectre");
  expect(spectre).toMatch(/M1 \(\S+ \S+ (\S+) \1\) NMOS/u);
  expect(spectre).toMatch(/M2 \(\S+ \S+ (\S+) \1\) PMOS/u);
  expect(spectre).toContain("subckt dut\n");
  const panel = page.getByRole("region", {
    name: "Live netlist",
    exact: true,
  });
  const topControls = panel.locator(".netlist-code-controls");
  for (const label of await topControls.locator("label").all()) {
    const labelTextBox = await label.locator("span").boundingBox();
    const selectBox = await label.locator("select").boundingBox();
    expect(labelTextBox).not.toBeNull();
    expect(selectBox).not.toBeNull();
    expect(
      Math.abs(
        labelTextBox!.y +
          labelTextBox!.height / 2 -
          (selectBox!.y + selectBox!.height / 2),
      ),
    ).toBeLessThanOrEqual(2);
  }
  const codeViewport = panel.locator(".netlist-code-viewport");
  await expect(codeViewport).toHaveAttribute("data-visible-lines", "10");
  await expect(codeViewport.locator(".cm-lineNumbers")).toBeVisible();
  await expect(panel.getByLabel("Netlist process")).toBeVisible();
  await expect(panel.getByLabel("NMOS netlist target")).toBeVisible();
  const portCase = panel.getByRole("button", {
    name: "Port names: uppercase",
  });
  const defaultButton = panel.getByRole("button", {
    name: "Default",
    exact: true,
  });
  await portCase.click();
  await expect(
    panel.getByRole("button", { name: "Port names: lowercase" }),
  ).toBeVisible();
  const codeViewportBox = await codeViewport.boundingBox();
  const optionsBarBox = await panel
    .getByLabel("Netlist output options")
    .boundingBox();
  expect(codeViewportBox).not.toBeNull();
  expect(optionsBarBox).not.toBeNull();
  expect(
    optionsBarBox!.y - (codeViewportBox!.y + codeViewportBox!.height),
  ).toBeLessThanOrEqual(12);
  await page.reload();
  if (
    (await page
      .getByTestId("netlist-panel-toggle")
      .getAttribute("aria-pressed")) !== "true"
  )
    await page.getByTestId("netlist-panel-toggle").click();
  await expect(
    panel.getByRole("button", { name: "Port names: lowercase" }),
  ).toBeVisible();
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await defaultButton.click();
  await expect(panel.getByLabel("Netlist format")).toHaveValue("spice");
  await expect(
    panel.getByRole("button", { name: "Port names: uppercase" }),
  ).toBeVisible();
  await expect(panel.getByLabel("Netlist code")).toContainText(".subckt dut\n");
  await page.reload();
  if (
    (await page
      .getByTestId("netlist-panel-toggle")
      .getAttribute("aria-pressed")) !== "true"
  )
    await page.getByTestId("netlist-panel-toggle").click();
  await expect(panel.getByLabel("Netlist format")).toHaveValue("spice");
  await expect(panel.getByLabel("Netlist process")).toBeVisible();
});

test("caps a long live netlist at twenty visible lines with internal scrolling", async ({
  page,
}) => {
  const project = createEmptyProject("long-netlist", "Long Netlist");
  const document = project.documents[0]!;
  for (let index = 1; index <= 24; index++) {
    const id = `R${index}`;
    document.instances.push({
      id,
      reference: id,
      symbolId: "resistor",
      placement: null,
      netlist: { parameters: { value: `${index}k` } },
    });
    for (const pinName of ["1", "2"])
      document.nets.push({
        id: `${id}-${pinName}`,
        terminals: [{ instanceId: id, pinName }],
      });
  }

  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "long-netlist.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  if (
    (await page
      .getByTestId("netlist-panel-toggle")
      .getAttribute("aria-pressed")) !== "true"
  )
    await page.getByTestId("netlist-panel-toggle").click();
  const panel = page.getByRole("region", { name: "Live netlist", exact: true });
  const viewport = panel.locator(".netlist-code-viewport");
  await expect(viewport).toHaveAttribute("data-visible-lines", "20");
  await expect(viewport.locator(".cm-lineNumbers")).toBeVisible();
  expect(
    await viewport
      .locator(".cm-scroller")
      .evaluate((scroller) => scroller.scrollHeight > scroller.clientHeight),
  ).toBe(true);
  const viewportBox = await viewport.boundingBox();
  const optionsBox = await panel
    .getByLabel("Netlist output options")
    .boundingBox();
  expect(viewportBox).not.toBeNull();
  expect(optionsBox).not.toBeNull();
  expect(
    optionsBox!.y - (viewportBox!.y + viewportBox!.height),
  ).toBeLessThanOrEqual(12);
});

test("edits output configuration without creating another electrical authority", async ({
  page,
}) => {
  await page.goto("/editor");
  await clickCommand(page, "Netlist", "Configuration…");
  const panel = page.getByRole("region", {
    name: "Netlist configuration",
    exact: true,
  });
  const code = panel.getByRole("textbox", {
    name: "Netlist configuration JSON",
  });
  await expect(panel.getByRole("combobox")).toHaveCount(0);
  await expect(panel.getByRole("button")).toHaveCount(0);
  const config = JSON.parse(await code.inputValue());
  expect(config).toMatchObject({
    format: "spice",
    portCase: "upper",
    selected: "abstract",
  });
  config.format = "spectre";
  config.portCase = "lower";
  await code.fill(JSON.stringify(config, null, 2));
  await page.reload();
  if (
    (await page
      .getByTestId("netlist-panel-toggle")
      .getAttribute("aria-pressed")) !== "true"
  )
    await page.getByTestId("netlist-panel-toggle").click();
  await expect(
    page.getByRole("combobox", { name: "Netlist format" }),
  ).toHaveValue("spectre");
  await clickCommand(page, "Netlist", "Configuration…");
  await expect
    .poll(async () => JSON.parse(await code.inputValue()))
    .toEqual(config);
  await code.fill("{");
  await expect(panel.getByRole("alert")).toContainText("Copying is paused");
  await page.getByTestId("copy-netlist").click();
  await expect(page.getByTestId("status")).toContainText(
    "Fix Netlist configuration",
  );
  await clickCommand(page, "Netlist", "Configuration…");
  await code.fill(JSON.stringify(config, null, 2));
  const netlist = await copyNetlistText(page, "spectre");
  expect(netlist).toContain("simulator lang=spectre");
});

test("retains copyable TODO fields when the user clears a template default", async ({
  page,
}) => {
  const project = createEmptyProject("draft-project", "Draft Circuit");
  const document = project.documents[0]!;
  document.instances.push({
    id: "R1",
    reference: "R1",
    symbolId: "resistor",
    placement: null,
    netlist: {
      binding: { kind: "primitive", deviceClass: "resistor" },
      parameters: {},
    },
  });
  document.noConnects.push(
    ...["1", "2"].map((pinName) => ({
      id: `open-${pinName}`,
      endpoint: { kind: "terminal" as const, instanceId: "R1", pinName },
    })),
  );
  await page.goto("/editor");
  await clickCommand(page, "Netlist", "Configuration…");
  const configuration = page.getByLabel("Netlist configuration JSON");
  const preferences = JSON.parse(await configuration.inputValue());
  preferences.profiles.abstract.devices.resistor.parameters = {};
  await configuration.fill(JSON.stringify(preferences));
  await page.getByTestId("netlist-panel-toggle").click();
  await page.getByTestId("project-file").setInputFiles({
    name: "draft.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  const text = await copyNetlistText(page);
  expect(text).not.toMatch(/^(?:\*|\/\/)/mu);
  expect(text).toContain("R1 NC0001 NC0002 {TODO_dut_R1_value}");
  await expect(page.getByRole("dialog", { name: "Check Report" })).toHaveCount(
    0,
  );
  await expect(page.getByTestId("status")).toContainText("1 TODO field");
  await clickCommand(page, "Netlist", "Check Report…");
  const report = page.getByRole("dialog", { name: "Check Report" });
  await expect(report).toContainText("Incomplete netlist: 1 TODO field");
  await expect(report.getByTestId("netlist-preview")).toContainText(
    "R1 NC0001 NC0002 {TODO_dut_R1_value}",
  );
  await report.getByTestId("check-report-close").click();
  await page
    .getByRole("combobox", { name: "Netlist format" })
    .selectOption("spectre");
  await clickCommand(page, "Netlist", "Check Report…");
  await expect(report.getByTestId("netlist-preview")).toContainText(
    "R1 (NC0001 NC0002) resistor r=TODO_dut_R1_value",
  );
});

test("keeps the netlist live and selectable when clipboard access fails", async ({
  page,
}) => {
  await page.goto("/editor");
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: () => Promise.reject(new Error("Clipboard denied")),
    });
  });
  const downloads: string[] = [];
  page.on("download", (download) =>
    downloads.push(download.suggestedFilename()),
  );
  await page.getByTestId("copy-netlist").click();
  const code = page.getByRole("textbox", { name: "Netlist code", exact: true });
  await expect(code).toContainText(".subckt dut");
  const netlistEditor = page.locator(
    '.project-source-editor[data-language="netlist"]',
  );
  await expect(netlistEditor.locator(".cm-lineNumbers")).toBeVisible();
  await expect(
    netlistEditor.locator(".cm-gutterElement").filter({ hasText: /^1$/u }),
  ).toBeVisible();
  expect(
    await netlistEditor.locator(".cm-content").evaluate((content) => {
      const colors = [getComputedStyle(content).color];
      for (const token of content.querySelectorAll("span"))
        colors.push(getComputedStyle(token).color);
      return new Set(colors).size;
    }),
  ).toBeGreaterThan(1);
  await expect(page.getByTestId("status")).toContainText(
    "select the netlist in the sidebar",
  );
  await page.getByTestId("spice-files").setInputFiles({
    name: "live.spi",
    mimeType: "text/plain",
    buffer: Buffer.from("\n.subckt live a b\nR1 a b 2k\n.ends live\n"),
  });
  await expect(
    page.getByRole("region", { name: "Import Review", exact: true }),
  ).toBeVisible();
  await page.getByTestId("netlist-panel-toggle").click();
  await expect(code).toContainText(/R1 a b 2k/iu);
  await expect(code).not.toContainText(".subckt dut");
  await page.setViewportSize({ width: 760, height: 800 });
  await expect(code).toBeVisible();
  await code.focus();
  await code.selectText();
  expect(downloads).toEqual([]);
});
