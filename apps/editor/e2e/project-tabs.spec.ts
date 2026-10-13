import {
  expect,
  test,
  type Locator,
  type Page,
  type Route,
} from "@playwright/test";
import {
  awaitEditorReady,
  awaitTwoFrames,
  exportedProject,
  openMenu,
  openProjectFile,
  openProjectInfo,
  parseSavedProject,
  placeComponentAt,
  renameProject,
  openEditor,
  renameShelfProject,
} from "./editor-fixtures";
import { sessionUser, signIn } from "./gallery-fixtures";
import { createEmptyProject, type CircuitProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { AgentHttpClient } from "../../../packages/agent-client/src/http-client.js";
import { placedInstance, onScreen } from "./canvas-fixtures.js";

const saved = (page: Page): Promise<CircuitProject> => exportedProject(page);
// The account the Cloud cases sign in as; it carries no role.
const author = sessionUser({
  displayName: "Author",
  email: "author@example.com",
  role: undefined,
});

const newProjectTab = (page: Page) =>
  page.getByRole("button", { name: "New project tab", exact: true });

const expectSelected = (tab: Locator) =>
  expect(tab).toHaveAttribute("aria-selected", "true");

/** Switch to the tab at this index and check how many parts it holds. */
async function showTab(page: Page, index: number, count: string) {
  await page.getByRole("tab").nth(index).click();
  await expect(page.getByTestId("active-instance-count")).toHaveText(count);
}

/** Drop the copy in hand at a canvas point, then leave placement. */
async function dropCopy(page: Page, x: number, y: number, count: string) {
  await page.getByTestId("schematic-canvas").click({ position: { x, y } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("active-instance-count")).toHaveText(count);
}

/** Open a Shelf project in a tab, which becomes the selected one. */
async function openShelfProject(page: Page, name: string) {
  await page.getByLabel("Open Shelf project in tab", { exact: true }).click();
  await page
    .locator(".project-tabs-shelf")
    .getByRole("button", { name, exact: true })
    .click();
  await expectSelected(page.getByRole("tab", { name: new RegExp(`${name}$`) }));
}

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
  await placeComponentAt(page, "nmos", { x: 240, y: 220 });
  await placeComponentAt(page, "nmos", { x: 440, y: 220 });
  await placeComponentAt(page, "pmos", { x: 650, y: 330 });
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
  await newProjectTab(page).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.getByTestId("active-instance-count")).toHaveText("0");
  await placeComponentAt(page, "resistor", { x: 260, y: 400 });
  const before = await saved(page);
  await showTab(page, 0, "3");
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
  await showTab(page, 1, "1");
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  await expect(page.getByTestId("status")).toContainText("click to place");
  await dropCopy(page, 480, 230, "3");
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
  await showTab(page, 0, "3");
  await expect(canvas).toHaveAttribute("viewBox", sourceView!);
  expect((await saved(page)).documents).toEqual(source.documents);
  await page.getByRole("tab").nth(1).click();
  await expect(canvas).toHaveAttribute("viewBox", targetView!);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.getByTestId("active-instance-count")).toHaveText("3");
  // A single component and the browser's own copy events use the same
  // append path. A leftover browser selection in the header must not take
  // ownership once the canvas has focus again, and Ctrl/Cmd+C puts the
  // fragment on the system clipboard without a placement in hand.
  await page.getByRole("tab").first().click();
  await page.getByTestId("hit-M3").click();
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("h1")!);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
  });
  await canvas.focus();
  await page.keyboard.press("ControlOrMeta+c");
  await expect(page.getByTestId("status")).toContainText("Circuit copied");
  await expect(page.getByTestId("copy-placement-preview")).toHaveCount(0);
  const encoded = await page.evaluate(() => navigator.clipboard.readText());
  expect(JSON.parse(encoded).project.documents[0].instances).toHaveLength(1);
  await page.getByRole("tab").nth(1).click();
  await page.keyboard.press("ControlOrMeta+v");
  await dropCopy(page, 660, 380, "4");
  // The other modifier gets no clipboard event from the browser; the editor
  // runs the same copy and paste for it.
  const alternate = await page.evaluate(() =>
    /Mac|iPhone|iPad|iPod/u.test(navigator.platform) ? "Control" : "Meta",
  );
  await page.getByRole("tab").first().click();
  await page.getByTestId("hit-M3").click();
  await page.keyboard.press(`${alternate}+c`);
  await page.getByRole("tab").nth(1).click();
  await canvas.focus();
  await page.keyboard.press(`${alternate}+v`);
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  await dropCopy(page, 560, 440, "5");
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
  await expectSelected(page.getByRole("tab").nth(1));
  await page.getByRole("button", { name: /Reload/ }).click();
  await showTab(page, 0, "3");
});

