import type { SchematicDocument } from "@icm/model";
import { razaviProductSymbols } from "@icm/symbols";
import { expect, test, type Locator } from "@playwright/test";
import { createEmptyProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { executeProjectTransaction } from "@icm/edit-engine";
import {
  downloadBytes,
  editComponentPropertyCode,
  expectStatus,
  exportedProject,
  openProjectFile,
  parseSavedProject,
  readComponentPropertyCode,
  setComponentParameter,
  setComponentCodeField,
  expectComponentCodeField,
  openEditor,
  openProject,
} from "./editor-fixtures.js";
import {
  exportedDocument,
  openPlacedProperties,
  placeComponent,
  openSelectionShelf,
  readComponentCode,
} from "./manual-editor-fixtures.js";
import { closeSelectionShelf, placedInstance } from "./canvas-fixtures.js";

test("source Shape controls apply only to controlled sources", async ({
  page,
}) => {
  await openPlacedProperties(
    page,
    "current-source",
    { x: 280, y: 200 },
    "hit-I1",
  );
  expect(await readComponentCode(page)).not.toHaveProperty("appearance.shape");

  await placeComponent(page, "vccs", { x: 460, y: 200 });
  await page.getByTestId("hit-G1").click();
  await openSelectionShelf(page);
  await expectComponentCodeField(page, "appearance.shape", "circle");
  const before = await exportedDocument(page);
  await setComponentCodeField(page, "appearance.shape", "diamond");
  await expect(
    page.locator(
      '[data-layer="symbols"] [data-object-id="G1"] polygon[fill="none"]',
    ),
  ).toHaveCount(1);
  const after = await exportedDocument(page);
  expect(after.annotations).toEqual(before.annotations);
  expect(after.nets).toEqual(before.nets);
  await setComponentCodeField(page, "appearance.shape", "circle");
  await expect(
    page.locator('[data-layer="symbols"] [data-object-id="G1"] circle'),
  ).toHaveCount(1);

  await placeComponent(page, "vcvs", { x: 640, y: 200 });
  await page.getByTestId("hit-E1").click();
  await openSelectionShelf(page);
  await expectComponentCodeField(page, "appearance.shape", "circle");
  await expect(
    page.locator('[data-layer="symbols"] [data-object-id="E1"] circle'),
  ).toHaveCount(1);
  const voltageBefore = await exportedDocument(page);
  await setComponentCodeField(page, "appearance.shape", "diamond");
  await expect(
    page.locator(
      '[data-layer="symbols"] [data-object-id="E1"] polygon[fill="none"]',
    ),
  ).toHaveCount(1);
  await expect(
    page
      .getByRole("button", { name: "Place VCVS", exact: true })
      .locator("circle"),
  ).toHaveCount(1);
  const voltageAfter = await exportedDocument(page);
  expect(voltageAfter.annotations).toEqual(voltageBefore.annotations);
  expect(voltageAfter.nets).toEqual(voltageBefore.nets);
  await setComponentCodeField(page, "appearance.shape", "circle");
  await expect(
    page.locator('[data-layer="symbols"] [data-object-id="E1"] circle'),
  ).toHaveCount(1);
});

test("Rail Properties switches Cell Pin and Global atomically, survives reload and undo", async ({
  page,
}) => {
  const seed = createEmptyProject("rail-connection", "Rail connection");
  const initial = executeProjectTransaction(seed, {
    transactionId: "rail",
    projectId: seed.id,
    expectedStructureRevision: seed.structureRevision,
    actor: { kind: "human", id: "test" },
    edits: [
      {
        kind: "transact_document",
        documentId: seed.topDocumentId,
        expectedRevision: 0,
        edits: [
          {
            kind: "add_power_rail",
            netId: "supply",
            routeId: "rail",
            startJunctionId: "left",
            endJunctionId: "right",
            labelId: "supply-label",
            netName: "VCC",
            scope: "global",
            powerDomain: "vdd",
            start: { x: 200, y: 200 },
            end: { x: 400, y: 200 },
          },
        ],
      },
    ],
  });
  if (!initial.ok) throw new Error(JSON.stringify(initial));
  const original = initial.project.documents[0]!;
  const load = async (content: string) => {
    await openProjectFile(page, content, "rail.icproj.json");
    await page.getByTestId("route-hit-rail").click({ force: true });
    await openSelectionShelf(page);
  };
  await openEditor(page);
  await load(serializeProject(initial.project));
  await expectComponentCodeField(page, "net.scope", "global");
  await editComponentPropertyCode(page, (code) => {
    code.net.scope = "local";
    code.display.visualAnnotation = false;
  });
  await expectComponentCodeField(page, "net.scope", "local");
  const local = await exportedProject(page);
  expect(local.documents[0]!.netlist!.terminals).toEqual([
    expect.objectContaining({
      name: "VCC",
      interfaceAnnotationId: expect.any(String),
    }),
  ]);
  expect(local.documents[0]!.routes).toEqual(original.routes);
  expect(local.documents[0]!.junctions).toEqual(original.junctions);
  await load(serializeProject(local));
  await expectComponentCodeField(page, "net.scope", "local");
  await editComponentPropertyCode(page, (code) => {
    code.net.scope = "global";
    code.display.visualAnnotation = true;
  });
  await expectComponentCodeField(page, "net.scope", "global");
  const global = await exportedProject(page);
  expect(global.documents[0]!.netlist!.terminals).toEqual([]);
  expect(global.documents[0]!.nets).toEqual(original.nets);
  expect(
    global.documents[0]!.annotations.filter(
      (label: SchematicDocument["annotations"][number]) =>
        label.visible !== false,
    ),
  ).toEqual(original.annotations);
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 40, y: 40 } });
  await page.keyboard.press("Control+z");
  const undone = await exportedProject(page);
  expect(undone.documents[0]!.netlist!.terminals).toEqual(
    local.documents[0]!.netlist!.terminals,
  );
});

