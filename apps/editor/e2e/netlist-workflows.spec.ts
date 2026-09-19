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

test("draws imported instances with their references", async ({ page }) => {
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
  // The import draws every device: nothing waits off-sheet in a tray.
  await expect(
    page.getByRole("region", { name: "Placement Tray" }),
  ).toHaveCount(0);
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
  // Drawn while working in SKY130, so it is already that process's device.
  await expectComponentCodeField(
    page,
    "netlistTarget",
    "sky130_fd_pr__nfet_01v8",
  );
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
  const selectBoxes = await topControls
    .locator(".netlist-code-selects > label > select")
    .evaluateAll((selects) =>
      selects.map((select) => {
        const { x, y, width } = select.getBoundingClientRect();
        return { x, y, width };
      }),
    );
  expect(selectBoxes).toHaveLength(2);
  expect(selectBoxes[1]!.y).toBeGreaterThan(selectBoxes[0]!.y);
  expect(selectBoxes[1]!.x).toBeCloseTo(selectBoxes[0]!.x, 0);
  expect(selectBoxes[1]!.x + selectBoxes[1]!.width).toBeCloseTo(
    selectBoxes[0]!.x + selectBoxes[0]!.width,
    0,
  );
  const refresh = panel.getByRole("button", { name: "Recompile netlist" });
  const copy = panel.getByRole("button", { name: "Copy netlist", exact: true });
  const formatSelect = panel.getByLabel("Netlist format");
  const processSelect = panel.getByLabel("Netlist process");
  const assertControls = async (stacked: boolean) => {
    const [format, process, refreshBox, copyBox] = await Promise.all(
      [formatSelect, processSelect, refresh, copy].map((item) =>
        item.boundingBox(),
      ),
    );
    for (const box of [process, refreshBox, copyBox])
      expect(box!.height).toBeCloseTo(format!.height, 1);
    expect(refreshBox!.y).toBeCloseTo(format!.y, 1);
    expect(copyBox!.y).toBeCloseTo(process!.y, 1);
    if (stacked) {
      expect(copyBox!.x).toBeCloseTo(refreshBox!.x, 1);
      expect(copyBox!.y).toBeGreaterThan(refreshBox!.y);
    } else {
      expect(copyBox!.x).toBeGreaterThan(refreshBox!.x);
      expect(copyBox!.y).toBeCloseTo(refreshBox!.y, 1);
    }
  };
  await assertControls(true);
  const handle = page.getByTestId("properties-resize-handle");
  const handleBox = (await handle.boundingBox())!;
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + 80);
  await page.mouse.down();
  await page.mouse.move(handleBox.x - 300, handleBox.y + 80);
  await page.mouse.up();
  await assertControls(false);
  await page.setViewportSize({ width: 720, height: 900 });
  // Restore the narrow dock through its keyboard resize control.
  await handle.focus();
  for (let index = 0; index < 10; index++)
    await handle.press("Shift+ArrowRight");
  await assertControls(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  const code = panel.getByLabel("Netlist code", { exact: true });
  const original = await code.innerText();
  await code.fill(original.replace(/\bM1\b/u, "M91"));
  await refresh.click();
  await expect(code).toContainText("M91");
  await expect(copy).toBeEnabled();
  await expect(formatSelect).toHaveValue("spectre");
  const valid = await code.innerText();
  await code.fill(valid + "\nINVALID");
  await refresh.click();
  await expect(code).toContainText("INVALID");
  await expect(panel.getByRole("alert")).toBeVisible();
  await panel.getByRole("button", { name: "Reload", exact: true }).click();
  await refresh.click();
  await expect.poll(() => code.innerText()).toBe(valid);
  await expect(panel.getByRole("alert")).toHaveCount(0);
  const codeViewport = panel.locator(".netlist-code-viewport");
  await expect(codeViewport.locator(".project-source-editor")).toHaveCSS(
    "height",
    "214px",
  );
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

test("grows and shrinks the live netlist with content, scrolling only at the viewport limit", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/editor");
  const panel = page.getByRole("region", { name: "Live netlist", exact: true });
  const viewport = panel.locator(".netlist-code-viewport");
  const editor = viewport.locator(".project-source-editor");
  const options = panel.getByLabel("Netlist output options");
  const code = panel.getByLabel("Netlist code", { exact: true });
  const height = () =>
    editor.evaluate((element) => element.getBoundingClientRect().height);
  const checkOptionsFollow = async () => {
    const viewportBox = (await viewport.boundingBox())!;
    const optionsBox = (await options.boundingBox())!;
    expect(optionsBox.y).toBeGreaterThanOrEqual(
      viewportBox.y + viewportBox.height,
    );
    expect(
      optionsBox.y - (viewportBox.y + viewportBox.height),
    ).toBeLessThanOrEqual(12);
  };
  const load = async (count: number) => {
    const project = createEmptyProject("growing-netlist", "Growing Netlist");
    const document = project.documents[0]!;
    for (let index = 1; index <= count; index++) {
      const id = `R${index}`;
      document.instances.push({
        id,
        reference: id,
        symbolId: "resistor",
        placement: {
          position: {
            x: 200 + ((index - 1) % 10) * 80,
            y: 200 + Math.floor((index - 1) / 10) * 80,
          },
          rotation: 0,
          mirror: "none",
        },
        netlist: { parameters: { value: `${index}k` } },
      });
      for (const pinName of ["1", "2"])
        document.nets.push({
          id: `${id}-${pinName}`,
          terminals: [{ instanceId: id, pinName }],
        });
    }
    await page.getByTestId("project-file").setInputFiles({
      name: "growing-netlist.icproj.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(project)),
    });
    await expect(viewport).toHaveAttribute(
      "data-line-count",
      String(count + 4),
    );
    await expect(viewport.locator(".cm-lineNumbers")).toBeVisible();
    await checkOptionsFollow();
  };
  await load(2);
  expect(await height()).toBeCloseTo(214, 0);
  await load(8);
  const twelveLinesHeight = await height();
  expect(twelveLinesHeight).toBeGreaterThan(214);
  const shortSource = await code.innerText();
  // An in-progress code draft grows too, before it is applied to the canvas.
  await code.fill(
    shortSource +
      "\n" +
      Array(12).fill("* draft comment").join("\n") +
      "\nINVALID",
  );
  await expect.poll(height).toBeGreaterThan(twelveLinesHeight + 200);
  await checkOptionsFollow();
  await code.fill(shortSource);
  await expect.poll(height).toBeCloseTo(twelveLinesHeight, 0);
  await load(22);
  expect(await height()).toBeGreaterThan(500);
  expect(await height()).toBeLessThan(600);
  // Past the room the dock has, the code stops growing and scrolls inside
  // itself: it takes the whole panel rather than a share of the window, and
  // the options stay where they are instead of being pushed out of sight.
  const dockScrolls = () =>
    panel.evaluate((element) => {
      const dock = element.parentElement!;
      return dock.scrollHeight > dock.clientHeight + 1;
    });
  await load(60);
  const filled = await height();
  expect(await dockScrolls()).toBe(false);
  await checkOptionsFollow();
  // A taller window is more room for the code, not the same share of a bigger
  // screen: the dock hands over everything the controls do not need.
  await page.setViewportSize({ width: 1440, height: 1400 });
  await expect.poll(height).toBeGreaterThan(filled + 300);
  expect(await height()).toBeGreaterThan(0.6 * 1400);
  expect(await dockScrolls()).toBe(false);
  await checkOptionsFollow();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect.poll(height).toBeCloseTo(filled, 0);
  const scroller = viewport.locator(".cm-scroller");
  expect(
    await scroller.evaluate(
      (element) => element.scrollHeight > element.clientHeight,
    ),
  ).toBe(true);
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(code).toContainText(".ends");
  await page.setViewportSize({ width: 720, height: 600 });
  await expect.poll(height).toBeLessThan(filled);
  // Ten lines of code is the floor. On a window this small the header's
  // selects wrap and the panel runs out of room, so the dock scrolls rather
  // than squeezing the code below that floor.
  await checkOptionsFollow();
  await load(2);
  expect(await height()).toBeCloseTo(214, 0);
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
    selected: "sky130",
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

test("fills a circuit drawn before the process in one click", async ({
  page,
}) => {
  // A circuit from before the editor bound devices: two MOS with no model and
  // no dimensions, so every card it prints is a TODO field. The panel offers
  // exactly the devices it would fill, and filling them leaves none.
  const project = createEmptyProject("bare-devices", "Bare devices");
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
      netlist: { parameters: {} },
    });
  }
  document.nets.push(
    {
      id: "shared-drain",
      terminals: [
        { instanceId: "M1", pinName: "D" },
        { instanceId: "M2", pinName: "D" },
      ],
    },
    {
      id: "shared-gate",
      terminals: [
        { instanceId: "M1", pinName: "G" },
        { instanceId: "M2", pinName: "G" },
      ],
    },
    {
      id: "m1-source",
      terminals: [
        { instanceId: "M1", pinName: "S" },
        { instanceId: "M1", pinName: "B" },
      ],
    },
    {
      id: "m2-source",
      terminals: [
        { instanceId: "M2", pinName: "S" },
        { instanceId: "M2", pinName: "B" },
      ],
    },
  );
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "bare-devices.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(page.getByTestId("status")).toContainText("Opened");
  const code = page.getByLabel("Netlist code", { exact: true });
  await expect(code).toContainText("TODO");
  const fill = page.getByTestId("netlist-fill-defaults");
  await expect(fill).toHaveText("Fill 2 devices");
  await fill.click();
  await expect(code).toContainText("sky130_fd_pr__nfet_01v8");
  await expect(code).not.toContainText("TODO");
  await expect(fill).toHaveCount(0);
  // One undo step: the circuit is back to what was opened.
  await clickCommand(page, "Edit", "Undo");
  await expect(code).toContainText("TODO");
  await expect(page.getByTestId("netlist-fill-defaults")).toHaveText(
    "Fill 2 devices",
  );
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

test("exports a MOS pair without bulk wiring or supply symbols", async ({
  page,
}) => {
  const project = createEmptyProject("implicit-bulk", "Implicit Bulk");
  const document = project.documents[0]!;
  for (const [index, id] of ["M1", "M2"].entries()) {
    document.instances.push({
      id,
      reference: id,
      symbolId: "nmos",
      placement: {
        position: { x: 240 + index * 200, y: 240 },
        rotation: 0,
        mirror: index ? "horizontal" : "none",
      },
      netlist: {
        binding: { kind: "model", deviceClass: "mos", name: "NMOS" },
        parameters: { w: "1u", l: "150n", nf: "1", m: "1" },
      },
    });
    const portId = `P${index}`;
    const netId = `gate-${index}`;
    document.instances.push({ id: portId, symbolId: "port", placement: null });
    document.nets.push({
      id: netId,
      terminals: [
        { instanceId: id, pinName: "G" },
        { instanceId: portId, pinName: "P" },
      ],
    });
    document.netlist!.terminals.push({
      id: `input-${index}`,
      name: index ? "Vin2" : "Vin",
      netId,
      direction: "input",
      interfaceInstanceIds: [portId],
    });
  }
  for (const pinName of ["D", "S"])
    document.nets.push({
      id: `shared-${pinName}`,
      terminals: ["M1", "M2"].map((instanceId) => ({ instanceId, pinName })),
    });
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.getByTestId("project-file").setInputFiles({
    name: "implicit-bulk.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(page.getByLabel("Netlist code", { exact: true })).toContainText(
    "M1",
  );
  const scs = await copyNetlistText(page, "spectre");
  expect(scs).toContain("subckt dut (VDD VSS VIN VIN2)");
  expect(scs).toMatch(/M1 \(\S+ VIN \S+ VSS\) NMOS/u);
  expect(scs).toMatch(/M2 \(\S+ VIN2 \S+ VSS\) NMOS/u);
  const spice = await copyNetlistText(page, "spice");
  expect(spice).toContain(".subckt dut VDD VSS VIN VIN2");
  expect(spice).not.toContain(".global");
  const saved = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  expect(saved.documents[0].instances).toHaveLength(4);
  expect(
    saved.documents[0].nets
      .flatMap((net: { terminals: { pinName: string }[] }) => net.terminals)
      .some((pin: { pinName: string }) => pin.pinName === "B"),
  ).toBe(false);
});
