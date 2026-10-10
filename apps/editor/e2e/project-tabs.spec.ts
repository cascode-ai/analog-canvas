import { expect, test, type Page } from "@playwright/test";
import {
  awaitEditorReady,
  chooseComponent,
  downloadBytes,
  openMenu,
  openProjectInfo,
  parseSavedProject,
  renameProject,
} from "./editor-fixtures";
import { createEmptyProject, type CircuitProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { AgentHttpClient } from "../../../packages/agent-client/src/http-client.js";
import { finiteGainProject } from "../test-fixtures/finite-gain-copy";

async function insert(page: Page, symbol: string, x: number, y: number) {
  await chooseComponent(page, symbol);
  await page.getByTestId("schematic-canvas").click({ position: { x, y } });
  await page.keyboard.press("Escape");
}
async function saved(page: Page): Promise<CircuitProject> {
  return parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  ) as CircuitProject;
}

test("GUI and Agent copy finite_gain across Projects without outside names, and undo/reopen preserve the model", async ({
  page,
  context,
  baseURL,
}) => {
  test.slow();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/editor?new=1");
  await awaitEditorReady(page);
  const sourceProject = finiteGainProject("finite-source-project");
  await page.getByTestId("project-file").setInputFiles({
    name: "finite-source.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(sourceProject)),
  });
  const sourceBefore = await saved(page);
  await page.getByTestId("open-agent").click();
  const panel = page.getByTestId("connect-agent-panel");
  await expect(panel.getByTestId("agent-copy-text")).toHaveValue(/Claim: /, {
    timeout: 45_000,
  });
  const { claimCode } = JSON.parse(
    /^Claim: (.+)$/mu.exec(
      await panel.getByTestId("agent-copy-text").inputValue(),
    )![1]!,
  );
  const client = new AgentHttpClient({ baseUrl: baseURL! });
  const session = await client.claim(claimCode);
  await expect(panel.getByTestId("agent-status")).toHaveText("Connected");
  await panel.getByRole("button", { name: "Close Agent dialog" }).click();
  for (const path of ["Agent", "C", "Ctrl+C"] as const) {
    const targetProject = finiteGainProject(`finite-target-${path}`);
    await page.getByTestId("tab-project-file").setInputFiles({
      name: `finite-target-${path}.icproj.json`,
      mimeType: "application/json",
      buffer: Buffer.from(serializeProject(targetProject)),
    });
    const targetTab = page.getByRole("tab").last();
    const before = await saved(page);
    await client.status(session.sessionId, session.agentToken);
    for (const copyNumber of [1, 2]) {
      if (path === "Agent") {
        const listing = await client.projects(
          session.sessionId,
          session.agentToken,
          {
            apiVersion: "3.0",
            requestId: `finite-list-${copyNumber}`,
            operation: "workspace",
            request: { action: "list" },
          },
        );
        if (
          !listing.ok ||
          listing.operation !== "workspace" ||
          listing.result.action !== "list"
        )
          throw new Error("Workspace list failed");
        const source = listing.result.projects.find(
          (item) => item.projectId === sourceProject.id,
        )!;
        const target = listing.result.projects.find(
          (item) => item.projectId === targetProject.id,
        )!;
        const copied = await client.projects(
          session.sessionId,
          session.agentToken,
          {
            apiVersion: "3.0",
            requestId: `finite-copy-${copyNumber}`,
            operation: "workspace",
            request: {
              action: "copy",
              sourceWorkspaceId: source.workspaceId,
              sourceDocumentId: source.cells[0]!.documentId,
              sourceRevision: source.cells[0]!.revision,
              sourceStructureRevision: source.structureRevision,
              targetWorkspaceId: target.workspaceId,
              targetDocumentId: target.cells[0]!.documentId,
              expectedRevision: target.cells[0]!.revision,
              expectedStructureRevision: target.structureRevision,
              selection: {
                instanceIds: ["X1"],
                routeIds: [],
                junctionIds: [],
                annotationIds: [],
                draftingIds: [],
              },
              offset: { x: copyNumber * 2000, y: 0 },
            },
          },
        );
        expect(copied).toMatchObject({
          ok: true,
          operation: "workspace",
          result: { action: "copy" },
        });
      } else {
        await page.getByRole("tab").first().click();
        await page.getByTestId("hit-X1").click();
        await page.keyboard.press(path === "C" ? "c" : "ControlOrMeta+c");
        await targetTab.click();
        if (path === "Ctrl+C") await page.keyboard.press("ControlOrMeta+v");
        const ghost = page.getByTestId("copy-placement-preview");
        await expect(ghost).toBeVisible();
        await expect(ghost.locator('[data-kind="net-label"]')).toHaveCount(0);
        await page.getByTestId("schematic-canvas").click({
          position: { x: 150 + 200 * copyNumber, y: 100 + 150 * copyNumber },
        });
        await page.keyboard.press("Escape");
      }
      await expect(page.getByTestId("active-instance-count")).toHaveText(
        String(copyNumber + 1),
      );
    }
    const copied = await saved(page);
    expect(copied.documents[0]!.nets).toEqual(before.documents[0]!.nets);
    expect(copied.documents[0]!.annotations).toEqual(
      before.documents[0]!.annotations,
    );
    expect(copied.documents[0]!.connectivityEvidence).toEqual(
      before.documents[0]!.connectivityEvidence,
    );
    expect(copied.modelSources).toEqual(before.modelSources);
    expect(copied.externalSubcircuitDefinitions).toEqual(
      before.externalSubcircuitDefinitions,
    );
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.getByTestId("active-instance-count")).toHaveText("2");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(page.getByTestId("active-instance-count")).toHaveText("3");
    expect((await saved(page)).documents[0]!.nets).toEqual(
      before.documents[0]!.nets,
    );
  }
  await page.getByRole("tab").first().click();
  expect((await saved(page)).documents).toEqual(sourceBefore.documents);
  await page.getByRole("tab").last().click();
  const beforeReload = await saved(page);
  page.on("dialog", (dialog) => void dialog.accept());
  await page.reload();
  await awaitEditorReady(page);
  expect((await saved(page)).documents).toEqual(beforeReload.documents);
  expect((await saved(page)).modelSources).toEqual(beforeReload.modelSources);
});

test("first blank Project has its own stable evidence identity", async ({
  page,
  context,
}) => {
  await page.goto("/editor?new=1");
  const initialId = (await saved(page)).id;
  expect(initialId).toMatch(/^project-/);
  const separateWindow = await context.newPage();
  await separateWindow.goto("/editor?new=1");
  expect((await saved(separateWindow)).id).not.toBe(initialId);
  await separateWindow.close();
  await page.reload();
  expect((await saved(page)).id).toBe(initialId);
  await page
    .getByRole("button", { name: "New project tab", exact: true })
    .click();
  const nextId = (await saved(page)).id;
  expect(nextId).toMatch(/^project-/);
  expect(nextId).not.toBe(initialId);
});