test("Cell Pin Properties edits the formal name even without a canvas label", async ({
  page,
}) => {
  // A copied Pin keeps its formal name while its canvas label is absent.
  const project = createEmptyProject("pin-name", "Pin name");
  const document = project.documents[0]!;
  document.instances.push(placedInstance("P2-copy-1", "port", 300, 200));
  document.nets.push({
    id: "net-voc",
    terminals: [{ instanceId: "P2-copy-1", pinName: "P" }],
  });
  document.netlist = {
    name: document.name,
    formalParameters: [],
    terminals: [
      {
        id: "terminal-voc",
        name: "Voc",
        netId: "net-voc",
        direction: "passive",
        interfaceInstanceIds: ["P2-copy-1"],
      },
    ],
  };
  await openProject(page, serializeProject(project), "pin-name.icproj.json");
  await page.getByTestId("hit-P2-copy-1").click();
  await openSelectionShelf(page);
  await expectComponentCodeField(page, "name", "Voc");
  await editComponentPropertyCode(page, (code) => {
    code.name = "Vcm";
  });
  await expectComponentCodeField(page, "name", "Vcm");
});

test("property inspection and remounts keep canvas keyboard ownership", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 350, y: 220 });
  await placeComponent(page, "resistor", { x: 550, y: 320 });
  const canvas = page.getByTestId("schematic-canvas");
  await page.getByTestId("hit-R1").dblclick();
  const code = page.getByLabel("Editable Canvas property code");
  await expect(code).toBeVisible();
  await expect(canvas).toBeFocused();
  await page.getByTestId("hit-R2").click();
  await expect(code).toContainText("R2");
  await expect(canvas).toBeFocused();
  await page.keyboard.press("r");
  await expectComponentCodeField(page, "rotation", 90);
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("hit-R2")).toHaveCount(0);
  await expect(page.getByTestId("hit-R1")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("hit-R2")).toHaveCount(1);
  await page.getByTestId("hit-R1").click();
  await expect(code).toContainText("R1");
  await expect(canvas).toBeFocused();
});

test("explicit property typing keeps Delete local and returns shortcuts to canvas", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 350, y: 220 });
  await page.getByTestId("hit-R1").dblclick();
  const code = page.getByLabel("Editable Canvas property code");
  await code.click();
  await expect(code).toBeFocused();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("hit-R1")).toHaveCount(1);
  await expect(code).toBeFocused();
  await page.keyboard.press("ControlOrMeta+z");
  await page.getByTestId("hit-R1").click();
  await expect(page.getByTestId("schematic-canvas")).toBeFocused();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("hit-R1")).toHaveCount(0);
});

test("live Defaults are undoable and invalid drafts never change the canvas", async ({
  page,
}) => {
  await openPlacedProperties(page, "nmos", { x: 360, y: 220 });
  await setComponentParameter(page, "w", "7u");
  const revision = await page.getByTestId("revision").textContent();
  await page.getByRole("button", { name: "Defaults", exact: true }).click();
  await expectComponentCodeField(page, "parameters.w", "1u");
  await expect(page.getByTestId("revision")).toHaveText(
    String(Number(revision) + 1),
  );
  await page.getByTestId("draw-tool-undo").click();
  await expectComponentCodeField(page, "parameters.w", "7u");
  const code = page.getByLabel("Editable Canvas property code");
  const invalid = await readComponentCode(page);
  const lastValidRevision = await page.getByTestId("revision").textContent();
  invalid.color = [256, 0, 0];
  await code.fill(JSON.stringify(invalid, null, 2));
  await expect(
    page.getByText(/Canvas keeps the last valid edit/u),
  ).toBeVisible();
  await expect(page.getByTestId("revision")).toHaveText(lastValidRevision!);
  for (const control of [
    page.getByRole("button", { name: "Edit line color" }),
    page.getByRole("switch", { name: "Toggle visual annotation visibility" }),
    page.getByRole("switch", { name: "Toggle value visibility" }),
    page.getByRole("button", { name: "Rotate clockwise" }),
    page.getByRole("button", { name: "Mirror left to right" }),
    page.getByRole("button", { name: "Mirror top to bottom" }),
    page.getByLabel("Target netlist options"),
  ])
    await expect(control).toBeDisabled();
  await page.getByRole("button", { name: "Discard draft" }).click();
  await expectComponentCodeField(page, "parameters.w", "7u");
  await expect(page.locator(".cm-json-key").first()).toBeVisible();
  await expect(page.locator(".cm-json-string").first()).toBeVisible();
});

test("one live JSON edit combines model, dimensions and appearance in one undo boundary", async ({
  page,
}) => {
  await openPlacedProperties(page, "nmos", { x: 360, y: 220 });
  const nfet = "sky130_fd_pr__nfet_01v8";
  const lvt = "sky130_fd_pr__nfet_01v8_lvt";
  // Placement binds nfet_01v8, so a different model makes the edit a Project
  // structure change merged with the field edits.
  await expectComponentCodeField(page, "netlistTarget", nfet);
  await editComponentPropertyCode(page, (code) => {
    code.netlistTarget = lvt;
    code.parameters.w = "5u";
    code.color = [20, 30, 40];
  });
  await expectComponentCodeField(page, "netlistTarget", lvt);
  await expectComponentCodeField(page, "netlistName", "M1");
  await expectComponentCodeField(page, "parameters.w", "5u");
  await expectComponentCodeField(page, "color", [20, 30, 40]);
  await page.getByTestId("draw-tool-undo").click();
  await expectComponentCodeField(page, "netlistTarget", nfet);
  await expectComponentCodeField(page, "netlistName", "M1");
  await expectComponentCodeField(page, "parameters.w", "1u");
  await expectComponentCodeField(page, "color", "auto");
  await page.getByTestId("draw-tool-redo").click();
  await expectComponentCodeField(page, "netlistTarget", lvt);
  await expectComponentCodeField(page, "parameters.w", "5u");
});