test("C carries a fresh copy into another tab, and V and Ctrl/Cmd+V paste the same", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  // M1's gate is on the Net a Cell Pin names O; its source goes to ground.
  const project = createEmptyProject("fresh-tab-copy", "Fresh tab copy");
  const document = project.documents[0]!;
  document.instances.push(
    {
      ...placedInstance("M1", "nmos", 300, 200),
      reference: "M1",
      netlist: {
        binding: { kind: "model", deviceClass: "mos", name: "NMOS" },
        parameters: { w: "1u", l: "150n", nf: "1", m: "1" },
      },
    },
    placedInstance("P1", "port", 200, 200),
    placedInstance("GND1", "ground", 320, 300),
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
  await openEditor(page, "/editor?new=1");
  await openProjectFile(page, serializeProject(project));
  await expect(page.getByTestId("hit-M1")).toBeVisible();
  const ghost = page.getByTestId("copy-placement-preview");
  const netLabels = page.locator(
    '[data-layer="annotations"] [data-kind="net-label"]',
  );

  await page.getByTestId("hit-M1").click();
  await page.keyboard.press("c");
  await expect(ghost).toBeVisible();
  await page.keyboard.press("r");
  await newProjectTab(page).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  // Still in hand, still turned, and nothing from the source circuit rides
  // along: no O, no ground name.
  await expect(ghost).toBeVisible();
  await expect(ghost.locator('[data-kind="net-label"]')).toHaveCount(0);
  await dropCopy(page, 400, 300, "1");
  await expect(netLabels).toHaveCount(0);
  const carried = (await saved(page)).documents[0]!;
  expect(carried.instances[0]!.placement?.rotation).toEqual(expect.any(Number));
  expect(carried.instances[0]!.placement?.rotation).not.toBe(0);
  expect(carried.nets.flatMap((net) => net.terminals)).toEqual([]);

  // V pastes what C copied: the same fresh insertion, not the outside names.
  await page.keyboard.press("v");
  await expect(ghost).toBeVisible();
  await expect(ghost.locator('[data-kind="net-label"]')).toHaveCount(0);
  await dropCopy(page, 560, 300, "2");
  await expect(netLabels).toHaveCount(0);

  await showTab(page, 0, "3");
  await expect(ghost).toHaveCount(0);

  // Ctrl/Cmd+C in one tab and Ctrl/Cmd+V in another place exactly what C does.
  await page.getByTestId("hit-M1").click();
  await page.keyboard.press("ControlOrMeta+c");
  await showTab(page, 1, "2");
  await page.keyboard.press("ControlOrMeta+v");
  await expect(ghost).toBeVisible();
  await expect(ghost.locator('[data-kind="net-label"]')).toHaveCount(0);
  await dropCopy(page, 480, 420, "3");
  await expect(netLabels).toHaveCount(0);
  const pasted = (await saved(page)).documents[0]!;
  expect(pasted.nets.flatMap((net) => net.terminals)).toEqual([]);
});