test("project tabs append a partial selection and retain independent history, cameras and code drafts", async ({
  page,
  context,
}) => {
  // This journey opens multiple Projects and verifies copy, export, undo and
  // code editing. Keep per-action assertions bounded, but allow the complete
  // workflow more than 30 seconds on the shared CI runner.
  test.slow();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/editor?new=1");
  const canvas = page.getByTestId("schematic-canvas");
  await insert(page, "nmos", 240, 220);
  await insert(page, "nmos", 440, 220);
  await insert(page, "pmos", 650, 330);
  await page.keyboard.press("w");
  await page.getByTestId("terminal-M1-G").click();
  await page.getByTestId("terminal-M2-G").click();
  await page.keyboard.press("Escape");
  // Use an actual subset: two transistors and their one wire; leave the PMOS behind.
  const a = (await page.getByTestId("hit-M1").boundingBox())!;
  const b = (await page.getByTestId("hit-M2").boundingBox())!;
  await page.mouse.move(Math.min(a.x, b.x) - 25, Math.min(a.y, b.y) - 25);
  await page.mouse.down();
  await page.mouse.move(
    Math.max(a.x + a.width, b.x + b.width) + 25,
    Math.max(a.y + a.height, b.y + b.height) + 25,
    { steps: 5 },
  );
  await page.mouse.up();
  // The destination already holds a part; the copy must append beside it.
  await page
    .getByRole("button", { name: "New project tab", exact: true })
    .click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.getByTestId("active-instance-count")).toHaveText("0");
  await insert(page, "resistor", 260, 400);
  const before = await saved(page);
  await page.getByRole("tab").first().click();
  await expect(page.getByTestId("active-instance-count")).toHaveText("3");
  await page.evaluate(() => navigator.clipboard.writeText("external text"));
  await page.keyboard.press("c");
  await expect(page.getByTestId("status")).toContainText("Circuit copied");
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  // Plain C owns the internal fragment, leaving unrelated OS clipboard text
  // alone. The placement below verifies its two devices and complete route.
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "external text",
  );
  const sourceView = await canvas.getAttribute("viewBox");
  const source = await saved(page);
  // C in one tab, a click in another: the copy stays in hand across tabs.
  await page.getByRole("tab").nth(1).click();
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  await expect(page.getByTestId("status")).toContainText("click to place");
  await canvas.click({ position: { x: 480, y: 230 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("active-instance-count")).toHaveText("3");
  const target = await saved(page);
  const original = before.documents[0]!.instances[0]!;
  expect(
    target.documents[0]!.instances.find((item) => item.id === original.id),
  ).toEqual(original);
  expect(
    target.documents[0]!.instances.filter((item) => item.symbolId === "nmos"),
  ).toHaveLength(2);
  expect(target.documents[0]!.routes.length).toBeGreaterThan(0);
  expect(
    target.documents[0]!.instances.some((item) => item.symbolId === "pmos"),
  ).toBe(false);
  const targetView = await canvas.getAttribute("viewBox");
  await page.getByRole("tab").first().click();
  await expect(page.getByTestId("active-instance-count")).toHaveText("3");
  await expect(canvas).toHaveAttribute("viewBox", sourceView!);
  expect((await saved(page)).documents).toEqual(source.documents);
  await page.getByRole("tab").nth(1).click();
  await expect(canvas).toHaveAttribute("viewBox", targetView!);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.getByTestId("active-instance-count")).toHaveText("3");
  // A single component and native modifiers use the same append path.
  await page.getByRole("tab").first().click();
  await page.getByTestId("hit-M3").click();
  await page.keyboard.press("ControlOrMeta+c");
  await page.getByRole("tab").nth(1).click();
  await page.keyboard.press("ControlOrMeta+v");
  await canvas.click({ position: { x: 660, y: 380 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("active-instance-count")).toHaveText("4");
  // Unapplied invalid text cannot be discarded by switching projects.
  await page.getByTestId("project-code-toggle").click();
  const code = page.getByRole("textbox", { name: "Project code", exact: true });
  await code.fill("invalid project");
  await page.getByRole("tab").first().click();
  // The refusal names what holds the tab, so it can be finished (#1462).
  await expect(page.getByTestId("status")).toContainText(
    "Can't switch project tabs yet: a code panel holds a draft that is not applied. No work was discarded.",
  );
  await expect(code).toHaveText("invalid project");
  await expect(page.getByRole("tab").nth(1)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("button", { name: /Reload/ }).click();
  await page.getByRole("tab").first().click();
  await expect(page.getByTestId("active-instance-count")).toHaveText("3");
  await page.screenshot({ path: "plan/project-tabs.png" });
});

test("C carries a fresh copy into another tab, and V and Ctrl/Cmd+V paste the same", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  // M1's gate is on the Net a Cell Pin names O; its source goes to ground.
  const project = createEmptyProject("fresh-tab-copy", "Fresh tab copy");
  const document = project.documents[0]!;
  const placement = (x: number, y: number) => ({
    position: { x, y },
    rotation: 0 as const,
    mirror: "none" as const,
  });
  document.instances.push(
    {
      id: "M1",
      reference: "M1",
      symbolId: "nmos",
      placement: placement(300, 200),
      netlist: {
        binding: { kind: "model", deviceClass: "mos", name: "NMOS" },
        parameters: { w: "1u", l: "150n", nf: "1", m: "1" },
      },
    },
    { id: "P1", symbolId: "port", placement: placement(200, 200) },
    { id: "GND1", symbolId: "ground", placement: placement(320, 300) },
  );
  document.nets.push(
    {
      id: "net-o",
      terminals: [
        { instanceId: "M1", pinName: "G" },
        { instanceId: "P1", pinName: "P" },
      ],
    },
    {
      id: "net-gnd",
      terminals: [
        { instanceId: "M1", pinName: "S" },
        { instanceId: "GND1", pinName: "0" },
      ],
    },
  );
  document.netlist!.terminals.push({
    id: "terminal-o",
    name: "O",
    netId: "net-o",
    direction: "input",
    interfaceInstanceIds: ["P1"],
  });
  await page.goto("/editor?new=1");
  await awaitEditorReady(page);
  await page.getByTestId("project-file").setInputFiles({
    name: "fresh-tab-copy.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(project)),
  });
  await expect(page.getByTestId("hit-M1")).toBeVisible();
  const canvas = page.getByTestId("schematic-canvas");
  const ghost = page.getByTestId("copy-placement-preview");
  const netLabels = page.locator(
    '[data-layer="annotations"] [data-kind="net-label"]',
  );

  await page.getByTestId("hit-M1").click();
  await page.keyboard.press("c");
  await expect(ghost).toBeVisible();
  await page.keyboard.press("r");
  await page
    .getByRole("button", { name: "New project tab", exact: true })
    .click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  // Still in hand, still turned, and nothing from the source circuit rides
  // along: no O, no ground name.
  await expect(ghost).toBeVisible();
  await expect(ghost.locator('[data-kind="net-label"]')).toHaveCount(0);
  await canvas.click({ position: { x: 400, y: 300 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
  await expect(netLabels).toHaveCount(0);
  const carried = (await saved(page)).documents[0]!;
  expect(carried.instances[0]!.placement?.rotation).toEqual(expect.any(Number));
  expect(carried.instances[0]!.placement?.rotation).not.toBe(0);
  expect(carried.nets.flatMap((net) => net.terminals)).toEqual([]);

  // V pastes what C copied: the same fresh insertion, not the outside names.
  await page.keyboard.press("v");
  await expect(ghost).toBeVisible();
  await expect(ghost.locator('[data-kind="net-label"]')).toHaveCount(0);
  await canvas.click({ position: { x: 560, y: 300 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("active-instance-count")).toHaveText("2");
  await expect(netLabels).toHaveCount(0);

  await page.getByRole("tab").first().click();
  await expect(page.getByTestId("active-instance-count")).toHaveText("3");
  await expect(ghost).toHaveCount(0);

  // Ctrl/Cmd+C in one tab and Ctrl/Cmd+V in another place exactly what C does.
  await page.getByTestId("hit-M1").click();
  await page.keyboard.press("ControlOrMeta+c");
  await page.getByRole("tab").nth(1).click();
  await expect(page.getByTestId("active-instance-count")).toHaveText("2");
  await page.keyboard.press("ControlOrMeta+v");
  await expect(ghost).toBeVisible();
  await expect(ghost.locator('[data-kind="net-label"]')).toHaveCount(0);
  await canvas.click({ position: { x: 480, y: 420 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("active-instance-count")).toHaveText("3");
  await expect(netLabels).toHaveCount(0);
  const pasted = (await saved(page)).documents[0]!;
  expect(pasted.nets.flatMap((net) => net.terminals)).toEqual([]);
});

test("tab file opening is additive and closing unsaved projects can be cancelled", async ({
  page,
}) => {
  await page.goto("/editor?new=1");
  await insert(page, "resistor", 300, 220);
  const exported = await saved(page);
  exported.name = "Second circuit";
  await page.getByTestId("tab-project-file").setInputFiles({
    name: "second.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(
    page.getByRole("tab", { name: "Second circuit" }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab").nth(1).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab").first()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("tab").first()).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab").nth(1)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await insert(page, "capacitor", 500, 260);
  await page.setViewportSize({ width: 360, height: 600 });
  await page.getByRole("button", { name: "Close tab Second circuit" }).click();
  await expect(
    page.getByRole("button", { name: "Keep open", exact: true }),
  ).toBeFocused();
  const closeStrip = page.getByTestId("project-tab-close-decision");
  await expect(closeStrip.locator(".inline-confirm-decision")).toHaveText(
    "Close without savingKeep open",
  );
  expect(
    await closeStrip.evaluate(
      (element) =>
        element.scrollWidth <= element.clientWidth &&
        element.getBoundingClientRect().height <= 44 &&
        [...element.querySelectorAll("button:not([hidden])")].every(
          (button) => button.getBoundingClientRect().right <= innerWidth,
        ),
    ),
  ).toBe(true);
  await page.screenshot({ path: "plan/inline-tab-close-narrow.png" });
  await page.getByRole("button", { name: "Keep open", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.getByRole("button", { name: "Close tab Second circuit" }).click();
  await page
    .getByRole("button", { name: "Close without saving", exact: true })
    .click();
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
});

test("a tab's right-click menu closes the others or all, asking once for unsaved ones", async ({
  page,
}) => {
  await page.goto("/editor?new=1");
  await awaitEditorReady(page);
  const newTab = page.getByRole("button", {
    name: "New project tab",
    exact: true,
  });
  const tabs = page.getByRole("tab");
  const menu = page.getByTestId("project-tab-menu");
  await newTab.click();
  await insert(page, "resistor", 300, 240);
  await newTab.click();
  await expect(tabs).toHaveCount(3);

  // Close Others keeps the tab right-clicked; clean tabs go without asking.
  await tabs.nth(1).click({ button: "right" });
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Close",
    "Close Others",
    "Close All",
  ]);
  await menu.getByRole("menuitem", { name: "Close Others" }).click();
  await expect(tabs).toHaveCount(1);
  await expect(tabs).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");

  // Close All asks once for the unsaved tabs, then leaves one blank tab.
  await newTab.click();
  await insert(page, "capacitor", 300, 240);
  await tabs.first().click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Close All" }).click();
  const strip = page.getByTestId("project-tab-close-decision");
  await expect(strip).toContainText("Close 2 tabs? 2 have unsaved changes.");
  await strip.getByRole("button", { name: "Keep open", exact: true }).click();
  await expect(tabs).toHaveCount(2);
  await tabs.first().click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Close All" }).click();
  await strip
    .getByRole("button", { name: "Close without saving", exact: true })
    .click();
  await expect(tabs).toHaveCount(1);
  await expect(page.getByTestId("active-instance-count")).toHaveText("0");
});

test("the Shelf appends a Cloud Project tab, deduplicates and saves Cloud identities", async ({
  page,
}) => {
  const { createEmptyProject } = await import("@icm/model");
  const records = ["Alpha", "Beta"].map((name, index) => {
    const project = createEmptyProject(`project-${index}`, name);
    return {
      id: `cloud-${index}`,
      name,
      revision: 1,
      schemaVersion: project.schemaVersion,
      updatedAt: "2026-09-21T08:00:00.000Z",
      projectText: JSON.stringify(project),
    };
  });
  const writes: string[] = [];
  const reads: string[] = [];
  const deletes: string[] = [];
  const creations: string[] = [];
  let finishDeletion = () => {};
  let deleteRequested = false;
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u1",
          displayName: "Author",
          email: "author@example.com",
          provider: "github",
          isAdmin: false,
        },
      },
    }),
  );
  await page.route("**/api/projects", (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      const project = parseSavedProject(body.projectText);
      const created = {
        id: "cloud-recreated",
        name: body.name,
        revision: 1,
        schemaVersion: project.schemaVersion,
        updatedAt: "2026-10-10T00:00:00Z",
        projectText: body.projectText,
      };
      records.push(created);
      creations.push(created.id);
      return route.fulfill({ status: 201, json: { project: created } });
    }
    return route.fulfill({ json: { projects: records } });
  });
  await page.route("**/api/projects/cloud-*", async (route) => {
    const item = records.find((item) =>
      route.request().url().endsWith(item.id),
    )!;
    if (!item)
      return route.fulfill({
        status: 404,
        json: { error: "project-not-found" },
      });
    if (route.request().method() === "DELETE") {
      deleteRequested = true;
      await new Promise<void>((resolve) => {
        finishDeletion = resolve;
      });
      deletes.push(item.id);
      records.splice(records.indexOf(item), 1);
      return route.fulfill({ json: { projects: records } });
    }
    if (route.request().method() !== "GET") {
      expect(route.request().headers()["if-match"]).toBe(
        `revision-${item.revision}`,
      );
      const body = route.request().postDataJSON();
      item.projectText = body.projectText;
      item.name = body.name;
      item.revision++;
      writes.push(item.id);
    } else reads.push(item.id);
    return route.fulfill({ json: { project: item } });
  });
  await page.goto("/editor?new=1");
  const blankProjectId = (await saved(page)).id;
  await shelf("Alpha");
  await expect(page.getByRole("tab")).toHaveCount(2);
  async function shelf(name: string) {
    await page.getByLabel("Open Shelf project in tab", { exact: true }).click();
    await page
      .locator(".project-tabs-shelf")
      .getByRole("button", { name, exact: true })
      .click();
    await expect(
      page.getByRole("tab", { name: new RegExp(`${name}$`) }),
    ).toHaveAttribute("aria-selected", "true");
  }
  await insert(page, "nmos", 300, 240);
  await shelf("Beta");
  await insert(page, "resistor", 450, 240);
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => writes).toEqual(["cloud-1"]);
  await shelf("Alpha");
  await expect(page.getByRole("tab")).toHaveCount(3);
  await page.getByRole("tab").first().click();
  expect((await saved(page)).id).toBe(blankProjectId);
  await shelf("Alpha");
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
  expect(reads).toEqual(["cloud-0", "cloud-1"]);
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => writes).toEqual(["cloud-1", "cloud-0"]);
  expect(
    parseSavedProject(records[0]!.projectText).documents[0]!.instances[0]!
      .symbolId,
  ).toBe("nmos");
  expect(
    parseSavedProject(records[1]!.projectText).documents[0]!.instances[0]!
      .symbolId,
  ).toBe("resistor");
  await page.getByRole("tab", { name: /Alpha$/ }).dblclick();
  await page
    .getByRole("textbox", { name: "Project name", exact: true })
    .fill("Alpha local");
  await page
    .getByRole("textbox", { name: "Project name", exact: true })
    .press("Enter");
  await page.getByLabel("Open Shelf project in tab", { exact: true }).click();
  const renamePanel = page.locator(".project-tabs-shelf");
  await renamePanel.getByRole("button", { name: "Alpha", exact: true }).hover();
  await renamePanel
    .getByRole("button", { name: "Rename Alpha", exact: true })
    .click();
  await renamePanel
    .getByRole("textbox", { name: "Shelf project name", exact: true })
    .fill("Alpha stored");
  await renamePanel
    .getByRole("textbox", { name: "Shelf project name", exact: true })
    .press("Enter");
  await expect(
    renamePanel.getByRole("button", { name: "Alpha stored", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: /Alpha local$/ }).getByLabel("Unsaved"),
  ).toBeVisible();
  expect(parseSavedProject(records[0]!.projectText).name).toBe("Alpha stored");
  await page.getByLabel("Open Shelf project in tab", { exact: true }).click();
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto("/");
  await page.goto("/editor?project=cloud-1");
  await awaitEditorReady(page);
  await expect(page.getByRole("tab")).toHaveCount(3);
  await expect(page.getByRole("tab", { name: /Beta$/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
  await insert(page, "nmos", 300, 240);
  await page.getByLabel("Open Shelf project in tab", { exact: true }).click();
  const shelfPanel = page.locator(".project-tabs-shelf");
  await shelfPanel.getByRole("button", { name: "Beta", exact: true }).hover();
  await shelfPanel
    .getByRole("button", { name: "Rename Beta", exact: true })
    .click();
  await shelfPanel
    .getByRole("textbox", { name: "Shelf project name", exact: true })
    .fill("Beta renamed");
  await shelfPanel
    .getByRole("textbox", { name: "Shelf project name", exact: true })
    .press("Enter");
  await expect(
    shelfPanel.getByRole("button", { name: "Beta renamed", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: /Beta renamed$/ }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("active-instance-count")).toHaveText("2");
  expect(
    parseSavedProject(records[1]!.projectText).documents[0]!.instances,
  ).toHaveLength(1);
  await expect(
    page.getByRole("tab", { name: /Beta renamed$/ }).getByLabel("Unsaved"),
  ).toBeVisible();
  // Management of an inactive tab must preserve the selected circuit and its
  // recovery identity, while detaching the deleted tab from its Cloud resource.
  await page.getByLabel("Open Shelf project in tab", { exact: true }).click();
  await page.getByRole("tab", { name: /Alpha local$/ }).click();
  await page.getByLabel("Open Shelf project in tab", { exact: true }).click();
  await shelfPanel
    .getByRole("button", { name: "Beta renamed", exact: true })
    .hover();
  await shelfPanel
    .getByRole("button", { name: "Delete Beta renamed", exact: true })
    .click();
  await shelfPanel
    .getByRole("button", { name: "Keep it", exact: true })
    .click();
  expect(deletes).toEqual([]);
  await shelfPanel
    .getByRole("button", { name: "Delete Beta renamed", exact: true })
    .click();
  await shelfPanel
    .getByRole("button", { name: "Really delete", exact: true })
    .click();
  await expect.poll(() => deleteRequested).toBe(true);
  const writesBeforeDeletion = [...writes];
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 100, y: 100 } });
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByTestId("status")).toContainText("Can't save yet");
  expect(writes).toEqual(writesBeforeDeletion);
  finishDeletion();
  await expect.poll(() => deletes).toEqual(["cloud-1"]);
  await expect(
    shelfPanel.getByRole("button", { name: "Beta renamed", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /Beta renamed$/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Alpha local$/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
  await page.getByLabel("Open Shelf project in tab", { exact: true }).click();
  await page.reload();
  await awaitEditorReady(page);
  await expect(page.getByRole("tab", { name: /Alpha local$/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("tab", { name: /Beta renamed$/ }).click();
  await expect(page.getByTestId("active-instance-count")).toHaveText("2");
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => creations).toEqual(["cloud-recreated"]);
  expect(
    parseSavedProject(
      records.find((item) => item.id === "cloud-recreated")!.projectText,
    ).documents[0]!.instances,
  ).toHaveLength(2);
  await expect(
    page.getByRole("tab", { name: /Beta renamed$/ }).getByLabel("Unsaved"),
  ).toHaveCount(0);
});

test("plain C/V works between internal tabs when system clipboard permission is denied", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          document.documentElement.dataset.clipboardAccess = "requested";
          throw new Error("denied");
        },
        readText: async () => {
          document.documentElement.dataset.clipboardAccess = "requested";
          throw new Error("denied");
        },
      },
    });
  });
  await page.goto("/editor?new=1");
  await insert(page, "nmos", 300, 220);
  await insert(page, "nmos", 470, 220);
  await insert(page, "nmos", 630, 220);
  await page.getByTestId("hit-M1").click();
  await page.keyboard.press("c");
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "New project tab", exact: true })
    .click();
  // Unsaved work in an inactive tab continues protecting browser close/reload.
  expect(
    await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      // Model BeforeUnloadEvent's string returnValue, not Event's legacy cancel setter.
      Object.defineProperty(event, "returnValue", {
        value: "",
        writable: true,
      });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(true);
  await page.keyboard.press("v");
  await expect(page.getByTestId("status")).toContainText("click to place");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 500, y: 240 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
  await page.getByRole("tab").first().click();
  await expect(page.getByTestId("active-instance-count")).toHaveText("3");
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-clipboard-access",
  );
});

