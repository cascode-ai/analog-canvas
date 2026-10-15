import {
  awaitEditorReady,
  clickCommand,
  parseSavedProject,
  copyNetlistText,
  downloadBytes,
  openCellManagerTab,
  openProjectFile as openFile,
  openEditor,
} from "./editor-fixtures";
import { openSelectionShelf, placeComponent } from "./manual-editor-fixtures";
import { placedInstance, onScreen, drawWire } from "./canvas-fixtures";
import { mockProviders, sessionUser, signIn } from "./gallery-fixtures";
import { analyzeDesignNetlist, createDesignNetlistExport } from "@icm/netlist";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { resolveEndpointPoint, resolveRouteGeometry } from "@icm/derived";
import { AgentHttpClient } from "../../../packages/agent-client/src/http-client";
import { AgentSessionClient } from "../../../packages/agent-client/src/session-client";
import {
  expect,
  test as base,
  type BrowserContext,
  type Page,
  type Locator,
} from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { createEmptyProject, routeEnd, type CircuitProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { executeProjectTransaction } from "@icm/edit-engine";
import { newComponentDefinition } from "../src/features/user-components/component-definition-edit";
import { publishedDefinition } from "../src/features/user-components/component-library-contract";
import {
  ComponentLibraryDO,
  routeComponentLibraryRequest,
} from "../../../worker/component-library";

/** Browser journeys use the real HTTP policy and SQLite storage, with isolated test sessions. */
function library() {
  let dropPublicationResponse = false;
  const db = new DatabaseSync(":memory:");
  const durable = new ComponentLibraryDO({
    storage: {
      sql: {
        exec<T>(sql: string, ...bindings: (string | number | null)[]) {
          const statement = db.prepare(sql);
          if (sql.trim().startsWith("SELECT"))
            return { toArray: () => statement.all(...bindings) as T[] };
          statement.run(...bindings);
          return { toArray: () => [] as T[] };
        },
      },
      transactionSync<T>(fn: () => T): T {
        return fn();
      },
    },
  });
  return {
    seedHistoricalDefinition(id: string, definition: unknown) {
      db.prepare(
        `INSERT INTO components
        (id, revision, author_id, author, status, created_at, updated_at, name, definition)
        VALUES (?, 1, 'alice', 'Alice', 'shared', '2026-01-01', '2026-01-01', ?, ?)`,
      ).run(
        id,
        (definition as { symbol: { name: string } }).symbol.name,
        JSON.stringify(definition),
      );
    },
    /** Seeds revision 1 of a new component definition named `name`. */
    seedPublished(id: string, name: string) {
      const definition = newComponentDefinition();
      definition.symbol.name = name;
      this.seedHistoricalDefinition(id, publishedDefinition(definition, id, 1));
      return definition;
    },
    /** Signs the page's browser in as `identity` (null: signed out), then opens a new editor. */
    async openEditorAs(page: Page, identity: string | null) {
      await this.connect(page.context(), identity);
      await openBlankEditor(page);
    },
    dropNextPublicationResponse: () => {
      dropPublicationResponse = true;
    },
    close: () => db.close(),
    async connect(context: BrowserContext, identity: string | null) {
      const user = identity
        ? sessionUser({
            id: identity,
            displayName: identity,
            email: `${identity}@example.com`,
            isAdmin: identity === "admin",
          })
        : null;
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await signIn(context, user);
      await mockProviders(context, {
        github: true,
        google: false,
        email: false,
      });
      await context.route("**/api/components**", async (route) => {
        const headers = {
          ...route.request().headers(),
          ...(identity ? { cookie: `icm_session=${identity}` } : {}),
        };
        const response = await routeComponentLibraryRequest(
          new Request(route.request().url(), {
            method: route.request().method(),
            headers,
            ...(route.request().postData()
              ? { body: route.request().postData()! }
              : {}),
          }),
          {
            COMPONENT_LIBRARY: {
              getByName: () => ({
                fetch: (input, init) => durable.fetch(new Request(input, init)),
              }),
            },
            AUTH: {
              getByName: () => ({ fetch: async () => Response.json({ user }) }),
            },
          },
        );
        if (
          dropPublicationResponse &&
          route.request().method() === "PUT" &&
          response!.ok
        ) {
          dropPublicationResponse = false;
          await route.abort("failed");
          return;
        }
        await route.fulfill({
          status: response!.status,
          contentType: "application/json",
          body: await response!.text(),
        });
      });
    },
  };
}

/** Each test owns a fresh library, closed when the test ends. */
const test = base.extend<{ service: ReturnType<typeof library> }>({
  service: async ({}, provideService) => {
    const service = library();
    await provideService(service);
    service.close();
  },
});

async function openBlankEditor(page: Page) {
  await openEditor(page, "/editor?new=1");
  await expect(page.getByTestId("shapes-category-user-defined")).toHaveCount(0);
}

/** The commit button, named after the destination it currently offers. */
const PUBLISH = /^(Publish|Update my component)$/;
const text = (scope: Page | Locator, value: string) =>
  scope.getByText(value, { exact: true });
const button = (scope: Page | Locator, name: string | RegExp) =>
  scope.getByRole("button", { name, exact: true });
const netlist = (scope: Locator) =>
  scope.getByLabel("External model netlist", { exact: true });
const entry = (scope: Locator) =>
  scope.getByLabel("External model entry", { exact: true });
const instanceCount = (page: Page) => page.getByTestId("active-instance-count");
const componentEditor = (page: Page) =>
  page.getByRole("dialog", { name: "Edit Component Definition", exact: true });
const libraryDialog = (page: Page) =>
  page.getByRole("dialog", { name: "User Components", exact: true });
const libraryEntries = (page: Page) =>
  page.evaluate(
    async () => (await (await fetch("/api/components")).json()).entries,
  );
/** Sends one JSON request to the real library API, returning its status. */
const requestComponent = (
  page: Page,
  id: string,
  method: string,
  body: unknown,
) =>
  page.evaluate(
    async ({ id, method, body }) =>
      (
        await fetch(`/api/components/${id}`, {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        })
      ).status,
    { id, method, body },
  );
/** Writes a public record through the real library API, returning its status. */
const putComponent = (page: Page, id: string, body: unknown) =>
  requestComponent(page, id, "PUT", body);
/** An administrator's soft deletion of revision 1, returning its status. */
const deleteComponent = (page: Page, id: string) =>
  requestComponent(page, id, "PATCH", { revision: 1, status: "deleted" });
async function copyText(page: Page, field: Locator) {
  await field.focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+c");
  return page.evaluate(() => navigator.clipboard.readText());
}
const openProjectFile = (page: Page, project: CircuitProject | Buffer) =>
  openFile(
    page,
    Buffer.isBuffer(project) ? project : serializeProject(project),
  );
async function markNoConnect(page: Page, terminal: string) {
  await page.getByTestId(terminal).click({ button: "right" });
  await openSelectionShelf(page);
  await button(page, "Mark No Connect").click();
  await page.keyboard.press("Escape");
}
/** Pairs a real Agent session with this Editor: a concurrent Project writer. */
async function pairAgent(page: Page, baseUrl: string) {
  await page.getByTestId("open-agent").click();
  const panel = page.getByTestId("connect-agent-panel");
  const claim = panel.getByTestId("agent-copy-text");
  await expect(claim).toHaveValue(/Claim: /, { timeout: 45_000 });
  const client = new AgentSessionClient({
    http: new AgentHttpClient({ baseUrl }),
  });
  await client.connect(
    JSON.parse(/^Claim: (.+)$/mu.exec(await claim.inputValue())![1]!).claimCode,
  );
  await panel.getByRole("button", { name: "Close Agent dialog" }).click();
  return client;
}
async function editWithKey(page: Page, reference: string) {
  await page.getByTestId(`hit-${reference}`).click();
  await page.keyboard.press("e");
  return componentEditor(page);
}
async function editFromMenu(page: Page, reference: string) {
  await page.getByTestId(`hit-${reference}`).click({ button: "right" });
  await page
    .getByRole("menuitem", {
      name: "Edit Component Definition (E)",
      exact: true,
    })
    .click();
  return componentEditor(page);
}
async function openExternalCircuit(page: Page, name: string) {
  const manager = await openCellManagerTab(page, "External Circuits");
  await manager
    .locator(".cell-manager-list-item")
    .filter({ hasText: name })
    .last()
    .click();
  return manager;
}
async function openUserComponents(page: Page) {
  const dialog = libraryDialog(page);
  await clickCommand(page, "Edit", "User Components…");
  await expect(dialog).toBeVisible();
  return dialog;
}
/** Places the named library component from a newly opened User Components. */
async function placeFromLibrary(
  page: Page,
  name: string,
  x?: number,
  y?: number,
) {
  await openUserComponents(page);
  await button(page, `Place ${name}`).click();
  await place(page, x, y);
}
/** Reopens the Project's one draft from User Components. */
async function openProjectDraft(page: Page, name: string | RegExp) {
  await openUserComponents(page);
  await text(page, "Project drafts (1)").click();
  await button(page, name).click();
}
/** Publishes revision 1 of `definition` through the real library API. */
async function publishComponent(page: Page, id: string, definition: unknown) {
  expect(await putComponent(page, id, { revision: 0, definition })).toBe(200);
}
/** A symbol-only definition named `name`. */
const symbolDefinition = (name: string) => ({
  symbol: { ...newComponentDefinition().symbol, name },
});
/** A historical definition whose interface maps IN only, leaving OUT missing. */
function legacyDefinition(interfaceId: string, name: string) {
  const legacy = {
    ...newComponentDefinition(),
    subcircuit: {
      id: interfaceId,
      symbolId: "custom-component",
      target: "legacy",
      ports: [{ name: "IN", pinName: "IN", direction: "input" }],
    },
  };
  legacy.subcircuit.symbolId = legacy.symbol.id;
  legacy.symbol.name = name;
  return legacy;
}
/** A closed polyline around the box from (left, top) to (right, bottom). */
const boxOutline = (
  left: number,
  top: number,
  right: number,
  bottom: number,
) => ({
  kind: "polyline" as const,
  points: [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
    { x: left, y: top },
  ],
});
/** Chooses an option of the scope's exactly labelled select. */
const choose = (
  scope: Page | Locator,
  label: string,
  option: string | { label: string },
) => scope.getByLabel(label, { exact: true }).selectOption(option);
const symbolJson = (scope: Locator) =>
  scope.getByLabel("Circuit symbol JSON", { exact: true });
/** The Project's component definition for this symbol. */
const definitionOf = (project: CircuitProject, symbolId: string) =>
  project.componentDefinitions!.find((item) => item.symbol.id === symbolId)!;
/** The Project's first-Cell instance with this ID. */
const instanceOf = (project: CircuitProject, id: string) =>
  project.documents[0]!.instances.find((item) => item.id === id)!;
/** Applies the model and waits until the editor reports it applied. */
async function applyModel(scope: Locator) {
  await button(scope, "Apply model").click();
  await expect(scope.getByRole("status")).toContainText("Applied");
}
/** Applies the model and places one instance on the editor's page. */
async function applyAndPlace(editor: Locator, x?: number, y?: number) {
  await button(editor, "Apply & Place").click();
  await expect(editor).toHaveCount(0);
  await place(editor.page(), x, y);
}
async function readProject(page: Page): Promise<CircuitProject> {
  // Sharing journeys return to an earlier editor window. Clipboard reads
  // require that document to be focused, not just its code editor element.
  await page.bringToFront();
  const editor = page.getByRole("textbox", {
    name: "Project code",
    exact: true,
  });
  if (!(await editor.isVisible()))
    await page.getByTestId("project-code-toggle").click();
  const project = parseSavedProject(await copyText(page, editor));
  await page.getByTestId("project-code-toggle").click();
  return project;
}
async function authoringView(
  editor: Locator,
  name: "Circuit" | "Symbol" | "Mapping",
) {
  const tab = editor.getByRole("tab", {
    name: name === "Mapping" ? "Circuit" : name,
    exact: true,
  });
  if (await tab.count()) await tab.click();
  if (name === "Mapping") {
    const details = editor.locator(".component-circuit-interface details");
    if (
      (await details.count()) &&
      (await details.getAttribute("open")) === null
    )
      await details.locator("summary").click();
  }
}

test("reopening details hides a cached public component that is no longer accessible", async ({
  page,
  context,
  service,
}) => {
  service.seedPublished("retained-detail", "Retained detail");
  await service.openEditorAs(page, "admin");
  const dialog = await openUserComponents(page);
  await button(dialog, "Details for Retained detail").click();
  await expect(
    dialog.getByRole("heading", { name: "Retained detail", exact: true }),
  ).toBeVisible();
  await button(dialog, "Close").click();
  expect(await deleteComponent(page, "retained-detail")).toBe(200);
  // Simulate a new signed-out request policy; retained details must be re-read.
  await context.unroute("**/api/auth/me");
  await context.unroute("**/api/components**");
  await service.connect(context, null);
  await openUserComponents(page);
  await expect(
    dialog.getByRole("heading", { name: "Retained detail", exact: true }),
  ).toHaveCount(0);
  await expect(dialog.getByRole("status")).toContainText("not found");
});

test("public symbol placement connects contacts atomically and keeps the clicked orientation during a revision check", async ({
  page,
  context,
  service,
}) => {
  service.seedPublished("contact-block", "Contact block");
  await service.openEditorAs(page, "alice");
  await placeFromLibrary(page, "Contact block");
  const before = await readProject(page);
  const first = before.documents[0]!.instances[0]!;
  const [nextPoint] = await onScreen(
    page.locator(`[data-object-id="${first.id}"][data-symbol-id] > g`).first(),
    [{ x: 80, y: 0 }],
  );
  await openUserComponents(page);
  await button(page, "Place Contact block").click();
  // Click only once the canvas takes placement input; an earlier click is lost.
  await expect(page.getByTestId("component-input-plane")).toBeVisible();
  let resume!: () => void;
  const hold = new Promise<void>((resolve) => {
    resume = resolve;
  });
  await context.route(
    "**/api/components/contact-block?view=identity*",
    async (route) => {
      await hold;
      await route.fallback();
    },
  );
  const checking = page.waitForRequest((request) =>
    request.url().includes("view=identity"),
  );
  await page.mouse.click(nextPoint.x, nextPoint.y);
  await checking;
  await page.keyboard.press("r");
  resume();
  await expect(instanceCount(page)).toHaveText("2");
  await page.keyboard.press("Escape");
  const after = await readProject(page);
  const document = after.documents[0]!;
  const second = document.instances[1]!;
  expect(second.placement?.rotation).toBe(0);
  expect(
    document.nets.some(
      (net) =>
        net.terminals.some(
          (pin) => pin.instanceId === first.id && pin.pinName === "OUT",
        ) &&
        net.terminals.some(
          (pin) => pin.instanceId === second.id && pin.pinName === "IN",
        ),
    ),
  ).toBe(true);
  await page.keyboard.press("ControlOrMeta+z");
  const undone = await readProject(page);
  expect(undone.documents[0]!.instances).toEqual(
    before.documents[0]!.instances,
  );
  expect(undone.documents[0]!.nets).toEqual(before.documents[0]!.nets);
  expect(undone.componentDefinitions).toEqual(before.componentDefinitions);
});

test("library selection refuses a revision changed during preview and editing returns to the library", async ({
  page,
  service,
}) => {
  const definition = service.seedPublished("revision-guard", "Revision guard");
  await service.openEditorAs(page, "alice");
  const dialog = await openUserComponents(page);
  await button(dialog, "Details for Revision guard").click();
  await expect(
    dialog.getByRole("heading", { name: "Revision guard", exact: true }),
  ).toBeVisible();
  await button(dialog, "Back to components").click();
  await clickLibraryAction(dialog, "Edit Revision guard definition");
  await button(page, "Back to library").click();
  await expect(dialog).toBeVisible();
  await button(dialog, "Place Revision guard").click();
  await expect(dialog).toHaveCount(0);
  expect(
    await putComponent(page, "revision-guard", {
      revision: 1,
      definition: {
        ...definition,
        symbol: { ...definition.symbol, name: "Revision guard changed" },
      },
    }),
  ).toBe(200);
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 300, y: 220 } });
  await expect(page.getByTestId("status")).toContainText("changed");
  await expect(instanceCount(page)).toHaveText("0");
  await page.keyboard.press("Escape");
  await openUserComponents(page);
  await button(dialog, "Details for Revision guard").click();
  await expect(
    text(dialog, "This component changed. Refresh before selecting it."),
  ).toBeVisible();
});
test("a revision conflict can retry an interrupted catalog refresh", async ({
  page,
  context,
  service,
}) => {
  const definition = service.seedPublished("recovery-guard", "Recovery guard");
  for (let index = 0; index < 22; index += 1)
    service.seedPublished(
      `recovery-z-${String(index).padStart(2, "0")}`,
      `Device ${index}`,
    );
  await service.openEditorAs(page, "alice");
  const dialog = await openUserComponents(page);
  await expect(dialog.locator(".user-component-tile")).toHaveCount(23);
  expect(
    await putComponent(page, "recovery-guard", {
      revision: 1,
      definition: {
        ...definition,
        symbol: { ...definition.symbol, name: "Recovery guard changed" },
      },
    }),
  ).toBe(200);
  let failNextPage = true;
  await context.route("**/api/components?**", async (route) => {
    if (
      new URL(route.request().url()).searchParams.has("cursor") &&
      failNextPage
    )
      await route.fulfill({
        status: 503,
        json: { error: "Service unavailable" },
      });
    else await route.fallback();
  });
  await button(dialog, "Details for Recovery guard").click();
  await expect(button(dialog, "Try Again")).toBeVisible();
  await expect(dialog.locator(".user-component-tile")).toHaveCount(20);
  failNextPage = false;
  await button(dialog, "Try Again").click();
  await expect(dialog.locator(".user-component-tile")).toHaveCount(23);
  await expect(button(dialog, "Place Recovery guard changed")).toBeVisible();
  await expect(button(dialog, "Try Again")).toHaveCount(0);
});