test("tab file opening is additive, and closing one tab, the others or all asks only for unsaved ones", async ({
  page,
}) => {
  await page.goto("/editor?new=1");
  await placeComponentAt(page, "resistor", { x: 300, y: 220 });
  const exported = await saved(page);
  exported.name = "Second circuit";
  await page.getByTestId("tab-project-file").setInputFiles({
    name: "second.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveCount(2);
  await expectSelected(page.getByRole("tab", { name: "Second circuit" }));
  await tabs.nth(1).focus();
  await page.keyboard.press("ArrowLeft");
  await expectSelected(tabs.first());
  await expect(tabs.first()).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expectSelected(tabs.nth(1));
  await placeComponentAt(page, "capacitor", { x: 500, y: 260 });
  await page.setViewportSize({ width: 360, height: 600 });
  const canvas = page.getByTestId("schematic-canvas");
  // Let the responsive side panels finish settling after the viewport change.
  await expect.poll(async () => (await canvas.boundingBox())?.x).toBe(0);
  const beforeClose = await canvas.boundingBox();
  const beforeView = await canvas.getAttribute("viewBox");
  await page.getByRole("button", { name: "Close tab Second circuit" }).click();
  await expect(
    page.getByRole("button", { name: "Keep open", exact: true }),
  ).toBeFocused();
  const strip = page.getByTestId("project-tab-close-decision");
  await expect(strip.locator(".inline-confirm-decision")).toHaveText(
    "Close without savingKeep open",
  );
  expect(await canvas.boundingBox()).toEqual(beforeClose);
  await expect(canvas).toHaveAttribute("viewBox", beforeView!);
  expect(
    await strip.evaluate(
      (element) =>
        element.scrollWidth <= element.clientWidth &&
        element.getBoundingClientRect().height <= 44 &&
        [...element.querySelectorAll("button:not([hidden])")].every(
          (button) => button.getBoundingClientRect().right <= innerWidth,
        ),
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Keep open", exact: true }).click();
  expect(await canvas.boundingBox()).toEqual(beforeClose);
  await expect(tabs).toHaveCount(2);
  await page.getByRole("button", { name: "Close tab Second circuit" }).click();
  await page
    .getByRole("button", { name: "Close without saving", exact: true })
    .click();
  await expect(tabs).toHaveCount(1);
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
  await page.setViewportSize({ width: 1280, height: 720 });

  // A tab's right-click menu: Close Others keeps the tab right-clicked, and
  // clean tabs go without asking.
  const newTab = newProjectTab(page);
  const menu = page.getByTestId("project-tab-menu");
  await newTab.click();
  await newTab.click();
  await expect(tabs).toHaveCount(3);
  await tabs.first().click({ button: "right" });
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Close",
    "Close Others",
    "Close All",
  ]);
  await menu.getByRole("menuitem", { name: "Close Others" }).click();
  await expect(tabs).toHaveCount(1);
  await expectSelected(tabs);
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");

  // Close All asks once for the unsaved tabs, then leaves one blank tab.
  await newTab.click();
  await placeComponentAt(page, "capacitor", { x: 300, y: 240 });
  await tabs.first().click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Close All" }).click();
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
  const stored = (index: number) =>
    parseSavedProject(records[index]!.projectText);
  await signIn(page, author);
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
  await openShelfProject(page, "Alpha");
  await expect(page.getByRole("tab")).toHaveCount(2);
  await placeComponentAt(page, "nmos", { x: 300, y: 240 });
  await openShelfProject(page, "Beta");
  await placeComponentAt(page, "resistor", { x: 450, y: 240 });
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => writes).toEqual(["cloud-1"]);
  await openShelfProject(page, "Alpha");
  await expect(page.getByRole("tab")).toHaveCount(3);
  await page.getByRole("tab").first().click();
  expect((await saved(page)).id).toBe(blankProjectId);
  await openShelfProject(page, "Alpha");
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
  expect(reads).toEqual(["cloud-0", "cloud-1"]);
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => writes).toEqual(["cloud-1", "cloud-0"]);
  expect(stored(0).documents[0]!.instances[0]!.symbolId).toBe("nmos");
  expect(stored(1).documents[0]!.instances[0]!.symbolId).toBe("resistor");
  await page.getByRole("tab", { name: /Alpha$/ }).dblclick();
  const name = page.getByRole("textbox", { name: "Project name", exact: true });
  await name.fill("Alpha local");
  await name.press("Enter");
  await renameShelfProject(page, "Alpha", "Alpha stored");
  await expect(
    page.getByRole("tab", { name: /Alpha local$/ }).getByLabel("Unsaved"),
  ).toBeVisible();
  expect(stored(0).name).toBe("Alpha stored");
  await page.getByLabel("Open Shelf project in tab", { exact: true }).click();
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto("/");
  await openEditor(page, "/editor?project=cloud-1");
  await expect(page.getByRole("tab")).toHaveCount(3);
  await expectSelected(page.getByRole("tab", { name: /Beta$/ }));
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
  await placeComponentAt(page, "nmos", { x: 300, y: 240 });
  await renameShelfProject(page, "Beta", "Beta renamed");
  const shelfPanel = page.locator(".project-tabs-shelf");
  await expectSelected(page.getByRole("tab", { name: /Beta renamed$/ }));
  await expect(page.getByTestId("active-instance-count")).toHaveText("2");
  expect(stored(1).documents[0]!.instances).toHaveLength(1);
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
  const deleteBeta = shelfPanel.getByRole("button", {
    name: "Delete Beta renamed",
    exact: true,
  });
  await deleteBeta.click();
  await shelfPanel
    .getByRole("button", { name: "Keep it", exact: true })
    .click();
  expect(deletes).toEqual([]);
  await deleteBeta.click();
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
  await expectSelected(page.getByRole("tab", { name: /Alpha local$/ }));
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
  await page.getByLabel("Open Shelf project in tab", { exact: true }).click();
  await page.reload();
  await awaitEditorReady(page);
  await expectSelected(page.getByRole("tab", { name: /Alpha local$/ }));
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

test("the Arena gate opens after a manual Cloud Save and on every Shelf opening, sends the person to Arena's window, and closes after five new votes or when Arena has nothing to offer (#1681)", async ({
  context,
  page,
}) => {
  await signIn(page, author);
  let revision = 0;
  const saveAnswer = (route: Route) => {
    const body = route.request().postDataJSON();
    return route.fulfill({
      status: route.request().method() === "POST" ? 201 : 200,
      json: {
        project: {
          id: "cloud-gate",
          name: body.name,
          revision: ++revision,
          schemaVersion: parseSavedProject(body.projectText).schemaVersion,
          updatedAt: "2026-10-12T00:00:00Z",
          projectText: body.projectText,
        },
      },
    });
  };
  await page.route("**/api/projects", (route) =>
    route.request().method() === "POST"
      ? saveAnswer(route)
      : route.fulfill({ json: { projects: [] } }),
  );
  await page.route("**/api/projects/cloud-gate", saveAnswer);
  // Arena behind Analog Canvas's Worker: the Voter's voted Battles, newest
  // first with when each was cast, answered with Arena's clock.
  const votes = [
    { id: "old", castAt: new Date(Date.now() - 3_600_000).toISOString() },
  ];
  let arenaUp = true;
  let aiAccount = false;
  let pastReads = 0;
  let battlesLeft = 40;
  let sessionReads = 0;
  await page.route("**/api/arena/battles/past", (route) =>
    ++pastReads && aiAccount
      ? route.fulfill({ status: 403, json: { error: "ai-account" } })
      : arenaUp
        ? route.fulfill({
            headers: { date: new Date().toUTCString() },
            json: { battles: votes, more: false, total: votes.length },
          })
        : route.fulfill({ status: 503, json: { error: "arena-unavailable" } }),
  );
  // Arena's session: the Battles left to this Voter (0 for an AI seat).
  await page.route("**/api/arena/session", (route) => {
    sessionReads++;
    return route.fulfill({
      json: {
        signedIn: true,
        aiAccount,
        consented: true,
        votes: 1,
        battlesLeft: aiAccount ? 0 : battlesLeft,
      },
    });
  });
  // Chip Arena's animated Battle, stubbed: no test reaches chip-arena.com.
  let previews = 0;
  await context.route("https://chip-arena.com/**", (route) => {
    previews++;
    return route.fulfill({ contentType: "text/html", body: "<p>Battle</p>" });
  });
  // Arena's own window, wherever it opens.
  await context.route(/\/schematic\?/u, (route) =>
    route.fulfill({ contentType: "text/html", body: "<title>Arena</title>" }),
  );

  // Opening, closing and not showing the gate leave React nothing to say.
  const unmountWarnings: string[] = [];
  page.on("console", (message) => {
    if (/unmount/iu.test(message.text())) unmountWarnings.push(message.text());
  });
  await page.goto("/editor?new=1");
  await awaitEditorReady(page);
  const gate = page.getByTestId("arena-gate");
  const close = gate.getByRole("button", { name: "Close", exact: true });
  const count = page.getByTestId("arena-gate-count");

  // The save completes first; then the gate opens and holds.
  await page.keyboard.press("ControlOrMeta+s");
  await expect(gate).toBeVisible();
  expect(revision).toBe(1);
  await expect(gate).toContainText("Vote on 5 Battles to continue");
  // Five dots, none filled; readers hear the count.
  await expect(count.locator("[aria-hidden]")).toHaveCount(5);
  await expect(count.locator("[data-filled]")).toHaveCount(0);
  await expect(count).toHaveText("Voted 0 of 5");
  // Chip Arena's animated Battle, framed from chip-arena.com itself.
  await expect(gate.locator("iframe")).toHaveAttribute(
    "src",
    "https://chip-arena.com/schematic/preview",
  );
  await expect.poll(() => previews).toBeGreaterThan(0);
  await expect(close).toHaveAttribute("aria-disabled", "true");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.activeElement?.closest("[data-testid=arena-gate]") !== null,
      ),
    )
    .toBe(true);
  // Neither Escape, Close nor the backdrop gets past it yet.
  await page.keyboard.press("Escape");
  // Playwright waits for an aria-disabled button; a person can still press it.
  await close.click({ force: true });
  await page.mouse.click(4, 4);
  await expect(gate).toBeVisible();

  // The battle page opens in a window of its own, marked as the gate's.
  const [arena] = await Promise.all([
    context.waitForEvent("page"),
    gate.getByRole("link", { name: "Start voting →" }).click(),
  ]);
  expect(new URL(arena.url()).pathname + new URL(arena.url()).search).toBe(
    "/schematic?from=canvas-gate",
  );
  // Five Votes there; the gate counts them on its next read.
  for (let vote = 1; vote <= 5; vote++)
    votes.unshift({ id: `new-${vote}`, castAt: new Date().toISOString() });
  await arena.close();
  await page.bringToFront();
  await expect(count).toHaveText("Voted 5 of 5", { timeout: 10_000 });
  await expect(count.locator("[data-filled]")).toHaveCount(5);
  await expect(close).toHaveAttribute("aria-disabled", "false");
  await page.keyboard.press("Escape");
  await expect(gate).toHaveCount(0);

  // Every Shelf opening opens it again. With 3 Battles left it asks for 3,
  // and when they run out it lets the person go.
  battlesLeft = 3;
  const shelf = page.getByLabel("Open Shelf project in tab", { exact: true });
  await shelf.click();
  await expect(gate).toContainText("Vote on 3 Battles to continue");
  await expect(count).toHaveText("Voted 0 of 3");
  await expect(count.locator("[aria-hidden]")).toHaveCount(3);
  battlesLeft = 0;
  await expect(gate).toContainText(
    "Arena has no more Battles for you right now.",
    { timeout: 10_000 },
  );
  await page.keyboard.press("Escape");
  await expect(gate).toHaveCount(0);
  // With none left, opening the Shelf (shut, then open) shows no panel.
  await shelf.click();
  const sessionReadsBefore = sessionReads;
  await shelf.click();
  await expect.poll(() => sessionReads).toBe(sessionReadsBefore + 1);
  await awaitTwoFrames(page);
  await expect(gate).toHaveCount(0);

  // An unreachable Arena never traps anyone either.
  battlesLeft = 40;
  await placeComponentAt(page, "resistor", { x: 400, y: 240 });
  arenaUp = false;
  await page.keyboard.press("ControlOrMeta+s");
  await expect(gate).toContainText("Arena can't be reached right now.");
  await expect(gate.getByRole("link")).toHaveCount(0);
  await close.click();
  await expect(gate).toHaveCount(0);
  expect(revision).toBe(2);

  // An AI account, which may not vote, saves without any panel.
  await placeComponentAt(page, "resistor", { x: 500, y: 240 });
  arenaUp = true;
  aiAccount = true;
  const readsBefore = pastReads;
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => pastReads).toBe(readsBefore + 1);
  await expect.poll(() => revision).toBe(3);
  await awaitTwoFrames(page);
  await expect(gate).toHaveCount(0);
  expect(unmountWarnings).toEqual([]);
});