test("refresh restores every unsaved tab and active view without crossing browser windows", async ({
  page,
  context,
}) => {
  // Four complete circuit exports before and after reload, plus another
  // browser window, are a longer journey than the single-edit checks.
  test.slow();
  await page.goto("/editor?new=1");
  const expected: CircuitProject[] = [];
  const views: (string | null)[] = [];
  for (const symbol of ["nmos", "pmos", "resistor", "capacitor"]) {
    if (expected.length)
      await page
        .getByRole("button", { name: "New project tab", exact: true })
        .click();
    await insert(page, symbol, 240 + expected.length * 30, 250);
    expected.push(await saved(page));
    views.push(
      await page.getByTestId("schematic-canvas").getAttribute("viewBox"),
    );
  }
  await page.getByRole("tab").nth(1).click();
  // A different browser window starts independent, even on the same URL.
  const other = await context.newPage();
  await other.goto("/editor?new=1");
  await expect(other.getByRole("tab")).toHaveCount(1);
  await insert(other, "inductor", 260, 230);
  other.on("dialog", (dialog) => dialog.accept());
  await other.reload();
  await expect(other.getByTestId("active-instance-count")).toHaveText("1");
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByRole("tab")).toHaveCount(4);
  await expect(page.getByRole("tab").nth(1)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  for (let index = 0; index < expected.length; index++) {
    await page.getByRole("tab").nth(index).click();
    await expect(page.getByTestId("active-instance-count")).toHaveText("1");
    await expect(page.getByTestId("schematic-canvas")).toHaveAttribute(
      "viewBox",
      views[index]!,
    );
    expect((await saved(page)).documents).toEqual(expected[index]!.documents);
  }
  // A closed tab stays closed across the next refresh.
  await page
    .getByRole("button", { name: /Close tab / })
    .last()
    .click();
  await page
    .getByRole("button", { name: "Close without saving", exact: true })
    .click();
  await page.reload();
  await expect(page.getByRole("tab")).toHaveCount(3);
  await other.close();
});

