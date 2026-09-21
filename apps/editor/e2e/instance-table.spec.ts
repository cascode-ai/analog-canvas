import { expect, test } from "@playwright/test";
import { clickCommand, copyNetlistText } from "./editor-fixtures.js";

test("bulk edits instance JSON in the sidebar with atomic undo and live netlist updates", async ({
  page,
}) => {
  await page.goto("/editor");
  await page.getByTestId("spice-files").setInputFiles({
    name: "circuit.spi",
    mimeType: "text/plain",
    buffer: Buffer.from("\n.subckt top a b\nR1 a b 1k\nR2 b a 2k\n.ends top\n"),
  });
  await clickCommand(page, "Netlist", "Edit Device Data…");
  const panel = page.getByRole("region", {
    name: "Instance code",
    exact: true,
  });
  const code = panel.getByRole("textbox", { name: "Instance JSON" });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(panel.getByRole("combobox")).toHaveCount(0);
  await expect(panel.getByRole("button")).toHaveCount(0);
  const original = await code.inputValue();
  const values = JSON.parse(original);
  const rows = Object.values(values)[0] as Record<string, any>;
  for (const row of Object.values(rows)) row.parameters.value = "10k";
  const pasted = JSON.stringify(values, null, 4);
  await code.fill(pasted);
  // Live acknowledgement must preserve bulk-paste formatting/caret ownership.
  await expect(code).toHaveValue(pasted);
  await page.getByTestId("draw-tool-undo").click();
  await expect(code).toHaveValue(original);
  await page.getByTestId("draw-tool-redo").click();
  await expect
    .poll(async () =>
      Object.values(
        Object.values(JSON.parse(await code.inputValue()))[0] as Record<
          string,
          any
        >,
      ).map((row) => row.parameters.value),
    )
    .toEqual(["10k", "10k"]);

  await code.fill("{");
  await expect(panel.getByRole("alert")).toContainText("valid JSON");
  expect(await copyNetlistText(page)).toMatch(/R1 a b 10k\nR2 b a 10k/iu);
  await page.getByTestId("draw-tool-undo").click();
  const live = page.getByRole("textbox", { name: "Netlist code", exact: true });
  await expect(live).toContainText(/R1 a b 1k/iu);
  await expect(live).toContainText(/R2 b a 2k/iu);
  await page.getByTestId("draw-tool-redo").click();
  await expect(live).toContainText(/R1 a b 10k/iu);
  await expect(live).toContainText(/R2 b a 10k/iu);

  await clickCommand(page, "Netlist", "Edit Device Data…");
  const rejected = JSON.parse(await code.inputValue());
  const invalidRows = Object.values(rejected)[0] as Record<string, any>;
  Object.values(invalidRows)[0]!.parameters.value = "99k";
  Object.values(invalidRows)[1]!.reference = "R1";
  await code.fill(JSON.stringify(rejected));
  await expect(panel.getByRole("alert")).toContainText("Edit rejected");
  expect(await copyNetlistText(page)).toMatch(/R1 a b 10k\nR2 b a 10k/iu);
  await clickCommand(page, "Netlist", "Edit Device Data…");
  await page.setViewportSize({ width: 760, height: 800 });
  await expect(code).toBeVisible();
  await code.selectText();
});
