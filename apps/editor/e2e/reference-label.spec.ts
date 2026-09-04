import { expect, test } from "@playwright/test";

import {
  awaitEditorReady,
  chooseComponent,
  downloadBytes,
} from "./editor-fixtures.js";

// A resistor's Reference starts with R because the netlist prints it as the
// element token: `gm1 a b 10k` would be a controlled source. Until now typing
// `gm` over the label ended in exactly that refusal, and the only way to show
// the text was a separate Text object placed by hand. The label is
// presentation; the Reference is the electrical fact. So the refusal becomes
// an offer to keep one and show the other.
test("typing a non-Reference text over R1 offers to show it as a label", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 240 } });
  await page.keyboard.press("Escape");

  await page.getByTestId("annotation-hit-instance-label-R1").dblclick();
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  await editor.fill("gm");
  await page.getByRole("button", { name: "Apply text changes" }).click();

  const offer = page.getByTestId("reference-label-offer");
  await expect(offer).toContainText(
    "“gm” cannot be this component’s Reference",
  );
  await expect(offer).toContainText("Keep Reference “R1”");
  // Nothing was renamed or refused behind the person's back.
  await expect(page.getByTestId("canvas-text-editor")).toBeVisible();

  // Declining keeps the editor open with the text still in it.
  await offer.getByRole("button", { name: "Keep editing" }).click();
  await expect(offer).toHaveCount(0);
  await expect(editor).toHaveText("gm");

  await page.getByRole("button", { name: "Apply text changes" }).click();
  await offer.getByRole("button", { name: "Show as label" }).click();
  await expect(page.getByTestId("canvas-text-editor")).toHaveCount(0);
  await expect(page.getByTestId("status")).toHaveText(
    "Showing “gm” as a label; Reference R1 is unchanged",
  );

  // The canvas reads gm where R1 stood; R1 is hidden, not renamed.
  const annotations = page.locator('[data-layer="annotations"]');
  await expect(
    annotations.locator('[data-object-id="instance-label-R1"]'),
  ).toHaveCount(0);
  const label = annotations.locator('[data-object-id^="instance-text-"]');
  await expect(label).toHaveCount(1);
  await expect(label).toContainText("gm");

  await page.getByTestId("hit-R1").click();
  await page.getByTestId("selection-shelf").click();
  const properties = page.getByRole("complementary", { name: "Properties" });
  await expect(properties.getByLabel("Component reference")).toHaveValue("R1");
  await expect(properties.getByLabel("Component label")).toHaveValue("gm");
  await expect(
    properties.getByLabel("Component display toggles").getByLabel("Reference"),
  ).not.toBeChecked();

  // The Project keeps the Reference as the netlist token and the text as
  // literal attached content with no binding at all.
  const project = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  expect(project.documents[0].instances[0].reference).toBe("R1");
  const saved: Array<{ id: string }> = project.documents[0].annotations;
  expect(
    saved.find((annotation) => annotation.id === "instance-label-R1"),
  ).toMatchObject({
    visible: false,
    binding: { kind: "instance-reference", instanceId: "R1" },
  });
  const literal = saved.find((annotation) =>
    annotation.id.startsWith("instance-text-"),
  ) as { content?: { runs: RichTextRunLike[] } } | undefined;
  expect(literal).toMatchObject({
    kind: "instance-label",
    anchor: { kind: "object", objectId: "R1" },
  });
  // The text keeps the styled runs the Reference label was edited in — that
  // is what "in its place" looks like — so compare the characters, not the
  // run structure.
  expect(plainText(literal?.content?.runs ?? [])).toBe("gm");
  expect(literal).not.toHaveProperty("binding");
});

interface RichTextRunLike {
  kind: string;
  value?: string;
  children?: RichTextRunLike[];
}

function plainText(runs: RichTextRunLike[]): string {
  return runs.map((run) => run.value ?? plainText(run.children ?? [])).join("");
}

// The same text box from the other side: Properties. A label typed there
// joins the Reference rather than replacing it, and clearing it takes only
// the label away.
test("Properties gives a placed component a free label without touching its Reference", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 240 } });
  await page.keyboard.press("Escape");

  await page.getByTestId("hit-R1").click();
  await page.getByTestId("selection-shelf").click();
  const properties = page.getByRole("complementary", { name: "Properties" });
  const labelField = properties.getByLabel("Component label");
  await expect(labelField).toHaveValue("");
  await labelField.fill("1/gm");
  await labelField.press("Enter");
  await expect(page.getByTestId("status")).toHaveText("Set label to 1/gm");

  const annotations = page.locator('[data-layer="annotations"]');
  const label = annotations.locator('[data-object-id^="instance-text-"]');
  await expect(label).toContainText("1/gm");
  await expect(
    annotations.locator('[data-object-id="instance-label-R1"]'),
  ).toContainText("R1");
  await expect(properties.getByLabel("Component reference")).toHaveValue("R1");
  await expect(properties.getByLabel("Component label")).toHaveValue("1/gm");

  await properties.getByLabel("Component label").fill("");
  await properties.getByLabel("Component label").press("Enter");
  await expect(page.getByTestId("status")).toHaveText(
    "Removed the component label",
  );
  await expect(label).toHaveCount(0);
  await expect(
    annotations.locator('[data-object-id="instance-label-R1"]'),
  ).toContainText("R1");
});
