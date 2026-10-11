import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { builtInSymbols } from "@icm/symbols";

async function openLibrary(page) {
  await page.getByTestId("edit-menu").locator("summary").click();
  await page
    .getByRole("button", { name: "User Components…", exact: true })
    .click();
  const library = page.getByRole("dialog", {
    name: "User Components",
    exact: true,
  });
  await expect(library).toBeVisible();
  return library;
}

/** Author, persist, edit and capture through the actual desktop UI, without auth. */
export async function acceptLocalComponents({
  page,
  running,
  output,
  chooseExport,
  exportProject,
}) {
  const library = await openLibrary(page);
  await library
    .getByRole("button", { name: "Create Component…", exact: true })
    .click();
  const editor = page.getByRole("dialog", {
    name: "Edit Component Definition",
    exact: true,
  });
  await expect(editor.getByLabel("Definition type")).toHaveValue("circuit");
  const source =
    ".subckt local_gain IN OUT params: gain=2\nE1 OUT 0 IN 0 {gain}\n.ends local_gain";
  await editor
    .getByLabel("External model netlist", { exact: true })
    .fill(source);
  await editor
    .getByRole("button", { name: "Apply model", exact: true })
    .click();
  await editor
    .getByRole("button", { name: "Save to local library", exact: true })
    .click();
  await expect(
    editor.getByText("Saved to the local library.", { exact: true }),
  ).toBeVisible();
  await editor
    .getByRole("button", { name: "Back to library", exact: true })
    .click();
  const entry = library.getByRole("listitem").filter({ hasText: "local_gain" });
  await expect(entry).toHaveCount(1);
  await entry.getByRole("button", { name: "Place", exact: true }).click();
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 340, y: 250 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("instance-count")).toHaveText("1");
  const captured = await exportProject(
    page,
    join(output, "local-component-capture.icproj.json"),
  );
  assert(
    captured.modelSources.some((record) =>
      record.files.some((file) => file.text === source),
    ),
  );

  await openLibrary(page);
  await entry
    .getByRole("button", { name: "Edit definition…", exact: true })
    .click();
  const changed = source.replace("gain=2", "gain=4");
  await editor
    .getByLabel("External model netlist", { exact: true })
    .fill(changed);
  await editor
    .getByRole("button", { name: "Apply model", exact: true })
    .click();
  await editor
    .getByRole("button", { name: "Update local component", exact: true })
    .click();
  await expect(
    editor.getByText("Saved to the local library.", { exact: true }),
  ).toBeVisible();
  await editor
    .getByRole("button", { name: "Back to library", exact: true })
    .click();
  await entry.locator("summary").click();
  const definitionPath = join(output, "local_gain.component.json");
  await chooseExport(definitionPath);
  await entry
    .getByRole("button", { name: "Export definition…", exact: true })
    .click();
  await expect
    .poll(async () =>
      readFile(definitionPath, "utf8")
        .then((text) => JSON.parse(text).revision)
        .catch(() => null),
    )
    .toBe(2);
  const saved = JSON.parse(await readFile(definitionPath, "utf8"));
  assert(saved.circuit.source.files.some((file) => file.text === changed));
  await entry
    .getByRole("button", { name: "Remove component", exact: true })
    .click();
  await entry
    .getByRole("button", { name: "Really delete", exact: true })
    .click();
  await expect(entry).toHaveCount(0);
  await library.getByLabel("Component list filter").selectOption("deleted");
  await expect(entry).toHaveCount(1);
  await entry.getByRole("button", { name: "Restore", exact: true }).click();
  await library.getByLabel("Component list filter").selectOption("active");
  await expect(entry).toHaveCount(1);
  await library
    .getByLabel("Import local component")
    .setInputFiles(definitionPath);
  await expect(entry).toHaveCount(2);
  await page.screenshot({ path: join(output, "local-components.png") });
  await library.getByRole("button", { name: "Close", exact: true }).click();
  const unchanged = await exportProject(
    page,
    join(output, "local-component-after-library-edit.icproj.json"),
  );
  // Authoring snapshots can change; the applied capture and its source cannot.
  assert.deepEqual(
    unchanged.componentDefinitions,
    captured.componentDefinitions,
  );
  assert.deepEqual(
    unchanged.modelSources.map(({ draft: _draft, ...record }) => record),
    captured.modelSources.map(({ draft: _draft, ...record }) => record),
  );
  await page.keyboard.press("Control+s");
  await expect(page.getByText(/^Saved:/)).toBeVisible();

  await openLibrary(page);
  await library
    .getByRole("button", { name: "Create Component…", exact: true })
    .click();
  await editor.getByLabel("Definition type").selectOption("json");
  await editor.getByLabel("Component definition code", { exact: true }).fill(
    JSON.stringify({
      symbol: {
        ...builtInSymbols.find((symbol) => symbol.id === "resistor"),
        id: "local-artwork",
        name: "Local artwork",
      },
    }),
  );
  await editor.getByRole("button", { name: "Apply", exact: true }).click();
  await editor
    .getByRole("button", { name: "Save to local library", exact: true })
    .click();
  await expect(
    editor.getByText("Saved to the local library.", { exact: true }),
  ).toBeVisible();
  await editor
    .getByRole("button", { name: "Back to library", exact: true })
    .click();
  await library
    .getByRole("listitem")
    .filter({ hasText: "Local artwork" })
    .getByRole("button", { name: "Place", exact: true })
    .click();
  await canvas.click({ position: { x: 500, y: 250 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("instance-count")).toHaveText("2");
  await page.keyboard.press("Control+s");
  await expect(page.getByText(/^Saved:/)).toBeVisible();

  await running.evaluate(({ shell }) => {
    globalThis.__openedProductLinks = [];
    shell.openExternal = async (url) => {
      globalThis.__openedProductLinks.push(url);
    };
  });
  await page.getByRole("link", { name: "TokenZhang", exact: true }).click();
  await page
    .getByRole("link", { name: "GitHub repository", exact: true })
    .click();
  const about = page.getByRole("button", { name: "About", exact: true });
  const aboutBox = await about.boundingBox();
  const homeBox = await page
    .getByRole("button", { name: "Local projects", exact: true })
    .boundingBox();
  assert(aboutBox.x > homeBox.x);
  await about.click();
  await page
    .getByRole("link", { name: "View source on GitHub ↗", exact: true })
    .click();
  await expect
    .poll(() => running.evaluate(() => globalThis.__openedProductLinks.length))
    .toBe(3);
  const opened = await running.evaluate(() => globalThis.__openedProductLinks);
  assert.equal(opened[0], "https://tokenzhang.com");
  assert.equal(opened[1], "https://github.com/cascode-ai/analog-canvas");
  assert.match(
    opened[2],
    /^https:\/\/github\.com\/cascode-ai\/analog-canvas\/commit\/[a-f0-9]{40}$/u,
  );
  await page
    .getByRole("dialog", { name: "About Analog Canvas" })
    .getByRole("button", { name: "Close", exact: true })
    .click();
}

export async function acceptLocalComponentRestart(page) {
  const library = await openLibrary(page);
  await expect(
    library.getByRole("listitem").filter({ hasText: "local_gain" }),
  ).toHaveCount(2);
  await expect(
    library.getByRole("listitem").filter({ hasText: "Local artwork" }),
  ).toHaveCount(1);
  await library.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByTestId("instance-count")).toHaveText("2");
}