async function selectWidthValue(code: Locator) {
  // Locate the width string through the actual editable DOM, then type normally.
  await code
    .locator(".cm-line")
    .filter({ hasText: '"w":' })
    .evaluate((line) => {
      const token = line.querySelector(".cm-json-string")!;
      const text = document
        .createTreeWalker(token, NodeFilter.SHOW_TEXT)
        .nextNode()!;
      const range = document.createRange();
      range.setStart(text, 1);
      range.setEnd(text, 3);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      (line.closest('[contenteditable="true"]') as HTMLElement).focus();
    });
}

test("live typing preserves the caret, local undo and incomplete JSON", async ({
  page,
}) => {
  await openPlacedProperties(page, "nmos", { x: 360, y: 220 });
  const code = page.getByLabel("Editable Canvas property code");
  await editComponentPropertyCode(page, (value) => {
    value.display.value = true;
  });
  await selectWidthValue(code);
  // These keystrokes form one typing burst. Keep the transaction clock fixed
  // so waiting for live rendering on a busy runner cannot split CodeMirror's
  // 500 ms undo group between "EV" and "x". Browser timers still run normally.
  await page.clock.setFixedTime(new Date());
  await page.keyboard.type("EV", { delay: 80 });
  const value = page.locator(
    '[data-layer="formal"] [data-object-id="instance-value-M1"]',
  );
  const lastValid = page.getByText(/Canvas keeps the last valid edit/u);
  await expect(value).toContainText("EV");
  await page.keyboard.type("x", { delay: 80 });
  await expect(value).toContainText("EVx");
  await code.press("ControlOrMeta+z");
  await expect(value).toContainText("1u");
  // Emit the actual shifted letter, not lowercase z with Shift held: the
  // latter is a synthetic layout event that CodeMirror interprets as Undo.
  await code.press("ControlOrMeta+Shift+Z");
  await expect(value).toContainText("EVx");
  const raw = await readComponentPropertyCode(page);
  const revision = await page.getByTestId("revision").textContent();
  await code.fill(raw.slice(0, -1));
  await expect(lastValid).toBeVisible();
  await expect(value).toContainText("EVx");
  await expect(page.getByTestId("revision")).toHaveText(revision!);
  await code.press("Escape");
  await expect(code).not.toBeFocused();
  await expect(lastValid).toBeVisible();
  await expect(page.getByTestId("revision")).toHaveText(revision!);
  // Suspending the hidden source projection must not unmount the live draft.
  await closeSelectionShelf(page);
  await expect(code).not.toBeVisible();
  await openSelectionShelf(page);
  await expect(lastValid).toBeVisible();
  // Native editor copy reads the draft without replacing its error status with
  // the Copy JSON button's acknowledgement. Keep the repair assertion below live.
  await code.press("ControlOrMeta+a");
  await code.press("ControlOrMeta+c");
  await expect
    .poll(async () =>
      // Native Windows clipboard copy uses CRLF; CodeMirror stores LF.
      (await page.evaluate(() => navigator.clipboard.readText())).replace(
        /\r\n/g,
        "\n",
      ),
    )
    .toBe(raw.slice(0, -1).replace(/\r\n/g, "\n"));
  await expect(lastValid).toBeVisible();
  await expect(page.getByTestId("revision")).toHaveText(revision!);
  await code.press("ControlOrMeta+End");
  await code.press("}");
  await expect(lastValid).toHaveCount(0);
  await expect(page.getByText("Live", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("revision")).toHaveText(revision!);
});

// Native Linux CI covers the full editing journey above. Exercise the Windows
// CodeMirror keymap separately without repeating malformed JSON and focus flows.
test("property code undo and redo use Control on Windows", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "platform", { get: () => "Win32" }),
  );
  await openPlacedProperties(page, "nmos", { x: 360, y: 220 });
  const code = page.getByLabel("Editable Canvas property code");
  await selectWidthValue(code);
  await page.keyboard.insertText("5u");
  await expectComponentCodeField(page, "parameters.w", "5u");
  await code.press("Control+z");
  await expectComponentCodeField(page, "parameters.w", "1u");
  await code.press("Control+Shift+Z");
  await expectComponentCodeField(page, "parameters.w", "5u");
  await expect(page.getByTestId("hit-M1")).toHaveCount(1);
});