async function editDefinition(page: Page, name: string) {
  await expect(componentEditor(page)).toBeVisible();
  const mode = page.getByLabel("Definition type", { exact: true });
  if (await mode.count()) await mode.selectOption("json");
  const code = page.getByRole("textbox", {
    name: "Component definition code",
    exact: true,
  });
  await expect(code).toBeVisible();
  const value = JSON.parse(await copyText(page, code));
  value.symbol.name = name;
  value.symbol.primitives.push({
    kind: "circle",
    center: { x: 0, y: 0 },
    radius: 6,
  });
  await code.fill(JSON.stringify(value, null, 2));
}
async function clickLibraryAction(scope: Page | Locator, name: string) {
  const button = scope.getByRole("button", {
    name,
    exact: true,
    includeHidden: true,
  });
  // Query changes load cards asynchronously. Wait for this action before
  // deciding whether its containing menu needs to be opened.
  await button.waitFor({ state: "attached" });
  const menu = button.locator("xpath=ancestor::details[1]");
  if ((await menu.count()) && (await menu.getAttribute("open")) === null)
    await menu.locator("summary").click();
  await button.click();
}
async function place(page: Page, x = 350, y = 300) {
  await expect(libraryDialog(page)).toBeHidden();
  // Circuit placement prepares its provenance before closing the authoring dialog.
  await expect(componentEditor(page)).toBeHidden();
  const count = Number(await instanceCount(page).textContent());
  await page.getByTestId("schematic-canvas").click({ position: { x, y } });
  await expect(instanceCount(page)).toHaveText(String(count + 1));
  await page.keyboard.press("Escape");
}

const finiteGainSource = [
  ".subckt finite_gain IN OUT VSS params: gain=10 poleHz=1000",
  "E1 DRIVE VSS IN VSS {gain}",
  "R1 DRIVE OUT 1k",
  "C1 OUT VSS {1/(6.283185307179586*1k*poleHz)}",
  ".ends finite_gain",
  ".subckt owned_helper A B",
  "R1 A B 1k",
  ".ends owned_helper",
  "",
].join("\n");

test("reopening User Components retains the session catalog beyond a minute without another list request", async ({
  page,
  context,
  service,
}) => {
  const startedAt = Date.now();
  await page.clock.setFixedTime(startedAt);
  await service.openEditorAs(page, "alice");
  await publishComponent(
    page,
    "reusable-device",
    symbolDefinition("Reusable device"),
  );
  let listRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/components")
      listRequests += 1;
  });
  const dialog = await openUserComponents(page);
  await expect(button(dialog, "Place Reusable device")).toBeVisible();
  await button(dialog, "Close").click();
  await page.clock.setFixedTime(startedAt + 120_000);
  await context.route("**/api/components?**", (route) => route.abort("failed"));
  await openUserComponents(page);
  await expect(button(dialog, "Place Reusable device")).toBeVisible();
  await expect(text(dialog, "Loading components…")).toHaveCount(0);
  await expect(text(dialog, "Couldn’t load user components.")).toHaveCount(0);
  expect(listRequests).toBe(1);
  const search = dialog.getByRole("textbox", {
    name: "Search User Defined components",
  });
  await search.fill("unmatched");
  await expect(text(dialog, "Couldn’t load user components.")).toBeVisible();
  await search.fill("");
  await expect(button(dialog, "Place Reusable device")).toBeVisible();
  await expect(text(dialog, "Loading components…")).toHaveCount(0);
  expect(listRequests).toBe(2);
});

test("historical invalid pin mappings remain inspectable without blocking valid library cards", async ({
  page,
  service,
}) => {
  await service.openEditorAs(page, "alice");
  const healthy = {
    symbol: structuredClone(
      builtInSymbols.find((symbol) => symbol.id === "resistor")!,
    ),
  };
  healthy.symbol.name = "Healthy device";
  await publishComponent(page, "healthy-device", healthy);
  const legacy = legacyDefinition("legacy-interface", "Legacy device");
  service.seedHistoricalDefinition("legacy-device", legacy);
  const dialog = await openUserComponents(page);
  await expect(button(dialog, "Place Healthy device")).toBeVisible();
  const rejected = dialog.getByTestId("rejected-user-component");
  await expect(rejected).toContainText("Legacy device");
  await expect(rejected).toContainText("Alice");
  await expect(rejected).toContainText("missing OUT");
  await expect(button(dialog, "Place Legacy device")).toHaveCount(0);
  await button(dialog, "Copy raw record for Legacy device").click();
  await expect(
    dialog.getByText(
      "Copied raw record. Repair the source before creating a component.",
      { exact: true },
    ),
  ).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(JSON.parse(copied)).toMatchObject({
    id: "legacy-device",
    revision: 1,
    definition: legacy,
  });
  await dialog
    .getByRole("textbox", { name: "Search User Defined components" })
    .fill("Legacy");
  await expect(button(dialog, "Place Healthy device")).toHaveCount(0);
  await expect(rejected).toBeVisible();
  await expect(
    text(dialog, "No user components match this search."),
  ).toHaveCount(0);
  await expect(button(dialog, "Try Again")).toHaveCount(0);
});

test("reopening deleted components after sign-out does not retain administrator results", async ({
  page,
  context,
  service,
}) => {
  await service.openEditorAs(page, "admin");
  await publishComponent(
    page,
    "deleted-device",
    symbolDefinition("Deleted device"),
  );
  expect(await deleteComponent(page, "deleted-device")).toBe(200);
  const dialog = await openUserComponents(page);
  await button(dialog, "Review deleted components").click();
  await expect(button(dialog, "Place Deleted device")).toBeVisible();
  await page.clock.install();
  await button(dialog, "Close").click();
  await page.clock.fastForward(31_000);
  await service.connect(context, null);
  await openUserComponents(page);
  await page.clock.runFor(200);
  await expect(text(dialog, "Couldn’t load user components.")).toBeVisible();
  await expect(dialog.locator(".user-component-tile")).toHaveCount(0);
  await expect(button(dialog, "Show available components")).toHaveCount(0);
});

