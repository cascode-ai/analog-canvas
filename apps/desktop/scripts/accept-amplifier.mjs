import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { acceptGraphics } from "./accept-graphics.mjs";

/** Reviewed native-ota starter, edited through the shipped editor UI. No simulation. */
export async function acceptAmplifier({
  page,
  root,
  output,
  chooseExport,
  exportProject,
}) {
  const fixture = join(
    root,
    "apps/editor/src/examples/simulation-ota.icproj.json",
  );
  const original = parseProject(await readFile(fixture, "utf8"));
  await page.getByTestId("tab-project-file").setInputFiles(fixture);
  await expect(page.getByTestId("instance-count")).toHaveText("23");
  const countRoutes = await page.locator('[data-testid^="route-hit-"]').count();
  const canvas = page.getByTestId("schematic-canvas");
  const box = await canvas.boundingBox();
  assert(box);
  // Place and connect two temporary parts on the same amplifier canvas.
  for (const y of [0.7, 0.9]) {
    await page.keyboard.press("i");
    const picker = page.getByRole("dialog", {
      name: "Insert Component",
      exact: true,
    });
    await picker.getByLabel("Component search").fill("resistor");
    await picker.getByTestId("insert-component-resistor").click();
    await canvas.click({
      position: { x: box.width * 0.15, y: box.height * y },
    });
    await page.keyboard.press("Escape");
  }
  await expect(page.getByTestId("instance-count")).toHaveText("25");
  await page.getByTestId("draw-tool-wire").click();
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-testid^="route-hit-"]')).toHaveCount(
    countRoutes + 1,
  );
  await page.getByTestId("draw-tool-undo").click();
  await expect(page.locator('[data-testid^="route-hit-"]')).toHaveCount(
    countRoutes,
  );
  await page.getByTestId("draw-tool-undo").click();
  await page.getByTestId("draw-tool-undo").click();
  await expect(page.getByTestId("instance-count")).toHaveText("23");

  await page.getByTestId("hit-CL").click();
  await page.keyboard.press("c");
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.8);
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  await canvas.click({ position: { x: box.width * 0.2, y: box.height * 0.8 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("instance-count")).toHaveText("24");
  await page.getByTestId("draw-tool-undo").click();
  await expect(page.getByTestId("instance-count")).toHaveText("23");
  await page.getByTestId("draw-tool-redo").click();
  await expect(page.getByTestId("instance-count")).toHaveText("24");
  await page.getByTestId("draw-tool-undo").click();

  const netlistToggle = page.getByTestId("netlist-panel-toggle");
  if ((await netlistToggle.getAttribute("aria-pressed")) === "true")
    await netlistToggle.click();
  await page.getByTestId("hit-CL").click();
  const shelf = page.getByTestId("selection-shelf");
  if ((await shelf.getAttribute("aria-expanded")) !== "true")
    await shelf.click();
  const code = page.getByLabel("Editable Canvas property code");
  await expect(code).toBeVisible();
  // Inline controls are widgets, not JSON source. Read the displayed source
  // without depending on the user's global Windows clipboard.
  const properties = JSON.parse(
    await code.evaluate((element) => {
      const clone = element.cloneNode(true);
      for (const widget of clone.querySelectorAll('[contenteditable="false"]'))
        widget.remove();
      return [...clone.querySelectorAll(".cm-line")]
        .map((line) => line.textContent)
        .join("\n");
    }),
  );
  properties.parameters.value = "2p";
  await code.fill(JSON.stringify(properties, null, 2));
  await page.keyboard.press("Tab");
  await page.keyboard.press("Escape");
  await page.getByTestId("document-selector").selectOption("document-ota-5t");
  await expect(page.getByTestId("hit-M1")).toBeVisible();
  await expect(page.getByTestId("instance-count")).toHaveText("23");
  await page
    .getByTestId("document-selector")
    .selectOption(original.topDocumentId);
  await page.keyboard.press("Control+s");
  await expect(page.getByText(/^Saved:/)).toBeVisible();
  const location = await page
    .getByTestId("native-file-location")
    .getAttribute("title");
  const saved = parseProject(await readFile(location, "utf8"));
  assert.equal(
    saved.documents
      .find((d) => d.id === original.topDocumentId)
      .instances.find((i) => i.id === "CL").netlist.parameters.value,
    "2p",
  );
  assert.deepEqual(saved.simulationFolders, original.simulationFolders);
  assert.equal(saved.simulationFolders.length, 8);
  assert.deepEqual(
    saved.externalSubcircuitDefinitions,
    original.externalSubcircuitDefinitions,
  );
  assert.deepEqual(saved.source, original.source);
  const exchange = await exportProject(
    page,
    join(output, "native-ota.icproj.json"),
  );
  assert.equal(serializeProject(exchange), serializeProject(saved));
  await acceptGraphics({ page, output, stem: "native-ota", chooseExport });
  assert.equal(await page.title(), `${saved.name} — Analog Canvas`);
  assert(
    !(await page.getByTestId("native-file-location").textContent()).includes(
      location,
    ),
  );

  if ((await netlistToggle.getAttribute("aria-pressed")) !== "true")
    await netlistToggle.click();
  const netlist = page.getByRole("region", {
    name: "Live netlist",
    exact: true,
  });
  for (const format of ["spice", "spectre"]) {
    await netlist.getByLabel("Netlist format").selectOption(format);
    const path = join(
      output,
      `native-ota.${format === "spice" ? "cir" : "scs"}`,
    );
    await chooseExport(path);
    await netlist
      .getByRole("button", { name: "Save netlist file…", exact: true })
      .click();
    await expect
      .poll(async () => {
        try {
          return (await readFile(path, "utf8")).length;
        } catch {
          return 0;
        }
      })
      .toBeGreaterThan(100);
    const text = await readFile(path, "utf8");
    assert.match(text, /subckt ota_5t/i);
    assert.match(text, /2p/);
  }
  await page.screenshot({ path: join(output, "native-ota.png") });
  return location;
}