// The narrowest stored panel width; the panel has no width breakpoints.
test("Properties resizes from 300px with plain selectable code and its inline controls", async ({
  page,
}) => {
  await page.addInitScript(
    (size) =>
      localStorage.setItem("icm.properties-panel-width.v1", String(size)),
    300,
  );
  await openPlacedProperties(page, "pmos", { x: 360, y: 220 });
  const editor = page.getByTestId("component-property-code-editor");
  const code = page.getByLabel("Editable Canvas property code");
  const target = editor.getByLabel("Target netlist options");
  const pfet = "sky130_fd_pr__pfet_01v8";
  await target.selectOption(pfet);
  await expectComponentCodeField(page, "netlistTarget", pfet);
  const picker = editor.locator(".cm-netlist-target-picker");
  await expect(picker).toBeVisible();
  await expect(
    editor.locator(".cm-json-string").filter({
      hasText: `"${pfet}"`,
    }),
  ).toHaveCount(1);
  // Only the JSON name is painted; the native menu occupies one icon button.
  await expect(target).toHaveCSS("opacity", "0");
  const pickerBox = await picker.boundingBox();
  expect(pickerBox!.width).toBeLessThanOrEqual(24);
  const editorBox = await editor.boundingBox();
  expect(pickerBox!.x + pickerBox!.width).toBeLessThanOrEqual(
    editorBox!.x + editorBox!.width,
  );
  await target.focus();
  await expect(target).toBeFocused();
  await expect(picker).toHaveCSS("outline-style", "solid");
  const raw = await readComponentPropertyCode(page);

  await expect(editor.locator(".cm-property-assist")).toHaveCount(0);
  await expect(editor.locator(".cm-property-hint")).toHaveCount(0);
  await expect(
    editor.getByRole("button", { name: "Need help?", exact: true }),
  ).toHaveCount(0);
  expect(raw).not.toContain("//");

  // Focus a text-only line; the editor center may contain an inline switch.
  await code.locator(".cm-line").first().click();
  await page.keyboard.press("ControlOrMeta+a");
  const selected = await code.evaluate(() => window.getSelection()?.toString());
  // Selection serialization uses LF even when innerText uses the Windows
  // CRLF convention. Compare all selected content, not OS line separators.
  expect(selected?.replace(/\r\n/gu, "\n")).toBe(raw.replace(/\r\n/gu, "\n"));

  // Each inline control sits on the JSON line it edits.
  for (const [control, key] of [
    [editor.getByRole("button", { name: "Edit line color" }), "color"],
    [
      editor.getByRole("switch", {
        name: "Toggle visual annotation visibility",
      }),
      "visualAnnotation",
    ],
    [editor.getByRole("switch", { name: "Toggle value visibility" }), "value"],
    [
      editor.getByRole("button", { name: "Rotate clockwise 90 degrees" }),
      "rotation",
    ],
    [editor.getByRole("button", { name: "Mirror left to right" }), "mirror"],
    [editor.getByRole("button", { name: "Mirror top to bottom" }), "mirror"],
  ] as const) {
    await expect(control).toBeVisible();
    expect(
      await control.evaluate(
        (element) => element.closest(".cm-line")?.textContent,
      ),
    ).toContain(`"${key}"`);
  }
  await editor
    .getByRole("button", { name: "Rotate clockwise 90 degrees" })
    .click();
  await expectComponentCodeField(page, "rotation", 90);
  const layout = await editor.evaluate((section) => ({
    overflow: section.scrollWidth > section.clientWidth,
    editable: Boolean(section.querySelector('[contenteditable="true"]')),
    inlineControls: section.querySelectorAll(
      ".cm-line .cm-property-inline-toggle, .cm-line .cm-property-inline-placement, .cm-line .cm-property-inline-color",
    ).length,
  }));
  // The six above, and the multiplier's ×m display (#1423).
  await expect(
    editor.locator(".cm-line", { hasText: '"m"' }).getByRole("switch"),
  ).toHaveAttribute("aria-checked", "false");
  expect(layout).toEqual({
    overflow: false,
    editable: true,
    inlineControls: 7,
  });

  // The left edge resizes by pointer and keyboard, and the width persists.
  const properties = page.getByRole("complementary", { name: "Properties" });
  const resize = page.getByTestId("properties-resize-handle");
  const width = async () => (await properties.boundingBox())!.width;
  const before = await width();
  const grip = (await resize.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 - 24, grip.y + grip.height / 2);
  await page.mouse.up();
  await expect.poll(width).toBeCloseTo(before + 24, 0);
  await resize.focus();
  await resize.press("Shift+ArrowLeft");
  await expect.poll(width).toBeCloseTo(before + 56, 0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Number(localStorage.getItem("icm.properties-panel-width.v1")),
      ),
    )
    .toBeCloseTo(before + 56, 0);
});

test("Q opens a text-first Properties editor with one-click exact draft copy", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "pmos", { x: 360, y: 220 });
  await closeSelectionShelf(page);
  await page.keyboard.press("q");
  const code = page.getByLabel("Editable Canvas property code");
  await expect(code).toBeVisible();
  await page.keyboard.press("q");
  await expect(code).not.toBeVisible();
  await page.keyboard.press("q");
  await expect(code).toBeVisible();
  const draft = await readComponentCode(page);
  draft.parameters.w = "EV";
  const raw = JSON.stringify(draft, null, 2) + "\n\n";
  await code.fill(raw);
  await code.press("ControlOrMeta+End");
  const copy = page.getByRole("button", { name: "Copy JSON", exact: true });
  await expect(copy).toHaveCount(1);
  await expect(copy.locator("svg")).toBeVisible();
  await copy.click();
  expect(
    (await page.evaluate(() => navigator.clipboard.readText())).replace(
      /\r\n/g,
      "\n",
    ),
  ).toBe(raw);
  await expect(
    page.getByText("JSON copied", {
      exact: true,
    }),
  ).toBeVisible();
  const positions = await page
    .getByTestId("component-property-code-editor")
    .evaluate((section) => {
      const copy = section
        .querySelector(".component-property-copy")!
        .getBoundingClientRect();
      const editor = section
        .querySelector(".cm-scroller")!
        .getBoundingClientRect();
      return {
        copyBottom: copy.bottom,
        editorTop: editor.top,
        editorHeight: editor.height,
        panelHeight: section.getBoundingClientRect().height,
      };
    });
  expect(positions.copyBottom).toBeGreaterThan(0);
  expect(positions.editorHeight).toBeGreaterThan(240);
  await page.getByTestId("draw-tool-undo").click();
  await expectComponentCodeField(page, "parameters.w", "1u");
});