test("only the person's own opening of the Cloud shelf opens the Arena gate, so a reload always ends one (#1681)", async ({
  page,
}) => {
  // The hosted Gallery, as gallery-test.ts selects it, has My shelf.
  await page.addInitScript(() => {
    Object.assign(window, { __icmLocalGalleryReplica: true });
  });
  await page.route("https://chip-arena.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<p>Battle</p>" }),
  );
  await signIn(page, author);
  await page.route("**/api/projects", (route) =>
    route.fulfill({ json: { projects: [] } }),
  );
  let reads = 0;
  await page.route("**/api/arena/battles/past", (route) => {
    reads++;
    return route.fulfill({
      headers: { date: new Date().toUTCString() },
      json: { battles: [], more: false, total: 0 },
    });
  });
  await page.route("**/api/arena/session", (route) =>
    route.fulfill({
      json: { signedIn: true, aiAccount: false, battlesLeft: 12 },
    }),
  );
  const gate = page.getByTestId("arena-gate");
  const shelfTab = page.getByTestId("gallery-view-shelf");

  // The Gallery opening on My shelf, from its address, opens no gate.
  await page.goto("/?view=shelf");
  await expect(shelfTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("gallery-view-gallery")).toBeEnabled();
  // Choosing My shelf does.
  await page.getByTestId("gallery-view-gallery").click();
  await shelfTab.click();
  await expect(gate).toBeVisible();
  expect(reads).toBe(1);
  await page.keyboard.press("Escape");
  await expect(gate).toBeVisible();
  // A reload, still on My shelf, ends it and opens none.
  await page.reload();
  await expect(shelfTab).toHaveAttribute("aria-selected", "true");
  await expect(gate).toHaveCount(0);

  // So too the account page's Cloud Projects.
  await page.goto("/account?tab=projects");
  const projectsTab = page.getByTestId("account-tab-projects");
  await expect(projectsTab).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("account-tab-circuits").click();
  expect(reads).toBe(1);
  await projectsTab.click();
  await expect(gate).toBeVisible();
  expect(reads).toBe(2);
  await page.reload();
  await expect(projectsTab).toHaveAttribute("aria-selected", "true");
  await expect(gate).toHaveCount(0);
  expect(reads).toBe(2);
});