/** How many tabs this window's saved workspace holds (null: none saved). */
async function savedTabCount(page: Page): Promise<number | null> {
  return page.evaluate(
    () =>
      new Promise<number | null>((resolve, reject) => {
        const windowId = sessionStorage.getItem("icm.workspace-window.v1");
        const request = indexedDB.open("analog-canvas-workspaces", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const read = request.result
            .transaction("windows")
            .objectStore("windows")
            .get(windowId ?? "");
          read.onsuccess = () => {
            request.result.close();
            resolve(read.result ? read.result.tabs.length : null);
          };
          read.onerror = () => reject(read.error);
        };
      }),
  );
}

test("a fresh browser tab offers the tabs a closed window left, and reopens them once (#1250)", async ({
  page,
  context,
}) => {
  test.slow();
  await page.goto("/editor?new=1");
  await insert(page, "resistor", 240, 250);
  await page
    .getByRole("button", { name: "New project tab", exact: true })
    .click();
  await insert(page, "capacitor", 270, 250);
  await expect.poll(() => savedTabCount(page)).toBe(2);
  const banner = (target: Page) =>
    target.getByTestId("workspace-reopen-banner");

  // While that window is open, its tabs are its own.
  const beside = await context.newPage();
  await beside.goto("/editor");
  await awaitEditorReady(beside);
  await beside.waitForTimeout(300);
  await expect(banner(beside)).toHaveCount(0);
  await beside.close();

  await page.close();
  const fresh = await context.newPage();
  await fresh.goto("/editor");
  await expect(banner(fresh)).toContainText("2 tabs open");
  await banner(fresh).getByRole("button", { name: "Reopen tabs" }).click();
  await expect(banner(fresh)).toHaveCount(0);
  // The untouched blank circuit gave way to the two reopened tabs.
  await expect(fresh.getByRole("tab")).toHaveCount(2);
  for (let index = 0; index < 2; index++) {
    await fresh.getByRole("tab").nth(index).click();
    await expect(fresh.getByTestId("active-instance-count")).toHaveText("1");
  }
  await expect.poll(() => savedTabCount(fresh)).toBe(2);

  // Taken over, they are offered to no other window.
  const later = await context.newPage();
  await later.goto("/editor");
  await awaitEditorReady(later);
  await later.waitForTimeout(300);
  await expect(banner(later)).toHaveCount(0);
  await later.close();
});