test("batch Code lists differing values, edits them atomically and refuses incompatible values", async ({
  page,
}) => {
  const project = createEmptyProject("batch-values", "Batch values");
  project.documents[0]!.instances = [
    ["R1", "resistor", { value: "1k", tc: "1" }],
    ["R2", "resistor", { tc: "2" }],
    ["C1", "capacitor", { value: "1p" }],
  ].map(([id, symbolId, parameters], index) => ({
    ...placedInstance(id as string, symbolId as string, 100 + index * 180, 100),
    reference: id as string,
    netlist: {
      binding: {
        kind: "primitive" as const,
        deviceClass: symbolId as "resistor" | "capacitor",
      },
      parameters: parameters as Record<string, string>,
    },
  }));
  await openProject(
    page,
    serializeProject(project),
    "batch-values.icproj.json",
  );
  await expectStatus(page, "Opened batch-values.icproj.json");
  await page.getByTestId("hit-R1").click();
  await page.getByTestId("hit-R2").click({ modifiers: ["Shift"] });
  await openSelectionShelf(page);
  const batch = page.getByTestId("group-property-code-editor");
  await expect(batch.getByText("2 selected", { exact: true })).toBeVisible();
  const code = await readComponentCode(page);
  // Values that differ are listed per component.
  expect(code).toMatchObject({
    type: "resistor",
    parameters: { value: { R1: "1k", R2: "" }, tc: { R1: "1", R2: "2" } },
    color: [0, 0, 0],
  });
  const revision = Number(await page.getByTestId("revision").textContent());
  await editComponentPropertyCode(page, (value) => {
    value.parameters.value = "10k";
    value.color = [255, 0, 0];
    value.display.value = true;
  });
  await expect(page.getByTestId("revision")).toHaveText(String(revision + 1));
  for (const id of ["R1", "R2"]) {
    await expect(
      page.locator(`[data-object-id="${id}"] [data-role="instance-symbol"]`),
    ).toHaveAttribute("stroke", "#ff0000");
    await expect(
      page.locator(`[data-object-id="instance-value-${id}"]`),
    ).toContainText("10k");
  }
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(await readComponentCode(page)).toEqual(code);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  // The value both now share is still listed per component, beside each tc.
  expect(await readComponentCode(page)).toMatchObject({
    parameters: { value: { R1: "10k", R2: "10k" }, tc: { R1: "1", R2: "2" } },
  });

  // A resistance typed for a resistor and a capacitor together is refused.
  await page.getByTestId("hit-C1").click({ modifiers: ["Shift"] });
  const mixed = await readComponentCode(page);
  expect(mixed).toMatchObject({
    type: "",
    parameters: { value: { R1: "10k", R2: "10k", C1: "1p" } },
    color: { R1: [255, 0, 0], R2: [255, 0, 0], C1: [0, 0, 0] },
  });
  const mixedRevision = await page.getByTestId("revision").textContent();
  await page
    .getByLabel("Editable Canvas property code")
    .fill(JSON.stringify({ ...mixed, parameters: { value: "10k" } }));
  const discard = page.getByRole("button", {
    name: "Discard draft",
    exact: true,
  });
  await expect(discard).toBeVisible();
  await expect(page.getByTestId("revision")).toHaveText(mixedRevision!);
  await discard.click();
  // One color entered for the batch colors every type.
  await editComponentPropertyCode(page, (value) => {
    value.color = [220, 38, 38];
  });
  for (const id of ["R1", "R2", "C1"])
    await expect(
      page.locator(`[data-object-id="${id}"] [data-role="instance-symbol"]`),
    ).toHaveAttribute("stroke", "#dc2626");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect((await readComponentCode(page)).color).toEqual({
    R1: [255, 0, 0],
    R2: [255, 0, 0],
    C1: [0, 0, 0],
  });
});

test("Properties keeps component and Annotation text colors independent", async ({
  page,
}) => {
  const clockStart = Date.parse("2026-08-31T00:00:00Z");
  await page.clock.install({ time: clockStart });
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 280, y: 180 });
  await placeComponent(page, "resistor", { x: 480, y: 180 });
  await page.getByTestId("hit-R1").click();
  await openSelectionShelf(page);

  const properties = page.getByRole("complementary", { name: "Properties" });
  const component = page.locator('[data-object-id="R1"]');
  const symbol = component.locator('[data-role="instance-symbol"]');
  const label = page.locator('[data-object-id="instance-label-R1"]');
  const secondLabel = page.locator('[data-object-id="instance-label-R2"]');
  const labelHit = page.getByTestId("annotation-hit-instance-label-R1");

  await editComponentPropertyCode(page, (value) => {
    value.color = "#dc2626";
  });
  await expect(symbol).toHaveAttribute("stroke", "#dc2626");
  await expect(
    component.locator('[data-role="instance-background"]'),
  ).toHaveCount(0);
  await expect(label).toHaveAttribute("fill", "#dc2626");

  await labelHit.click({ force: true });
  await openSelectionShelf(page);
  await expect(
    properties.getByRole("region", { name: "Text properties" }),
  ).toBeVisible();
  expect((await readComponentCode(page)).color).toBe("auto");
  await properties.getByRole("button", { name: "Edit text color" }).click();
  await page
    .getByRole("button", { name: "Use Blue for text", exact: true })
    .click();
  await expect(label).toHaveAttribute("fill", "#2563eb");
  await expect(symbol).toHaveAttribute("stroke", "#dc2626");

  // Incomplete property code belongs only to this selection and never reaches another label.
  await page
    .getByLabel("Editable Canvas property code")
    .fill('{ "appearance":');
  await page
    .getByTestId("annotation-hit-instance-label-R2")
    .click({ force: true });
  await expect(label).toHaveAttribute("fill", "#2563eb");
  await expect(secondLabel).not.toHaveAttribute("fill");
  expect((await readComponentCode(page)).color).toBe("auto");

  await labelHit.click({ force: true });
  await editComponentPropertyCode(page, (code) => {
    code.color = "auto";
  });
  await expect(label).toHaveAttribute("fill", "#dc2626");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(label).toHaveAttribute("fill", "#2563eb");
  expect((await readComponentCode(page)).color).toEqual([37, 99, 235]);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(label).toHaveAttribute("fill", "#dc2626");
  expect((await readComponentCode(page)).color).toBe("auto");

  const project = await exportedProject(page);
  const savedR1 = project.documents[0].instances.find(
    (instance: { id: string }) => instance.id === "R1",
  );
  const savedLabel = project.documents[0].annotations.find(
    (annotation: { id: string }) => annotation.id === "instance-label-R1",
  );
  expect(savedR1.styleOverride).toEqual({ foreground: "#dc2626" });
  expect(savedR1.styleOverride).not.toHaveProperty("labelColor");
  expect(savedLabel).not.toHaveProperty("textColor");
});