test("plain C/V works between internal tabs when system clipboard permission is denied", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const denied = async () => {
      document.documentElement.dataset.clipboardAccess = "requested";
      throw new Error("denied");
    };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: denied, readText: denied },
    });
  });
  await page.goto("/editor?new=1");
  await placeComponentAt(page, "nmos", { x: 300, y: 220 });
  await placeComponentAt(page, "nmos", { x: 470, y: 220 });
  await placeComponentAt(page, "nmos", { x: 630, y: 220 });
  await page.getByTestId("hit-M1").click();
  await page.keyboard.press("c");
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await newProjectTab(page).click();
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
  await dropCopy(page, 500, 240, "1");
  await showTab(page, 0, "3");
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-clipboard-access",
  );
});

test("refresh restores every unsaved tab and the active view, and a closed tab stays closed", async ({
  page,
}) => {
  await page.goto("/editor?new=1");
  const expected: CircuitProject[] = [];
  const views: (string | null)[] = [];
  for (const symbol of ["nmos", "resistor"]) {
    if (expected.length) await newProjectTab(page).click();
    await placeComponentAt(page, symbol, {
      x: 240 + expected.length * 30,
      y: 250,
    });
    expected.push(await saved(page));
    views.push(
      await page.getByTestId("schematic-canvas").getAttribute("viewBox"),
    );
  }
  await page.getByRole("tab").first().click();
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expectSelected(page.getByRole("tab").first());
  for (let index = 0; index < expected.length; index++) {
    await showTab(page, index, "1");
    await expect(page.getByTestId("schematic-canvas")).toHaveAttribute(
      "viewBox",
      views[index]!,
    );
    expect((await saved(page)).documents).toEqual(expected[index]!.documents);
  }
  await page
    .getByRole("button", { name: /Close tab / })
    .last()
    .click();
  await page
    .getByRole("button", { name: "Close without saving", exact: true })
    .click();
  await page.reload();
  await expect(page.getByRole("tab")).toHaveCount(1);
});

