import { expect, test, type Locator, type Page } from "@playwright/test";
import { inflateSync } from "node:zlib";
import { createEmptyProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import {
  clickCommand,
  downloadBytes,
  copyNetlistText,
  expectComponentCodeField,
  expectStatus,
  openMenu,
  openCellManagerTab,
  openProjectFile,
  showNetlistPanel,
  openEditor,
  openProject,
} from "./editor-fixtures.js";
import {
  placeComponent,
  openSelectionShelf,
} from "./manual-editor-fixtures.js";
import { placedInstance } from "./canvas-fixtures.js";

/**
 * Each shown run of text with its size and place. Text in an embedded face
 * (all of it since #1413) is hex glyph codes, read through that font's
 * ToUnicode map; a built-in face's is a literal string.
 */
function pdfTextRuns(pdf: Buffer): PdfTextRun[] {
  const raw = pdf.toString("latin1");
  // Every stream, by its object number, inflated when Flate-encoded.
  const streams = new Map<number, string>();
  for (const match of raw.matchAll(
    /(\d+) 0 obj\s*<<((?:(?!endobj)[\s\S])*?)>>\s*stream\r?\n/gu,
  )) {
    const start = match.index + match[0].length;
    const bytes = pdf.subarray(start, raw.indexOf("\nendstream", start));
    streams.set(
      Number(match[1]),
      match[2]!.includes("/FlateDecode")
        ? inflateSync(bytes).toString("latin1")
        : bytes.toString("latin1"),
    );
  }
  // Each font resource name, and the text its glyph codes stand for.
  const fonts = new Map<string, Map<string, string>>();
  const resources = /\/Font\s*<<([^>]*)>>/u.exec(raw)?.[1] ?? "";
  for (const [, name, object] of resources.matchAll(/\/(F\d+)\s+(\d+) 0 R/gu)) {
    const font = new RegExp(
      String.raw`(?:^|\s)${object} 0 obj\s*<<((?:(?!endobj)[\s\S])*?)endobj`,
      "u",
    ).exec(raw)?.[1];
    const map = /\/ToUnicode (\d+) 0 R/u.exec(font ?? "")?.[1];
    const codes = new Map<string, string>();
    for (const block of (streams.get(Number(map)) ?? "").matchAll(
      /beginbfchar([\s\S]*?)endbfchar/gu,
    ))
      for (const [, code, text] of block[1]!.matchAll(
        /<([0-9a-f]+)>\s*<([0-9a-f]+)>/giu,
      ))
        codes.set(
          code!.toLowerCase(),
          String.fromCodePoint(
            ...text!.match(/.{4}/gu)!.map((hex) => Number.parseInt(hex, 16)),
          ),
        );
    fonts.set(name!, codes);
  }

  const runs: PdfTextRun[] = [];
  const textBlock = /BT\s+([\s\S]*?)\s+ET/gu;
  const font = /\/(F\d+)\s+([\d.]+)\s+Tf/u;
  const matrix =
    /[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s+([-\d.]+)\s+Tm/u;
  const literal = /\(([^)]*)\)\s+Tj/u;
  const glyphs = /<([0-9a-f]+)>\s+Tj/iu;
  for (const stream of streams.values()) {
    for (const block of stream.matchAll(textBlock)) {
      const fontMatch = font.exec(block[1]!);
      const matrixMatch = matrix.exec(block[1]!);
      const literalMatch = literal.exec(block[1]!);
      const glyphMatch = glyphs.exec(block[1]!);
      if (!fontMatch || !matrixMatch || !(literalMatch || glyphMatch)) continue;
      const codes = fonts.get(fontMatch[1]!);
      runs.push({
        fontSize: Number(fontMatch[2]),
        x: Number(matrixMatch[1]),
        y: Number(matrixMatch[2]),
        text: literalMatch
          ? literalMatch[1]!
          : glyphMatch![1]!
              .toLowerCase()
              .match(/.{4}/gu)!
              .map((code) => codes?.get(code) ?? "\uFFFD")
              .join(""),
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

const checkReport = (page: Page) =>
  page.getByRole("dialog", { name: "Check Report" });
const netlistAlert = (page: Page) =>
  page.getByRole("region", { name: "Live netlist" }).getByRole("alert");

test("keeps rejected SPICE import diagnostics in a historical report", async ({
  page,
}) => {
  await page.goto("/editor");
  await openMenu(page, "File");
  // A JFET has no symbol in the approved catalog. (The mixed-device acceptance
  // netlist used to be refused for its switch; that card imports now.)
  await page.getByTestId("spice-files").setInputFiles({
    name: "jfet.spi",
    mimeType: "text/plain",
    buffer: Buffer.from(
      [
        ".subckt top d g s",
        "J1 d g s jm",
        ".ends top",
        ".model jm njf",
        "",
      ].join("\n"),
    ),
  });

  await expectStatus(page, "approved Razavi catalog has no symbol");
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
  await openProjectFile(page, serializeProject(replacement));
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

  await expectStatus(page, "Imported 2 Documents");
  await showNetlistPanel(page);
  await expect(page.getByTestId("netlist-issues")).toContainText(
    "Legacy declaration EXT_MASTER has no Project-owned implementation",
  );
  await expect(page.getByTestId("copy-netlist-panel")).toBeDisabled();
  const manager = await openCellManagerTab(page, "External Circuits");
  await manager.getByRole("button", { name: /EXT_MASTER/ }).click();
  await manager
    .getByRole("button", { name: "Define implementation…", exact: true })
    .click();
  const body =
    ".subckt EXT_MASTER P1 P2 params: l=1u nf=1\nREXT P1 P2 1k\n.ends EXT_MASTER\n";
  await manager.getByLabel("External model netlist").fill(body);
  await manager
    .getByRole("button", { name: "Apply model", exact: true })
    .click();
  await manager.getByLabel("Close Cell Manager").click();
  const spice = await copyNetlistText(page);
  await expect(checkReport(page)).toHaveCount(0);
  expect(spice).toContain(".subckt leaf A B params: scale=1");
  expect(spice).toContain("X1 IN OUT leaf scale=2");
  expect(spice).toContain("X2 OUT IN EXT_MASTER l=1u nf=4");
  expect(spice).toContain(body);
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

  await openProject(page, serializeProject(project));
  expect(await copyNetlistText(page)).toContain("R1 IN NC0001 10k");
  await expect(checkReport(page)).toHaveCount(0);
  await clickCommand(page, "Netlist", "Review Netlist Issues…");
  const dialog = checkReport(page);
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
  await expectStatus(page, "SPICE netlist copied");
  const spice = await page.evaluate(() => navigator.clipboard.readText());
  expect(spice).toContain("R1 IN NC0001 10k");
  expect(spice).not.toContain("GENERATED_NO_CONNECT_NODE");
});

// The browser converts the formal scene to a vector PDF with svg2pdf, which
// places each script by the page's own font metrics: only a browser can
// check it. The Project, SVG and PNG exports are exporters.test.ts's.
test("exports the formal scene as a vector PDF with its scripts in place", async ({
  page,
}) => {
  await openEditor(page, "/editor?example=common-source-amplifier");
  const pdf = await downloadBytes(page, "File", "Export PDF");
  expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  const pdfText = pdf.toString("latin1");
  // A page-cover PNG was the former PDF implementation. The browser PDF must
  // retain the formal SVG as PDF paths/text, so it cannot contain an image XObject.
  expect(pdfText).not.toContain("/Subtype /Image");
  expect(pdfText).toContain("/Type /Font");

  // Each subscript decodes to its own text after its base, smaller, and
  // placed after and below it.
  const runs = pdfTextRuns(pdf);
  for (const pair of [
    "I_out",
    "C_GS",
    "C_GD",
    "M_1",
    "R_D",
    "R_S",
    "V_in",
    "V_DD",
  ]) {
    const [baseText, scriptText] = pair.split("_");
    const index = runs.findIndex(
      (run, at) =>
        at > 0 &&
        run.text.trim() === scriptText &&
        runs[at - 1]!.text === baseText,
    );
    expect(index, `${pair} is present`).toBeGreaterThan(0);
    const [base, script] = [runs[index - 1]!, runs[index]!];
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
  await openMenu(page, "Netlist");
  const primary = page.getByTestId("copy-netlist");
  await expect(primary).toHaveAccessibleName("Copy Netlist");
  await expect(primary).toContainText("Copy Netlist");
  await expect(primary).toHaveAttribute("title", /Spectre \(\.scs\)/u);
  expect(await copyNetlistText(page)).toBe(spectre);
  // The panel's own copy button, beside the code, copies the same netlist.
  await page.evaluate(() => navigator.clipboard.writeText("unchanged"));
  await page.getByTestId("copy-netlist-panel").click();
  // Match copyNetlistText's line-ending-neutral clipboard contract: Windows
  // returns CRLF even though the generated netlist uses LF.
  await expect
    .poll(async () =>
      (await page.evaluate(() => navigator.clipboard.readText())).replace(
        /\r\n?/gu,
        "\n",
      ),
    )
    .toBe(spectre);
  await expect(checkReport(page)).toHaveCount(0);

  await placeComponent(page, "nmos", { x: 360, y: 220 });
  await page.getByTestId("netlist-panel-toggle").click();
  // The lone MOS prints at once as a draft, ? on every open pin.
  await expect(
    page.getByRole("textbox", { name: "Netlist code", exact: true }),
  ).toContainText(/M1 \(\? \? \? VSS\)/u);
  // The panel surfaces the first structural error for the Instance just
  // placed. Which one comes first is diagnostic order, not a contract — a
  // lone MOS is missing a model target and its connections both — so this
  // asserts the Instance is named rather than pinning one message.
  await expect(netlistAlert(page)).toContainText("M1");
  await page.evaluate(() => navigator.clipboard.writeText("unchanged"));
  await clickCommand(page, "Netlist", "Copy Netlist");
  await expectStatus(page, "Resolve the Check Report");
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

/**
 * The File > Export > Netlist item, opened.
 */
async function exportNetlistItem(page: Page) {
  const details = await openMenu(page, "File");
  const group = details.getByRole("button", { name: "Export", exact: true });
  if ((await group.getAttribute("aria-expanded")) !== "true")
    await group.click();
  return details.getByRole("button", { name: "Export Netlist", exact: true });
}

/** The file a click on `item` downloads: its name and text. */
async function savedBy(page: Page, item: Locator) {
  const download = page.waitForEvent("download");
  await item.click();
  const file = await download;
  const chunks: Buffer[] = [];
  for await (const chunk of await file.createReadStream())
    chunks.push(Buffer.from(chunk));
  return {
    name: file.suggestedFilename(),
    text: Buffer.concat(chunks).toString("utf8"),
  };
}

test("File > Export > Netlist saves the netlist the Netlist panel shows, in the format it shows", async ({
  page,
}) => {
  await openEditor(page, "/editor");
  // The item is the same words whichever format the panel shows; before the
  // panel has been opened it saves the saved choice, SPICE by default.
  await expect(await exportNetlistItem(page)).toHaveText("Netlist…");
  const panel = await showNetlistPanel(page);
  const code = panel.getByRole("textbox", {
    name: "Netlist code",
    exact: true,
  });
  for (const [format, extension] of [
    ["spice", ".spi"],
    ["spectre", ".scs"],
    ["spice+rnl", ".spi"],
    ["spectre+rnl", ".scs"],
  ] as const) {
    await panel.getByLabel("Netlist format").selectOption(format);
    const output = format.endsWith("+rnl")
      ? panel.getByRole("textbox", { name: "RNL netlist code", exact: true })
      : code;
    await expect(output).toContainText(
      format.startsWith("spice") ? ".subckt dut" : "subckt dut",
    );
    // The editor's lines one by one: its element text as a whole gains line
    // breaks of its own in Chromium.
    const shown = (await output.locator(".cm-line").allTextContents()).join(
      "\n",
    );
    const item = await exportNetlistItem(page);
    await expect(item).toHaveText("Netlist…");
    const saved = await savedBy(page, item);
    expect(saved.name.endsWith(extension)).toBe(true);
    // The file ends in a line break the panel does not show.
    expect(saved.text.replaceAll("\r", "").trimEnd()).toBe(shown.trimEnd());
    await expectStatus(page, /netlist (?:saved|download requested)/iu);
  }
});

test("grows and shrinks the live netlist with content, scrolling only at the viewport limit, with aligned controls", async ({
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
        ...placedInstance(
          id,
          "resistor",
          200 + ((index - 1) % 10) * 80,
          200 + Math.floor((index - 1) / 10) * 80,
        ),
        reference: id,
        netlist: { parameters: { value: `${index}k` } },
      });
      // Both pins on one Net: a pin alone on its Net would be an unfinished
      // node, and the panel lists every such finding under the code.
      document.nets.push({
        id: `${id}-net`,
        terminals: [
          { instanceId: id, pinName: "1" },
          { instanceId: id, pinName: "2" },
        ],
      });
    }
    await openProjectFile(page, serializeProject(project));
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

  // The header controls stay aligned and inside the panel at any dock width.
  await page.setViewportSize({ width: 1280, height: 720 });
  const topControls = panel.locator(".netlist-code-controls");
  for (const label of await topControls.locator("label").all()) {
    const labelTextBox = (await label.locator("span").boundingBox())!;
    const selectBox = (await label.locator("select").boundingBox())!;
    expect(
      Math.abs(
        labelTextBox.y +
          labelTextBox.height / 2 -
          (selectBox.y + selectBox.height / 2),
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
  const controls = [
    panel.getByLabel("Netlist format"),
    panel.getByLabel("Netlist process"),
    panel.getByRole("button", { name: "Refresh netlist" }),
    panel.getByRole("button", { name: "Copy netlist", exact: true }),
    panel,
  ];
  const assertControls = async () => {
    const [format, process, refresh, copy, panelBox] = await Promise.all(
      controls.map((item) => item.boundingBox()),
    );
    for (const box of [process, refresh, copy])
      expect(box!.height).toBeCloseTo(format!.height, 1);
    expect(refresh!.y).toBeCloseTo(format!.y, 1);
    expect(copy!.x + copy!.width).toBeLessThanOrEqual(
      panelBox!.x + panelBox!.width,
    );
  };
  await assertControls();
  const handle = page.getByTestId("properties-resize-handle");
  const handleBox = (await handle.boundingBox())!;
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + 80);
  await page.mouse.down();
  await page.mouse.move(handleBox.x - 300, handleBox.y + 80);
  await page.mouse.up();
  await assertControls();
  await page.setViewportSize({ width: 720, height: 900 });
  // Restore the narrow dock through its keyboard resize control.
  await handle.focus();
  for (let index = 0; index < 10; index++)
    await handle.press("Shift+ArrowRight");
  await assertControls();
});

test("edits output configuration without creating another electrical authority, and blocks output when a default is missing", async ({
  page,
}) => {
  await page.goto("/editor");
  await clickCommand(page, "Netlist", "Netlist Settings…");
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
    selected: "sky130",
  });
  expect(config).not.toHaveProperty("portCase");
  config.format = "spectre";
  await code.fill(JSON.stringify(config, null, 2));
  await page.reload();
  // The workspace restores the open configuration panel. Wait for that
  // restoration before switching to the output panel.
  await expect(panel).toBeVisible();
  await page.getByTestId("netlist-panel-toggle").click();
  const format = page.getByRole("combobox", { name: "Netlist format" });
  await expect(format).toHaveValue("spectre");
  await clickCommand(page, "Netlist", "Netlist Settings…");
  await expect
    .poll(async () => JSON.parse(await code.inputValue()))
    .toEqual(config);
  await code.fill("{");
  await expect(panel.getByRole("alert")).toContainText("Copying is paused");
  await clickCommand(page, "Netlist", "Copy Netlist");
  await expectStatus(page, "Fix Netlist configuration");
  await clickCommand(page, "Netlist", "Netlist Settings…");
  await code.fill(JSON.stringify(config, null, 2));
  const netlist = await copyNetlistText(page, "spectre");
  expect(netlist).toContain("simulator lang=spectre");

  // A configured default that is missing blocks output in either format.
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
  await clickCommand(page, "Netlist", "Netlist Settings…");
  config.format = "spice";
  config.profiles.abstract.devices.resistor.parameters = {};
  await code.fill(JSON.stringify(config));
  await page.getByTestId("netlist-panel-toggle").click();
  await openProjectFile(page, serializeProject(project));
  const live = page.getByLabel("Netlist code", { exact: true });
  // The panel shows the draft, value unknown; output itself stays blocked.
  await expect(live).toContainText("* Draft:");
  await expect(live).toContainText(/R1 \S+ \S+ \?/u);
  await expect(netlistAlert(page)).toContainText("requires parameter value");
  await clickCommand(page, "Netlist", "Review Netlist Issues…");
  const report = checkReport(page);
  await expect(report).toContainText("1 blocking issue");
  await expect(report.getByTestId("netlist-preview")).toHaveCount(0);
  await report.getByTestId("check-report-close").click();
  await format.selectOption("spectre");
  await clickCommand(page, "Netlist", "Review Netlist Issues…");
  await expect(report).toContainText("1 blocking issue");
  await expect(report.getByTestId("netlist-preview")).toHaveCount(0);
  // The report's finding navigates to its part and keeps the report open.
  await report
    .getByRole("button", { name: /MISSING_REQUIRED_PARAMETER/u })
    .first()
    .click();
  await expectStatus(page, "Preflight:");
  await expect(page.getByTestId("active-document-name")).toHaveText("dut");
  await expect(report).toBeVisible();
  const reportBodyBox = await report
    .locator(".netlist-preflight-body")
    .boundingBox();
  const diagnosticsBox = await report
    .getByLabel("Netlist diagnostics")
    .boundingBox();
  expect(diagnosticsBox!.width).toBeGreaterThan(reportBodyBox!.width * 0.9);
});

test("refreshes a legacy circuit with missing device defaults in one click", async ({
  page,
}) => {
  // A circuit from before the editor bound devices: two MOS with no model and
  // no dimensions, plus one ideal resistor with no value. Refresh fills every
  // safe process default in the same undoable edit. No partial netlist is
  // exposed while those fields are missing.
  const project = createEmptyProject("bare-devices", "Bare devices");
  const document = project.documents[0]!;
  for (const [reference, symbolId] of [
    ["M1", "nmos"],
    ["M2", "pmos"],
    ["R1", "resistor"],
  ] as const) {
    document.instances.push({
      id: reference,
      reference,
      symbolId,
      placement: null,
      netlist: { parameters: {} },
    });
  }
  // Drains and gates shared; each source tied to its body; R1 across itself.
  for (const [id, a, b] of [
    ["shared-drain", "M1.D", "M2.D"],
    ["shared-gate", "M1.G", "M2.G"],
    ["m1-source", "M1.S", "M1.B"],
    ["m2-source", "M2.S", "M2.B"],
    ["resistor", "R1.1", "R1.2"],
  ])
    document.nets.push({
      id: id!,
      terminals: [a!, b!].map((pin) => {
        const [instanceId, pinName] = pin.split(".") as [string, string];
        return { instanceId, pinName };
      }),
    });
  await openProject(page, serializeProject(project));
  await expectStatus(page, "Opened");
  const code = page.getByLabel("Netlist code", { exact: true });
  await expect(code).toContainText("* Draft:");
  await expect(code).toContainText("w=? l=?");
  await expect(netlistAlert(page)).toContainText(
    "requires an explicit model target",
  );
  const fill = page.getByTestId("netlist-fill-defaults");
  await expect(fill).toHaveText("Fill 3 devices");
  await page.getByRole("button", { name: "Refresh netlist" }).click();
  await expect(code).toContainText("sky130_fd_pr__nfet_01v8");
  await expect(code).toContainText(/R1 \S+ \S+ 1k/u);
  await expect(fill).toHaveCount(0);
  // One undo step: the circuit is back to what was opened.
  await page.getByTestId("draw-tool-undo").click();
  await expect(code).toContainText("w=? l=?");
  await expect(page.getByTestId("netlist-fill-defaults")).toHaveText(
    "Fill 3 devices",
  );
  await page.getByTestId("netlist-fill-defaults").click();
  await expect(code).toContainText("sky130_fd_pr__nfet_01v8");
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
  await clickCommand(page, "Netlist", "Copy Netlist");
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
  await expectStatus(page, "select the netlist in the sidebar");
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