test("value display projects MOS W/L beside the reference", async ({
  page,
}) => {
  await openEditor(page);
  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  await dialog.getByLabel("Component search").fill("nmos");
  await dialog.getByTestId("insert-component-nmos").click();
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 360, y: 240 } });
  await page.keyboard.press("Escape");

  // Geometry and the Value display are Properties decisions after placement.
  await page.getByTestId("hit-M1").click();
  await openSelectionShelf(page);
  await setComponentParameter(page, "w", "41um");
  await setComponentParameter(page, "l", "80nm");
  await setComponentParameter(page, "m", "4");
  await editComponentPropertyCode(page, (propertyCode) => {
    propertyCode.display.value = true;
  });
  await canvas.click({ position: { x: 80, y: 80 } });

  const reference = page.locator('[data-object-id="instance-label-M1"]');
  const value = page.locator('[data-object-id="instance-value-M1"]');
  await expect(reference).toContainText("M1");
  // MOS values render as a stacked fraction with engineering units: the
  // numerator and denominator are separate part texts around a fraction bar.
  await expect(value).toContainText("41um");
  await expect(value).toContainText("80nm");
  await expect(value).toContainText("×4");
  await expect(page.locator('[data-role="fraction-bar"]')).toHaveCount(1);
  await expect(
    value.locator('[data-role="fraction-numerator"]'),
  ).not.toHaveAttribute("textLength");
  await expect(
    value.locator('[data-role="fraction-denominator"]'),
  ).not.toHaveAttribute("textLength");
  await expect(value.locator('text[text-anchor="start"]')).not.toHaveAttribute(
    "lengthAdjust",
  );
  const fractionCenters = await value.evaluate((element) => {
    const box = (role: string) => {
      const part = element.querySelector<SVGGraphicsElement>(
        `[data-role="fraction-${role}"]`,
      )!;
      if (role === "bar") return part.getBBox();
      // Compare typographic advances, not platform-specific ink overhang.
      const texts = part.matches("text")
        ? [part as SVGTextElement]
        : Array.from(part.querySelectorAll("text"));
      const positions = texts.flatMap((text) =>
        Array.from({ length: text.getNumberOfChars() }, (_, index) => [
          text.getStartPositionOfChar(index).x,
          text.getEndPositionOfChar(index).x,
        ]).flat(),
      );
      const x = Math.min(...positions);
      return { x, width: Math.max(...positions) - x };
    };
    const bar = box("bar");
    return [box("numerator"), box("denominator")].map((part) => ({
      centerGap: Math.abs(part.x + part.width / 2 - bar.x - bar.width / 2),
      leftGap: part.x - bar.x,
      rightGap: bar.x + bar.width - part.x - part.width,
    }));
  });
  for (const part of fractionCenters) {
    expect(part.centerGap).toBeLessThan(0.02);
    expect(part.leftGap).toBeGreaterThan(0);
    expect(part.rightGap).toBeGreaterThan(0);
  }
  const multiplierGap = await value.evaluate((element) => {
    const bar = element.querySelector<SVGLineElement>(
      '[data-role="fraction-bar"]',
    );
    const multiplier = [
      ...element.querySelectorAll<SVGTextElement>("text"),
    ].find((text) => text.getAttribute("text-anchor") === "start");
    if (!bar || !multiplier) throw new Error("Value geometry is incomplete");
    const barBox = bar.getBBox();
    return multiplier.getStartPositionOfChar(1).x - (barBox.x + barBox.width);
  });
  expect(multiplierGap).toBeGreaterThan(0);
  expect(multiplierGap).toBeLessThan(12);
  // The value block is the second upright row under the reference.
  const referenceBox = await reference.boundingBox();
  const valueBox = await value.boundingBox();
  if (!referenceBox || !valueBox) throw new Error("Labels are not measurable");
  expect(valueBox.y).toBeGreaterThan(referenceBox.y);
});