/** This window's saved tabs, each as [unsaved, its Cloud Project id]. */
function savedTabs(page: Page): Promise<[boolean, string | null][]> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
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
              (read.result?.tabs ?? []).map(({ session }: { session: any }) => [
                session.dirty,
                session.file.cloudBinding?.id ?? null,
              ]),
            );
          };
          read.onerror = () => reject(read.error);
        };
      }),
  );
}

test("a fresh browser tab offers the tabs a closed window left, reopens them once, and brings a Cloud Project's unsaved edits back as a copy (#1250, #1599)", async ({
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
  await signIn(context, author);
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
  const banner = (target: Page) =>
    target.getByTestId("workspace-reopen-banner");
  const expectNothingOffered = async () => {
    const other = await context.newPage();
    await other.goto("/editor");
    await awaitEditorReady(other);
    await other.waitForTimeout(300);
    await expect(banner(other)).toHaveCount(0);
    await other.close();
  };

  // Edit Cloud Project Alpha and a new circuit without saving either.
  const page = await context.newPage();
  await page.goto("/editor?project=cloud-alpha");
  await expectSelected(alphaTab(page));
  await placeComponentAt(page, "resistor", { x: 260, y: 240 });
  await expect(alphaTab(page).getByLabel("Unsaved")).toBeVisible();
  await newProjectTab(page).click();
  await placeComponentAt(page, "capacitor", { x: 270, y: 250 });
  await expect
    .poll(() => savedTabs(page))
    .toEqual([
      [false, null],
      [true, "cloud-alpha"],
      [true, null],
    ]);

  // While that window is open, its tabs are its own.
  await expectNothingOffered();

  await page.close();
  const fresh = await context.newPage();
  await fresh.goto("/editor");
  await expect(banner(fresh)).toContainText("3 tabs open");
  await expect(banner(fresh)).toContainText("Alpha");
  // Opened from the Shelf, Alpha is its saved version.
  await openShelfProject(fresh, "Alpha");
  await expect(fresh.getByTestId("active-instance-count")).toHaveText("0");

  // Reopen tabs brings the edits back beside it, Alpha's bound to no Cloud
  // Project.
  await banner(fresh).getByRole("button", { name: "Reopen tabs" }).click();
  await expect(banner(fresh)).toHaveCount(0);
  const copy = fresh.getByRole("tab", { name: /Alpha \(unsaved copy\)$/ });
  await expect(copy.getByLabel("Unsaved")).toBeVisible();
  await copy.click();
  await expect(fresh.getByTestId("active-instance-count")).toHaveText("1");
  await alphaTab(fresh).click();
  await expect(fresh.getByTestId("active-instance-count")).toHaveText("0");
  await fresh.getByRole("tab").last().click();
  await expect(fresh.getByTestId("active-instance-count")).toHaveText("1");

  // Taken over, they are offered to no other window.
  await expectNothingOffered();
});

test("each blank Project has its own stable identity, and New Circuit opens a blank tab beside the circuit this window drew", async ({
  page,
  context,
}) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/editor?new=1");
  const initialId = (await saved(page)).id;
  expect(initialId).toMatch(/^project-/);
  const separateWindow = await context.newPage();
  await separateWindow.goto("/editor?new=1");
  expect((await saved(separateWindow)).id).not.toBe(initialId);
  await separateWindow.close();
  await page.reload();
  expect((await saved(page)).id).toBe(initialId);
  await placeComponentAt(page, "resistor", { x: 240, y: 250 });

  // The Gallery's New Circuit again, in the same browser tab: the circuit
  // drawn before stays in its own tab and the new one starts empty.
  await page.goto("/editor?new=1");
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expectSelected(page.getByRole("tab").nth(1));
  await expect(page.getByTestId("active-instance-count")).toHaveText("0");
  const nextId = (await saved(page)).id;
  expect(nextId).toMatch(/^project-/);
  expect(nextId).not.toBe(initialId);
  // The request is handled, so the address no longer asks for another.
  await expect(page).toHaveURL(/\/editor$/);

  await page.reload();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await showTab(page, 0, "1");

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
  await openProjectFile(
    page,
    serializeProject(createEmptyProject("project-opened", "Opened")),
  );
  await expect(page.getByRole("tab")).toHaveCount(3);
  await expect(page.getByRole("tab").nth(2)).toContainText("Opened");
  await expectSelected(page.getByRole("tab").nth(2));
  await expect(page.locator(".replace-guard-dialog")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { drawnTabShown?: boolean }).drawnTabShown,
    ),
  ).toBeUndefined();
  await showTab(page, 0, "1");
});