test("New Circuit opens a blank tab beside the circuit this window drew, and a refresh adds none", async ({
  page,
}) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/editor?new=1");
  await insert(page, "resistor", 240, 250);

  // The Gallery's New Circuit again, in the same browser tab: the circuit
  // drawn before stays in its own tab and the new one starts empty.
  await page.goto("/editor?new=1");
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.getByRole("tab").nth(1)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByTestId("active-instance-count")).toHaveText("0");
  // The request is handled, so the address no longer asks for another.
  await expect(page).toHaveURL(/\/editor$/);

  await page.reload();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.getByRole("tab").first().click();
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");

  // The blank tab is the open one from the start: the circuit brought back
  // beside it is never shown, and a file opened at once lands in the blank
  // tab, not over that unsaved circuit.
  await page.addInitScript(() => {
    const seen = window as unknown as { drawnTabShown?: boolean };
    new MutationObserver(() => {
      const first = document.querySelector('[role="tab"]');
      if (first?.getAttribute("aria-selected") === "true")
        seen.drawnTabShown = true;
    }).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-selected"],
    });
  });
  await page.goto("/editor?new=1");
  await page.getByTestId("project-file").setInputFiles({
    name: "opened.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      serializeProject(createEmptyProject("project-opened", "Opened")),
    ),
  });
  await expect(page.getByRole("tab")).toHaveCount(3);
  await expect(page.getByRole("tab").nth(2)).toContainText("Opened");
  await expect(page.getByRole("tab").nth(2)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".replace-guard-dialog")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { drawnTabShown?: boolean }).drawnTabShown,
    ),
  ).toBeUndefined();
  await page.getByRole("tab").first().click();
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
});

// Plain C/V across tabs is pasted by the partial-selection, fresh-copy and
// denied-permission cases; these rows check the browser's own copy events.
for (const modifier of ["Control", "Meta"]) {
  test(`${modifier} C/V copies a wired subset into an existing project`, async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/editor?new=1");
    await insert(page, "nmos", 260, 200);
    await insert(page, "nmos", 450, 200);
    await insert(page, "resistor", 600, 400);
    await page.keyboard.press("w");
    await page.getByTestId("terminal-M1-S").click();
    await page.getByTestId("terminal-M2-S").click();
    await page.keyboard.press("Escape");
    // Box-select both transistors and their wire, leaving the resistor behind.
    const a = (await page.getByTestId("hit-M1").boundingBox())!;
    const b = (await page.getByTestId("hit-M2").boundingBox())!;
    await page.mouse.move(Math.min(a.x, b.x) - 25, Math.min(a.y, b.y) - 25);
    await page.mouse.down();
    await page.mouse.move(
      Math.max(a.x + a.width, b.x + b.width) + 25,
      Math.max(a.y + a.height, b.y + b.height) + 25,
      { steps: 5 },
    );
    await page.mouse.up();
    const key = (letter: string) => `${modifier}+${letter}`;
    // A leftover browser selection in the header must not take ownership
    // once the canvas has focus again.
    await page.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector("h1")!);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
    });
    await page.getByTestId("schematic-canvas").focus();
    const sourceRoutes = await page
      .locator('[data-layer="routes"] polyline')
      .count();
    await page.keyboard.press(key("c"));
    await expect(page.getByTestId("status")).toContainText("Circuit copied");
    await expect(page.getByTestId("copy-placement-preview")).toHaveCount(0);
    expect(sourceRoutes).toBeGreaterThan(0);
    const encoded = await page.evaluate(() => navigator.clipboard.readText());
    const source = JSON.parse(encoded).project.documents[0];
    expect(source.instances).toHaveLength(2);
    expect(source.routes.length).toBe(sourceRoutes);
    await page
      .getByRole("button", { name: "New project tab", exact: true })
      .click();
    await insert(page, "capacitor", 300, 400);
    await page.keyboard.press(key("v"));
    await expect(page.getByTestId("status")).toContainText("click to place");
    await page
      .getByTestId("schematic-canvas")
      .click({ position: { x: 380, y: 200 } });
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("active-instance-count")).toHaveText("3");
    await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(
      sourceRoutes,
    );
    const result = (await saved(page)).documents[0]!;
    expect(
      result.instances.filter((item) => item.symbolId === "nmos"),
    ).toHaveLength(2);
    expect(
      result.instances.filter((item) => item.symbolId === "capacitor"),
    ).toHaveLength(1);
    expect(result.instances.some((item) => item.symbolId === "resistor")).toBe(
      false,
    );
    // A single undo removes the appended group, keeping the target capacitor.
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.getByTestId("active-instance-count")).toHaveText("1");
    await page.getByRole("tab").first().click();
    await expect(page.getByTestId("active-instance-count")).toHaveText("3");
  });
}

test("tab names edit in place as one undoable change", async ({ page }) => {
  await page.goto("/editor?new=1");
  await awaitEditorReady(page);
  const tab = page.getByRole("tab", { selected: true });
  await tab.dblclick();
  const name = page.getByRole("textbox", { name: "Project name", exact: true });
  await expect(name).toBeFocused();
  await name.fill("OTA input stage");
  await name.press("Enter");
  await expect(name).toBeHidden();
  await expect(tab).toContainText("OTA input stage");
  await expect(tab.getByLabel("Unsaved")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(tab).toContainText("New Circuit");
});

test("name blur commits to the owning tab and text keys stay out of the canvas", async ({
  page,
}) => {
  await page.goto("/editor?new=1");
  await awaitEditorReady(page);
  await renameProject(page, "Project A");
  await page
    .getByRole("button", { name: "New project tab", exact: true })
    .click();
  await expect(page.getByRole("tab", { selected: true })).toContainText(
    "New Circuit",
  );
  await renameProject(page, "Project B");
  const first = page.getByRole("tab", { includeHidden: true }).first();
  const second = page.getByRole("tab", { includeHidden: true }).nth(1);
  await first.click();
  await expect(first).toHaveAttribute("aria-selected", "true");
  await insert(page, "resistor", 260, 220);
  await first.dblclick();
  const name = page.getByRole("textbox", { name: "Project name", exact: true });
  await name.fill("Project A revised");
  await name.press("Home");
  await name.press("ArrowRight");
  await name.press("w");
  await name.press("r");
  await name.press("Delete");
  await expect(name).toBeFocused();
  await expect(first).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("hit-R1")).toHaveCount(1);
  await name.fill("Project A revised");
  await second.click();
  await expect(name).toBeHidden();
  await expect(second).toHaveAttribute("aria-selected", "true");
  await expect(first).toContainText("Project A revised");
  await expect(second).toContainText("Project B");
  await first.click();
  await expect(first).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(first).toContainText("Project A");
  await expect(page.getByTestId("hit-R1")).toHaveCount(1);
});

test("double-clicking another project's name activates it before inline editing", async ({
  page,
}) => {
  await page.goto("/editor?new=1");
  await awaitEditorReady(page);
  await renameProject(page, "Project A");
  await page
    .getByRole("button", { name: "New project tab", exact: true })
    .click();
  await expect(page.getByRole("tab", { selected: true })).toContainText(
    "New Circuit",
  );
  await renameProject(page, "Project B");
  await page.getByRole("tab", { name: /Project A/ }).dblclick();
  const name = page.getByRole("textbox", { name: "Project name", exact: true });
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("Project A");
  await name.fill("Revised A");
  await name.press("Enter");
  await expect(page.getByRole("tab", { selected: true })).toContainText(
    "Revised A",
  );
  await expect(page.getByRole("tab", { name: /Project B/ })).toBeVisible();
});

test("tab-bar New and Close actions keep their clicked target while a name commits", async ({
  page,
}) => {
  await page.goto("/editor?new=1");
  await awaitEditorReady(page);
  await page.getByRole("tab", { selected: true }).dblclick();
  const name = page.getByRole("textbox", { name: "Project name", exact: true });
  await name.fill("A circuit name that expands on commit");
  await page
    .getByRole("button", { name: "New project tab", exact: true })
    .click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.getByRole("tab").first()).toContainText(
    "A circuit name that expands on commit",
  );
  await expect(page.getByRole("tab", { selected: true })).toContainText(
    "New Circuit",
  );
  await page.getByRole("tab", { selected: true }).dblclick();
  await name.fill("Another renamed circuit");
  await page
    .getByRole("button", { name: "Close tab New Circuit", exact: true })
    .click();
  await expect(page.getByTestId("project-tab-close-decision")).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.getByRole("button", { name: "Keep open", exact: true }).click();
  await expect(page.getByRole("tab", { selected: true })).toContainText(
    "Another renamed circuit",
  );
});

test("closing a clean tab does not borrow the renamed tab's unsaved decision", async ({
  page,
}) => {
  await page.goto("/editor?new=1");
  await awaitEditorReady(page);
  await page
    .getByRole("button", { name: "New project tab", exact: true })
    .click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.getByRole("tab").first().click();
  await expect(page.getByRole("tab").first()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("tab", { selected: true }).dblclick();
  const name = page.getByRole("textbox", { name: "Project name", exact: true });
  await name.fill("Edited project");
  await page
    .getByRole("button", { name: "Close tab New Circuit", exact: true })
    .nth(1)
    .click();
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.getByTestId("project-tab-close-decision")).toHaveCount(0);
  await expect(page.getByRole("tab", { selected: true })).toContainText(
    "Edited project",
  );
});