test("a W/L numerator drags freely and keeps its offset through history and file reload", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "nmos", { x: 350, y: 250 });
  const canvas = page.getByTestId("schematic-canvas");
  const instance = page.getByTestId("hit-M1");
  await instance.click();
  await openSelectionShelf(page);
  await setComponentParameter(page, "w", "2u");
  await setComponentParameter(page, "l", "180n");
  await setComponentParameter(page, "m", "4");
  await editComponentPropertyCode(page, (code) => {
    code.display.value = true;
  });
  await canvas.click({ position: { x: 70, y: 70 } });

  const value = page.locator('[data-object-id="instance-value-M1"]');
  const numerator = value.locator('[data-role="fraction-numerator"]');
  await expect(numerator).toContainText("2u");
  const before = (await value.boundingBox())!;
  const ownerBefore = (await instance.boundingBox())!;
  const grip = (await numerator.boundingBox())!;
  const start = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
  // Grab the numerator itself, not the lower hit rectangle or an Alt cycle.
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 180, start.y + 120, { steps: 12 });
  const valueX = async () => (await value.boundingBox())!.x;
  await expect.poll(valueX).toBeCloseTo(before.x + 180, 0);
  await page.mouse.up();
  // The only allowed difference on release is annotation-grid rounding.
  await expect
    .poll(async () => Math.abs((await value.boundingBox())!.x - before.x - 180))
    .toBeLessThan(3);
  await expect
    .poll(async () => Math.abs((await value.boundingBox())!.y - before.y - 120))
    .toBeLessThan(3);
  expect(await instance.boundingBox()).toEqual(ownerBefore);
  const dropped = (await value.boundingBox())!;

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(valueX).toBeCloseTo(before.x, 0);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(valueX).toBeCloseTo(dropped.x, 0);

  const valueAnchor = (document: SchematicDocument) => {
    const anchor = document.annotations.find(
      (annotation) => annotation.id === "instance-value-M1",
    )!.anchor;
    if (anchor.kind !== "object")
      throw new Error("Value must retain its component anchor");
    return anchor;
  };
  const authored = await exportedDocument(page);
  const anchor = valueAnchor(authored);
  expect(anchor.objectId).toBe("M1");
  expect(
    Math.hypot(anchor.localOffset.x, anchor.localOffset.y),
  ).toBeGreaterThan(200);

  // Reopen a real exported file, then export again to verify persisted data.
  const saved = await downloadBytes(page, "File", "Export Project File…");
  await openProjectFile(page, saved, "value-drag.icproj.json");
  await expect(numerator).toContainText("2u");
  const reopened = await exportedDocument(page);
  expect(valueAnchor(reopened)).toEqual(anchor);
  expect(reopened.instances).toEqual(authored.instances);
  expect(reopened.nets).toEqual(authored.nets);
});

test("live property edits survive blank click and Escape without replaying legacy drafts", async ({
  page,
}) => {
  await openPlacedProperties(page, "resistor", { x: 320, y: 200 }, "hit-R1");
  const canvas = page.getByTestId("schematic-canvas");
  await setComponentParameter(page, "value", "33k");
  await canvas.click({ position: { x: 60, y: 60 } });
  await expect(page.getByTestId("revision")).toHaveText("2");

  await page.getByTestId("hit-R1").click();
  await openSelectionShelf(page);
  await expectComponentCodeField(page, "parameters.value", "33k");

  await setComponentParameter(page, "value", "47k");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("revision")).toHaveText("3");

  await canvas.click({ position: { x: 60, y: 60 } });
  await page.getByTestId("hit-R1").click();
  await openSelectionShelf(page);
  await expectComponentCodeField(page, "parameters.value", "47k");
});

test("edits a formula-capable Signal Flow block with undo, redo, and Reset defaults", async ({
  page,
}) => {
  // Capability determines this scenario: a catalog addition becomes the
  // exercised block without this test baking in a symbol ID. Blocks whose
  // frame takes a non-rectangular `shape` are excluded — they size their body
  // by different rules, and the frame dimensions asserted below belong to the
  // rectangular family. A tapered block is its own scenario.
  const formulaSymbol = razaviProductSymbols.find(
    (symbol) =>
      symbol.formulaPresentation?.supportsCoefficient &&
      symbol.formulaPresentation.adaptiveFrame &&
      !symbol.formulaPresentation.adaptiveFrame.shape,
  );
  expect(formulaSymbol).toBeDefined();
  const symbol = formulaSymbol!;

  await openPlacedProperties(page, symbol.id, { x: 360, y: 240 });
  const properties = page.getByRole("complementary", { name: "Properties" });
  // Empty presentation code inherits the canonical symbol's own formula.
  await expectComponentCodeField(page, "signalFlow", {});

  const formalScene = page.locator('[data-layer="formal"]');
  const renderedFormula = formalScene.locator(
    '[data-role="signal-flow-formula"]',
  );
  const frame = formalScene.locator('[data-role="signal-flow-frame"]');
  await expect(renderedFormula).toHaveCount(1);
  await expect(renderedFormula.locator('text[font-size="12"]')).not.toHaveCount(
    0,
  );

  await setComponentCodeField(page, "signalFlow.formula", "z⁻¹/(1−z⁻¹)");
  await expect(
    formalScene.locator('[data-role="formula-fraction-bar"]'),
  ).toHaveCount(1);
  await expect(
    formalScene.locator('[data-role="formula-superscript"]'),
  ).toHaveCount(2);
  await expect(frame).toHaveAttribute("width", "60");
  // The 40-unit preset is a minimum. The shared stacked-fraction layout
  // expands to 50 units so superscript denominators clear the fraction bar.
  await expect(frame).toHaveAttribute("height", "50");

  await setComponentCodeField(page, "signalFlow.coefficient", "K");
  await expect(
    formalScene.locator('[data-role="formula-coefficient"]'),
  ).toHaveText("K·");
  await expect(frame).toHaveAttribute("width", "80");

  await setComponentCodeField(page, "signalFlow.bodyWidth", 160);
  await setComponentCodeField(page, "signalFlow.bodyHeight", 80);
  await expect(frame).toHaveAttribute("width", "160");
  await expect(frame).toHaveAttribute("height", "80");

  await page.getByTestId("draw-tool-undo").click();
  await expect(frame).toHaveAttribute("height", "50");
  await page.getByTestId("draw-tool-redo").click();
  await expect(frame).toHaveAttribute("height", "80");

  await properties
    .getByRole("button", { name: "Defaults", exact: true })
    .click();
  // Reset restores the Symbol's own formula as editable text, not an empty
  // box: the default is the starting point for the next edit.
  await expectComponentCodeField(page, "signalFlow", {});
  await expect(
    formalScene.locator('[data-role="formula-coefficient"]'),
  ).toHaveCount(0);
});

