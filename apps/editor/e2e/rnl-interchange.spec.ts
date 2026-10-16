import { expect, test, type Page } from "@playwright/test";

import {
  copyNetlistText,
  exampleProject,
  expectStatus,
  exportedProject,
  openProject,
  showNetlistPanel,
} from "./editor-fixtures.js";

/**
 * An RNL format's text as the Netlist panel's own Copy button copies it,
 * once the rnl runtime has written it in its Worker. (The Circuit menu's
 * Copy Netlist copies the plain netlist.)
 */
async function copyRnlText(
  page: Page,
  mode: "spice+rnl" | "spectre+rnl",
): Promise<string> {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() =>
    navigator.clipboard.writeText("clipboard sentinel"),
  );
  const panel = await showNetlistPanel(page);
  await panel.getByLabel("Netlist format").selectOption(mode);
  await expect(
    panel.getByRole("textbox", { name: "RNL netlist code", exact: true }),
  ).toBeVisible();
  await panel.getByTestId("copy-netlist-panel").click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .not.toBe("clipboard sentinel");
  // Windows normalizes clipboard lines to CRLF.
  return (await page.evaluate(() => navigator.clipboard.readText())).replace(
    /\r\n?/gu,
    "\n",
  );
}

// docs/specs/rnl-interchange.md: the RNL formats the rnl runtime writes in
// its Worker, and File > Import > RNL… reading what they wrote.
test("writes SPICE+RNL and Spectre+RNL, and imports the file it wrote as it was drawn", async ({
  page,
}) => {
  const project = exampleProject("two-stage-op-amp.icproj.json");
  await openProject(page, project);
  const spice = await copyNetlistText(page, "spice");

  const rich = await copyRnlText(page, "spice+rnl");
  expect(rich).toContain('* @RNL(type="header")');
  expect(rich).toContain(
    '@USE-PACKAGE(name="rnl-std-functional", version="0.3")',
  );
  expect(rich).toMatch(/#X1 @SET-SYMBOL \$OPAMP_5TERM/u);
  // The netlist it carries is the plain one, the op-amp's body printed in
  // the port order of its RNL symbol.
  expect(rich).toMatch(/^X1 Vin Vout 0 VSS net0 opamp$/mu);
  const spectre = await copyRnlText(page, "spectre+rnl");
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
  expect(await copyNetlistText(page, "spice")).toBe(spice);
});
