import { expect, test, type Page } from "@playwright/test";
import { hierarchyNavigationFixture as fixture } from "../../../netlists/hierarchy-navigation/fixture";
import {
  exportedProject,
  openProject,
  openProjectFile,
} from "./editor-fixtures.js";

/** The Testbench view of the dock, opened from the Netlist view's switch. */
async function openTestbench(page: Page) {
  const views = page.getByRole("group", { name: "Dock view" });
  if (!(await views.isVisible()))
    await page.getByTestId("netlist-panel-toggle").click();
  await views.getByRole("button", { name: "Testbench" }).click();
  const panel = page.getByRole("region", { name: "Testbench" });
  await expect(panel).toBeVisible();
  return panel;
}

/** Type into the Testbench source and let the editor lose focus. */
async function typeAtStart(page: Page, text: string) {
  const source = page.getByRole("textbox", { name: /^Testbench source/u });
  await source.click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.insertText(text);
  await page.getByTestId("netlist-panel-toggle").focus();
}

test.describe("Testbench view (#2110)", () => {
  test("writes a Cell's Testbench and Specs without any hosted request, with Undo and export", async ({
    page,
  }) => {
    const hosted: string[] = [];
    page.on("request", (request) => {
      if (/\/api\/simulat/u.test(request.url())) hosted.push(request.url());
    });
    await openProject(page, fixture());
    const panel = await openTestbench(page);
    await panel
      .getByRole("combobox", { name: "Testbench Cell" })
      .selectOption({ label: "Amplifier" });
    await panel.getByRole("button", { name: "New Testbench" }).click();
    const source = panel.getByRole("textbox", { name: /^Testbench source/u });
    await expect(source).toContainText("XDUT IN OUT Amplifier");

    await typeAtStart(page, "* @spec gain >= 60 unit=dB\n* @spec pm > 1M\n");
    const specs = panel.getByRole("list", { name: "Specs" });
    await expect(specs.getByRole("button")).toHaveText([
      /gain\s*>= 60\s*dB/u,
      /pm\s*invalid/u,
    ]);
    await expect(
      panel.getByRole("list", { name: "Spec problems" }),
    ).toContainText("Line 2:");

    // The edit is one Project history entry: Undo leaves the starter.
    await page.getByTestId("draw-tool-undo").click();
    await expect(specs).toHaveCount(0);
    await expect(source).toContainText("XDUT IN OUT Amplifier");
    await page.getByTestId("draw-tool-redo").click();
    await expect(specs.getByRole("button")).toHaveCount(2);

    const saved = await exportedProject(page);
    const folder = saved.simulationFolders.find(
      (item: { name: string }) => item.name === "Amplifier testbench",
    );
    expect(folder.input.entry).toBe("testbench.spice");
    expect(folder.input.files).toEqual([
      {
        path: "testbench.spice",
        text: expect.stringContaining("* @spec gain >= 60 unit=dB"),
      },
    ]);
    expect(hosted).toEqual([]);

    // The exported file opens with the Testbench and its Specs as they were.
    await openProjectFile(page, saved, "reopened.icproj.json");
    const reopened = await openTestbench(page);
    await reopened
      .getByRole("combobox", { name: "Testbench Cell" })
      .selectOption({ label: "Amplifier" });
    await expect(
      reopened.getByRole("list", { name: "Specs" }).getByRole("button"),
    ).toHaveText([/gain\s*>= 60\s*dB/u, /pm\s*invalid/u]);
  });

  test("reviews an import before one Project edit and never copies the Cell's netlist", async ({
    page,
  }) => {
    await openProject(page, fixture());
    const panel = await openTestbench(page);
    await panel.getByTestId("testbench-import-files").setInputFiles([
      {
        name: "tb.sp",
        mimeType: "text/plain",
        buffer: Buffer.from("* mine\nXDUT IN OUT dut\n.end\n"),
      },
      {
        name: "report.py",
        mimeType: "text/plain",
        buffer: Buffer.from("print('gain')\n"),
      },
      {
        name: "circuit.spice",
        mimeType: "text/plain",
        buffer: Buffer.from(".subckt dut IN OUT\n.ends\n"),
      },
    ]);
    const review = panel.getByRole("group", { name: "Review import" });
    await expect(review).toContainText("A new Testbench for");
    await expect(review.getByRole("listitem")).toHaveText([
      /tb\.sp\s*New/u,
      /report\.py\s*New/u,
      /circuit\.spice\s*Skipped: Canvas writes it/u,
    ]);
    await expect(
      review.getByRole("combobox", { name: "Testbench entry file" }),
    ).toHaveValue("tb.sp");
    await review.getByRole("checkbox", { name: "report.py" }).uncheck();
    await review.getByRole("button", { name: "Import" }).click();

    await expect(review).toHaveCount(0);
    const source = panel.getByRole("textbox", { name: /^Testbench source/u });
    await expect(source).toContainText("* mine");
    await expect(panel.getByRole("tablist", { name: "Files" })).toHaveCount(0);

    // Undo removes the whole import at once.
    await page.getByTestId("draw-tool-undo").click();
    await expect(panel).toContainText("No Testbench for");
  });
});