test("selects a reviewed SKY130 MOS through the inline Target netlist field", async ({
  page,
}) => {
  await openPlacedProperties(page, "nmos", { x: 360, y: 220 });
  const properties = page.getByRole("complementary", { name: "Properties" });
  await expect(
    properties.getByRole("button", { name: "Need help?", exact: true }),
  ).toHaveCount(0);
  const model = "sky130_fd_pr__nfet_01v8";
  await properties.getByLabel("Target netlist options").selectOption(model);
  await expectComponentCodeField(page, "netlistTarget", model);
  await expectComponentCodeField(page, "parameters.nf", "1");
  await expectComponentCodeField(page, "parameters.m", "1");
  // Clearing to None and choosing the Model again keep the netlist name.
  await setComponentCodeField(page, "netlistTarget", "");
  await expectComponentCodeField(page, "netlistName", "M1");
  await setComponentCodeField(page, "netlistTarget", model);
  await expectComponentCodeField(page, "netlistName", "M1");

  const saved = await exportedProject(page);
  expect(
    saved.externalSubcircuitDefinitions.map(
      (definition: { name: string; terminals: { name: string }[] }) => [
        definition.name,
        definition.terminals.map((terminal) => terminal.name),
      ],
    ),
  ).toEqual([[model, ["D", "G", "S", "B"]]]);
  expect(saved.documents[0].instances[0]).toMatchObject({
    reference: "M1",
    netlist: {
      parameters: { w: "1u", l: "150n", nf: "1", m: "1" },
      binding: { kind: "external-subcircuit" },
    },
  });
});

test("transformer parameter labels show independently, edit on the canvas and survive history and files", async ({
  page,
}) => {
  await openPlacedProperties(page, "xfmr", { x: 360, y: 220 });
  const labels = page.locator(
    '[data-layer="formal"] [data-kind="instance-value"]',
  );
  const kToggle = page.getByRole("switch", {
    name: "Toggle K visibility",
    exact: true,
  });
  await expect(kToggle).toHaveAttribute("aria-checked", "false");
  await kToggle.click();
  await expect(labels).toHaveCount(1);
  await expect(labels).toContainText("K = 1");
  await editComponentPropertyCode(page, (code) => {
    code.display.parameters.k = false;
    code.display.parameters.lp = true;
  });
  await expect(labels).toHaveCount(1);
  await expect(labels).toContainText("Lp = 1n");
  await page.getByTestId("draw-tool-undo").click();
  await expect(labels).toContainText("K = 1");
  await page.getByTestId("draw-tool-redo").click();

  // The label edits its parameter on the canvas and refuses an empty value.
  const id = await labels.getAttribute("data-object-id");
  const hit = page.getByTestId(`annotation-hit-${id}`);
  const editor = page.getByLabel("Canvas text editor", { exact: true });
  const relabel = async (text: string) => {
    await hit.dblclick();
    await editor.fill(text);
    await editor.press("Enter");
  };
  await relabel("Lp = 2.5n");
  await expect(editor).toHaveCount(0);
  await expect(labels).toContainText("Lp = 2.5n");
  await relabel("Lp =");
  await expect(editor).toBeVisible();
  await editor.press("Escape");
  await expect(labels).toContainText("Lp = 2.5n");
  // The bare name keeps the parameter and shows only the name; empty hides it.
  await relabel("Lp");
  await expect(labels).toHaveText("Lp");
  await relabel("");
  await expect(labels).toHaveCount(0);
  await page.getByTestId("draw-tool-undo").click();
  await expect(labels).toHaveText("Lp");

  // Both labels stack under a turned part and reopen from the file.
  await page.locator('[data-canvas-hit-kind="instance"]').click();
  await openSelectionShelf(page);
  await editComponentPropertyCode(page, (code) => {
    code.display.parameters.k = true;
    code.parameters.k = "0.83";
    code.rotation = 45;
  });
  await expect(labels).toHaveCount(2);
  const boxes = await labels.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().toJSON()),
  );
  expect(boxes[0]!.x).toBeCloseTo(boxes[1]!.x, 1);
  expect(boxes[0]!.bottom).toBeLessThan(boxes[1]!.y);
  const saved = await downloadBytes(page, "File", "Export Project File…");
  const instance = parseSavedProject(saved.toString("utf8")).documents[0]
    .instances[0];
  expect(instance.netlist.parameters).toMatchObject({ lp: "2.5n", k: "0.83" });
  await openProjectFile(page, saved, "xfmr.icproj.json");
  await page.getByTestId(`hit-${instance.id}`).click();
  await openSelectionShelf(page);
  await expect(kToggle).toHaveAttribute("aria-checked", "true");
  await expect(labels).toHaveCount(2);
  await expect(labels.filter({ hasText: "K = 0.83" })).toHaveCount(1);
});

test("batch Code drafts follow selection identity even when common values are identical", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 250, y: 200 });
  await placeComponent(page, "resistor", { x: 450, y: 200 });
  await placeComponent(page, "resistor", { x: 650, y: 200 });
  await page.getByTestId("hit-R1").click();
  await page.getByTestId("hit-R2").click({ modifiers: ["Shift"] });
  await openSelectionShelf(page);
  await page
    .getByLabel("Editable Canvas property code")
    .fill('{ "appearance":');
  await page.getByTestId("hit-R3").click({ modifiers: ["Shift"] });
  await expect(
    page.getByRole("button", { name: "Discard draft", exact: true }),
  ).toHaveCount(0);
  expect(
    JSON.parse(await readComponentPropertyCode(page)).parameters.value,
  ).toEqual({ R1: "1k", R2: "1k", R3: "1k" });
  // One value in place of the list sets all three.
  await editComponentPropertyCode(page, (code) => {
    code.parameters.value = "22k";
  });
  const saved = await exportedProject(page);
  expect(
    saved.documents[0].instances.map(
      (instance: any) => instance.netlist.parameters.value,
    ),
  ).toEqual(["22k", "22k", "22k"]);
});