test("external tab activation cannot discard the focused name draft", async ({
  page,
  baseURL,
}) => {
  await page.goto("/editor?new=1");
  await awaitEditorReady(page);
  await renameProject(page, "Project A");
  await page
    .getByRole("button", { name: "New project tab", exact: true })
    .click();
  await expect(page.getByRole("tab", { selected: true })).toContainText(
    "New Circuit",
  );
  await renameProject(page, "Project B");
  await page.getByTestId("open-agent").click();
  const panel = page.getByTestId("connect-agent-panel");
  const message = panel.getByTestId("agent-copy-text");
  await expect(message).toHaveValue(/Claim: /);
  const { claimCode } = JSON.parse(
    /^Claim: (.+)$/mu.exec(await message.inputValue())![1]!,
  );
  const client = new AgentHttpClient({ baseUrl: baseURL! });
  const session = await client.claim(claimCode);
  await expect(panel.getByTestId("agent-status")).toHaveText("Connected");
  await panel.getByRole("button", { name: "Close Agent dialog" }).click();
  const list = await client.projects(session.sessionId, session.agentToken, {
    apiVersion: "3.0",
    requestId: "rename-workspaces",
    operation: "workspace",
    request: { action: "list" },
  });
  if (
    !list.ok ||
    list.operation !== "workspace" ||
    list.result.action !== "list"
  )
    throw new Error("Could not read the real editor's workspaces");
  const activeWorkspaceId = list.result.activeWorkspaceId;
  const target = list.result.projects.find(
    (item) => item.workspaceId !== activeWorkspaceId,
  )!;
  await page.getByRole("tab", { selected: true }).dblclick();
  const name = page.getByRole("textbox", { name: "Project name", exact: true });
  await name.fill("Pending B");
  // The external caller is real; observations stay at the editor UI seam.
  await client.projects(session.sessionId, session.agentToken, {
    apiVersion: "3.0",
    requestId: "activate-while-naming",
    operation: "workspace",
    request: { action: "activate", workspaceId: target.workspaceId },
  });
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("Pending B");
  await expect(
    page.getByRole("tab", { includeHidden: true, selected: true }),
  ).toHaveAttribute("title", "Project B");
  await name.press("Enter");
  await client.projects(session.sessionId, session.agentToken, {
    apiVersion: "3.0",
    requestId: "activate-after-naming",
    operation: "workspace",
    request: { action: "activate", workspaceId: target.workspaceId },
  });
  await expect(page.getByRole("tab", { selected: true })).toContainText(
    "Project A",
  );
  await expect(page.getByRole("tab", { name: /Pending B/ })).toBeVisible();
});

test("unchanged imported whitespace names make no edit on Enter or blur", async ({
  page,
}) => {
  const project = createEmptyProject("spaced-name", "  Preserved name  ");
  await page.goto("/editor?new=1");
  await awaitEditorReady(page);
  await page.getByTestId("project-file").setInputFiles({
    name: "spaced.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(project)),
  });
  const tab = page.getByRole("tab", { selected: true });
  await expect(tab).toHaveAttribute("title", project.name);
  const before = await saved(page);
  for (const method of ["Enter", "blur"]) {
    await tab.dblclick();
    const name = page.getByRole("textbox", {
      name: "Project name",
      exact: true,
    });
    await expect(name).toHaveValue(project.name);
    if (method === "Enter") await name.press("Enter");
    else await page.getByTestId("project-menu-toggle").click();
    await expect(name).toBeHidden();
    await expect(tab).toHaveAttribute("title", project.name);
    await expect(tab.getByLabel("Unsaved")).toHaveCount(0);
    expect(await saved(page)).toEqual(before);
  }
});

test("unchanged legacy names survive the Cloud-length input limit and IME Enter", async ({
  page,
}) => {
  const project = createEmptyProject("legacy-name", "A".repeat(124));
  await page.goto("/editor?new=1");
  await awaitEditorReady(page);
  await page.getByTestId("project-file").setInputFiles({
    name: "legacy.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(project)),
  });
  const tab = page.getByRole("tab", { selected: true });
  await expect(tab).toContainText(project.name);
  const name = page.getByRole("textbox", { name: "Project name", exact: true });
  for (const key of ["Escape", "Enter"]) {
    await tab.dblclick();
    await expect(name).toHaveValue(project.name);
    await expect(name).toHaveAttribute("maxlength", "120");
    await name.press(key);
    await expect(name).toBeHidden();
    await expect(tab).toContainText(project.name);
  }
  await tab.dblclick();
  await name.fill("放大器");
  await name.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("放大器");
  await name.press("Enter");
  await expect(tab).toContainText("放大器");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(tab).toContainText(project.name);
});

test("tab rename keeps header geometry and Project Info renames the circuit and its Cell", async ({
  page,
}) => {
  await page.goto("/editor?new=1");
  await insert(page, "resistor", 260, 220);
  const toggle = page.getByTestId("project-menu-toggle");
  const fileMenu = await openMenu(page, "File");
  // One New Project and no second list of the tabs: the tabs choose the
  // project, and the name is edited in its tab.
  await expect(
    fileMenu.getByRole("button", { name: "New Project" }),
  ).toHaveCount(1);
  const file = page.getByTestId("project-menu");
  await expect(file.getByRole("menuitemradio")).toHaveCount(0);
  await expect(file.getByRole("textbox")).toHaveCount(0);
  await page.keyboard.press("Escape");

  const longName =
    "Voltage regulator with a very long circuit name for temperature and supply characterization";
  const tab = page.getByRole("tab", { selected: true });
  await tab.dblclick();
  const name = page.getByRole("textbox", { name: "Project name", exact: true });
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("New Circuit");
  const before = (await page.getByTestId("schematic-canvas").boundingBox())!;
  await name.fill(longName);
  expect(await page.getByTestId("schematic-canvas").boundingBox()).toEqual(
    before,
  );
  await name.press("Enter");
  await expect(name).toBeHidden();
  await expect(page.getByTestId("project-name")).toHaveText(longName);
  // The tab shows the name. The header's File menu keeps its short label
  // with the whole name as its tooltip, so a long name never widens it.
  await expect(page.getByRole("tab", { selected: true })).toContainText(
    longName,
  );
  await expect(toggle).toHaveAttribute("title", longName);
  await expect(toggle.locator(".project-menu-title")).toHaveText("File");
  for (const width of [1360, 720]) {
    await page.setViewportSize({ width, height: 900 });
    const brand = (await page.locator(".gallery-home-link").boundingBox())!;
    const trigger = (await toggle.boundingBox())!;
    expect(trigger.x).toBeGreaterThanOrEqual(brand.x + brand.width);
    expect(trigger.width).toBeLessThanOrEqual(96);
    const dialog = await openProjectInfo(page);
    await expect(
      dialog.getByRole("textbox", { name: "Name", exact: true }),
    ).toHaveValue(longName);
    await expect(dialog).toContainText("Current Cell");
    // About two thirds of the window.
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(Math.abs(bounds.width - (width * 2) / 3)).toBeLessThanOrEqual(2);
    await page.screenshot({ path: `plan/project-info-${width}.png` });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }
  // Escape cancels, and a blank name leaves the old name intact.
  await tab.dblclick();
  await name.fill("Uncommitted rename");
  await page.keyboard.press("Escape");
  await expect(name).toBeHidden();
  await tab.dblclick();
  await name.fill("  ");
  await name.press("Enter");
  await expect(toggle).toHaveAttribute("title", longName);
  // A rename is an ordinary edit: one Undo restores the old name.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("project-name")).toHaveText("New Circuit");

  // Project Info names the circuit and its Cell as one undoable edit.
  const info = await openProjectInfo(page);
  const cellField = info.getByRole("textbox", {
    name: "Current Cell",
    exact: true,
  });
  const cellName = await cellField.inputValue();
  await info
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Bandgap reference");
  await cellField.fill("bandgap_core");
  await cellField.press("Enter");
  await expect(info).toBeHidden();
  await expect(page.getByTestId("project-name")).toHaveText(
    "Bandgap reference",
  );
  await expect(page.getByRole("tab", { selected: true })).toContainText(
    "Bandgap reference",
  );
  await openProjectInfo(page);
  await expect(cellField).toHaveValue("bandgap_core");
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("project-name")).toHaveText("New Circuit");
  await openProjectInfo(page);
  await expect(cellField).toHaveValue(cellName);
  await page.keyboard.press("Escape");

  // Projects are switched with the tabs.
  await page
    .getByRole("button", { name: "New project tab", exact: true })
    .click();
  await expect(name).toHaveCount(0);
  await insert(page, "capacitor", 340, 260);
  await page.getByRole("tab").first().click();
  await expect(page.getByTestId("hit-R1")).toHaveCount(1);
  await expect(page.getByTestId("hit-C1")).toHaveCount(0);
});