test("tab names edit in place as one undoable change and commit to their own tab through activation, New, Close and blur", async ({
  page,
}) => {
  await openEditor(page, "/editor?new=1");
  const tabs = page.getByRole("tab", { includeHidden: true });
  const first = tabs.first();
  const second = tabs.nth(1);
  const selected = page.getByRole("tab", { selected: true });
  const name = page.getByRole("textbox", { name: "Project name", exact: true });
  const newTab = newProjectTab(page);
  await first.dblclick();
  await expect(name).toBeFocused();
  await name.fill("OTA input stage");
  await name.press("Enter");
  await expect(name).toBeHidden();
  await expect(first).toContainText("OTA input stage");
  await expect(first.getByLabel("Unsaved")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(first).toContainText("New Circuit");

  // New, clicked while a name commits and widens its tab, still opens a tab.
  await first.dblclick();
  await name.fill("A circuit name that expands on commit");
  await newTab.click();
  await expect(tabs).toHaveCount(2);
  await expect(first).toContainText("A circuit name that expands on commit");
  await expect(selected).toContainText("New Circuit");
  await renameProject(page, "Project B");

  // Double-clicking another project's name activates it before editing.
  await first.dblclick();
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("A circuit name that expands on commit");
  await name.fill("Project A");
  await name.press("Enter");
  await expect(selected).toContainText("Project A");
  await expect(second).toContainText("Project B");

  // Text keys stay out of the canvas, and blur commits to the owning tab.
  await placeComponentAt(page, "resistor", { x: 260, y: 220 });
  await first.dblclick();
  await name.fill("Project A revised");
  await name.press("Home");
  await name.press("ArrowRight");
  await name.press("w");
  await name.press("r");
  await name.press("Delete");
  await expect(name).toBeFocused();
  await expectSelected(first);
  await expect(page.getByTestId("hit-R1")).toHaveCount(1);
  await name.fill("Project A revised");
  await second.click();
  await expect(name).toBeHidden();
  await expectSelected(second);
  await expect(first).toContainText("Project A revised");
  await expect(second).toContainText("Project B");
  await first.click();
  await expectSelected(first);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(first).toContainText("Project A");
  await expect(first).not.toContainText("revised");
  await expect(page.getByTestId("hit-R1")).toHaveCount(1);

  // Close, clicked while a clean tab's name commits, asks about the edit
  // the name just made.
  await newTab.click();
  await expect(tabs).toHaveCount(3);
  await selected.dblclick();
  await name.fill("Another renamed circuit");
  await page
    .getByRole("button", { name: "Close tab New Circuit", exact: true })
    .click();
  const decision = page.getByTestId("project-tab-close-decision");
  await expect(decision).toBeVisible();
  await expect(tabs).toHaveCount(3);
  await page.getByRole("button", { name: "Keep open", exact: true }).click();
  await expect(selected).toContainText("Another renamed circuit");

  // Closing a clean tab does not borrow the renamed tab's unsaved decision.
  await newTab.click();
  await first.click();
  await first.dblclick();
  await name.fill("Edited project");
  await page
    .getByRole("button", { name: "Close tab New Circuit", exact: true })
    .click();
  await expect(tabs).toHaveCount(3);
  await expect(decision).toHaveCount(0);
  await expect(selected).toContainText("Edited project");
});

test("unchanged imported or legacy names make no edit on Enter, blur or IME Enter, past the Cloud-length input limit", async ({
  page,
}) => {
  const spaced = createEmptyProject("spaced-name", "  Preserved name  ");
  await openEditor(page, "/editor?new=1");
  await openProjectFile(page, serializeProject(spaced));
  const tab = page.getByRole("tab", { selected: true });
  const name = page.getByRole("textbox", { name: "Project name", exact: true });
  await expect(tab).toHaveAttribute("title", spaced.name);
  const before = await saved(page);
  for (const method of ["Enter", "blur"]) {
    await tab.dblclick();
    await expect(name).toHaveValue(spaced.name);
    if (method === "Enter") await name.press("Enter");
    else await page.getByTestId("project-menu-toggle").click();
    await expect(name).toBeHidden();
    await expect(tab).toHaveAttribute("title", spaced.name);
    await expect(tab.getByLabel("Unsaved")).toHaveCount(0);
    expect(await saved(page)).toEqual(before);
  }

  const legacy = createEmptyProject("legacy-name", "A".repeat(124));
  await openProjectFile(page, serializeProject(legacy));
  await expect(tab).toContainText(legacy.name);
  for (const key of ["Escape", "Enter"]) {
    await tab.dblclick();
    await expect(name).toHaveValue(legacy.name);
    await expect(name).toHaveAttribute("maxlength", "120");
    await name.press(key);
    await expect(name).toBeHidden();
    await expect(tab).toContainText(legacy.name);
  }
  await tab.dblclick();
  await name.fill("放大器");
  await name.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("放大器");
  await name.press("Enter");
  await expect(tab).toContainText("放大器");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(tab).toContainText(legacy.name);
});

test("external tab activation cannot discard the focused name draft", async ({
  page,
  baseURL,
}) => {
  await openEditor(page, "/editor?new=1");
  await renameProject(page, "Project A");
  await newProjectTab(page).click();
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
  const activateOther = (requestId: string) =>
    client.projects(session.sessionId, session.agentToken, {
      apiVersion: "3.0",
      requestId,
      operation: "workspace",
      request: { action: "activate", workspaceId: target.workspaceId },
    });
  await page.getByRole("tab", { selected: true }).dblclick();
  const name = page.getByRole("textbox", { name: "Project name", exact: true });
  await name.fill("Pending B");
  // The external caller is real; observations stay at the editor UI seam.
  await activateOther("activate-while-naming");
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("Pending B");
  await expect(
    page.getByRole("tab", { includeHidden: true, selected: true }),
  ).toHaveAttribute("title", "Project B");
  await name.press("Enter");
  await activateOther("activate-after-naming");
  await expect(page.getByRole("tab", { selected: true })).toContainText(
    "Project A",
  );
  await expect(page.getByRole("tab", { name: /Pending B/ })).toBeVisible();
});

test("tab rename keeps header geometry and Project Info renames the circuit and its Cell", async ({
  page,
}) => {
  await page.goto("/editor?new=1");
  await placeComponentAt(page, "resistor", { x: 260, y: 220 });
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
  await expect(tab).toContainText(longName);
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
  await expect(tab).toContainText("Bandgap reference");
  await openProjectInfo(page);
  await expect(cellField).toHaveValue("bandgap_core");
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("project-name")).toHaveText("New Circuit");
  await openProjectInfo(page);
  await expect(cellField).toHaveValue(cellName);
  await page.keyboard.press("Escape");
});