test("automatically loads all components and retries an interrupted page without losing cards", async ({
  page,
  context,
  service,
}) => {
  await service.openEditorAs(page, "alice");
  const definition = { symbol: newComponentDefinition().symbol };
  await page.evaluate(async (definition) => {
    for (let index = 0; index < 43; index += 1) {
      const next = structuredClone(definition);
      next.symbol.name = `Device ${index}`;
      const response = await fetch(
        `/api/components/paged-device-${String(index).padStart(2, "0")}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ revision: 0, definition: next }),
        },
      );
      if (!response.ok) throw Error(await response.text());
    }
  }, definition);
  const legacy = legacyDefinition(
    "legacy-paged-interface",
    "Legacy paged device",
  );
  service.seedHistoricalDefinition("paged-device-43", legacy);
  let failNextPage = true;
  let failFirstPage = true;
  const cursors: (string | null)[] = [];
  await context.route("**/api/components?**", async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    cursors.push(cursor);
    if ((cursor && failNextPage) || (!cursor && failFirstPage))
      await route.fulfill({
        status: 503,
        json: { error: "Service unavailable" },
      });
    else await route.fallback();
  });
  const dialog = await openUserComponents(page);
  const refreshFailed = text(
    dialog,
    "Couldn’t refresh components. Loaded components are still available.",
  );
  await expect(text(dialog, "Couldn’t load user components.")).toBeVisible();
  failFirstPage = false;
  await button(dialog, "Try Again").click();
  await expect(dialog.locator(".user-component-tile")).toHaveCount(20);
  await expect(button(dialog, "Load More")).toHaveCount(0);
  await expect(refreshFailed).toBeVisible();
  await expect(dialog.locator(".user-component-tile")).toHaveCount(20);
  failNextPage = false;
  await button(dialog, "Try Again").click();
  await expect(dialog.locator(".user-component-tile")).toHaveCount(44);
  await expect(dialog.locator(".user-component-place")).toHaveCount(43);
  const rejected = dialog.getByTestId("rejected-user-component");
  await expect(rejected).toContainText("Legacy paged device");
  await expect(rejected).toContainText("OUT");
  await expect(button(dialog, "Try Again")).toHaveCount(0);
  expect(cursors).toEqual([
    null,
    null,
    "paged-device-19",
    "paged-device-19",
    "paged-device-39",
  ]);
  await button(dialog, "Close").click();
  await openUserComponents(page);
  await expect(dialog.locator(".user-component-tile")).toHaveCount(44);
  await expect(rejected).toContainText("OUT");
  expect(cursors).toHaveLength(5);
  failFirstPage = true;
  await button(dialog, "Refresh").click();
  await expect(refreshFailed).toBeVisible();
  await expect(dialog.locator(".user-component-tile")).toHaveCount(44);
  await expect(rejected).toContainText("OUT");
  expect(cursors).toEqual([
    null,
    null,
    "paged-device-19",
    "paged-device-19",
    "paged-device-39",
    null,
  ]);
});

test("a catalog larger than the session cache retries from its retained last page", async ({
  page,
  context,
  service,
}) => {
  const definition = { symbol: newComponentDefinition().symbol };
  for (let index = 0; index < 61; index += 1) {
    const next = structuredClone(definition);
    // Valid historical names can make summaries exceed the bounded session cache.
    next.symbol.name = `Device ${index} ${"x".repeat(18_000)}`;
    service.seedHistoricalDefinition(
      `large-device-${String(index).padStart(2, "0")}`,
      next,
    );
  }
  let failLastPage = true;
  const cursors: (string | null)[] = [];
  await service.openEditorAs(page, "alice");
  await context.route("**/api/components?**", async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    cursors.push(cursor);
    if (cursor === "large-device-59" && failLastPage)
      await route.fulfill({
        status: 503,
        json: { error: "Service unavailable" },
      });
    else await route.fallback();
  });
  const dialog = await openUserComponents(page);
  await expect(button(dialog, "Try Again")).toBeVisible();
  await expect(dialog.locator(".user-component-tile")).toHaveCount(60);
  failLastPage = false;
  await button(dialog, "Try Again").click();
  await expect(dialog.locator(".user-component-tile")).toHaveCount(61);
  expect(cursors).toEqual([
    null,
    "large-device-19",
    "large-device-39",
    "large-device-59",
    "large-device-59",
  ]);
});

test("library preview fits actual off-viewBox artwork without changing the stored definition", async ({
  page,
  service,
}) => {
  const definition = newComponentDefinition();
  definition.symbol.name = "Offset symbol";
  delete definition.subcircuit;
  definition.symbol.pins = [
    {
      name: "P",
      role: "passive",
      at: { x: 500, y: 240 },
      direction: "west",
      presentation: { visibility: "visible" },
    },
  ];
  definition.symbol.primitives = [boxOutline(500, 200, 600, 280)];
  service.seedHistoricalDefinition("offset-symbol", definition);
  await service.openEditorAs(page, null);
  await openUserComponents(page);
  const tile = button(page, "Place Offset symbol");
  await expect(tile).toBeVisible();
  const svg = tile.locator("svg");
  await expect(svg.locator("polyline")).toBeAttached();
  await expect
    .poll(async () =>
      svg.evaluate((element) => {
        const viewport = element.getBoundingClientRect();
        const ink = element.querySelector("polyline")!.getBoundingClientRect();
        return (
          ink.left >= viewport.left &&
          ink.right <= viewport.right &&
          ink.top >= viewport.top &&
          ink.bottom <= viewport.bottom &&
          ink.height > viewport.height * 0.5
        );
      }),
    )
    .toBe(true);
  const source = await page.evaluate(
    async () =>
      (await (await fetch("/api/components/offset-symbol")).json()).entry
        .definition,
  );
  expect(source.symbol.viewBox).toEqual(definition.symbol.viewBox);
  expect(source.symbol.primitives).toEqual(definition.symbol.primitives);
});

test("library cards separate artwork, long titles and authors at narrow and zoomed sizes", async ({
  page,
  context,
  service,
}) => {
  const author = "AnalogCircuitResearchAndDeviceModelingGroup";
  const name =
    "Precision amplifier with configurable gain and output filtering";
  await service.connect(context, author);
  await openBlankEditor(page);
  const tall = { symbol: newComponentDefinition().symbol };
  tall.symbol.id = "tall-library-artwork";
  tall.symbol.name = name;
  tall.symbol.viewBox = { x: -40, y: -150, width: 80, height: 300 };
  tall.symbol.primitives[0] = boxOutline(-20, -120, 20, 120);
  const wide = structuredClone(tall);
  wide.symbol.id = "wide-library-artwork";
  wide.symbol.name = "Wide artwork";
  wide.symbol.viewBox = { x: -180, y: -30, width: 360, height: 60 };
  wide.symbol.primitives[0] = boxOutline(-160, -20, 160, 20);
  for (const definition of [tall, wide])
    await publishComponent(page, definition.symbol.id, definition);
  const dialog = await openUserComponents(page);
  await expect(dialog.locator(".user-component-tile")).toHaveCount(2);
  for (const card of await dialog.locator(".user-component-tile").all()) {
    await card.scrollIntoViewIfNeeded();
    const caption = card.locator(".user-component-caption");
    const action = card.locator(".user-component-actions");
    await expect(caption).toBeInViewport();
    await expect(action).toBeInViewport();
    const bounds = (await card.boundingBox())!;
    const captionBounds = (await caption.boundingBox())!;
    const actionBounds = (await action.boundingBox())!;
    expect(captionBounds.y + captionBounds.height).toBeLessThanOrEqual(
      bounds.y + bounds.height,
    );
    expect(actionBounds.y + actionBounds.height).toBeLessThanOrEqual(
      bounds.y + bounds.height,
    );
  }
  await expect(button(dialog, `Place ${name}`)).toBeVisible();
  for (const [width, zoom] of [
    [1280, 1],
    [640, 1],
    [900, 1.25],
  ] as const) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate((zoom) => {
      document.documentElement.style.zoom = String(zoom);
    }, zoom);
    const placeButton = button(dialog, `Place ${name}`);
    await placeButton.scrollIntoViewIfNeeded();
    const title = placeButton.locator("strong");
    const authorLabel = placeButton.getByText(author, { exact: true });
    const artBounds = (await placeButton.locator("svg").boundingBox())!;
    const titleBounds = (await title.boundingBox())!;
    const authorBounds = (await authorLabel.boundingBox())!;
    const menuToggle = dialog.getByLabel(`Actions for ${name}`, {
      exact: true,
    });
    if ((await menuToggle.locator("..").getAttribute("open")) === null)
      await menuToggle.click();
    const editBounds = (await button(
      dialog,
      `Edit ${name} definition`,
    ).boundingBox())!;
    expect(artBounds.y + artBounds.height).toBeLessThanOrEqual(titleBounds.y);
    expect(titleBounds.y + titleBounds.height).toBeLessThanOrEqual(
      authorBounds.y,
    );
    expect(authorBounds.y + authorBounds.height).toBeLessThanOrEqual(
      editBounds.y,
    );
    // Read enough of a long title to distinguish entries; its full name stays accessible.
    expect(titleBounds.height).toBeGreaterThan(
      (await title.evaluate((node) =>
        parseFloat(getComputedStyle(node).lineHeight),
      )) * 1.5,
    );
    await expect(title).toHaveAttribute("title", name);
    await expect(authorLabel).toHaveAttribute("title", author);
    await expect(button(dialog, "Create Component…")).toBeInViewport();
    await expect(button(dialog, "Close")).toBeInViewport();
    expect(
      await dialog.evaluate((node) => node.scrollWidth - node.clientWidth),
    ).toBeLessThanOrEqual(1);
  }
});

test("Create from keeps a new publication destination through draft reopening even for the original author", async ({
  page,
  service,
}) => {
  await service.openEditorAs(page, "alice");
  const definition = symbolDefinition("Original device");
  await publishComponent(page, "original-device", definition);
  await openUserComponents(page);
  await clickLibraryAction(page, "Create from Original device");
  const editor = componentEditor(page);
  await editor.getByLabel("Component definition code").fill(
    JSON.stringify({
      symbol: { ...definition.symbol, name: "Derivative device" },
    }),
  );
  await button(editor, "Apply").click();
  await editor.getByLabel("Close component editor").click();
  const saved = await readProject(page);
  const draft = JSON.parse(saved.componentAuthoringDrafts![0]!.text);
  expect(draft.appliedDefinition.libraryOrigin).toMatchObject({
    componentId: "original-device",
    revision: 1,
    authorId: "alice",
  });
  await openProjectFile(page, saved);
  await awaitEditorReady(page);
  await openProjectDraft(page, "Library draft Original device");
  await button(editor, "Publish as new component").click();
  await expect(editor.getByRole("status")).toContainText(
    "Published to the public library",
  );
  await expect(button(editor, "Update my component")).toBeEnabled();
  const entries = await libraryEntries(page);
  expect(entries).toHaveLength(2);
  expect(
    entries.find((entry: { id: string }) => entry.id === "original-device"),
  ).toMatchObject({
    revision: 1,
    authorId: "alice",
    definition: { symbol: { name: "Original device" } },
  });
  expect(
    entries.find((entry: { id: string }) => entry.id !== "original-device"),
  ).toMatchObject({
    revision: 1,
    authorId: "alice",
    definition: { symbol: { name: "Derivative device" } },
  });
});

test("captured origin lookup failure preserves its target and refuses implicit new publication", async ({
  page,
  context,
  service,
}) => {
  service.seedHistoricalDefinition(
    "origin-lookup-device",
    publishedDefinition(
      symbolDefinition("Origin lookup device"),
      "origin-lookup-device",
      1,
    ),
  );
  await service.openEditorAs(page, "alice");
  await placeFromLibrary(page, "Origin lookup device");
  let originReads = 0;
  let newWrites = 0;
  await context.route("**/api/components/*", async (route) => {
    if (
      route.request().method() === "GET" &&
      route.request().url().endsWith("/origin-lookup-device")
    ) {
      originReads++;
      await route.fulfill({
        status: 404,
        json: { message: "Origin lookup unavailable" },
      });
    } else {
      if (route.request().method() === "PUT") newWrites++;
      await route.fallback();
    }
  });
  const editor = await editWithKey(page, "X1");
  const recovery = editor.getByRole("group", {
    name: "Publication recovery",
  });
  await expect(recovery).toBeVisible();
  await expect(button(editor, "Update my component")).toBeDisabled();
  await recovery
    .getByRole("button", { name: "Reload published version" })
    .click();
  await expect.poll(() => originReads).toBe(2);
  expect(newWrites).toBe(0);
  const variant = symbolDefinition("Explicit origin copy");
  await editor
    .getByLabel("Component definition code")
    .fill(JSON.stringify(variant));
  await button(editor, "Apply").click();
  await expect(button(editor, "Update my component")).toBeDisabled();
  expect(newWrites).toBe(0);
});

test("publication conflicts retain update intent until explicit reload or create-copy after an account change", async ({
  page,
  context,
  service,
}) => {
  await service.openEditorAs(page, "alice");
  const publish = (revision: number, name: string) =>
    putComponent(page, "owned-device", {
      revision,
      definition: symbolDefinition(name),
    });
  expect(await publish(0, "Owned device")).toBe(200);
  await openUserComponents(page);
  await clickLibraryAction(page, "Edit Owned device definition");
  const editor = componentEditor(page);
  await editor
    .getByLabel("Component definition code")
    .fill(JSON.stringify(symbolDefinition("My pending edit")));
  await button(editor, "Apply").click();
  expect(await publish(1, "Concurrent revision")).toBe(200);
  await button(editor, "Update my component").click();
  const recovery = editor.getByRole("group", {
    name: "Publication recovery",
  });
  await expect(recovery).toBeVisible();
  await recovery
    .getByRole("button", { name: "Reload published version" })
    .click();
  await expect(editor.getByLabel("Component definition code")).toContainText(
    "Concurrent revision",
  );
  await editor.getByLabel("Close component editor").click();
  await openUserComponents(page);
  await clickLibraryAction(page, "Edit Concurrent revision definition");
  await expect(editor.getByLabel("Component definition code")).toContainText(
    "Concurrent revision",
  );
  await service.connect(context, "bob");
  await button(editor, "Update my component").click();
  await expect(recovery).toBeVisible();
  await recovery.getByRole("button", { name: "Create separate copy" }).click();
  await button(editor, "Publish as new component").click();
  await expect(editor.getByRole("status")).toContainText(
    "Published to the public library",
  );
  const entries = await libraryEntries(page);
  expect(entries).toHaveLength(2);
  expect(
    entries.find((entry: { id: string }) => entry.id === "owned-device"),
  ).toMatchObject({ revision: 2, authorId: "alice" });
  expect(
    entries.find((entry: { id: string }) => entry.id !== "owned-device"),
  ).toMatchObject({ revision: 1, authorId: "bob" });
});

test("new native publication survives a lost response, Project reopen and another edit without duplicating its public identity", async ({
  page,
  service,
}) => {
  await service.openEditorAs(page, "alice");
  const editor = await openNativeComponent(page);
  await netlist(editor).fill(
    ".subckt retry_source IN OUT\nR1 IN OUT 1k\n.ends retry_source\n",
  );
  await button(editor, "Apply model").click();
  service.dropNextPublicationResponse();
  await button(editor, "Publish").click();
  await expect(
    editor.getByText(
      "Publication outcome is unknown. Retry the same operation before editing again.",
      { exact: true },
    ),
  ).toBeVisible();
  await editor.getByLabel("Close component editor").click();
  const pending = await readProject(page);
  await openProjectFile(page, pending);
  await awaitEditorReady(page);
  async function reopenPublication() {
    await openProjectDraft(page, /^Library draft /);
  }
  await reopenPublication();
  await button(editor, "Publish").click();
  await expect(button(editor, "Update my component")).toBeEnabled();
  await editor.getByLabel("Close component editor").click();
  await reopenPublication();
  await expect(button(editor, "Update my component")).toBeEnabled();
  const entries = await libraryEntries(page);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ revision: 1, authorId: "alice" });
  await netlist(editor).fill(
    ".subckt retry_source IN OUT\nR1 IN OUT 2k\n.ends retry_source\n",
  );
  await button(editor, "Apply model").click();
  await button(editor, "Update my component").click();
  await expect(
    editor.getByText(/^(Saved|Published) to the public library\.$/),
  ).toBeVisible();
  const updated = await libraryEntries(page);
  expect(updated).toHaveLength(1);
  expect(updated[0]).toMatchObject({
    id: entries[0].id,
    revision: 2,
    authorId: "alice",
  });
});

test("reopened artwork drafts require Apply before publishing and Place applies the displayed candidate", async ({
  page,
  service,
}) => {
  await service.openEditorAs(page, "alice");
  const original = {
    symbol: {
      ...structuredClone(builtInSymbols.find((s) => s.id === "resistor")!),
      id: "local-artwork",
      name: "Original artwork",
    },
  };
  const initial = createEmptyProject("artwork-reopen", "Artwork reopen");
  initial.componentDefinitions = [original];
  initial.documents[0]!.instances = [
    { ...placedInstance("X1", original.symbol.id, 220, 200), reference: "X1" },
  ];
  await openProjectFile(page, initial);
  await awaitEditorReady(page);
  await page.getByTestId("hit-X1").click();
  // Q edits the occurrence; only E opens its definition.
  await page.keyboard.press("q");
  await expect(page.getByLabel("Editable Canvas property code")).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Edit Component Definition" }),
  ).toHaveCount(0);
  await page.keyboard.press("q");
  await page.keyboard.press("e");
  const editor = componentEditor(page);
  const candidate = structuredClone(original);
  candidate.symbol.name = "Saved artwork candidate";
  await editor
    .getByLabel("Component definition code", { exact: true })
    .fill(JSON.stringify(candidate));
  await editor.locator("footer > details > summary:visible").click();
  await button(editor, "Save draft").click();
  await editor.getByLabel("Close component editor").click();
  const saved = await readProject(page);
  expect(saved.componentDefinitions).toEqual([original]);
  await openProjectDraft(page, /^Artwork draft /);
  await expect(button(editor, PUBLISH)).toBeDisabled();
  await button(editor, "Place").click();
  await place(page, 420, 230);
  const applied = await readProject(page);
  expect(applied.documents[0]!.instances).toHaveLength(2);
  for (const instance of applied.documents[0]!.instances)
    expect(definitionOf(applied, instance.symbolId).symbol.name).toBe(
      candidate.symbol.name,
    );
});

test("public circuit authoring drafts survive closing and portable reopening without changing drawing captures", async ({
  page,
  service,
}) => {
  await service.openEditorAs(page, "alice");
  const editor = await openFiniteGain(page);
  await button(editor, "Apply model").click();
  await button(editor, PUBLISH).click();
  await expect(text(editor, "Saved to the public library.")).toBeVisible();
  await editor.getByLabel("Close component editor").click();
  const before = await readProject(page);
  await openUserComponents(page);
  await clickLibraryAction(page, "Edit finite_gain definition");
  await netlist(editor).fill(finiteGainSource.replace("gain=10", "gain=17"));
  await editor.getByRole("tab", { name: "Symbol", exact: true }).click();
  await choose(editor, "Symbol mode", "custom");
  const broken = '{ "symbol": unfinished library JSON';
  await symbolJson(editor).fill(broken);
  await editor.locator(".external-model-more > summary").click();
  await button(editor, "Save draft").click();
  await editor.getByLabel("Close component editor").click();
  const saved = await readProject(page);
  expect(saved.documents).toEqual(before.documents);
  expect(saved.componentDefinitions).toEqual(before.componentDefinitions);
  expect(saved.modelSources).toEqual(before.modelSources);
  expect(saved.componentAuthoringDrafts).toHaveLength(1);
  await openUserComponents(page);
  await clickLibraryAction(page, "Edit finite_gain definition");
  await editor.getByRole("tab", { name: "Symbol", exact: true }).click();
  await expect(symbolJson(editor)).toContainText(broken);
  await expect(button(editor, PUBLISH)).toBeDisabled();
  await editor.getByLabel("Close component editor").click();
  await openProjectFile(page, saved);
  const discard = button(page, "Continue without saving");
  if (await discard.isVisible()) await discard.click();
  await awaitEditorReady(page);
  await openProjectDraft(page, "Library draft finite_gain");
  await editor.getByRole("tab", { name: "Symbol", exact: true }).click();
  await expect(symbolJson(editor)).toContainText(broken);
  await editor.getByRole("tab", { name: "Circuit", exact: true }).click();
  await expect(netlist(editor)).toContainText("gain=17");
});

test("new circuit authoring starts with native source and places a complete six-terminal component without public saving", async ({
  page,
  service,
}) => {
  await service.openEditorAs(page, null);
  await openUserComponents(page);
  await button(page, "Create Component…").click();
  const editor = componentEditor(page);
  await expect(editor.getByLabel("Definition type")).toHaveValue("circuit");
  await expect(editor.getByLabel("Legacy implementation repair")).toHaveCount(
    0,
  );
  await authoringView(editor, "Circuit");
  await netlist(editor).fill(
    [
      ".subckt differential_gain INP INN REF OUT VDD VSS params: gain=20",
      "E1 OUT REF INP INN {gain}",
      ".ends differential_gain",
    ].join("\n"),
  );
  await editor.getByRole("tab", { name: "Symbol", exact: true }).click();
  await editor.getByLabel("Cell symbol width", { exact: true }).fill("140");
  await editor.getByLabel("Cell symbol width", { exact: true }).blur();
  await authoringView(editor, "Symbol");
  await choose(editor, "Symbol mode", "custom");
  await authoringView(editor, "Mapping");
  await choose(editor, "Map native INP", "pin:INN");
  await choose(editor, "Map native INN", "pin:INP");
  await editor.getByRole("tab", { name: "Circuit", exact: true }).click();
  await expect(netlist(editor)).toContainText(".subckt differential_gain");
  await button(editor, "Apply model").click();
  await button(editor, "Place").click();
  await expect(editor).toHaveCount(0);
  await place(page);
  for (const pin of ["INP", "INN", "REF", "OUT", "VDD", "VSS"]) {
    await markNoConnect(page, "terminal-X1-" + pin);
  }
  const project = await readProject(page);
  expect(
    project.externalSubcircuitDefinitions[0]!.presentation?.minimumBodySize
      ?.width,
  ).toBe(140);
  const mappings = project.componentDefinitions![0]!.circuitBinding!.terminals;
  expect(mappings[0]).toMatchObject({ pinName: "INN" });
  expect(mappings[1]).toMatchObject({ pinName: "INP" });
  expect(
    project.externalSubcircuitDefinitions[0]!.terminals.map((t) => t.name),
  ).toEqual(["INP", "INN", "REF", "OUT", "VDD", "VSS"]);
  expect(project.documents[0]!.instances[0]!.netlist?.binding?.kind).toBe(
    "external-subcircuit",
  );
  const exported = createDesignNetlistExport(project, { format: "spice" });
  expect(exported.status).toBe("ready");
  if (exported.status !== "ready")
    throw Error(JSON.stringify(exported.diagnostics));
  expect(exported.file.text).toContain(
    ".subckt differential_gain INP INN REF OUT VDD VSS params: gain=20",
  );
});

test("selecting a second native source entry preserves the first owner's identity and circuit", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const initial = createEmptyProject("multi-entry", "Multi-entry");
  const prepared = executeProjectTransaction(initial, {
    projectId: initial.id,
    expectedStructureRevision: initial.structureRevision,
    transactionId: "prepare-multiple-entries",
    actor: { kind: "human", id: "test" },
    edits: [
      {
        kind: "apply_model_source",
        source: {
          id: "multi-source",
          language: "spice",
          entry: "model.spice",
          files: [
            {
              path: "model.spice",
              text: ".subckt first A B\nR1 A B 1k\n.ends first\n.subckt second A B\nR1 A B 2k\n.ends second\n",
            },
          ],
          dependencies: [],
          revision: 0,
        },
        definitions: [{ definitionId: "first-owner", entry: "first" }],
      },
    ],
  });
  if (!prepared.ok) throw Error(JSON.stringify(prepared.error));
  await openBlankEditor(page);
  await openProjectFile(page, prepared.project);
  const editor = await openNativeComponent(page);
  await authoringView(editor, "Circuit");
  await choose(editor, "External model source owner", { label: "model.spice" });
  await entry(editor).selectOption("second");
  await button(editor, "Apply & Place").click();
  await place(page);
  const saved = await readProject(page);
  expect(saved.externalSubcircuitDefinitions).toHaveLength(2);
  expect(
    saved.externalSubcircuitDefinitions.find(
      (owner) => owner.id === "first-owner",
    ),
  ).toEqual(prepared.project.externalSubcircuitDefinitions[0]);
  const second = saved.externalSubcircuitDefinitions.find(
    (owner) => owner.name === "second",
  )!;
  expect(second.id).not.toBe("first-owner");
  expect(second.implementation?.sourceId).toBe("multi-source");
  expect(saved.documents[0]!.instances[0]!.netlist?.binding).toEqual({
    kind: "external-subcircuit",
    definitionId: second.id,
  });
});

test("legacy four-to-six repair uses the full native pin editor, keeps a saved draft off the original class and preserves peers in one undo", async ({
  page,
  service,
}) => {
  await service.openEditorAs(page, null);
  const legacy = newComponentDefinition();
  const initial = createEmptyProject("legacy-six", "Legacy six");
  initial.componentDefinitions = [legacy];
  for (const [index, id] of ["X1", "X2"].entries())
    initial.documents[0]!.instances.push({
      ...placedInstance(id, legacy.symbol.id, 220 + index * 200, 200),
      reference: id,
      netlist: {
        parameters: { gain: "17" },
        binding: {
          kind: "unresolved-subcircuit",
          name: legacy.subcircuit!.target,
        },
      },
    });
  const model = executeProjectTransaction(initial, {
    projectId: initial.id,
    expectedStructureRevision: 0,
    transactionId: "model",
    actor: { kind: "human", id: "test" },
    edits: [
      {
        kind: "apply_model_source",
        source: {
          id: "six-source",
          revision: 0,
          language: "spice",
          entry: "model.spice",
          dependencies: [],
          files: [
            {
              path: "model.spice",
              text: ".subckt amp INP INN REF OUT VDD VSS params: gain=20\nE1 OUT REF INP INN {gain}\n.ends amp\n",
            },
          ],
        },
        definitions: [{ definitionId: "six-amp", entry: "amp" }],
      },
    ],
  });
  if (!model.ok) throw Error(model.error.message);
  await openProjectFile(page, model.project);
  await awaitEditorReady(page);
  const editor = await editWithKey(page, "X1");
  await authoringView(editor, "Circuit");
  await choose(editor, "External model source owner", "six-source");
  await authoringView(editor, "Mapping");
  await expect(
    editor.getByLabel("Native pin mapping").locator("tbody tr"),
  ).toHaveCount(6);
  await choose(editor, "Map native INP", "pin:IN");
  await editor.getByLabel("Add pin for INN", { exact: true }).click();
  await editor.getByLabel("Add pin for REF", { exact: true }).click();
  await authoringView(editor, "Symbol");
  const json = symbolJson(editor);
  const valid = await copyText(page, json);
  await json.fill('{"symbol": unfinished');
  await text(editor, "More").click();
  await button(editor, "Save draft").click();
  await expect(
    text(editor, "Saved repair draft. The captured class is unchanged."),
  ).toBeVisible();
  await editor.getByLabel("Close component editor").click();
  const saved = await readProject(page);
  expect(saved.documents).toEqual(model.project.documents);
  expect(saved.componentDefinitions).toEqual([legacy]);
  expect(saved.modelSources![0]!.files).toEqual(
    model.project.modelSources![0]!.files,
  );
  expect(saved.modelSources![0]!.draft!.authoring![0]!.artworkText).toBe(
    '{"symbol": unfinished',
  );
  await openUserComponents(page);
  await page.getByText(/Project drafts/).click();
  await page.getByRole("button", { name: /^Circuit draft / }).click();
  await authoringView(editor, "Symbol");
  await expect(json).toContainText('{"symbol": unfinished');
  await json.fill(valid);
  await button(editor, "Apply model").click();
  await expect(text(editor, "Applied component repair")).toBeVisible();
  await editor.getByLabel("Close component editor", { exact: true }).click();
  const repaired = await readProject(page);
  expect(repaired.modelSources![0]!.files).toEqual(
    model.project.modelSources![0]!.files,
  );
  expect(repaired.modelSources![0]!.draft).toBeUndefined();
  expect(
    repaired.documents[0]!.instances.map(
      (instance) => instance.netlist?.binding,
    ),
  ).toEqual([
    { kind: "external-subcircuit", definitionId: "six-amp" },
    { kind: "external-subcircuit", definitionId: "six-amp" },
  ]);
  expect(
    repaired.documents[0]!.instances.every(
      (instance) => instance.netlist?.parameters?.gain === "17",
    ),
  ).toBe(true);
  const symbol = repaired.componentDefinitions!.find(
    (d) => d.symbol.id === repaired.documents[0]!.instances[0]!.symbolId,
  )!;
  expect(symbol.circuitBinding!.terminals).toHaveLength(6);
  expect(symbol.symbol.primitives).toEqual(legacy.symbol.primitives);
  await page.keyboard.press("ControlOrMeta+z");
  expect((await readProject(page)).documents[0]!.instances).toEqual(
    model.project.documents[0]!.instances,
  );
});

test("Create keeps authoring views, custom artwork and commit actions usable in narrow or zoomed workspaces", async ({
  page,
  context,
  service,
}) => {
  await service.connect(context, null);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openBlankEditor(page);
  const editor = await openNativeComponent(page);
  await authoringView(editor, "Symbol");
  await choose(editor, "Symbol mode", "custom");
  const code = symbolJson(editor);
  const preview = editor.getByLabel("Custom symbol preview", { exact: true });
  const codeBounds = (await editor
    .locator(".component-definition-code")
    .boundingBox())!;
  const previewBounds = (await preview.boundingBox())!;
  const applyBounds = (await button(editor, "Apply model").boundingBox())!;
  expect(codeBounds.height).toBeGreaterThan(250);
  expect(codeBounds.y + codeBounds.height).toBeLessThanOrEqual(applyBounds.y);
  expect(codeBounds.width).toBeGreaterThan(previewBounds.width);
  expect(codeBounds.x + codeBounds.width).toBeLessThanOrEqual(previewBounds.x);
  await code.fill("{ unfinished artwork");
  await authoringView(editor, "Circuit");
  await netlist(editor).fill(
    [
      ".subckt layout_amp INP INN REF OUT VDD VSS params: gain=20",
      "E1 OUT REF INP INN {gain}",
      ".ends layout_amp",
    ].join("\n"),
  );
  for (const [width, zoom] of [
    [640, 1],
    [900, 1.25],
  ] as const) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate((zoom) => {
      document.documentElement.style.zoom = String(zoom);
    }, zoom);
    await expect
      .poll(() =>
        editor.evaluate((dialog) => dialog.scrollWidth - dialog.clientWidth),
      )
      .toBeLessThanOrEqual(1);
    await authoringView(editor, "Circuit");
    await expect(netlist(editor)).toBeInViewport();
    await expect(
      editor.getByLabel("Model format", { exact: true }),
    ).toBeInViewport();
    await authoringView(editor, "Mapping");
    await expect(
      editor.getByLabel("Model VSS direction", { exact: true }),
    ).toBeVisible();
    await expect(button(editor, "Apply model")).toBeInViewport();
    await expect(editor.getByLabel("Close component editor")).toBeInViewport();
    await expect(button(editor, PUBLISH)).toBeDisabled();
    await editor.locator(".external-model-more > summary").click();
    await expect(button(editor, "Save draft")).toBeInViewport();
    await editor.locator(".external-model-more > summary").click();
    await authoringView(editor, "Symbol");
    await expect(code).toBeInViewport();
    await expect(code).toHaveText("{ unfinished artwork");
  }
});

test("automatic layout only enables explicit offsets and distinguishes pending source from missing circuit", async ({
  page,
  service,
}) => {
  await service.openEditorAs(page, null);
  const editor = await openNativeComponent(page);
  await expect(button(editor, "Apply & Place")).toBeDisabled();
  await authoringView(editor, "Symbol");
  await expect(
    text(editor, "Define the circuit interface to generate a symbol."),
  ).toBeVisible();
  await authoringView(editor, "Circuit");
  await netlist(editor).fill(
    ".subckt simple IN OUT\nR1 IN OUT 1k\n.ends simple\n",
  );
  await expect(editor.getByText("Not applied", { exact: false })).toBeVisible();
  await expect(text(editor, "0 call(s) share this model source.")).toHaveCount(
    0,
  );
  await authoringView(editor, "Symbol");
  const offset = editor.getByLabel("Cell symbol IN pin offset", {
    exact: true,
  });
  await expect(offset).toBeDisabled();
  await choose(editor, "Cell symbol IN pin side", "west");
  await expect(offset).toBeEnabled();
  await offset.fill("40");
  await offset.blur();
  await expect(offset).toHaveValue("40");
  await button(editor, "Apply & Place").click();
  await page.keyboard.press("Escape");
  const project = await readProject(page);
  expect(
    project.externalSubcircuitDefinitions[0]?.presentation?.pinPlacements,
  ).toEqual([expect.objectContaining({ side: "west", offset: 40 })]);
});

test("publishes an applied native component and captures another user's complete revision on insertion", async ({
  page,
  browser,
  baseURL,
  service,
}) => {
  test.setTimeout(90_000);
  const visitor = await browser.newContext({ baseURL: baseURL! });
  try {
    await service.openEditorAs(page, "alice");
    const editor = await openFiniteGain(page, "custom");
    await applyModel(editor);
    await expect(button(editor, PUBLISH)).toBeEnabled();
    await button(editor, PUBLISH).click();
    await expect(text(editor, "Saved to the public library.")).toBeVisible();
    const [published] = await libraryEntries(page);
    expect(published).toMatchObject({
      revision: 1,
      authorId: "alice",
      status: "shared",
      circuit: { version: 1, source: { language: "spice", revision: 1 } },
    });
    expect(published.circuit.source.files[0].text).toBe(finiteGainSource);
    expect(published.definition.circuitBinding.definitionId).toBe(
      published.circuit.externalDefinition.id,
    );
    await service.connect(visitor, "bob");
    const insertedPage = await visitor.newPage();
    await openBlankEditor(insertedPage);
    const beforePlacement = await readProject(insertedPage);
    await openUserComponents(insertedPage);
    await button(insertedPage, "Place finite_gain").click();
    await insertedPage.keyboard.press("Escape");
    expect(resources(await readProject(insertedPage))).toEqual(
      resources(beforePlacement),
    );
    await placeFromLibrary(insertedPage, "finite_gain", 400, 220);
    const inserted = await readProject(insertedPage);
    await button(insertedPage, "Undo").click();
    expect(resources(await readProject(insertedPage))).toEqual(
      resources(beforePlacement),
    );
    await button(insertedPage, "Redo").click();
    expect(inserted.modelSources).toHaveLength(1);
    expect(inserted.modelSources![0]!.files[0]!.text).toBe(finiteGainSource);
    const owner = inserted.externalSubcircuitDefinitions[0]!;
    const instance = inserted.documents[0]!.instances[0]!;
    expect(instance.netlist?.binding).toEqual({
      kind: "external-subcircuit",
      definitionId: owner.id,
    });
    expect(
      definitionOf(inserted, instance.symbolId).circuitBinding!.definitionId,
    ).toBe(owner.id);
    await placeFromLibrary(insertedPage, "finite_gain", 650, 320);
    await expect(instanceCount(insertedPage)).toHaveText("2");
    const repeated = await readProject(insertedPage);
    expect(resources(repeated)).toEqual(resources(inserted));
    expect(
      repeated.documents[0]!.instances.map((item) => item.reference),
    ).toEqual(["X1", "X2"]);
    await editor
      .getByRole("button", { name: "Close component editor" })
      .click();
    const beforeLibraryEdit = await readProject(page);
    await openUserComponents(page);
    await clickLibraryAction(page, "Edit finite_gain definition");
    const libraryEditor = componentEditor(page);
    await expect(netlist(libraryEditor)).toBeVisible();
    await authoringView(libraryEditor, "Circuit");
    await netlist(libraryEditor).fill(
      finiteGainSource.replace("gain=10", "gain=40"),
    );
    await expect(button(libraryEditor, PUBLISH)).toBeDisabled();
    await button(libraryEditor, "Apply model").click();
    await button(libraryEditor, PUBLISH).click();
    await expect(
      text(libraryEditor, "Saved to the public library."),
    ).toBeVisible();
    const [updated] = await libraryEntries(page);
    expect(updated.revision).toBe(2);
    expect(updated.circuit.source.files[0].text).toBe(
      finiteGainSource.replace("gain=10", "gain=40"),
    );
    await libraryEditor
      .getByRole("button", { name: "Close component editor" })
      .click();
    const afterLibraryEdit = await readProject(page);
    expect(afterLibraryEdit).toEqual({
      ...beforeLibraryEdit,
      structureRevision: afterLibraryEdit.structureRevision,
      componentAuthoringDrafts: afterLibraryEdit.componentAuthoringDrafts,
    });
    expect(afterLibraryEdit.componentAuthoringDrafts).toHaveLength(1);
    expect(afterLibraryEdit.componentAuthoringDrafts![0]!.library).toEqual({
      componentId: updated.id,
      revision: 2,
    });
    expect(await readProject(insertedPage)).toEqual(repeated);
    // The exported file carries the captured revision without the library.
    await openProjectFile(
      insertedPage,
      await downloadBytes(insertedPage, "File", "Export Project File…"),
    );
    await awaitEditorReady(insertedPage);
    expect(resources(await readProject(insertedPage))).toEqual(
      resources(repeated),
    );
    await visitor.route("**/api/components**", (route) =>
      route.abort("internetdisconnected"),
    );
    await insertedPage.reload();
    await awaitEditorReady(insertedPage);
    expect(resources(await readProject(insertedPage))).toEqual(
      resources(repeated),
    );
  } finally {
    await visitor.close();
  }
});

/** The captured resources a library insertion adds to a Project. */
const resources = (project: CircuitProject) => ({
  sources: project.modelSources ?? [],
  owners: project.externalSubcircuitDefinitions,
  components: project.componentDefinitions ?? [],
});
/** Starts native authoring with `finiteGainSource` and its finite_gain entry. */
async function openFiniteGain(page: Page, symbolMode?: "custom") {
  const editor = await openNativeComponent(page);
  await authoringView(editor, "Circuit");
  await netlist(editor).fill(finiteGainSource);
  await entry(editor).selectOption("finite_gain");
  if (symbolMode) {
    await authoringView(editor, "Symbol");
    await choose(editor, "Symbol mode", symbolMode);
  }
  return editor;
}
async function openNativeComponent(page: Page) {
  await openUserComponents(page);
  await button(page, "Create Component…").click();
  const editor = componentEditor(page);
  await editor.getByLabel("Definition type").selectOption("circuit");
  return editor;
}

test("repairs a wired legacy custom component with explicit native port mapping in one undo", async ({
  page,
  baseURL,
  service,
}) => {
  await service.openEditorAs(page, "alice");
  const symbol = structuredClone(
    builtInSymbols.find((item) => item.id === "resistor")!,
  );
  symbol.id = "legacy-repair-artwork";
  symbol.name = "Legacy gain";
  symbol.pins[0]!.name = "sense";
  symbol.pins[1]!.name = "drive";
  symbol.primitives.push({
    kind: "circle",
    center: { x: 0, y: 0 },
    radius: 6,
  });
  const definition = {
    symbol,
    subcircuit: {
      id: "legacy-repair-interface",
      symbolId: symbol.id,
      target: "legacy_gain",
      ports: [
        { name: "A", pinName: "sense", direction: "input" },
        { name: "B", pinName: "drive", direction: "output" },
        { name: "GND", supply: "VSS", direction: "passive" },
      ],
    },
  };
  await publishComponent(page, "legacy-repair", definition);
  await placeFromLibrary(page, "Legacy gain", 400, 230);
  const label = await page
    .getByTestId("annotation-hit-instance-label-X1")
    .boundingBox();
  if (!label) throw Error("Missing occurrence label");
  await page.mouse.move(label.x + label.width / 2, label.y + label.height / 2);
  await page.mouse.down();
  await page.mouse.move(label.x + 100, label.y + 70, { steps: 5 });
  await page.mouse.up();
  await placeComponent(page, "voltage-source", { x: 140, y: 380 });
  await placeComponent(page, "ground", { x: 440, y: 460 });
  for (const [from, to] of [
    ["V1-+", "X1-sense"],
    ["V1--", "GND1-0"],
  ] as const) {
    await drawWire(page, from, to);
  }
  await markNoConnect(page, "terminal-X1-drive");
  expect(
    createDesignNetlistExport(await readProject(page), { format: "spice" })
      .status,
  ).toBe("blocked");
  const client = await pairAgent(page, baseURL!);
  const dialog = await editWithKey(page, "X1");
  await authoringView(dialog, "Circuit");
  await expect(button(dialog, "Place")).toHaveCount(0);
  await netlist(dialog).fill(".subckt incomplete IN OUT VSS\n");
  await expect(button(dialog, "Apply model")).toBeDisabled();
  await expect(
    text(dialog, "Missing .ends for incomplete").first(),
  ).toBeVisible();
  await dialog
    .getByRole("textbox", { name: "External model netlist", exact: true })
    .fill(finiteGainSource);
  await entry(dialog).selectOption("finite_gain");
  await expect(button(dialog, "Apply model")).toBeDisabled();
  await expect(
    dialog.getByText(/Unknown native terminal; repair the Pin mapping/).first(),
  ).toBeVisible();
  const migrate = async () => {
    for (const [old, next] of [
      ["A", "IN"],
      ["B", "OUT"],
      ["GND", "VSS"],
    ])
      await dialog
        .getByLabel(`Migrate legacy_gain.${old}`, { exact: true })
        .selectOption(next!);
  };
  await migrate();
  // A concurrent Project edit while the editor is open refuses the repair.
  const changed = await client.applyActions([
    {
      kind: "set-property",
      target: { kind: "instance", reference: "V1" },
      set: { dc: "0.2" },
    },
  ]);
  expect(changed.ok, changed.message).toBe(true);
  const live = (await client.refreshSnapshot()).snapshot.project;
  await button(dialog, "Apply model").click();
  await expect(dialog.locator(".cell-external-result")).toContainText(
    "Project changed",
  );
  expect((await client.refreshSnapshot()).snapshot.project).toEqual(live);
  await button(dialog, "Close component editor").click();
  await button(dialog, "Discard changes").click();
  const before = await readProject(page);
  await editWithKey(page, "X1");
  await authoringView(dialog, "Circuit");
  await netlist(dialog).fill(finiteGainSource);
  await entry(dialog).selectOption("finite_gain");
  await migrate();
  await button(dialog, "Apply model").click();
  await expect(dialog.locator(".cell-external-result")).toContainText(
    "Applied",
  );
  await button(dialog, "Close component editor").click();
  const repaired = await readProject(page);
  const owner = repaired.externalSubcircuitDefinitions[0]!;
  expect(owner.name).toBe("finite_gain");
  expect(owner.terminals.map((t) => t.name)).toEqual(["IN", "OUT", "VSS"]);
  expect(owner.implementation?.kind).toBe("source");
  const raw = repaired.componentDefinitions!.find(
    (d) => d.symbol.id === repaired.documents[0]!.instances[0]!.symbolId,
  )!;
  expect(raw.symbol.primitives).toEqual(symbol.primitives);
  expect(raw.symbol.pins).toEqual(symbol.pins);
  expect(raw.subcircuit).toBeUndefined();
  expect(raw.circuitBinding!.terminals[2]).toEqual({
    terminalId: owner.terminals[2]!.id,
    supply: "VSS",
  });
  expect(repaired.documents[0]!.routes.map((r) => r.id)).toEqual(
    before.documents[0]!.routes.map((r) => r.id),
  );
  expect(repaired.documents[0]!.nets.map((n) => n.id)).toEqual(
    before.documents[0]!.nets.map((n) => n.id),
  );
  expect(repaired.documents[0]!.noConnects[0]!.endpoint).toEqual({
    kind: "terminal",
    instanceId: before.documents[0]!.instances[0]!.id,
    pinName: "OUT",
  });
  await page.keyboard.press("ControlOrMeta+z");
  const undone = await readProject(page);
  expect(undone.componentDefinitions).toEqual(before.componentDefinitions);
  expect(undone.documents[0]!.instances).toEqual(
    before.documents[0]!.instances,
  );
  expect(undone.modelSources ?? []).toEqual([]);
});

test("explicitly attaches a legacy class to an existing applied Project model without changing its draft or peers", async ({
  page,
  service,
}) => {
  await service.openEditorAs(page, "alice");
  const native = await openFiniteGain(page);
  await button(native, "Apply & Place").click();
  await place(page, 650, 230);
  const editor = await editWithKey(page, "X1");
  await authoringView(editor, "Circuit");
  await netlist(editor).fill(finiteGainSource.replace("gain=10", "gain=25"));
  await text(editor, "More").click();
  await button(editor, "Save draft").click();
  await editor.getByLabel("Close component editor", { exact: true }).click();
  const symbol = {
    ...structuredClone(builtInSymbols.find((item) => item.id === "resistor")!),
    // A local definition may reuse a registry ID without its built-in interface.
    id: "comparator",
    name: "Legacy attach",
    variants: [
      { id: "base", hiddenPinNames: [] },
      {
        id: "alternate",
        hiddenPinNames: [],
        additionalPrimitives: [
          { kind: "circle" as const, center: { x: 0, y: 0 }, radius: 10 },
        ],
      },
    ],
    defaultVariantId: "base",
  };
  const definition = {
    symbol,
    subcircuit: {
      id: "legacy-attach-interface",
      symbolId: symbol.id,
      target: "finite_gain",
      ports: [
        { name: "A", pinName: "1", direction: "input" },
        { name: "B", pinName: "2", direction: "output" },
        { name: "GND", supply: "VSS", direction: "passive" },
      ],
    },
  };
  await publishComponent(page, "legacy-attach", definition);
  for (const x of [350, 500]) {
    await openUserComponents(page);
    if (x === 350) {
      await button(page, "Refresh").click();
    }
    await button(page, "Place Legacy attach").click();
    await place(page, x, 360);
  }
  const captured = await readProject(page);
  expect(captured.documents[0]!.instances[1]!.netlist?.binding?.kind).toBe(
    "unresolved-subcircuit",
  );
  const implicit = structuredClone(captured);
  const legacyId = implicit.documents[0]!.instances[1]!.symbolId;
  const shadow = definitionOf(implicit, legacyId);
  shadow.symbol.id = "comparator";
  shadow.subcircuit!.symbolId = "comparator";
  for (const instance of implicit.documents[0]!.instances.slice(1, 3)) {
    instance.symbolId = "comparator";
    delete instance.netlist!.binding;
  }
  implicit.documents[0]!.instances[2]!.symbolVariantId = "alternate";
  await openProjectFile(page, implicit);
  await button(page, "Continue without saving").click();
  await awaitEditorReady(page);
  const before = await readProject(page);
  expect(before.documents[0]!.instances[1]!.netlist?.binding).toBeUndefined();
  await editWithKey(page, "X2");
  await authoringView(editor, "Circuit");
  await choose(
    editor,
    "External model source owner",
    before.modelSources![0]!.id,
  );
  await authoringView(editor, "Mapping");
  await choose(editor, "Map native IN", "pin:1");
  await choose(editor, "Map native OUT", "pin:2");
  await choose(editor, "Map native VSS", "supply:VSS");
  await applyModel(editor);
  await editor.getByLabel("Close component editor", { exact: true }).click();
  const repaired = await readProject(page);
  expect(repaired.modelSources).toEqual(before.modelSources);
  expect(repaired.externalSubcircuitDefinitions).toHaveLength(1);
  expect(
    repaired.documents[0]!.instances.slice(1, 3).map((i) => i.symbolVariantId),
  ).toEqual(["base", "alternate"]);
  expect(repaired.documents[0]!.instances[0]).toEqual(
    before.documents[0]!.instances[0],
  );
  expect(
    repaired.documents[0]!.instances.slice(1, 3).map((i) => i.netlist?.binding),
  ).toEqual([
    {
      kind: "external-subcircuit",
      definitionId: before.externalSubcircuitDefinitions[0]!.id,
    },
    {
      kind: "external-subcircuit",
      definitionId: before.externalSubcircuitDefinitions[0]!.id,
    },
  ]);
});

test("explicitly upgrades a symbol-only public entry without rewriting captured Projects", async ({
  page,
  service,
}) => {
  test.setTimeout(90_000);
  const body = ".subckt restored_model A B\nR1 A B 1k\n.ends restored_model\n";
  await service.openEditorAs(page, "alice");
  const symbol = {
    ...structuredClone(builtInSymbols.find((item) => item.id === "resistor")!),
    id: "legacy-public-art",
    name: "Legacy public repair",
  };
  const definition = {
    symbol,
    subcircuit: {
      id: "legacy-public-interface",
      symbolId: symbol.id,
      target: "legacy_public_cell",
      ports: [
        { name: "A", pinName: "1", direction: "input" },
        { name: "B", pinName: "2", direction: "output" },
      ],
    },
  };
  await publishComponent(page, "legacy-upgrade", definition);
  await openUserComponents(page);
  const tile = page
    .locator(".user-component-tile")
    .filter({ hasText: "Legacy public repair" });
  await expect(text(tile, "Symbol only")).toBeVisible();
  await button(tile, "Place Legacy public repair").click();
  await place(page);
  await expect(instanceCount(page)).toHaveText("1");
  const captured = await readProject(page);
  expect(captured.documents[0]!.instances[0]!.netlist?.binding).toEqual({
    kind: "unresolved-subcircuit",
    name: "legacy_public_cell",
  });
  expect(captured.modelSources ?? []).toEqual([]);
  expect(createDesignNetlistExport(captured, { format: "spice" }).status).toBe(
    "blocked",
  );
  await openUserComponents(page);
  await clickLibraryAction(page, "Edit Legacy public repair definition");
  const editor = componentEditor(page);
  await authoringView(editor, "Circuit");
  await netlist(editor).fill(body);
  await applyModel(editor);
  await button(editor, "Update my component").click();
  await expect(text(editor, "Saved to the public library.")).toBeVisible();
  await editor.getByLabel("Close component editor", { exact: true }).click();
  const edited = await readProject(page);
  expect(edited).toEqual({
    ...captured,
    structureRevision: edited.structureRevision,
    componentAuthoringDrafts: edited.componentAuthoringDrafts,
  });
  expect(edited.componentAuthoringDrafts).toHaveLength(1);
  const entries = await libraryEntries(page);
  const upgraded = entries.find(
    (entry: { id: string }) => entry.id === "legacy-upgrade",
  );
  expect(upgraded.revision).toBe(2);
  expect(upgraded.circuit.source.files[0].text).toBe(body);
  expect(upgraded.definition.subcircuit).toBeUndefined();
});

test("live preview and the administrator lifecycle keep captured Projects", async ({
  page,
  service,
}) => {
  service.seedPublished("shared-amplifier", "Shared amplifier");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await service.openEditorAs(page, "admin");
  await openUserComponents(page);
  await button(page, "Create Component…").click();
  await editDefinition(page, "Previewed amplifier");
  await expect(
    page.getByLabel("Component preview").locator("circle"),
  ).toHaveCount(1);
  await button(page, "Close component editor").click();
  await button(page, "Discard changes").click();
  await placeFromLibrary(page, "Shared amplifier");
  const captured = (await readProject(page)).componentDefinitions;
  expect(captured).toHaveLength(1);
  await openUserComponents(page);
  await clickLibraryAction(page, "Manage Shared amplifier");
  await button(page, "Promote to official").click();
  await expect(
    page.getByText("Promoted to an official component."),
  ).toBeVisible();
  await button(page, "Delete component").click();
  await button(page, "Really delete").click();
  await expect(page.getByText("Removed from the library.")).toBeVisible();
  await button(page, "Close component editor").click();
  expect((await readProject(page)).componentDefinitions).toEqual(captured);
  await openUserComponents(page);
  await expect(button(page, "Place Shared amplifier")).toHaveCount(0);
  await button(page, "Review deleted components").click();
  await clickLibraryAction(page, "Review Shared amplifier");
  await button(page, "Restore").click();
  await expect(page.getByText("Restored to User Defined.")).toBeVisible();
  expect(errors).toEqual([]);
});

test("anonymous creation keeps public publication disabled and invalid code leaves the circuit untouched", async ({
  page,
  service,
}) => {
  await service.openEditorAs(page, null);
  await openUserComponents(page);
  await button(page, "Create Component…").click();
  await choose(page, "Definition type", "json");
  await expect(button(page, PUBLISH)).toBeDisabled();
  await expect(button(page, "Apply")).toBeEnabled();
  const code = page.getByRole("textbox", {
    name: "Component definition code",
    exact: true,
  });
  await code.fill("{");
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Close component editor" }).click();
  await button(page, "Keep editing").click();
  await expect(code).toContainText("{");
  await page.getByRole("button", { name: "Close component editor" }).click();
  await button(page, "Discard changes").click();
  expect((await readProject(page)).documents[0]!.instances).toHaveLength(0);
});

test("creates a native User Component through the shared model owner and places its automatic symbol", async ({
  page,
  service,
}) => {
  // Project Apply does not require or perform public-library publication.
  await service.openEditorAs(page, "alice");
  const editor = await openFiniteGain(page);
  await button(editor, "Apply model").click();
  await expect(editor.getByLabel("Parsed model interface")).toContainText("IN");
  await authoringView(editor, "Symbol");
  await expect(editor.getByLabel("Symbol preview")).toBeVisible();
  await button(editor, "Place").click();
  await expect(editor).toHaveCount(0);
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 280, y: 180 } });
  await canvas.click({ position: { x: 540, y: 280 } });
  await page.keyboard.press("Escape");
  await expect(instanceCount(page)).toHaveText("2");
  const project = await readProject(page);
  expect(project.modelSources).toHaveLength(1);
  expect(project.modelSources![0]!.files[0]!.text).toBe(finiteGainSource);
  expect(project.modelSources![0]!.revision).toBe(1);
  expect(project.externalSubcircuitDefinitions).toHaveLength(1);
  const definition = project.externalSubcircuitDefinitions[0]!;
  expect(definition.name).toBe("finite_gain");
  expect(definition.terminals.map((terminal) => terminal.name)).toEqual([
    "IN",
    "OUT",
    "VSS",
  ]);
  expect(definition.formalParameters).toEqual([
    { name: "gain", defaultValue: "10" },
    { name: "poleHz", defaultValue: "1000" },
  ]);
  for (const instance of project.documents[0]!.instances)
    expect(instance.netlist?.binding).toEqual({
      kind: "external-subcircuit",
      definitionId: definition.id,
    });
  await expect(page.locator('[data-pin-name="OUT"]').first()).toBeVisible();
  const dialog = await openUserComponents(page);
  await expect(button(dialog, "Place finite_gain")).toHaveCount(0);
});

test("native User Components bind an existing owner, guard unsaved text and keep a stale draft on the latest version", async ({
  page,
  baseURL,
  service,
}) => {
  test.setTimeout(90_000);
  await service.openEditorAs(page, null);
  let editor = await openFiniteGain(page);
  await button(editor, "Apply model").click();
  await editor.getByLabel("Close component editor", { exact: true }).click();
  const client = await pairAgent(page, baseURL!);
  const before = await readProject(page);
  const owner = before.modelSources![0]!;
  editor = await openNativeComponent(page);
  await authoringView(editor, "Circuit");
  await choose(editor, "External model source owner", owner.id);
  await authoringView(editor, "Circuit");
  await entry(editor).selectOption("finite_gain");
  const pendingText = finiteGainSource.replace("gain=10", "gain=17");
  await authoringView(editor, "Circuit");
  await netlist(editor).fill(pendingText);
  await editor.getByLabel("Definition type").selectOption("json");
  await expect(button(editor, "Discard changes")).toHaveCount(0);
  await editor.getByLabel("Definition type").selectOption("circuit");
  await expect(editor.getByLabel("Definition type")).toHaveValue("circuit");
  await expect(netlist(editor)).toContainText("gain=17");
  const updated = await client.advancedTransact({
    structureEdits: [
      {
        kind: "apply_model_source",
        source: {
          ...owner,
          files: [
            {
              path: owner.entry,
              text: finiteGainSource.replace("gain=10", "gain=15"),
            },
          ],
        },
        definitions: [
          {
            definitionId: before.externalSubcircuitDefinitions![0]!.id,
            entry: "finite_gain",
          },
        ],
      },
    ],
  });
  expect(updated.ok, updated.message).toBe(true);
  await button(editor, "Apply model").click();
  await expect(editor.getByRole("status")).toContainText(
    "The applied model changed",
  );
  const refused = (await client.refreshSnapshot()).snapshot.project;
  expect(refused.modelSources![0]!.files[0]!.text).toContain("gain=15");
  expect(refused.externalSubcircuitDefinitions).toHaveLength(1);
  await button(editor, "Keep my draft on the latest version").click();
  await button(editor, "Apply model").click();
  await expect(editor.getByRole("status")).toContainText(
    "Applied shared model",
  );
  const applied = (await client.refreshSnapshot()).snapshot.project;
  expect(applied.modelSources).toHaveLength(1);
  expect(applied.modelSources![0]!.revision).toBe(3);
  expect(applied.modelSources![0]!.files[0]!.text).toBe(pendingText);
  expect(applied.externalSubcircuitDefinitions).toHaveLength(1);
  expect(applied.externalSubcircuitDefinitions![0]!.terminals).toEqual(
    before.externalSubcircuitDefinitions![0]!.terminals,
  );
  expect(
    applied.externalSubcircuitDefinitions!.every(
      (definition) => definition.implementation?.sourceId === owner.id,
    ),
  ).toBe(true);
  await authoringView(editor, "Circuit");
  await netlist(editor).fill(".subckt unfinished A B\n");
  await text(editor, "More").click();
  await button(editor, "Save draft").click();
  await expect(editor.getByRole("status")).toContainText("Saved draft");
  await editor.getByLabel("Close component editor", { exact: true }).click();
  const saved = await readProject(page);
  expect(saved.modelSources![0]!.files[0]!.text).toBe(pendingText);
  expect(saved.modelSources![0]!.draft!.files[0]!.text).toBe(
    ".subckt unfinished A B\n",
  );
  // Save draft stores the draft beside the applied owner, never over it.
  const appliedOwner = applied.externalSubcircuitDefinitions![0]!;
  expect(
    saved.externalSubcircuitDefinitions.map(
      ({ id, name, terminals, implementation }) => ({
        id,
        name,
        terminals,
        implementation,
      }),
    ),
  ).toEqual([
    {
      id: appliedOwner.id,
      name: "finite_gain",
      terminals: appliedOwner.terminals,
      implementation: appliedOwner.implementation,
    },
  ]);
  expect(appliedOwner.terminals.map((terminal) => terminal.name)).toEqual([
    "IN",
    "OUT",
    "VSS",
  ]);
  expect(appliedOwner.implementation?.kind).toBe("source");
  const manager = await openExternalCircuit(page, "finite_gain");
  await expect(netlist(manager)).toContainText(".subckt unfinished A B");
  await expect(manager).toContainText("Saved draft");
});

test("native Save draft keeps an existing placeholder owner's name and terminals", async ({
  page,
  service,
}) => {
  await service.openEditorAs(page, null);
  const project = createEmptyProject("placeholder-owner", "Placeholder owner");
  project.externalSubcircuitDefinitions.push({
    id: "legacy",
    name: "legacy_gain",
    interfaceStatus: "declared",
    terminals: [
      { id: "a", name: "A", direction: "input" },
      { id: "b", name: "B", direction: "output" },
    ],
    formalParameters: [{ name: "gain", defaultValue: "2" }],
  });
  await openProjectFile(page, project);
  await awaitEditorReady(page);
  // Cell Manager saves the interface-only owner's first draft.
  let manager = await openExternalCircuit(page, "legacy_gain");
  await button(manager, "Define implementation…").click();
  await netlist(manager).fill(".subckt legacy_gain A B\n");
  await text(manager, "More").click();
  await button(manager, "Save draft").click();
  await expect(manager.getByRole("status")).toContainText("Saved draft");
  await manager.getByLabel("Close Cell Manager").click();
  const linked = await readProject(page);
  const source = linked.modelSources![0]!;
  const owner = linked.externalSubcircuitDefinitions[0]!;
  expect(owner).toEqual({
    ...project.externalSubcircuitDefinitions[0],
    implementation: { kind: "placeholder", sourceId: source.id },
  });
  // The native editor reopens that draft for the same owner, then names
  // a different entry.
  const editor = await openNativeComponent(page);
  await authoringView(editor, "Circuit");
  await choose(editor, "External model source owner", source.id);
  await netlist(editor).fill(".subckt other_gain P Q\n");
  await text(editor, "More").click();
  await button(editor, "Save draft").click();
  await expect(editor.getByRole("status")).toContainText("Saved draft");
  await editor.getByLabel("Close component editor", { exact: true }).click();
  const saved = await readProject(page);
  expect(saved.externalSubcircuitDefinitions).toEqual([owner]);
  expect(saved.modelSources![0]!.draft!.files[0]!.text).toBe(
    ".subckt other_gain P Q\n",
  );
  manager = await openExternalCircuit(page, "legacy_gain");
  await expect(netlist(manager)).toContainText(".subckt other_gain P Q");
  await expect(manager).toContainText("Saved draft");
});

test("complete same-name custom artwork initializes checked mappings", async ({
  page,
  service,
}) => {
  await service.openEditorAs(page, null);
  const editor = await openFiniteGain(page, "custom");
  await authoringView(editor, "Symbol");
  const code = symbolJson(editor);
  const component = JSON.parse(await copyText(page, code));
  delete component.circuitBinding;
  await code.fill(JSON.stringify(component, null, 2));
  await expect(editor.getByRole("alert")).toHaveCount(0);
  await applyAndPlace(editor);
  const applied = await readProject(page);
  const captured = definitionOf(applied, component.symbol.id);
  expect(
    captured.circuitBinding!.terminals.map((m) =>
      "pinName" in m ? m.pinName : m.supply,
    ),
  ).toEqual(["IN", "OUT", "VSS"]);
  expect(applied.documents[0]!.nets).toEqual([]);
});

test("custom circuit mappings reject collapsed ports and use an explicit property supply", async ({
  page,
  service,
}) => {
  await service.openEditorAs(page, null);
  const editor = await openFiniteGain(page, "custom");
  await authoringView(editor, "Symbol");
  const code = symbolJson(editor);
  // CodeMirror virtualizes its DOM: fill() can replace only the rendered
  // lines and leave old document text behind. Select through its keymap.
  const replaceCode = async (value: object) => {
    await code.press("ControlOrMeta+a");
    await page.keyboard.insertText(JSON.stringify(value, null, 2));
  };
  const component = JSON.parse(await copyText(page, code));
  const duplicate = structuredClone(component);
  duplicate.circuitBinding.terminals[1].pinName = "IN";
  await replaceCode(duplicate);
  await expect(
    editor
      .getByRole("status")
      .filter({ hasText: "different native terminals" }),
  ).toBeVisible();
  await expect(button(editor, "Apply model")).toBeDisabled();
  await expect(instanceCount(page)).toHaveText("0");
  component.symbol.pins = component.symbol.pins.filter(
    (pin: { name: string }) => pin.name !== "VSS",
  );
  component.circuitBinding.terminals[2] = {
    terminalId: component.circuitBinding.terminals[2].terminalId,
    supply: "VSS",
  };
  await replaceCode(component);
  expect(JSON.parse(await copyText(page, code))).toEqual(component);
  await applyAndPlace(editor, 400, 220);
  await expect(page.getByTestId("terminal-X1-VSS")).toHaveCount(0);
  await placeComponent(page, "voltage-source", { x: 160, y: 350 });
  await placeComponent(page, "ground", { x: 440, y: 460 });
  for (const [from, to] of [
    ["V1-+", "X1-IN"],
    ["V1--", "GND1-0"],
  ] as const) {
    await drawWire(page, from, to);
  }
  await markNoConnect(page, "terminal-X1-OUT");
  const applied = await readProject(page);
  const analysis = analyzeDesignNetlist(applied);
  expect(analysis.diagnostics.filter((d) => d.severity === "error")).toEqual(
    [],
  );
  expect(
    analysis
      .ir!.cells[0]!.instances.find((i) => i.id === "X1")!
      .nodes.map((node) => node.pinName),
  ).toEqual(["IN", "OUT", "VSS"]);
  expect(
    analysis.ir!.cells[0]!.instances.find((i) => i.id === "X1")!.nodes[2]!
      .netName,
  ).toBe("0");
});

test("editing connected custom artwork and switching modes preserves logical pins and captured peers", async ({
  page,
  service,
}) => {
  await service.openEditorAs(page, null);
  let editor = await openFiniteGain(page, "custom");
  await authoringView(editor, "Symbol");
  const initialCode = symbolJson(editor);
  const initialArtwork = JSON.parse(await copyText(page, initialCode));
  initialArtwork.symbol.variants = [
    { id: "base", hiddenPinNames: [] },
    {
      id: "alternate",
      hiddenPinNames: [],
      additionalPrimitives: [
        { kind: "circle", center: { x: 0, y: 0 }, radius: 10 },
      ],
    },
  ];
  initialArtwork.symbol.defaultVariantId = "base";
  await initialCode.fill(JSON.stringify(initialArtwork, null, 2));
  await button(editor, "Apply & Place").click();
  await expect(editor).toHaveCount(0);
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 360, y: 240 } });
  await canvas.click({ position: { x: 640, y: 320 } });
  await page.keyboard.press("Escape");
  await placeComponent(page, "voltage-source", { x: 140, y: 350 });
  await drawWire(page, "V1-+", "X1-IN");
  const selectedVariants = await readProject(page);
  for (const instance of selectedVariants.documents[0]!.instances.filter(
    (item) => item.id === "X1" || item.id === "X2",
  ))
    instance.symbolVariantId = "alternate";
  await openProjectFile(page, selectedVariants);
  await button(page, "Continue without saving").click();
  await awaitEditorReady(page);
  const before = await readProject(page);
  const peer = instanceOf(before, "X2");
  expect(instanceOf(before, "X1").symbolVariantId).toBe("alternate");
  expect(peer.symbolVariantId).toBe("alternate");
  editor = await editFromMenu(page, "X1");
  await authoringView(editor, "Symbol");
  await expect(editor.getByLabel("Symbol mode")).toHaveValue("custom");
  await authoringView(editor, "Symbol");
  const code = symbolJson(editor);
  const artwork = JSON.parse(await copyText(page, code));
  artwork.symbol.pins.find((pin: { name: string }) => pin.name === "IN").at.x -=
    20;
  await code.fill(JSON.stringify(artwork, null, 2));
  await applyModel(editor);
  await editor.getByLabel("Close component editor", { exact: true }).click();
  const moved = await readProject(page);
  expect(instanceOf(moved, "X1").symbolVariantId).toBe("alternate");
  expect(moved.documents[0]!.nets).toEqual(before.documents[0]!.nets);
  expect(moved.modelSources![0]!.files).toEqual(before.modelSources![0]!.files);
  expect(moved.externalSubcircuitDefinitions[0]!.terminals).toEqual(
    before.externalSubcircuitDefinitions[0]!.terminals,
  );
  expect(instanceOf(moved, "X2")).toEqual(peer);
  const endpoint = {
    kind: "terminal" as const,
    instanceId: "X1",
    pinName: "IN",
  };
  const oldPoint = resolveEndpointPoint(
    before.documents[0]!,
    createProjectSymbolResolver(before, builtInSymbols),
    endpoint,
  )!;
  const movedResolver = createProjectSymbolResolver(moved, builtInSymbols);
  const movedPoint = resolveEndpointPoint(
    moved.documents[0]!,
    movedResolver,
    endpoint,
  )!;
  expect(movedPoint).toEqual({ x: oldPoint.x - 20, y: oldPoint.y });
  expect(
    resolveRouteGeometry(
      moved.documents[0]!,
      movedResolver,
      moved.documents[0]!.routes[0]!,
    )!.centerline.at(-1),
  ).toEqual(movedPoint);
  expect(instanceOf(moved, "X1").symbolId).not.toBe(artwork.symbol.id);
  expect(definitionOf(moved, artwork.symbol.id)).toEqual(
    definitionOf(before, artwork.symbol.id),
  );
  await page.keyboard.press("ControlOrMeta+z");
  expect(await readProject(page)).toEqual({
    ...before,
    structureRevision: expect.any(Number),
    documents: before.documents.map((document) => ({
      ...document,
      revision: expect.any(Number),
    })),
  });
  await editFromMenu(page, "X1");
  await authoringView(editor, "Symbol");
  await expect(editor.getByLabel("Symbol mode")).toHaveValue("custom");
  await editor.getByLabel("Symbol mode").selectOption("automatic");
  const discard = button(editor, "Discard changes");
  if (await discard.isVisible()) await discard.click();
  await applyModel(editor);
  await applyModel(editor);
  await editor.getByLabel("Close component editor", { exact: true }).click();
  const automatic = await readProject(page);
  const caller = instanceOf(automatic, "X1");
  expect(caller.symbolVariantId).toBeUndefined();
  expect(caller.symbolId).not.toBe(artwork.symbol.id);
  expect(caller.netlist?.binding).toEqual(
    instanceOf(before, "X1").netlist?.binding,
  );
  expect(automatic.modelSources![0]!.files).toEqual(
    before.modelSources![0]!.files,
  );
  expect(automatic.documents[0]!.nets).toEqual(before.documents[0]!.nets);
  expect(instanceOf(automatic, "X2")).toEqual(peer);
});

test("copying custom circuits keeps terminal identities scoped to each native owner", async ({
  page,
  service,
}) => {
  test.setTimeout(90_000);
  await service.openEditorAs(page, null);
  for (const [name, x] of [
    ["finite_gain", 250],
    ["second_gain", 500],
  ] as const) {
    const editor = await openNativeComponent(page);
    await authoringView(editor, "Circuit");
    await netlist(editor).fill(
      finiteGainSource
        .split(".subckt owned_helper")[0]!
        .replaceAll("finite_gain", name),
    );
    await authoringView(editor, "Symbol");
    await choose(editor, "Symbol mode", "custom");
    await button(editor, "Apply & Place").click();
    await place(page, x, 260);
  }
  const source = await readProject(page);
  const [first, second] = source.externalSubcircuitDefinitions;
  const oldIds = second!.terminals.map((terminal) => terminal.id);
  second!.terminals.forEach((terminal, index) => {
    terminal.id = first!.terminals[index]!.id;
  });
  for (const component of source.componentDefinitions ?? []) {
    if (component.circuitBinding?.definitionId !== second!.id) continue;
    for (const mapping of component.circuitBinding.terminals)
      mapping.terminalId =
        first!.terminals[oldIds.indexOf(mapping.terminalId)]!.id;
  }
  await openProjectFile(page, source);
  await page.getByTestId("hit-X1").click();
  await page.getByTestId("hit-X2").click({ modifiers: ["ControlOrMeta"] });
  await page.keyboard.press("ControlOrMeta+c");
  await button(page, "New project tab").click();
  for (const [index, y] of [200, 440].entries()) {
    await page.keyboard.press("ControlOrMeta+v");
    await page
      .getByTestId("schematic-canvas")
      .click({ position: { x: 250, y } });
    await expect(instanceCount(page)).toHaveText(String((index + 1) * 2));
    await page.keyboard.press("Escape");
  }
  const copied = await readProject(page);
  expect(copied.modelSources).toHaveLength(2);
  expect(copied.externalSubcircuitDefinitions).toHaveLength(2);
  expect(copied.documents[0]!.nets).toEqual([]);
  expect(copied.documents[0]!.connectivityEvidence).toEqual([]);
  const resolver = createProjectSymbolResolver(copied, builtInSymbols);
  for (const instance of copied.documents[0]!.instances) {
    const binding = instance.netlist!.binding!;
    if (binding.kind !== "external-subcircuit")
      throw Error("Missing native target");
    const owner = copied.externalSubcircuitDefinitions.find(
      (item) => item.id === binding.definitionId,
    )!;
    const artwork = definitionOf(copied, instance.symbolId);
    expect(artwork.circuitBinding!.definitionId).toBe(owner.id);
    expect(
      artwork.circuitBinding!.terminals.map((item) => item.terminalId),
    ).toEqual(owner.terminals.map((item) => item.id));
    expect(
      resolver
        .resolve(instance.symbolId)!
        .definition.pins.map((pin) => pin.name),
    ).toEqual(["IN", "OUT", "VSS"]);
  }
});

test("native custom source changes diagnose missing mappings without crashing the Editor", async ({
  page,
  service,
}) => {
  await service.openEditorAs(page, null);
  let editor = await openFiniteGain(page, "custom");
  await applyAndPlace(editor);
  const before = await readProject(page);
  editor = await editFromMenu(page, "X1");
  await authoringView(editor, "Circuit");
  await netlist(editor).fill(
    finiteGainSource.replace("IN OUT VSS params:", "IN OUT VSS EXTRA params:"),
  );
  await expect(
    editor.locator(".cell-external-result").filter({ hasText: "EXTRA" }),
  ).toBeVisible();
  await expect(button(editor, "Apply model")).toBeDisabled();
  await expect(editor.locator(".cell-external-result")).toContainText("EXTRA");
  await editor.getByLabel("Close component editor", { exact: true }).click();
  await button(editor, "Discard changes").click();
  expect(await readProject(page)).toEqual(before);
});

test("connected custom native port rename preserves graphical mapping, Nets and No Connects in one undo", async ({
  page,
  service,
}) => {
  await service.openEditorAs(page, null);
  let editor = await openFiniteGain(page, "custom");
  await authoringView(editor, "Symbol");
  const jsonCode = symbolJson(editor);
  const custom = JSON.parse(await copyText(page, jsonCode));
  custom.symbol.pins.find((pin: { name: string }) => pin.name === "IN").name =
    "sense";
  custom.circuitBinding.terminals.find(
    (mapping: { pinName: string }) => mapping.pinName === "IN",
  ).pinName = "sense";
  await jsonCode.fill(JSON.stringify(custom, null, 2));
  await applyAndPlace(editor, 400, 220);
  await placeComponent(page, "voltage-source", { x: 150, y: 350 });
  await placeComponent(page, "ground", { x: 480, y: 460 });
  for (const [from, to] of [
    ["V1-+", "X1-IN"],
    ["V1--", "GND1-0"],
    ["X1-VSS", "GND1-0"],
  ] as const) {
    await drawWire(page, from, to);
  }
  await markNoConnect(page, "terminal-X1-OUT");
  const before = await readProject(page);
  const beforeOwner = before.externalSubcircuitDefinitions[0]!;
  const originalArtwork = definitionOf(
    before,
    instanceOf(before, "X1").symbolId,
  );
  editor = await editFromMenu(page, "X1");
  await authoringView(editor, "Circuit");
  await netlist(editor).fill(finiteGainSource.replace(/\bIN\b/gu, "INPUT"));
  await authoringView(editor, "Circuit");
  await editor.getByLabel("Migrate finite_gain.IN").selectOption("INPUT");
  await applyModel(editor);
  await editor.getByLabel("Close component editor", { exact: true }).click();
  const renamed = await readProject(page);
  expect(
    renamed.externalSubcircuitDefinitions[0]!.terminals.map(
      (terminal) => terminal.name,
    ),
  ).toEqual(["INPUT", "OUT", "VSS"]);
  expect(renamed.externalSubcircuitDefinitions[0]!.terminals[0]!.id).toBe(
    beforeOwner.terminals[0]!.id,
  );
  expect(definitionOf(renamed, originalArtwork.symbol.id)).toEqual(
    originalArtwork,
  );
  const expectedDocument = structuredClone(before.documents[0]!);
  for (const net of expectedDocument.nets)
    for (const terminal of net.terminals)
      if (terminal.instanceId === "X1" && terminal.pinName === "IN")
        terminal.pinName = "INPUT";
  expect(renamed.documents[0]!.nets).toEqual(expectedDocument.nets);
  expect(renamed.documents[0]!.noConnects).toEqual(
    before.documents[0]!.noConnects,
  );
  expect(
    renamed.documents[0]!.routes.some((route) =>
      [route.start, routeEnd(route)].some(
        (endpoint) =>
          endpoint?.kind === "terminal" &&
          endpoint.instanceId === "X1" &&
          endpoint.pinName === "INPUT",
      ),
    ),
  ).toBe(true);
  expect(await copyNetlistText(page, "spice")).toContain(
    ".subckt finite_gain INPUT OUT VSS",
  );
  await button(page, "Undo").click();
  const undone = await readProject(page);
  expect(undone.documents[0]!.nets).toEqual(before.documents[0]!.nets);
  expect(undone.externalSubcircuitDefinitions).toEqual(
    before.externalSubcircuitDefinitions,
  );
});

test("native port removal captures repaired custom artwork and detaches removed No Connects in one undo", async ({
  page,
  service,
}) => {
  await service.openEditorAs(page, null);
  const editor = await openFiniteGain(page, "custom");
  await applyAndPlace(editor, 400, 220);
  await placeComponent(page, "ground", { x: 480, y: 460 });
  for (const pin of ["IN", "VSS"]) {
    await drawWire(page, `X1-${pin}`, "GND1-0");
  }
  await markNoConnect(page, "terminal-X1-OUT");
  const before = await readProject(page);
  const manager = await openExternalCircuit(page, "finite_gain");
  await netlist(manager).fill(
    ".subckt finite_gain VSS\nR1 VSS 0 1k\n.ends finite_gain\n.subckt owned_helper A B\nR1 A B 1k\n.ends owned_helper\n",
  );
  await manager
    .getByLabel("Migrate finite_gain.IN")
    .selectOption("__disconnect");
  await manager
    .getByLabel("Migrate finite_gain.OUT")
    .selectOption("__disconnect");
  await applyModel(manager);
  await button(manager, "Close Cell Manager").click();
  const after = await readProject(page);
  expect(
    after.externalSubcircuitDefinitions[0]!.terminals.map(
      (terminal) => terminal.name,
    ),
  ).toEqual(["VSS"]);
  const expectedNets = structuredClone(before.documents[0]!.nets);
  for (const net of expectedNets)
    net.terminals = net.terminals.filter(
      (terminal) => terminal.instanceId !== "X1" || terminal.pinName !== "IN",
    );
  expect(after.documents[0]!.nets).toEqual(expectedNets);
  expect(
    after.documents[0]!.routes.some((route) =>
      [route.start, routeEnd(route)].some(
        (endpoint) =>
          endpoint.kind === "terminal" &&
          endpoint.instanceId === "X1" &&
          endpoint.pinName === "IN",
      ),
    ),
  ).toBe(false);
  expect(after.documents[0]!.noConnects).toEqual([]);
  expect(
    definitionOf(after, instanceOf(after, "X1").symbolId).symbol.pins.map(
      (pin) => pin.name,
    ),
  ).toEqual(["VSS"]);
  await button(page, "Undo").click();
  const undone = await readProject(page);
  expect(undone.documents[0]!.nets).toEqual(before.documents[0]!.nets);
  expect(undone.documents[0]!.noConnects).toEqual(
    before.documents[0]!.noConnects,
  );
});

test("native port removal migrates preferred artwork past a different placed capture", async ({
  page,
  service,
}) => {
  await service.openEditorAs(page, null);
  let editor = await openFiniteGain(page, "custom");
  await applyModel(editor);
  {
    await button(editor, "Place").click();
    await place(page, 400, 220);
    const placed = await readProject(page);
    const artwork = structuredClone(placed.componentDefinitions![0]!);
    artwork.symbol.id += "-preferred";
    artwork.symbol.primitives.push({
      kind: "circle",
      center: { x: 0, y: 0 },
      radius: 6,
    });
    editor = await openNativeComponent(page);
    await authoringView(editor, "Circuit");
    await choose(
      editor,
      "External model source owner",
      placed.modelSources![0]!.id,
    );
    await authoringView(editor, "Circuit");
    await entry(editor).selectOption("finite_gain");
    await authoringView(editor, "Symbol");
    await editor.getByLabel("Symbol mode").selectOption("custom");
    await editor
      .getByRole("textbox", { name: "Circuit symbol JSON", exact: true })
      .fill(JSON.stringify(artwork, null, 2));
    await applyModel(editor);
  }
  await editor.getByLabel("Close component editor", { exact: true }).click();
  const before = await readProject(page);
  const oldPreference = before.externalSubcircuitDefinitions[0]!.symbolId!;
  expect(
    before.documents[0]!.instances.map((item) => item.symbolId),
  ).not.toContain(oldPreference);
  const manager = await openExternalCircuit(page, "finite_gain");
  await netlist(manager).fill(
    ".subckt finite_gain IN VSS params: gain=10\nR1 IN VSS {gain}\n.ends finite_gain\n",
  );
  await manager
    .getByLabel("Migrate finite_gain.OUT")
    .selectOption("__disconnect");
  await applyModel(manager);
  await button(manager, "Place").click();
  await place(page, 650, 320);
  for (const reference of ["X1", "X2"])
    for (const pin of ["IN", "VSS"]) {
      await markNoConnect(page, `terminal-${reference}-${pin}`);
    }
  const after = await readProject(page);
  const definition = after.externalSubcircuitDefinitions[0]!;
  expect(definition.terminals.map((terminal) => terminal.name)).toEqual([
    "IN",
    "VSS",
  ]);
  expect(definition.symbolId).not.toBe(oldPreference);
  const preferred = definitionOf(after, definition.symbolId!);
  expect(preferred.symbol.pins.map((pin) => pin.name)).toEqual(["IN", "VSS"]);
  expect(preferred.symbol.primitives).toEqual(
    definitionOf(before, oldPreference).symbol.primitives,
  );
  expect(after.documents[0]!.instances.at(-1)!.symbolId).toBe(
    definition.symbolId,
  );
  for (const instance of after.documents[0]!.instances) {
    const capture = definitionOf(after, instance.symbolId);
    expect(capture.symbol.pins.map((pin) => pin.name)).toEqual(["IN", "VSS"]);
  }
  expect(await copyNetlistText(page, "spice")).toContain(
    after.modelSources![0]!.files[0]!.text,
  );
});