for (const method of ["C", "C across Projects", "Ctrl+C/V across Projects"]) {
  test(`attaches a copied Net Label to a wire with its exact look using ${method}`, async ({
    page,
    context,
  }) => {
    const { createRoutePath } = await import("@icm/model");
    const { resolveDocumentLogicalNets } = await import("@icm/derived");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const project = createEmptyProject("label-landing", "Label landing");
    const document = project.documents[0]!;
    for (const [id, y] of [
      ["source", 100],
      ["target", 300],
    ] as const) {
      document.nets.push({ id, terminals: [] });
      document.junctions.push(
        {
          id: `${id}-a`,
          netId: id,
          position: { x: 100, y },
          role: "route-anchor",
        },
        {
          id: `${id}-b`,
          netId: id,
          position: { x: 300, y },
          role: "route-anchor",
        },
      );
      document.routes.push(
        createRoutePath({
          id: `${id}-wire`,
          netId: id,
          start: { kind: "junction", junctionId: `${id}-a` },
          end: { kind: "junction", junctionId: `${id}-b` },
          bends: [],
          modes: ["manual"],
        }),
      );
    }
    document.annotations.push({
      id: "source-label",
      kind: "net-label",
      netId: "source",
      binding: { kind: "net-name", netId: "source" },
      anchor: { kind: "free", position: { x: 200, y: 80 } },
      alignment: "end",
      rotation: 0,
      locked: false,
      textColor: "#be123c",
      sizeScale: 1.25,
      formatOverride: {
        runs: [
          {
            kind: "span",
            style: "overbar",
            children: [
              { kind: "text", value: "IN" },
              {
                kind: "span",
                style: "subscript",
                children: [{ kind: "text", value: "1" }],
              },
            ],
          },
        ],
      },
    });
    document.connectivityEvidence.push({
      id: "source-name",
      kind: "name-claim",
      netId: "source",
      name: "IN_1_bar",
      scope: "local",
      owner: { kind: "net-label", annotationId: "source-label" },
    });
    const sourceLabel = structuredClone(document.annotations[0]!);
    const open = async (value: CircuitProject) => {
      await page.getByTestId("project-file").setInputFiles({
        name: `${value.id}.icproj.json`,
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(value)),
      });
      await awaitEditorReady(page);
    };
    await page.goto("/editor?new=1");
    await open(project);
    const crossProject = method !== "C";
    if (crossProject) {
      await page
        .getByRole("button", { name: "New project tab", exact: true })
        .click();
      const destination = structuredClone(project);
      destination.id = "destination";
      destination.documents[0]!.annotations = [];
      destination.documents[0]!.connectivityEvidence = [];
      await open(destination);
      await page.getByRole("tab").first().click();
    }
    await page.getByTestId("annotation-hit-source-label").click();
    const systemPaste = method === "Ctrl+C/V across Projects";
    await page.keyboard.press(systemPaste ? "Control+c" : "c");
    if (crossProject) await page.getByRole("tab").nth(1).click();
    const canvas = page.getByTestId("schematic-canvas");
    if (systemPaste) {
      await canvas.focus();
      await page.keyboard.press("Control+v");
    }
    const wirePoint = await canvas.evaluate((element) => {
      const matrix = (element as SVGSVGElement).getScreenCTM()!;
      const point = new DOMPoint(200, 300).matrixTransform(matrix);
      return { x: point.x, y: point.y };
    });
    // Screen-space distance, independent of the fitted camera's zoom.
    await page.mouse.move(wirePoint.x, wirePoint.y - 6);
    const ghost = page.getByTestId("copy-placement-preview");
    await expect(ghost).toBeVisible();
    await expect(ghost.locator('[data-text-decoration="overbar"]')).toHaveCount(
      1,
    );
    await expect(ghost.locator('[data-text-run="subscript"]')).toHaveCount(1);
    await page.mouse.click(wirePoint.x, wirePoint.y - 6);
    await page.keyboard.press("Escape");
    const initialCount = crossProject ? 0 : 1;
    const labels = page.locator(
      '[data-layer="annotations"] [data-kind="net-label"]',
    );
    await expect(labels).toHaveCount(initialCount + 1);
    const pasted = (await saved(page)).documents[0]!;
    const attached = pasted.annotations.find(
      (item) => item.netId === "target",
    )!;
    expect(attached).toMatchObject({
      netId: "target",
      binding: { kind: "net-name", netId: "target" },
      anchor: {
        kind: "route",
        routeId: "target-wire",
        fallbackPosition: { x: 200, y: 290 },
      },
      alignment: sourceLabel.alignment,
      rotation: sourceLabel.rotation,
      textColor: sourceLabel.textColor,
      sizeScale: sourceLabel.sizeScale,
      formatOverride: sourceLabel.formatOverride,
    });
    expect(pasted.nets).toHaveLength(2);
    const targetName = (doc: typeof pasted) =>
      resolveDocumentLogicalNets(doc).groups.find((group) =>
        group.baseNetIds.includes("target"),
      )?.name;
    expect(targetName(pasted)).toBe("IN_1_bar");
    await canvas.focus();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(labels).toHaveCount(initialCount);
    expect(targetName((await saved(page)).documents[0]!)).not.toBe("IN_1_bar");
    await canvas.focus();
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(labels).toHaveCount(initialCount + 1);
    expect(targetName((await saved(page)).documents[0]!)).toBe("IN_1_bar");

    // Just outside the same 12 px capture radius: keep the ordinary free copy.
    await canvas.focus();
    await page.keyboard.press("v");
    await page.mouse.move(wirePoint.x, wirePoint.y - 24);
    await expect(ghost).toBeVisible();
    await page.mouse.click(wirePoint.x, wirePoint.y - 24);
    await page.keyboard.press("Escape");
    await expect(labels).toHaveCount(initialCount + 2);
    const free = (await saved(page)).documents[0]!.annotations.find(
      (item) =>
        item.id !== attached.id && (crossProject || item.id !== "source-label"),
    )!;
    expect(free).toMatchObject({
      anchor: { kind: "free" },
      textColor: sourceLabel.textColor,
      sizeScale: sourceLabel.sizeScale,
      formatOverride: sourceLabel.formatOverride,
    });
  });
}