test("attaches a Net Label copied across Projects with Ctrl+C/V to a wire with its exact look", async ({
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
    await openProjectFile(page, value);
    await awaitEditorReady(page);
  };
  await page.goto("/editor?new=1");
  await open(project);
  await newProjectTab(page).click();
  const destination = structuredClone(project);
  destination.id = "destination";
  destination.documents[0]!.annotations = [];
  destination.documents[0]!.connectivityEvidence = [];
  await open(destination);
  await page.getByRole("tab").first().click();
  await page.getByTestId("annotation-hit-source-label").click();
  await page.keyboard.press("Control+c");
  await page.getByRole("tab").nth(1).click();
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.focus();
  await page.keyboard.press("Control+v");
  const [wirePoint] = await onScreen(canvas, [{ x: 200, y: 300 }]);
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
  const labels = page.locator(
    '[data-layer="annotations"] [data-kind="net-label"]',
  );
  await expect(labels).toHaveCount(1);
  const pasted = (await saved(page)).documents[0]!;
  const attached = pasted.annotations.find((item) => item.netId === "target")!;
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
  await expect(labels).toHaveCount(0);
  expect(targetName((await saved(page)).documents[0]!)).not.toBe("IN_1_bar");
  await canvas.focus();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(labels).toHaveCount(1);
  expect(targetName((await saved(page)).documents[0]!)).toBe("IN_1_bar");

  // Just outside the same 12 px capture radius: keep the ordinary free copy.
  await canvas.focus();
  await page.keyboard.press("v");
  await page.mouse.move(wirePoint.x, wirePoint.y - 24);
  await expect(ghost).toBeVisible();
  await page.mouse.click(wirePoint.x, wirePoint.y - 24);
  await page.keyboard.press("Escape");
  await expect(labels).toHaveCount(2);
  const free = (await saved(page)).documents[0]!.annotations.find(
    (item) => item.id !== attached.id,
  )!;
  expect(free).toMatchObject({
    anchor: { kind: "free" },
    textColor: sourceLabel.textColor,
    sizeScale: sourceLabel.sizeScale,
    formatOverride: sourceLabel.formatOverride,
  });
});