for (const kind of ["port", "net"] as const) {
  test(`copies a styled ${kind} with identical name and overbar using C, Ctrl+C/V and project tabs`, async ({
    page,
    context,
  }) => {
    const { createEmptyProject, createRoutePath } = await import("@icm/model");
    const { resolveDocumentLogicalNets } = await import("@icm/derived");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const project = createEmptyProject("copy-names", "Copy names");
    const document = project.documents[0]!;
    document.nets.push({
      id: "input-net",
      terminals: kind === "port" ? [{ instanceId: "P1", pinName: "P" }] : [],
    });
    if (kind === "port") {
      document.instances.push({
        id: "P1",
        symbolId: "port",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      });
      document.netlist = {
        name: "dut",
        formalParameters: [],
        terminals: [
          {
            id: "input-port",
            name: "IN_1_bar",
            netId: "input-net",
            direction: "input",
            interfaceInstanceIds: ["P1"],
          },
        ],
      };
    } else {
      document.junctions.push(
        {
          id: "a",
          netId: "input-net",
          position: { x: 100, y: 100 },
          role: "route-anchor",
        },
        {
          id: "b",
          netId: "input-net",
          position: { x: 250, y: 100 },
          role: "route-anchor",
        },
      );
      document.routes.push(
        createRoutePath({
          id: "wire",
          netId: "input-net",
          start: { kind: "junction", junctionId: "a" },
          end: { kind: "junction", junctionId: "b" },
          bends: [],
          modes: ["manual"],
        }),
      );
      document.connectivityEvidence.push({
        id: "input-name",
        kind: "name-claim",
        netId: "input-net",
        name: "IN_1_bar",
        scope: "local",
        owner: { kind: "net-label", annotationId: "input-label" },
      });
    }
    document.annotations.push({
      id: "input-label",
      kind: kind === "port" ? "instance-label" : "net-label",
      ...(kind === "net" ? { netId: "input-net" } : {}),
      binding:
        kind === "port"
          ? { kind: "cell-terminal-name", terminalId: "input-port" }
          : { kind: "net-name", netId: "input-net" },
      anchor:
        kind === "port"
          ? {
              kind: "object",
              objectId: "P1",
              localOffset: { x: -25, y: -10 },
              fallbackPosition: { x: 75, y: 90 },
            }
          : { kind: "free", position: { x: 160, y: 75 } },
      alignment: "end",
      rotation: 0,
      locked: false,
      textColor: "#be123c",
      sizeScale: 1.25,
      formatOverride: {
        runs: [
          {
            kind: "span",
            style: "bold",
            children: [
              {
                kind: "span",
                style: "italic",
                children: [
                  {
                    kind: "span",
                    style: "overbar",
                    children: [
                      { kind: "text", value: "IN" },
                      {
                        kind: "span",
                        style: "subscript",
                        children: [{ kind: "text", value: "1" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    await page.goto("/editor?new=1");
    await page.getByTestId("project-file").setInputFiles({
      name: "copy-names.icproj.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(project)),
    });
    const canvas = page.getByTestId("schematic-canvas");
    const labels = page.locator(
      '[data-layer="annotations"] [data-object-id^="input-label"]',
    );
    await expect(labels).toHaveCount(1);
    const originalText = await labels.first().textContent();
    const sourceLabel = structuredClone(document.annotations[0]!);
    const select = async () => {
      if (kind === "port") await page.getByTestId("hit-P1").click();
      else await page.getByTestId("annotation-hit-input-label").click();
    };
    const verify = async (count: number) => {
      await expect(labels).toHaveCount(count);
      for (const label of await labels.all()) {
        await expect(label).toHaveText(originalText!);
        await expect(
          label.locator("..").locator('[data-text-decoration="overbar"]'),
        ).toHaveCount(1);
        await expect(label.locator('[data-text-run="subscript"]')).toHaveCount(
          1,
        );
      }
      const result = await saved(page);
      const target = result.documents[0]!;
      for (const label of target.annotations) {
        expect(label).toMatchObject({
          formatOverride: sourceLabel.formatOverride,
          textColor: sourceLabel.textColor,
          sizeScale: sourceLabel.sizeScale,
          alignment: sourceLabel.alignment,
          rotation: sourceLabel.rotation,
        });
        if (kind === "port")
          expect(label.anchor).toMatchObject({
            kind: "object",
            localOffset: { x: -25, y: -10 },
          });
      }
      const logical = resolveDocumentLogicalNets(target).groups;
      expect(logical).toHaveLength(1);
      expect(logical[0]!.name).toBe("IN_1_bar");
      expect(logical[0]!.baseNetIds).toHaveLength(count);
      if (kind === "port") {
        expect(
          target.netlist!.terminals.every(
            (terminal) => terminal.name === "IN_1_bar",
          ),
        ).toBe(true);
        const netlist = page.getByLabel("Netlist code", { exact: true });
        await expect(netlist).toContainText("IN_1_bar");
        await expect(netlist).not.toContainText("copy");
      }
      return result;
    };
    await select();
    await page.keyboard.press("c");
    const ghost = page.getByTestId("copy-placement-preview");
    await expect(ghost).toBeVisible();
    await expect(ghost).not.toContainText("copy");
    await expect(ghost.locator('[data-text-decoration="overbar"]')).toHaveCount(
      1,
    );
    await canvas.click({ position: { x: 390, y: 280 } });
    await page.keyboard.press("Escape");
    await verify(2);
    await canvas.focus();
    await page.keyboard.press("Control+z");
    await expect(labels).toHaveCount(1);
    await page.keyboard.press("Control+Shift+z");
    await verify(2);

    await select();
    await page.keyboard.press("Control+c");
    await page.keyboard.press("Control+v");
    await expect(ghost).toBeVisible();
    await canvas.click({ position: { x: 420, y: 420 } });
    await page.keyboard.press("Escape");
    const repeated = await verify(3);
    await page
      .getByRole("button", { name: "New project tab", exact: true })
      .click();
    await page.keyboard.press("v");
    await expect(ghost).toBeVisible();
    await canvas.click({ position: { x: 350, y: 260 } });
    await page.keyboard.press("Escape");
    await verify(1);
    await page.getByRole("tab").first().click();
    await verify(3);
    await page.getByTestId("project-file").setInputFiles({
      name: "reopened.icproj.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(repeated)),
    });
    await verify(3);
  });
}

test("Reopen tabs brings back unsaved edits to a Cloud Project open here as an unsaved copy (#1599)", async ({
  context,
}) => {
  test.slow();
  const alpha = createEmptyProject("project-alpha", "Alpha");
  const summary = {
    id: "cloud-alpha",
    name: "Alpha",
    revision: 1,
    schemaVersion: alpha.schemaVersion,
    updatedAt: "2026-10-10T00:00:00.000Z",
  };
  await context.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u1",
          displayName: "Author",
          email: "author@example.com",
          provider: "github",
          isAdmin: false,
        },
      },
    }),
  );
  await context.route("**/api/projects", (route) =>
    route.fulfill({ json: { projects: [summary] } }),
  );
  await context.route("**/api/projects/cloud-alpha", (route) =>
    route.fulfill({
      json: { project: { ...summary, projectText: serializeProject(alpha) } },
    }),
  );
  const alphaTab = (target: Page) =>
    target.getByRole("tab", { name: /Alpha$/ });

  // Edit Alpha without saving, then close the browser tab.
  const page = await context.newPage();
  await page.goto("/editor?project=cloud-alpha");
  await expect(alphaTab(page)).toHaveAttribute("aria-selected", "true");
  await insert(page, "resistor", 260, 240);
  await expect(alphaTab(page).getByLabel("Unsaved")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<boolean>((resolve, reject) => {
            const windowId = sessionStorage.getItem("icm.workspace-window.v1");
            const request = indexedDB.open("analog-canvas-workspaces", 1);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const read = request.result
                .transaction("windows")
                .objectStore("windows")
                .get(windowId ?? "");
              read.onsuccess = () => {
                request.result.close();
                resolve(
                  Boolean(
                    read.result?.tabs.some(
                      (tab: {
                        session: {
                          dirty: boolean;
                          file: { cloudBinding: { id: string } | null };
                        };
                      }) =>
                        tab.session.dirty &&
                        tab.session.file.cloudBinding?.id === "cloud-alpha",
                    ),
                  ),
                );
              };
              read.onerror = () => reject(read.error);
            };
          }),
      ),
    )
    .toBe(true);
  await page.close();

  // A new browser tab opens Alpha from the Shelf: its saved version.
  const fresh = await context.newPage();
  await fresh.goto("/editor");
  const banner = fresh.getByTestId("workspace-reopen-banner");
  await expect(banner).toContainText("Alpha");
  await fresh.getByLabel("Open Shelf project in tab", { exact: true }).click();
  await fresh
    .locator(".project-tabs-shelf")
    .getByRole("button", { name: "Alpha", exact: true })
    .click();
  await expect(alphaTab(fresh)).toHaveAttribute("aria-selected", "true");
  await expect(fresh.getByTestId("active-instance-count")).toHaveText("0");

  // Reopen tabs brings the edits back beside it, bound to no Cloud Project.
  await banner.getByRole("button", { name: "Reopen tabs" }).click();
  const copy = fresh.getByRole("tab", { name: /Alpha \(unsaved copy\)$/ });
  await expect(copy).toHaveAttribute("aria-selected", "true");
  await expect(copy.getByLabel("Unsaved")).toBeVisible();
  await expect(fresh.getByTestId("active-instance-count")).toHaveText("1");
  await alphaTab(fresh).click();
  await expect(fresh.getByTestId("active-instance-count")).toHaveText("0");
});
