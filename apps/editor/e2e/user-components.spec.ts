import {
  awaitEditorReady,
  clickCommand,
  parseSavedProject,
  clickDrawTool,
  copyNetlistText,
  downloadBytes,
  openCellManager,
  setComponentParameter,
} from "./editor-fixtures";
import { openSelectionShelf, placeComponent } from "./manual-editor-fixtures";
import { analyzeDesignNetlist, createDesignNetlistExport } from "@icm/netlist";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  externalSubcircuitSymbolId,
} from "@icm/symbols";
import { resolveEndpointPoint, resolveRouteGeometry } from "@icm/derived";
import { writeFile } from "node:fs/promises";
import { AgentHttpClient } from "../../../packages/agent-client/src/http-client";
import { AgentSessionClient } from "../../../packages/agent-client/src/session-client";
import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Locator,
} from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import {
  createEmptyProject,
  createSimulationFolder,
  routeEnd,
  type CircuitProject,
} from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { executeProjectTransaction } from "@icm/edit-engine";
import { newComponentDefinition } from "../src/features/user-components/component-definition-edit";
import { publishedDefinition } from "../src/features/user-components/component-library-contract";
import { callTool } from "../../mcp-server/src/tools";
import { prepareNgspiceExecutionInput } from "../../../packages/simulation-service/src/prepare-ngspice";
import { profile } from "./simulation-e2e-fixtures";
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
    dropNextPublicationResponse: () => {
      dropPublicationResponse = true;
    },
    close: () => db.close(),
    async connect(context: BrowserContext, identity: string | null) {
      const user = identity
        ? {
            id: identity,
            displayName: identity,
            email: `${identity}@example.com`,
            role: "user",
            provider: "github",
            isAdmin: identity === "admin",
          }
        : null;
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await context.route("**/api/auth/me", (route) =>
        route.fulfill({ json: { user } }),
      );
      await context.route("**/api/auth/providers", (route) =>
        route.fulfill({ json: { github: true, google: false, email: false } }),
      );
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

async function openEditor(page: Page) {
  await page.goto("/editor?new=1");
  await awaitEditorReady(page);
  await expect(page.getByTestId("shapes-category-user-defined")).toHaveCount(0);
}

/** Cloud storage is external to the Editor; retain the exact formal-save request. */
function privateProjectService() {
  let stored: {
    id: string;
    name: string;
    projectText: string;
    revision: number;
    schemaVersion: number;
    updatedAt: string;
  } | null = null;
  return {
    stored: () => stored,
    async connect(context: BrowserContext) {
      await context.route("**/api/projects", (route) => {
        if (route.request().method() === "GET")
          return route.fulfill({ json: { projects: stored ? [stored] : [] } });
        const body = route.request().postDataJSON();
        stored = {
          id: "cloud-native-capture",
          name: body.name,
          projectText: body.projectText,
          revision: 1,
          schemaVersion: JSON.parse(body.projectText).schemaVersion,
          updatedAt: "2026-10-09T01:00:00.000Z",
        };
        return route.fulfill({ status: 201, json: { project: stored } });
      });
      await context.route("**/api/projects/cloud-native-capture", (route) =>
        route.fulfill({ json: { project: stored } }),
      );
    },
  };
}
async function openUserComponents(page: Page) {
  await clickCommand(page, "Edit", "User Components…");
  await expect(
    page.getByRole("dialog", { name: "User Components", exact: true }),
  ).toBeVisible();
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
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+c");
  const project = parseSavedProject(
    await page.evaluate(() => navigator.clipboard.readText()),
  );
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
}) => {
  const service = library();
  const definition = newComponentDefinition();
  definition.symbol.name = "Retained detail";
  service.seedHistoricalDefinition(
    "retained-detail",
    publishedDefinition(definition, "retained-detail", 1),
  );
  try {
    await service.connect(context, "admin");
    await openEditor(page);
    await openUserComponents(page);
    const dialog = page.getByRole("dialog", {
      name: "User Components",
      exact: true,
    });
    await dialog
      .getByRole("button", { name: "Details for Retained detail", exact: true })
      .click();
    await expect(
      dialog.getByRole("heading", { name: "Retained detail", exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    expect(
      await page.evaluate(
        async () =>
          (
            await fetch("/api/components/retained-detail", {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ revision: 1, status: "deleted" }),
            })
          ).status,
      ),
    ).toBe(200);
    // Simulate a new signed-out request policy; retained details must be re-read.
    await context.unroute("**/api/auth/me");
    await context.unroute("**/api/components**");
    await service.connect(context, null);
    await openUserComponents(page);
    await expect(
      dialog.getByRole("heading", { name: "Retained detail", exact: true }),
    ).toHaveCount(0);
    await expect(dialog.getByRole("status")).toContainText("not found");
  } finally {
    service.close();
  }
});

test("public symbol placement connects contacts atomically and keeps the clicked orientation during a revision check", async ({
  page,
  context,
}) => {
  const service = library();
  const definition = newComponentDefinition();
  definition.symbol.name = "Contact block";
  service.seedHistoricalDefinition(
    "contact-block",
    publishedDefinition(definition, "contact-block", 1),
  );
  try {
    await service.connect(context, "alice");
    await openEditor(page);
    await openUserComponents(page);
    await page
      .getByRole("button", { name: "Place Contact block", exact: true })
      .click();
    await place(page);
    const before = await readProject(page);
    const first = before.documents[0]!.instances[0]!;
    const nextPoint = await page
      .locator(`[data-object-id="${first.id}"][data-symbol-id] > g`)
      .first()
      .evaluate((element) => {
        const matrix = (element as SVGGElement).getScreenCTM()!;
        const point = new DOMPoint(80, 0).matrixTransform(matrix);
        return { x: point.x, y: point.y };
      });
    await openUserComponents(page);
    await page
      .getByRole("button", { name: "Place Contact block", exact: true })
      .click();
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
    await expect(page.getByTestId("active-instance-count")).toHaveText("2");
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
  } finally {
    service.close();
  }
});

test("library selection refuses a revision changed during preview and editing returns to the library", async ({
  page,
  context,
}) => {
  const service = library();
  const definition = newComponentDefinition();
  definition.symbol.name = "Revision guard";
  service.seedHistoricalDefinition(
    "revision-guard",
    publishedDefinition(definition, "revision-guard", 1),
  );
  try {
    await service.connect(context, "alice");
    await openEditor(page);
    await openUserComponents(page);
    const dialog = page.getByRole("dialog", {
      name: "User Components",
      exact: true,
    });
    await dialog
      .getByRole("button", { name: "Details for Revision guard", exact: true })
      .click();
    await expect(
      dialog.getByRole("heading", { name: "Revision guard", exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: "Back to components", exact: true })
      .click();
    await clickLibraryAction(dialog, "Edit Revision guard definition");
    await page
      .getByRole("button", { name: "Back to library", exact: true })
      .click();
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", { name: "Place Revision guard", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    const changed = await page.evaluate(
      async (definition) =>
        (
          await fetch("/api/components/revision-guard", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ revision: 1, definition }),
          })
        ).status,
      definition,
    );
    expect(changed).toBe(200);
    await page
      .getByTestId("schematic-canvas")
      .click({ position: { x: 300, y: 220 } });
    await expect(page.getByTestId("status")).toContainText("changed");
    await expect(page.getByTestId("active-instance-count")).toHaveText("0");
    await page.keyboard.press("Escape");
    await openUserComponents(page);
    await dialog
      .getByRole("button", { name: "Details for Revision guard", exact: true })
      .click();
    await expect(
      dialog.getByText("This component changed. Refresh before selecting it.", {
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    service.close();
  }
});
async function editDefinition(page: Page, name: string) {
  await expect(
    page.getByRole("dialog", {
      name: "Edit Component Definition",
      exact: true,
    }),
  ).toBeVisible();
  const mode = page.getByLabel("Definition type", { exact: true });
  if (await mode.count()) await mode.selectOption("json");
  const code = page.getByRole("textbox", {
    name: "Component definition code",
    exact: true,
  });
  await expect(code).toBeVisible();
  await code.focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+c");
  const value = JSON.parse(
    await page.evaluate(() => navigator.clipboard.readText()),
  );
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
  await expect(
    page.getByRole("dialog", { name: "User Components", exact: true }),
  ).toBeHidden();
  const count = Number(
    await page.getByTestId("active-instance-count").textContent(),
  );
  await page.getByTestId("schematic-canvas").click({ position: { x, y } });
  await expect(page.getByTestId("active-instance-count")).toHaveText(
    String(count + 1),
  );
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

test("reopening User Components retains loaded cards without another list request", async ({
  page,
  context,
}) => {
  const service = library();
  try {
    await service.connect(context, "alice");
    await openEditor(page);
    const definition = { symbol: newComponentDefinition().symbol };
    definition.symbol.name = "Reusable device";
    expect(
      await page.evaluate(async (definition) => {
        const response = await fetch("/api/components/reusable-device", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ revision: 0, definition }),
        });
        return response.status;
      }, definition),
    ).toBe(200);
    let listRequests = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/components")
        listRequests += 1;
    });
    await openUserComponents(page);
    const dialog = page.getByRole("dialog", {
      name: "User Components",
      exact: true,
    });
    await expect(
      dialog.getByRole("button", {
        name: "Place Reusable device",
        exact: true,
      }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await context.route("**/api/components?**", (route) =>
      route.abort("failed"),
    );
    await openUserComponents(page);
    await expect(
      dialog.getByRole("button", {
        name: "Place Reusable device",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      dialog.getByText("Loading components…", { exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByText("Couldn’t load user components.", { exact: true }),
    ).toHaveCount(0);
    expect(listRequests).toBe(1);
    const search = dialog.getByRole("textbox", {
      name: "Search User Defined components",
    });
    await search.fill("unmatched");
    await expect(
      dialog.getByText("Couldn’t load user components.", { exact: true }),
    ).toBeVisible();
    await search.fill("");
    await expect(
      dialog.getByRole("button", {
        name: "Place Reusable device",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      dialog.getByText("Loading components…", { exact: true }),
    ).toHaveCount(0);
    expect(listRequests).toBe(2);
    await context.unroute("**/api/components?**");
    await page.evaluate(async (definition) => {
      for (const [id, revision, name] of [
        ["reusable-device", 1, "Updated device"],
        ["new-device", 0, "New device"],
      ] as const) {
        const response = await fetch(`/api/components/${id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            revision,
            definition: { symbol: { ...definition.symbol, name } },
          }),
        });
        if (!response.ok) throw Error(await response.text());
      }
    }, definition);
    await dialog.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "Place Updated device", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Place New device", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", {
        name: "Place Reusable device",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(listRequests).toBe(3);
  } finally {
    service.close();
  }
});

test("historical invalid pin mappings remain inspectable without blocking valid library cards", async ({
  page,
  context,
}) => {
  const service = library();
  try {
    await service.connect(context, "alice");
    await openEditor(page);
    const healthy = {
      symbol: structuredClone(
        builtInSymbols.find((symbol) => symbol.id === "resistor")!,
      ),
    };
    healthy.symbol.name = "Healthy device";
    expect(
      await page.evaluate(
        async (definition) =>
          (
            await fetch("/api/components/healthy-device", {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ revision: 0, definition }),
            })
          ).status,
        healthy,
      ),
    ).toBe(200);
    const legacy = {
      ...newComponentDefinition(),
      subcircuit: {
        id: "legacy-interface",
        symbolId: "custom-component",
        target: "legacy",
        ports: [{ name: "IN", pinName: "IN", direction: "input" }],
      },
    };
    legacy.subcircuit.symbolId = legacy.symbol.id;
    legacy.symbol.name = "Legacy device";
    service.seedHistoricalDefinition("legacy-device", legacy);
    await openUserComponents(page);
    const dialog = page.getByRole("dialog", {
      name: "User Components",
      exact: true,
    });
    await expect(
      dialog.getByRole("button", { name: "Place Healthy device", exact: true }),
    ).toBeVisible();
    await expect(dialog.getByTestId("rejected-user-component")).toContainText(
      "Legacy device",
    );
    await expect(dialog.getByTestId("rejected-user-component")).toContainText(
      "Alice",
    );
    await expect(dialog.getByTestId("rejected-user-component")).toContainText(
      "missing OUT",
    );
    await expect(
      dialog.getByRole("button", { name: "Place Legacy device", exact: true }),
    ).toHaveCount(0);
    await dialog
      .getByRole("button", {
        name: "Copy raw record for Legacy device",
        exact: true,
      })
      .click();
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
      .getByRole("button", { name: "Place Healthy device", exact: true })
      .click();
    await place(page, 400, 300);
    await expect(page.getByTestId("active-instance-count")).toHaveText("1");
    await openUserComponents(page);
    await expect(dialog.getByTestId("rejected-user-component")).toContainText(
      "missing OUT",
    );
    await dialog
      .getByRole("textbox", { name: "Search User Defined components" })
      .fill("Legacy");
    await expect(
      dialog.getByRole("button", { name: "Place Healthy device", exact: true }),
    ).toHaveCount(0);
    await expect(dialog.getByTestId("rejected-user-component")).toBeVisible();
    await expect(
      dialog.getByText("No user components match this search.", {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "Try Again", exact: true }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        async (definition) =>
          (
            await fetch("/api/components/new-invalid-device", {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ revision: 0, definition }),
            })
          ).status,
        legacy,
      ),
    ).toBe(400);
  } finally {
    service.close();
  }
});

test("User Components recovers first-load failures and keeps cards when stale refresh fails", async ({
  page,
  context,
}) => {
  const service = library();
  try {
    await service.connect(context, "alice");
    await openEditor(page);
    const definition = { symbol: newComponentDefinition().symbol };
    definition.symbol.name = "Recoverable device";
    await page.evaluate(async (definition) => {
      const response = await fetch("/api/components/recoverable-device", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision: 0, definition }),
      });
      if (!response.ok) throw Error(await response.text());
    }, definition);
    let unavailable = true;
    await context.route("**/api/components?**", async (route) => {
      if (unavailable)
        await route.fulfill({
          status: 503,
          json: { error: "Service unavailable" },
        });
      else await route.fallback();
    });
    await openUserComponents(page);
    const dialog = page.getByRole("dialog", {
      name: "User Components",
      exact: true,
    });
    await expect(
      dialog.getByText("Couldn’t load user components.", { exact: true }),
    ).toBeVisible();
    unavailable = false;
    await dialog
      .getByRole("button", { name: "Try Again", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", {
        name: "Place Recoverable device",
        exact: true,
      }),
    ).toBeVisible();
    await page.clock.install();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.clock.fastForward(61_000);
    unavailable = true;
    await openUserComponents(page);
    await page.clock.runFor(100);
    await expect(
      dialog.getByText(
        "Couldn’t refresh components. Loaded components are still available.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", {
        name: "Place Recoverable device",
        exact: true,
      }),
    ).toBeVisible();
    unavailable = false;
    await dialog
      .getByRole("button", { name: "Try Again", exact: true })
      .click();
    await page.clock.runFor(100);
    await expect(
      dialog.getByRole("button", { name: "Try Again", exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByText("Loading components…", { exact: true }),
    ).toHaveCount(0);
  } finally {
    service.close();
  }
});

test("reopening deleted components after sign-out does not retain administrator results", async ({
  page,
  context,
}) => {
  const service = library();
  try {
    await service.connect(context, "admin");
    await openEditor(page);
    const definition = { symbol: newComponentDefinition().symbol };
    definition.symbol.name = "Deleted device";
    await page.evaluate(async (definition) => {
      const response = await fetch("/api/components/deleted-device", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision: 0, definition }),
      });
      if (!response.ok) throw Error(await response.text());
      const deleted = await fetch("/api/components/deleted-device", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision: 1, status: "deleted" }),
      });
      if (!deleted.ok) throw Error(await deleted.text());
    }, definition);
    await openUserComponents(page);
    const dialog = page.getByRole("dialog", {
      name: "User Components",
      exact: true,
    });
    await dialog
      .getByRole("button", { name: "Review deleted components", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Place Deleted device", exact: true }),
    ).toBeVisible();
    await page.clock.install();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.clock.fastForward(31_000);
    await service.connect(context, null);
    await openUserComponents(page);
    await page.clock.runFor(200);
    await expect(
      dialog.getByText("Couldn’t load user components.", { exact: true }),
    ).toBeVisible();
    await expect(dialog.locator(".user-component-tile")).toHaveCount(0);
    await expect(
      dialog.getByRole("button", {
        name: "Show available components",
        exact: true,
      }),
    ).toHaveCount(0);
  } finally {
    service.close();
  }
});

test("a failed next page retains cards and Try Again retries that page", async ({
  page,
  context,
}) => {
  const service = library();
  try {
    await service.connect(context, "alice");
    await openEditor(page);
    const definition = { symbol: newComponentDefinition().symbol };
    await page.evaluate(async (definition) => {
      for (let index = 0; index < 23; index += 1) {
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
    const legacy = {
      ...newComponentDefinition(),
      subcircuit: {
        id: "legacy-paged-interface",
        symbolId: "custom-component",
        target: "legacy",
        ports: [{ name: "IN", pinName: "IN", direction: "input" }],
      },
    };
    legacy.subcircuit.symbolId = legacy.symbol.id;
    legacy.symbol.name = "Legacy paged device";
    service.seedHistoricalDefinition("paged-device-23", legacy);
    let failNextPage = true;
    let failFirstPage = false;
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
    await openUserComponents(page);
    const dialog = page.getByRole("dialog", {
      name: "User Components",
      exact: true,
    });
    await expect(dialog.locator(".user-component-tile")).toHaveCount(20);
    await dialog
      .getByRole("button", { name: "Load More", exact: true })
      .click();
    await expect(
      dialog.getByText(
        "Couldn’t refresh components. Loaded components are still available.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(dialog.locator(".user-component-tile")).toHaveCount(20);
    failNextPage = false;
    await dialog
      .getByRole("button", { name: "Try Again", exact: true })
      .click();
    await expect(dialog.locator(".user-component-tile")).toHaveCount(24);
    await expect(dialog.locator(".user-component-place")).toHaveCount(23);
    const rejected = dialog.getByTestId("rejected-user-component");
    await expect(rejected).toContainText("Legacy paged device");
    await expect(rejected).toContainText("OUT");
    await expect(
      dialog.getByRole("button", { name: "Try Again", exact: true }),
    ).toHaveCount(0);
    expect(cursors).toEqual([null, "paged-device-19", "paged-device-19"]);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await openUserComponents(page);
    await expect(dialog.locator(".user-component-tile")).toHaveCount(24);
    await expect(rejected).toContainText("OUT");
    expect(cursors).toHaveLength(3);
    failFirstPage = true;
    await dialog.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(
      dialog.getByText(
        "Couldn’t refresh components. Loaded components are still available.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(dialog.locator(".user-component-tile")).toHaveCount(24);
    await expect(rejected).toContainText("OUT");
    expect(cursors).toEqual([null, "paged-device-19", "paged-device-19", null]);
  } finally {
    service.close();
  }
});

test("library preview fits actual off-viewBox artwork without changing the stored definition", async ({
  page,
  context,
}) => {
  const service = library();
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
  definition.symbol.primitives = [
    {
      kind: "polyline",
      points: [
        { x: 500, y: 200 },
        { x: 600, y: 200 },
        { x: 600, y: 280 },
        { x: 500, y: 280 },
        { x: 500, y: 200 },
      ],
    },
  ];
  service.seedHistoricalDefinition("offset-symbol", definition);
  try {
    await service.connect(context, null);
    await openEditor(page);
    await openUserComponents(page);
    const tile = page.getByRole("button", {
      name: "Place Offset symbol",
      exact: true,
    });
    await expect(tile).toBeVisible();
    const svg = tile.locator("svg");
    await expect(svg.locator("polyline")).toBeAttached();
    await expect
      .poll(async () =>
        svg.evaluate((element) => {
          const viewport = element.getBoundingClientRect();
          const ink = element
            .querySelector("polyline")!
            .getBoundingClientRect();
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
  } finally {
    service.close();
  }
});

test("library cards separate artwork, long titles and authors at narrow and zoomed sizes", async ({
  page,
  context,
}, testInfo) => {
  const service = library();
  const author = "AnalogCircuitResearchAndDeviceModelingGroup";
  const name =
    "Precision amplifier with configurable gain and output filtering";
  try {
    await service.connect(context, author);
    await openEditor(page);
    const tall = { symbol: newComponentDefinition().symbol };
    tall.symbol.id = "tall-library-artwork";
    tall.symbol.name = name;
    tall.symbol.viewBox = { x: -40, y: -150, width: 80, height: 300 };
    tall.symbol.primitives[0] = {
      kind: "polyline",
      points: [
        { x: -20, y: -120 },
        { x: 20, y: -120 },
        { x: 20, y: 120 },
        { x: -20, y: 120 },
        { x: -20, y: -120 },
      ],
    };
    const wide = structuredClone(tall);
    wide.symbol.id = "wide-library-artwork";
    wide.symbol.name = "Wide artwork";
    wide.symbol.viewBox = { x: -180, y: -30, width: 360, height: 60 };
    wide.symbol.primitives[0] = {
      kind: "polyline",
      points: [
        { x: -160, y: -20 },
        { x: 160, y: -20 },
        { x: 160, y: 20 },
        { x: -160, y: 20 },
        { x: -160, y: -20 },
      ],
    };
    const entries = [
      tall,
      wide,
      ...Array.from({ length: 22 }, (_, index) => ({
        symbol: {
          ...structuredClone(wide.symbol),
          id: `dense-card-${index}`,
          name: `Device ${index}`,
        },
      })),
    ];
    for (const definition of entries) {
      expect(
        await page.evaluate(
          async (definition) =>
            (
              await fetch(`/api/components/${definition.symbol.id}`, {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ revision: 0, definition }),
              })
            ).status,
          definition,
        ),
      ).toBe(200);
    }
    await openUserComponents(page);
    const dialog = page.getByRole("dialog", {
      name: "User Components",
      exact: true,
    });
    await expect(dialog.locator(".user-component-tile")).toHaveCount(20);
    await dialog
      .getByRole("button", { name: "Load More", exact: true })
      .click();
    await expect(dialog.locator(".user-component-tile")).toHaveCount(24);
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
    await expect(
      dialog.getByRole("button", { name: `Place ${name}`, exact: true }),
    ).toBeVisible();
    for (const [width, zoom] of [
      [1280, 1],
      [640, 1],
      [900, 1.25],
    ] as const) {
      await page.setViewportSize({ width, height: 800 });
      await page.evaluate((zoom) => {
        document.documentElement.style.zoom = String(zoom);
      }, zoom);
      await page.screenshot({
        path: testInfo.outputPath(`cards-${width}-${zoom}.png`),
      });
      const placeButton = dialog.getByRole("button", {
        name: `Place ${name}`,
        exact: true,
      });
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
      const editBounds = (await dialog
        .getByRole("button", { name: `Edit ${name} definition`, exact: true })
        .boundingBox())!;
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
      await expect(
        dialog.getByRole("button", { name: "Create Component…", exact: true }),
      ).toBeInViewport();
      await expect(
        dialog.getByRole("button", { name: "Close", exact: true }),
      ).toBeInViewport();
      expect(
        await dialog.evaluate((node) => node.scrollWidth - node.clientWidth),
      ).toBeLessThanOrEqual(1);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() => {
      document.documentElement.style.zoom = "1";
    });
    await dialog
      .getByLabel("Search User Defined components")
      .fill("Precision amplifier");
    await expect(dialog.locator(".user-component-tile")).toHaveCount(1);
    await dialog
      .getByRole("button", { name: `Place ${name}`, exact: true })
      .click();
    await place(page);
    const project = await readProject(page);
    expect(
      project.componentDefinitions!.some((d) => d.symbol.name === name),
    ).toBe(true);
    expect(project.documents[0]!.instances).toHaveLength(1);
  } finally {
    service.close();
  }
});

test("Create from keeps a new publication destination through draft reopening even for the original author", async ({
  page,
  context,
}) => {
  const service = library();
  try {
    await service.connect(context, "alice");
    await openEditor(page);
    const definition = {
      symbol: { ...newComponentDefinition().symbol, name: "Original device" },
    };
    await page.evaluate(async (definition) => {
      const response = await fetch("/api/components/original-device", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision: 0, definition }),
      });
      if (!response.ok) throw Error(await response.text());
    }, definition);
    await openUserComponents(page);
    await clickLibraryAction(page, "Create from Original device");
    const editor = page.getByRole("dialog", {
      name: "Edit Component Definition",
      exact: true,
    });
    await editor.getByLabel("Component definition code").fill(
      JSON.stringify({
        symbol: { ...definition.symbol, name: "Derivative device" },
      }),
    );
    await editor.getByRole("button", { name: "Apply", exact: true }).click();
    await editor.getByLabel("Close component editor").click();
    const saved = await readProject(page);
    await page.getByTestId("project-file").setInputFiles({
      name: "draft.icproj.json",
      mimeType: "application/json",
      buffer: Buffer.from(serializeProject(saved)),
    });
    await awaitEditorReady(page);
    await openUserComponents(page);
    await page.getByText("Project drafts (1)", { exact: true }).click();
    await page
      .getByRole("button", {
        name: "Library draft Original device",
        exact: true,
      })
      .click();
    await editor
      .getByRole("button", { name: "Publish as new component", exact: true })
      .click();
    await expect(editor.getByRole("status")).toContainText(
      "Published to the public library",
    );
    await expect(
      editor.getByRole("button", { name: "Update my component", exact: true }),
    ).toBeEnabled();
    const entries = await page.evaluate(
      async () => (await (await fetch("/api/components")).json()).entries,
    );
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
  } finally {
    service.close();
  }
});

test("publication conflicts retain update intent until explicit reload or create-copy after an account change", async ({
  page,
  context,
}) => {
  const service = library();
  try {
    await service.connect(context, "alice");
    await openEditor(page);
    const definition = { symbol: newComponentDefinition().symbol };
    async function publish(revision: number, name: string) {
      return page.evaluate(
        async ({ revision, definition, name }) => {
          const response = await fetch("/api/components/owned-device", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              revision,
              definition: {
                ...definition,
                symbol: { ...definition.symbol, name },
              },
            }),
          });
          return response.status;
        },
        { revision, definition, name },
      );
    }
    expect(await publish(0, "Owned device")).toBe(200);
    await openUserComponents(page);
    await clickLibraryAction(page, "Edit Owned device definition");
    const editor = page.getByRole("dialog", {
      name: "Edit Component Definition",
      exact: true,
    });
    await editor.getByLabel("Component definition code").fill(
      JSON.stringify({
        ...definition,
        symbol: { ...definition.symbol, name: "My pending edit" },
      }),
    );
    await editor.getByRole("button", { name: "Apply", exact: true }).click();
    expect(await publish(1, "Concurrent revision")).toBe(200);
    await editor
      .getByRole("button", { name: "Update my component", exact: true })
      .click();
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
    await editor
      .getByRole("button", { name: "Update my component", exact: true })
      .click();
    await expect(recovery).toBeVisible();
    await recovery
      .getByRole("button", { name: "Create separate copy" })
      .click();
    await editor
      .getByRole("button", { name: "Publish as new component", exact: true })
      .click();
    await expect(editor.getByRole("status")).toContainText(
      "Published to the public library",
    );
    const entries = await page.evaluate(
      async () => (await (await fetch("/api/components")).json()).entries,
    );
    expect(entries).toHaveLength(2);
    expect(
      entries.find((entry: { id: string }) => entry.id === "owned-device"),
    ).toMatchObject({ revision: 2, authorId: "alice" });
    expect(
      entries.find((entry: { id: string }) => entry.id !== "owned-device"),
    ).toMatchObject({ revision: 1, authorId: "bob" });
  } finally {
    service.close();
  }
});

for (const kind of ["native", "artwork"] as const)
  test(`new ${kind} publication survives a lost response, Project reopen and another edit without duplicating its public identity`, async ({
    page,
    context,
  }) => {
    const service = library();
    try {
      await service.connect(context, "alice");
      await openEditor(page);
      const editor = await openNativeComponent(page);
      if (kind === "native") {
        await editor
          .getByLabel("External model netlist")
          .fill(
            ".subckt retry_source IN OUT\nR1 IN OUT 1k\n.ends retry_source\n",
          );
        await editor
          .getByRole("button", { name: "Apply model", exact: true })
          .click();
      } else {
        await editor
          .getByLabel("Definition type", { exact: true })
          .selectOption("json");
        await editor.getByLabel("Component definition code").fill(
          JSON.stringify({
            symbol: {
              ...newComponentDefinition().symbol,
              name: "Retry artwork",
            },
          }),
        );
        await editor
          .getByRole("button", { name: "Apply", exact: true })
          .click();
      }
      service.dropNextPublicationResponse();
      await editor
        .getByRole("button", { name: "Publish", exact: true })
        .click();
      await expect(
        editor.getByText(
          "Publication outcome is unknown. Retry the same operation before editing again.",
          { exact: true },
        ),
      ).toBeVisible();
      if (kind === "artwork") {
        await editor
          .locator(".component-definition-actions > details > summary")
          .click();
        await editor
          .getByRole("button", { name: "Save draft", exact: true })
          .click();
      }
      await editor.getByLabel("Close component editor").click();
      const pending = await readProject(page);
      await page.getByTestId("project-file").setInputFiles({
        name: "pending.icproj.json",
        mimeType: "application/json",
        buffer: Buffer.from(serializeProject(pending)),
      });
      await awaitEditorReady(page);
      async function reopenPublication() {
        await openUserComponents(page);
        await page.getByText("Project drafts (1)", { exact: true }).click();
        await page.getByRole("button", { name: /^Library draft / }).click();
      }
      await reopenPublication();
      await editor
        .getByRole("button", { name: "Publish", exact: true })
        .click();
      await expect(
        editor.getByRole("button", {
          name: "Update my component",
          exact: true,
        }),
      ).toBeEnabled();
      await editor.getByLabel("Close component editor").click();
      await reopenPublication();
      await expect(
        editor.getByRole("button", {
          name: "Update my component",
          exact: true,
        }),
      ).toBeEnabled();
      const entries = await page.evaluate(
        async () => (await (await fetch("/api/components")).json()).entries,
      );
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ revision: 1, authorId: "alice" });
      if (kind === "native") {
        await editor
          .getByLabel("External model netlist")
          .fill(
            ".subckt retry_source IN OUT\nR1 IN OUT 2k\n.ends retry_source\n",
          );
        await editor
          .getByRole("button", { name: "Apply model", exact: true })
          .click();
      } else {
        await editor.getByLabel("Component definition code").fill(
          JSON.stringify({
            symbol: {
              ...newComponentDefinition().symbol,
              name: "Updated retry artwork",
            },
          }),
        );
        await editor
          .getByRole("button", { name: "Apply", exact: true })
          .click();
      }
      await editor
        .getByRole("button", { name: "Update my component", exact: true })
        .click();
      await expect(
        editor.getByText(/^(Saved|Published) to the public library\.$/),
      ).toBeVisible();
      const updated = await page.evaluate(
        async () => (await (await fetch("/api/components")).json()).entries,
      );
      expect(updated).toHaveLength(1);
      expect(updated[0]).toMatchObject({
        id: entries[0].id,
        revision: 2,
        authorId: "alice",
      });
      if (kind === "native") {
        await authoringView(editor, "Symbol");
        await editor.getByLabel("Symbol mode").selectOption("custom");
        await editor
          .getByLabel("Circuit symbol JSON")
          .fill("{ unfinished publication artwork");
        await authoringView(editor, "Circuit");
        await editor
          .getByLabel("External model netlist")
          .fill("* unfinished publication circuit\n");
        await editor.getByText("More", { exact: true }).click();
        await editor
          .getByRole("button", { name: "Save draft", exact: true })
          .click();
        await editor
          .getByRole("button", { name: "View applied version", exact: true })
          .click();
        await editor
          .getByRole("button", { name: "Update my component", exact: true })
          .click();
        await expect(
          editor.getByText("Saved to the public library.", { exact: true }),
        ).toBeVisible();
        await editor.getByLabel("Close component editor").click();
        await reopenPublication();
        await expect(editor.getByLabel("External model netlist")).toContainText(
          "unfinished publication circuit",
        );
        await authoringView(editor, "Symbol");
        await expect(editor.getByLabel("Circuit symbol JSON")).toHaveText(
          "{ unfinished publication artwork",
        );
      }
    } finally {
      service.close();
    }
  });

test("Circuit owns directions while invalid Custom JSON remains editable without changing specialized pin roles", async ({
  page,
  context,
}) => {
  const service = library();
  try {
    await service.connect(context, null);
    await openEditor(page);
    const editor = await openNativeComponent(page);
    await expect(editor.getByRole("tab")).toHaveText(["Circuit", "Symbol"]);
    await editor
      .getByLabel("External model netlist")
      .fill(".subckt simple IN OUT\nR1 IN OUT 1k\n.ends simple\n");
    await editor.getByLabel("Model IN direction").selectOption("input");
    await authoringView(editor, "Symbol");
    await expect(editor.getByLabel("Symbol mode")).toHaveValue("automatic");
    await editor.getByLabel("Symbol mode").selectOption("custom");
    const json = editor.getByLabel("Circuit symbol JSON");
    await json.focus();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+c");
    const custom = JSON.parse(
      await page.evaluate(() => navigator.clipboard.readText()),
    );
    custom.symbol.pins.find((pin: { name: string }) => pin.name === "IN").role =
      "gate";
    await json.fill("{ unfinished artwork");
    await authoringView(editor, "Circuit");
    await editor.getByLabel("Model OUT direction").selectOption("output");
    await expect(
      editor.getByText("Fix Symbol JSON to edit pin mapping.", { exact: true }),
    ).toBeVisible();
    await authoringView(editor, "Symbol");
    await expect(json).toHaveText("{ unfinished artwork");
    await json.fill(JSON.stringify(custom));
    await editor
      .getByRole("button", { name: "Apply model", exact: true })
      .click();
    await expect(editor.getByRole("status")).toContainText("Applied");
    await editor.getByLabel("Close component editor").click();
    const project = await readProject(page);
    expect(
      project.externalSubcircuitDefinitions[0]!.terminals.map((pin) => [
        pin.name,
        pin.direction,
      ]),
    ).toEqual([
      ["IN", "input"],
      ["OUT", "output"],
    ]);
    expect(
      project
        .componentDefinitions!.find((component) => component.circuitBinding)!
        .symbol.pins.find((pin) => pin.name === "IN")!.role,
    ).toBe("gate");
  } finally {
    service.close();
  }
});

test("GUI Apply synchronizes existing shared owners without consuming a sibling's invalid artwork draft", async ({
  page,
  context,
}) => {
  const service = library();
  try {
    await service.connect(context, null);
    await openEditor(page);
    const initial = createEmptyProject("shared-authors", "Shared authors");
    const applied = executeProjectTransaction(initial, {
      projectId: initial.id,
      expectedStructureRevision: 0,
      transactionId: "initial-owners",
      actor: { kind: "human", id: "test" },
      edits: [
        {
          kind: "apply_model_source",
          source: {
            id: "shared-source",
            revision: 0,
            language: "spice",
            entry: "model.spice",
            files: [
              {
                path: "model.spice",
                text: ".subckt shared_a A B\nR1 A B 1k\n.ends shared_a\n.subckt shared_b A B\nR2 A B 2k\n.ends shared_b\n",
              },
            ],
            dependencies: [],
          },
          definitions: [
            { definitionId: "shared-a", entry: "shared_a" },
            { definitionId: "shared-b", entry: "shared_b" },
          ],
        },
      ],
    });
    if (!applied.ok) throw Error(applied.error.message);
    const source = applied.project.modelSources![0]!;
    source.draft = {
      baseRevision: source.revision,
      language: source.language,
      entry: source.entry,
      files: structuredClone(source.files),
      dependencies: [],
      authoring: [
        {
          definitionId: "shared-a",
          entry: "shared_a",
          symbolMode: "automatic",
          artworkText: "",
          portMaps: {},
        },
        {
          definitionId: "shared-b",
          entry: "shared_b",
          symbolMode: "custom",
          artworkText: "{ unfinished sibling artwork",
          portMaps: { "shared-b": { A: "A" } },
        },
      ],
    };
    const sibling = structuredClone(source.draft.authoring![1]!);
    await page.getByTestId("project-file").setInputFiles({
      name: "shared.icproj.json",
      mimeType: "application/json",
      buffer: Buffer.from(serializeProject(applied.project)),
    });
    await awaitEditorReady(page);
    const editor = await openNativeComponent(page);
    await editor
      .getByLabel("External model source owner", { exact: true })
      .selectOption(source.id);
    await expect(
      editor.getByLabel("External model entry", { exact: true }),
    ).toHaveValue("shared_a");
    await editor
      .getByRole("button", { name: "Apply model", exact: true })
      .click();
    await expect(editor.getByRole("status")).toContainText("Applied");
    await editor.getByLabel("Close component editor").click();
    const after = await readProject(page);
    expect(after.modelSources![0]!.revision).toBe(2);
    expect(after.modelSources![0]!.draft).toMatchObject({
      baseRevision: 2,
      authoring: [sibling],
    });
    expect(after.externalSubcircuitDefinitions.map((d) => d.id)).toEqual([
      "shared-a",
      "shared-b",
    ]);
  } finally {
    service.close();
  }
});

test("public artwork drafts retain their library identity and applied candidate across portable reopening", async ({
  page,
  context,
}) => {
  const service = library();
  try {
    await service.connect(context, "alice");
    await openEditor(page);
    const definition = {
      symbol: {
        ...structuredClone(builtInSymbols.find((s) => s.id === "resistor")!),
        id: "public-artwork",
        name: "Public artwork baseline",
      },
    };
    const componentId = "public-artwork-draft";
    expect(
      await page.evaluate(
        async ({ componentId, definition }) =>
          (
            await fetch(`/api/components/${componentId}`, {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ revision: 0, definition }),
            })
          ).status,
        { componentId, definition },
      ),
    ).toBe(200);
    await openUserComponents(page);
    await clickLibraryAction(page, "Edit Public artwork baseline definition");
    const editor = page.getByRole("dialog", {
      name: "Edit Component Definition",
      exact: true,
    });
    const candidate = structuredClone(definition);
    candidate.symbol.name = "Public artwork candidate";
    await editor
      .getByLabel("Component definition code", { exact: true })
      .fill(JSON.stringify(candidate));
    await editor.locator("footer > details > summary:visible").click();
    await editor
      .getByRole("button", { name: "Save draft", exact: true })
      .click();
    await editor.getByLabel("Close component editor").click();
    await openUserComponents(page);
    await clickLibraryAction(page, "Edit Public artwork baseline definition");
    await expect(editor.getByLabel("Component definition code")).toContainText(
      candidate.symbol.name,
    );
    await expect(
      editor.getByRole("button", {
        name: /^(Publish|Update my component)$/,
        exact: true,
      }),
    ).toBeDisabled();
    await editor.getByRole("button", { name: "Apply", exact: true }).click();
    await editor.getByLabel("Close component editor").click();
    const saved = await readProject(page);
    expect(saved.componentDefinitions ?? []).toEqual([]);
    expect(saved.componentAuthoringDrafts![0]!.library).toEqual({
      componentId,
      revision: 1,
    });
    await page.getByTestId("project-file").setInputFiles({
      name: "public-artwork.icproj.json",
      mimeType: "application/json",
      buffer: Buffer.from(serializeProject(saved)),
    });
    const discard = page.getByRole("button", {
      name: "Continue without saving",
      exact: true,
    });
    if (await discard.isVisible()) await discard.click();
    await awaitEditorReady(page);
    await openUserComponents(page);
    await page.getByText("Project drafts (1)", { exact: true }).click();
    await page
      .getByRole("button", {
        name: "Library draft Public artwork baseline",
        exact: true,
      })
      .click();
    await expect(
      editor.getByRole("button", {
        name: /^(Publish|Update my component)$/,
        exact: true,
      }),
    ).toBeEnabled();
    await editor
      .getByRole("button", {
        name: /^(Publish|Update my component)$/,
        exact: true,
      })
      .click();
    await expect(
      editor.getByText("Published to the public library.", { exact: true }),
    ).toBeVisible();
    const entries = await page.evaluate(
      async () => (await (await fetch("/api/components")).json()).entries,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: componentId,
      revision: 2,
      definition: { symbol: { name: candidate.symbol.name } },
    });
  } finally {
    service.close();
  }
});

test("reopened artwork drafts require Apply before publishing and Place applies the displayed candidate", async ({
  page,
  context,
}) => {
  const service = library();
  try {
    await service.connect(context, "alice");
    await openEditor(page);
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
      {
        id: "X1",
        reference: "X1",
        symbolId: original.symbol.id,
        placement: {
          position: { x: 220, y: 200 },
          rotation: 0,
          mirror: "none",
        },
      },
    ];
    await page.getByTestId("project-file").setInputFiles({
      name: "artwork.icproj.json",
      mimeType: "application/json",
      buffer: Buffer.from(serializeProject(initial)),
    });
    await awaitEditorReady(page);
    await page.getByTestId("hit-X1").click();
    await page.keyboard.press("e");
    const editor = page.getByRole("dialog", {
      name: "Edit Component Definition",
      exact: true,
    });
    const candidate = structuredClone(original);
    candidate.symbol.name = "Saved artwork candidate";
    await editor
      .getByLabel("Component definition code", { exact: true })
      .fill(JSON.stringify(candidate));
    await editor.locator("footer > details > summary:visible").click();
    await editor
      .getByRole("button", { name: "Save draft", exact: true })
      .click();
    await editor.getByLabel("Close component editor").click();
    const saved = await readProject(page);
    expect(saved.componentDefinitions).toEqual([original]);
    await openUserComponents(page);
    await page.getByText("Project drafts (1)", { exact: true }).click();
    await page.getByRole("button", { name: /^Artwork draft / }).click();
    await expect(
      editor.getByRole("button", {
        name: /^(Publish|Update my component)$/,
        exact: true,
      }),
    ).toBeDisabled();
    await editor.getByRole("button", { name: "Place", exact: true }).click();
    await place(page, 420, 230);
    const applied = await readProject(page);
    expect(applied.documents[0]!.instances).toHaveLength(2);
    for (const instance of applied.documents[0]!.instances)
      expect(
        applied.componentDefinitions!.find(
          (d) => d.symbol.id === instance.symbolId,
        )!.symbol.name,
      ).toBe(candidate.symbol.name);
  } finally {
    service.close();
  }
});

test("public circuit authoring drafts survive closing and portable reopening without changing drawing captures", async ({
  page,
  context,
}) => {
  const service = library();
  try {
    await service.connect(context, "alice");
    await openEditor(page);
    const editor = await openNativeComponent(page);
    await editor.getByLabel("External model netlist").fill(finiteGainSource);
    await editor
      .getByLabel("External model entry", { exact: true })
      .selectOption("finite_gain");
    await editor
      .getByRole("button", { name: "Apply model", exact: true })
      .click();
    await editor
      .getByRole("button", {
        name: /^(Publish|Update my component)$/,
        exact: true,
      })
      .click();
    await expect(
      editor.getByText("Saved to the public library.", { exact: true }),
    ).toBeVisible();
    await editor.getByLabel("Close component editor").click();
    const before = await readProject(page);
    await openUserComponents(page);
    await clickLibraryAction(page, "Edit finite_gain definition");
    await editor
      .getByLabel("External model netlist")
      .fill(finiteGainSource.replace("gain=10", "gain=17"));
    await editor.getByRole("tab", { name: "Symbol", exact: true }).click();
    await editor
      .getByLabel("Symbol mode", { exact: true })
      .selectOption("custom");
    const broken = '{ "symbol": unfinished library JSON';
    await editor
      .getByLabel("Circuit symbol JSON", { exact: true })
      .fill(broken);
    await editor.locator(".external-model-more > summary").click();
    await editor
      .getByRole("button", { name: "Save draft", exact: true })
      .click();
    await editor.getByLabel("Close component editor").click();
    const saved = await readProject(page);
    expect(saved.documents).toEqual(before.documents);
    expect(saved.componentDefinitions).toEqual(before.componentDefinitions);
    expect(saved.modelSources).toEqual(before.modelSources);
    expect(saved.componentAuthoringDrafts).toHaveLength(1);
    await openUserComponents(page);
    await clickLibraryAction(page, "Edit finite_gain definition");
    await editor.getByRole("tab", { name: "Symbol", exact: true }).click();
    await expect(
      editor.getByLabel("Circuit symbol JSON", { exact: true }),
    ).toContainText(broken);
    await expect(
      editor.getByRole("button", {
        name: /^(Publish|Update my component)$/,
        exact: true,
      }),
    ).toBeDisabled();
    await editor.getByLabel("Close component editor").click();
    await page.getByTestId("project-file").setInputFiles({
      name: "library-draft.icproj.json",
      mimeType: "application/json",
      buffer: Buffer.from(serializeProject(saved)),
    });
    const discard = page.getByRole("button", {
      name: "Continue without saving",
      exact: true,
    });
    if (await discard.isVisible()) await discard.click();
    await awaitEditorReady(page);
    await openUserComponents(page);
    await page.getByText("Project drafts (1)", { exact: true }).click();
    await page
      .getByRole("button", { name: "Library draft finite_gain", exact: true })
      .click();
    await editor.getByRole("tab", { name: "Symbol", exact: true }).click();
    await expect(
      editor.getByLabel("Circuit symbol JSON", { exact: true }),
    ).toContainText(broken);
    await editor.getByRole("tab", { name: "Circuit", exact: true }).click();
    await expect(editor.getByLabel("External model netlist")).toContainText(
      "gain=17",
    );
  } finally {
    service.close();
  }
});

test("new circuit authoring starts with native source and places a complete six-terminal component without public saving", async ({
  page,
  context,
}) => {
  const service = library();
  try {
    await service.connect(context, null);
    await openEditor(page);
    await openUserComponents(page);
    await page
      .getByRole("button", { name: "Create Component…", exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "Edit Component Definition",
      exact: true,
    });
    await expect(editor.getByLabel("Definition type")).toHaveValue("circuit");
    await expect(editor.getByLabel("Legacy implementation repair")).toHaveCount(
      0,
    );
    await authoringView(editor, "Circuit");
    await editor
      .getByLabel("External model netlist")
      .fill(
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
    await editor
      .getByLabel("Symbol mode", { exact: true })
      .selectOption("custom");
    await authoringView(editor, "Mapping");
    await editor
      .getByLabel("Map native INP", { exact: true })
      .selectOption("pin:INN");
    await editor
      .getByLabel("Map native INN", { exact: true })
      .selectOption("pin:INP");
    await editor.getByRole("tab", { name: "Circuit", exact: true }).click();
    await expect(editor.getByLabel("External model netlist")).toContainText(
      ".subckt differential_gain",
    );
    await editor
      .getByRole("button", { name: "Apply model", exact: true })
      .click();
    await editor.getByRole("button", { name: "Place", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await place(page);
    for (const pin of ["INP", "INN", "REF", "OUT", "VDD", "VSS"]) {
      await page.getByTestId("terminal-X1-" + pin).click({ button: "right" });
      await openSelectionShelf(page);
      await page
        .getByRole("button", { name: "Mark No Connect", exact: true })
        .click();
      await page.keyboard.press("Escape");
    }
    const project = await readProject(page);
    expect(
      project.externalSubcircuitDefinitions[0]!.presentation?.minimumBodySize
        ?.width,
    ).toBe(140);
    const mappings =
      project.componentDefinitions![0]!.circuitBinding!.terminals;
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
  } finally {
    service.close();
  }
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
  await openEditor(page);
  await page.getByTestId("project-file").setInputFiles({
    name: "multiple-entries.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(prepared.project)),
  });
  const editor = await openNativeComponent(page);
  await authoringView(editor, "Circuit");
  await editor
    .getByLabel("External model source owner", { exact: true })
    .selectOption({ label: "model.spice" });
  await editor
    .getByLabel("External model entry", { exact: true })
    .selectOption("second");
  await editor
    .getByRole("button", { name: "Apply & Place", exact: true })
    .click();
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

test("legacy four-to-six repair uses the full native pin editor and preserves peers in one undo", async ({
  page,
  context,
}) => {
  const service = library();
  try {
    await service.connect(context, null);
    await openEditor(page);
    const legacy = newComponentDefinition();
    const initial = createEmptyProject("legacy-six", "Legacy six");
    initial.componentDefinitions = [legacy];
    for (const [index, id] of ["X1", "X2"].entries())
      initial.documents[0]!.instances.push({
        id,
        reference: id,
        symbolId: legacy.symbol.id,
        placement: {
          position: { x: 220 + index * 200, y: 200 },
          rotation: 0,
          mirror: "none",
        },
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
    await page.getByTestId("project-file").setInputFiles({
      name: "legacy.icproj.json",
      mimeType: "application/json",
      buffer: Buffer.from(serializeProject(model.project)),
    });
    await awaitEditorReady(page);
    await page.getByTestId("hit-X1").click();
    await page.keyboard.press("e");
    const editor = page.getByRole("dialog", {
      name: "Edit Component Definition",
      exact: true,
    });
    await authoringView(editor, "Circuit");
    await editor
      .getByLabel("External model source owner", { exact: true })
      .selectOption("six-source");
    await authoringView(editor, "Mapping");
    await expect(
      editor.getByLabel("Native pin mapping").locator("tbody tr"),
    ).toHaveCount(6);
    await editor
      .getByLabel("Map native INP", { exact: true })
      .selectOption("pin:IN");
    await editor.getByLabel("Add pin for INN", { exact: true }).click();
    await editor.getByLabel("Add pin for REF", { exact: true }).click();
    await editor
      .getByRole("button", { name: "Apply model", exact: true })
      .click();
    await expect(
      editor.getByText("Applied component repair", { exact: true }),
    ).toBeVisible();
    await editor.getByLabel("Close component editor", { exact: true }).click();
    const repaired = await readProject(page);
    expect(repaired.modelSources).toEqual(model.project.modelSources);
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
    await page.keyboard.press("ControlOrMeta+Shift+z");
    expect((await readProject(page)).documents[0]!.instances).toEqual(
      repaired.documents[0]!.instances,
    );
  } finally {
    service.close();
  }
});

test("a legacy repair draft reopens without upgrading the original class until Apply", async ({
  page,
  context,
}) => {
  const service = library();
  try {
    await service.connect(context, null);
    await openEditor(page);
    const legacy = newComponentDefinition();
    const initial = createEmptyProject("legacy-draft", "Legacy draft");
    initial.componentDefinitions = [legacy];
    initial.documents[0]!.instances.push({
      id: "X1",
      reference: "X1",
      symbolId: legacy.symbol.id,
      placement: { position: { x: 220, y: 200 }, rotation: 0, mirror: "none" },
      netlist: {
        parameters: {},
        binding: { kind: "unresolved-subcircuit", name: "custom_block" },
      },
    });
    await page.getByTestId("project-file").setInputFiles({
      name: "legacy.icproj.json",
      mimeType: "application/json",
      buffer: Buffer.from(serializeProject(initial)),
    });
    await awaitEditorReady(page);
    await page.getByTestId("hit-X1").click();
    await page.keyboard.press("e");
    const editor = page.getByRole("dialog", {
      name: "Edit Component Definition",
      exact: true,
    });
    await authoringView(editor, "Circuit");
    await editor
      .getByLabel("External model netlist", { exact: true })
      .fill(
        ".subckt custom_block VDD VSS IN OUT\nE1 OUT VSS IN VSS 10\n.ends custom_block\n",
      );
    await editor.getByRole("tab", { name: "Symbol", exact: true }).click();
    await authoringView(editor, "Symbol");
    const json = editor.getByRole("textbox", {
      name: "Circuit symbol JSON",
      exact: true,
    });
    await json.focus();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+c");
    const valid = await page.evaluate(() => navigator.clipboard.readText());
    await json.fill('{"symbol": unfinished');
    await editor.getByText("More", { exact: true }).click();
    await editor
      .getByRole("button", { name: "Save draft", exact: true })
      .click();
    await expect(
      editor.getByText("Saved repair draft. The captured class is unchanged.", {
        exact: true,
      }),
    ).toBeVisible();
    await editor.getByLabel("Close component editor").click();
    const saved = await readProject(page);
    expect(saved.documents[0]!.instances).toEqual(
      initial.documents[0]!.instances,
    );
    expect(saved.componentDefinitions).toEqual([legacy]);
    expect(saved.modelSources![0]!.revision).toBe(0);
    expect(saved.modelSources![0]!.draft!.authoring![0]!.artworkText).toBe(
      '{"symbol": unfinished',
    );
    await openUserComponents(page);
    await page.getByText(/Project drafts/).click();
    await page
      .getByRole("button", { name: "Circuit draft custom_block", exact: true })
      .click();
    await editor.getByRole("tab", { name: "Symbol", exact: true }).click();
    await expect(json).toContainText('{"symbol": unfinished');
    await json.fill(valid);
    await editor
      .getByRole("button", { name: "Apply model", exact: true })
      .click();
    await expect(
      editor.getByText("Applied component repair", { exact: true }),
    ).toBeVisible();
    await editor.getByLabel("Close component editor").click();
    const applied = await readProject(page);
    expect(applied.documents[0]!.instances[0]!.netlist!.binding!.kind).toBe(
      "external-subcircuit",
    );
    expect(applied.modelSources![0]!.draft).toBeUndefined();
  } finally {
    service.close();
  }
});

test("a complete native draft retains invalid JSON through portable save and reopens in the same authoring views", async ({
  page,
  context,
}) => {
  const service = library();
  try {
    await service.connect(context, null);
    await openEditor(page);
    await openUserComponents(page);
    await page
      .getByRole("button", { name: "Create Component…", exact: true })
      .click();
    let editor = page.getByRole("dialog", {
      name: "Edit Component Definition",
      exact: true,
    });
    await authoringView(editor, "Circuit");
    await editor
      .getByLabel("External model netlist")
      .fill(".subckt draft_gain A B\nR1 A B 1k\n.ends draft_gain\n");
    await editor.getByRole("tab", { name: "Symbol", exact: true }).click();
    await authoringView(editor, "Symbol");
    await editor
      .getByLabel("Symbol mode", { exact: true })
      .selectOption("custom");
    const artworkCode = editor.getByLabel("Circuit symbol JSON", {
      exact: true,
    });
    await artworkCode.focus();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+c");
    const validArtwork = JSON.parse(
      await page.evaluate(() => navigator.clipboard.readText()),
    );
    validArtwork.symbol.primitives.push({
      kind: "circle",
      center: { x: 0, y: 0 },
      radius: 6,
    });
    await artworkCode.fill(JSON.stringify(validArtwork));
    await expect(
      editor.getByLabel("Custom symbol preview").locator("circle"),
    ).toHaveCount(1);
    const broken = '{ "symbol": unfinished';
    await editor
      .getByLabel("Circuit symbol JSON", { exact: true })
      .fill(broken);
    await editor.locator(".external-model-more > summary").click();
    await editor
      .getByRole("button", { name: "Save draft", exact: true })
      .click();
    await editor.getByLabel("Close component editor", { exact: true }).click();
    const project = await readProject(page);
    expect(project.componentDefinitions ?? []).toEqual([]);
    expect(project.modelSources![0]!.revision).toBe(0);
    expect(project.modelSources![0]!.files[0]!.text).toBe("");
    expect(project.modelSources![0]!.draft!.authoring![0]!.artworkText).toBe(
      broken,
    );
    await page.getByTestId("project-file").setInputFiles({
      name: "draft.icproj.json",
      mimeType: "application/json",
      buffer: Buffer.from(serializeProject(project)),
    });
    const warning = page.getByRole("button", {
      name: "Continue without saving",
      exact: true,
    });
    if (await warning.isVisible()) await warning.click();
    await awaitEditorReady(page);
    await openUserComponents(page);
    await page.getByText("Project drafts (1)", { exact: true }).click();
    await page
      .getByRole("button", { name: "Circuit draft draft_gain", exact: true })
      .click();
    editor = page.getByRole("dialog", {
      name: "Edit Component Definition",
      exact: true,
    });
    await editor.getByRole("tab", { name: "Symbol", exact: true }).click();
    await expect(
      editor.getByLabel("Circuit symbol JSON", { exact: true }),
    ).toContainText(broken);
    await expect(
      editor.getByLabel("Custom symbol preview").locator("circle"),
    ).toHaveCount(1);
    await expect(
      editor.getByRole("button", {
        name: /^(Publish|Update my component)$/,
        exact: true,
      }),
    ).toBeDisabled();
    await editor.getByRole("tab", { name: "Circuit", exact: true }).click();
    await expect(editor.getByLabel("External model netlist")).toContainText(
      "R1 A B 1k",
    );
  } finally {
    service.close();
  }
});

test("native authoring retains freely edited artwork before a valid circuit and fits a narrow or zoomed workspace", async ({
  page,
  context,
}, testInfo) => {
  const service = library();
  try {
    await service.connect(context, null);
    await openEditor(page);
    const editor = await openNativeComponent(page);
    await authoringView(editor, "Symbol");
    await editor
      .getByLabel("Symbol mode", { exact: true })
      .selectOption("custom");
    const code = editor.getByLabel("Circuit symbol JSON", { exact: true });
    await code.focus();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+c");
    const starter = JSON.parse(
      await page.evaluate(() => navigator.clipboard.readText()),
    );
    expect(starter.symbol.primitives).toHaveLength(3);
    expect(starter.subcircuit).toBeUndefined();
    await authoringView(editor, "Circuit");
    await editor
      .getByLabel("External model netlist")
      .fill(".subckt unfinished");
    await authoringView(editor, "Symbol");
    await expect(code).toBeVisible();
    await expect(
      editor.getByRole("button", {
        name: /^(Publish|Update my component)$/,
        exact: true,
      }),
    ).toBeDisabled();
    for (const [width, zoom] of [
      [640, 1],
      [900, 1.25],
      [1280, 1],
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
      await expect(
        editor.getByRole("tab", { name: "Circuit", exact: true }),
      ).toBeVisible();
      await expect(editor.getByLabel("Close component editor")).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`authoring-${width}-${zoom}.png`),
      });
    }
  } finally {
    service.close();
  }
});

test("Create keeps custom artwork, preview and commit actions usable in a bounded workspace", async ({
  page,
  context,
}, testInfo) => {
  const service = library();
  try {
    await service.connect(context, null);
    await page.setViewportSize({ width: 1280, height: 800 });
    await openEditor(page);
    const editor = await openNativeComponent(page);
    await authoringView(editor, "Symbol");
    await editor
      .getByLabel("Symbol mode", { exact: true })
      .selectOption("custom");
    const code = editor.getByLabel("Circuit symbol JSON", { exact: true });
    const preview = editor.getByLabel("Custom symbol preview", { exact: true });
    await page.screenshot({ path: testInfo.outputPath("create-custom.png") });
    const codeBounds = (await editor
      .locator(".component-definition-code")
      .boundingBox())!;
    const previewBounds = (await preview.boundingBox())!;
    const applyBounds = (await editor
      .getByRole("button", { name: "Apply model", exact: true })
      .boundingBox())!;
    expect(codeBounds.height).toBeGreaterThan(250);
    expect(codeBounds.y + codeBounds.height).toBeLessThanOrEqual(applyBounds.y);
    expect(codeBounds.width).toBeGreaterThan(previewBounds.width);
    expect(codeBounds.x + codeBounds.width).toBeLessThanOrEqual(
      previewBounds.x,
    );
    await expect(
      editor.getByRole("button", { name: "Apply model", exact: true }),
    ).toBeInViewport();
    await code.fill("{ unfinished artwork");
    for (const [width, zoom] of [
      [640, 1],
      [900, 1.25],
    ] as const) {
      await page.setViewportSize({ width, height: 800 });
      await page.evaluate((zoom) => {
        document.documentElement.style.zoom = String(zoom);
      }, zoom);
      await expect(code).toBeInViewport();
      await expect(
        editor.getByRole("button", { name: "Apply model", exact: true }),
      ).toBeInViewport();
      await expect(
        editor.getByLabel("Close component editor"),
      ).toBeInViewport();
      await expect
        .poll(() =>
          editor.evaluate((dialog) => dialog.scrollWidth - dialog.clientWidth),
        )
        .toBeLessThanOrEqual(1);
      await authoringView(editor, "Mapping");
      await authoringView(editor, "Symbol");
      await expect(code).toHaveText("{ unfinished artwork");
      await page.screenshot({
        path: testInfo.outputPath(`create-${width}-${zoom}.png`),
      });
    }
  } finally {
    service.close();
  }
});

test("automatic layout only enables explicit offsets and distinguishes pending source from missing circuit", async ({
  page,
  context,
}) => {
  const service = library();
  try {
    await service.connect(context, null);
    await openEditor(page);
    const editor = await openNativeComponent(page);
    await expect(
      editor.getByRole("button", { name: "Apply & Place", exact: true }),
    ).toBeDisabled();
    await authoringView(editor, "Symbol");
    await expect(
      editor.getByText("Define the circuit interface to generate a symbol.", {
        exact: true,
      }),
    ).toBeVisible();
    await authoringView(editor, "Circuit");
    await editor
      .getByLabel("External model netlist")
      .fill(".subckt simple IN OUT\nR1 IN OUT 1k\n.ends simple\n");
    await expect(
      editor.getByText("Not applied", { exact: false }),
    ).toBeVisible();
    await expect(
      editor.getByText("0 call(s) share this model source.", { exact: true }),
    ).toHaveCount(0);
    await authoringView(editor, "Symbol");
    const offset = editor.getByLabel("Cell symbol IN pin offset", {
      exact: true,
    });
    await expect(offset).toBeDisabled();
    await editor
      .getByLabel("Cell symbol IN pin side", { exact: true })
      .selectOption("west");
    await expect(offset).toBeEnabled();
    await offset.fill("40");
    await offset.blur();
    await expect(offset).toHaveValue("40");
    await editor
      .getByRole("button", { name: "Apply & Place", exact: true })
      .click();
    await page.keyboard.press("Escape");
    const project = await readProject(page);
    expect(
      project.externalSubcircuitDefinitions[0]?.presentation?.pinPlacements,
    ).toEqual([expect.objectContaining({ side: "west", offset: 40 })]);
  } finally {
    service.close();
  }
});

test("native Circuit, automatic Symbol, Circuit interface and draft actions remain usable in narrow or zoomed Create", async ({
  page,
  context,
}, testInfo) => {
  const service = library();
  try {
    await service.connect(context, null);
    await openEditor(page);
    const editor = await openNativeComponent(page);
    await editor
      .getByLabel("External model netlist")
      .fill(
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
      await authoringView(editor, "Circuit");
      await expect(
        editor.getByLabel("External model netlist"),
      ).toBeInViewport();
      await expect(
        editor.getByLabel("Model format", { exact: true }),
      ).toBeInViewport();
      await page.screenshot({
        path: testInfo.outputPath(`circuit-${width}-${zoom}.png`),
      });
      await authoringView(editor, "Symbol");
      await editor
        .getByLabel("Symbol mode", { exact: true })
        .selectOption("automatic");
      await authoringView(editor, "Circuit");
      const direction = editor.getByLabel("Model INP direction", {
        exact: true,
      });
      await direction.selectOption("input");
      await expect(direction).toHaveValue("input");
      await authoringView(editor, "Symbol");
      const bodyWidth = editor.getByLabel("Cell symbol width", { exact: true });
      await bodyWidth.fill("140");
      await bodyWidth.blur();
      await expect(direction).toHaveValue("input");
      await expect(
        editor.getByLabel("Symbol preview", { exact: true }),
      ).toBeInViewport();
      await page.screenshot({
        path: testInfo.outputPath(`automatic-${width}-${zoom}.png`),
      });
      await authoringView(editor, "Mapping");
      await expect(
        editor.getByRole("button", { name: "Customize symbol", exact: true }),
      ).toBeVisible();
      await expect(
        editor.getByLabel("Model VSS direction", { exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`pins-${width}-${zoom}.png`),
      });
      await expect(
        editor.getByRole("button", { name: "Apply model", exact: true }),
      ).toBeInViewport();
      await expect(
        editor.getByRole("button", { name: "Apply & Place", exact: true }),
      ).toBeInViewport();
      await expect(
        editor.getByRole("button", {
          name: /^(Publish|Update my component)$/,
          exact: true,
        }),
      ).toBeDisabled();
      await editor.locator(".external-model-more > summary").click();
      await expect(
        editor.getByRole("button", { name: "Save draft", exact: true }),
      ).toBeInViewport();
      await page.screenshot({
        path: testInfo.outputPath(`more-${width}-${zoom}.png`),
      });
      await editor.locator(".external-model-more > summary").click();
      expect(
        await editor.evaluate((node) => node.scrollWidth - node.clientWidth),
      ).toBeLessThanOrEqual(1);
    }
    await authoringView(editor, "Symbol");
    await editor
      .getByLabel("Symbol mode", { exact: true })
      .selectOption("custom");
    await editor
      .getByLabel("Circuit symbol JSON", { exact: true })
      .fill("{ unfinished artwork");
    await editor.locator(".external-model-more > summary").click();
    await editor
      .getByRole("button", { name: "Save draft", exact: true })
      .click();
    await editor.getByLabel("Close component editor").click();
    await openUserComponents(page);
    await page.getByText("Project drafts (1)", { exact: true }).click();
    await page
      .getByRole("dialog", { name: "User Components", exact: true })
      .locator("footer details")
      .getByRole("button")
      .click();
    await authoringView(editor, "Symbol");
    await expect(
      editor.getByLabel("Circuit symbol JSON", { exact: true }),
    ).toHaveText("{ unfinished artwork");
    await expect(
      editor.getByRole("button", { name: "Apply model", exact: true }),
    ).toBeInViewport();
  } finally {
    service.close();
  }
});

test("advanced artwork can be applied and placed locally without publishing", async ({
  page,
  context,
}) => {
  const service = library();
  try {
    await service.connect(context, null);
    await openEditor(page);
    await openUserComponents(page);
    await page
      .getByRole("button", { name: "Create Component…", exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "Edit Component Definition",
      exact: true,
    });
    await editor.getByLabel("Definition type").selectOption("json");
    await editor.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(
      editor.getByRole("button", {
        name: /^(Publish|Update my component)$/,
        exact: true,
      }),
    ).toBeDisabled();
    await editor.getByRole("button", { name: "Place", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await place(page);
    const project = await readProject(page);
    expect(project.documents[0]!.instances).toHaveLength(1);
    expect(project.documents[0]!.instances[0]!.netlist?.binding?.kind).toBe(
      "unresolved-subcircuit",
    );
    await openUserComponents(page);
    await expect(
      page.getByRole("button", { name: "Place New component", exact: true }),
    ).toHaveCount(0);
  } finally {
    service.close();
  }
});

test("MCP publishes a native component, recovers requests and inserts a fixed library revision in another Editor", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const service = library();
  const visitor = await browser.newContext({ baseURL: baseURL! });
  async function paired(page: Page) {
    await page.getByTestId("open-agent").click();
    const panel = page.getByTestId("connect-agent-panel");
    const message = panel.getByTestId("agent-copy-text");
    await expect(message).toHaveValue(/Claim: /, { timeout: 45_000 });
    const client = new AgentSessionClient({
      http: new AgentHttpClient({ baseUrl: baseURL! }),
    });
    await client.connect(
      JSON.parse(/^Claim: (.+)$/mu.exec(await message.inputValue())![1]!)
        .claimCode,
    );
    await panel.getByRole("button", { name: "Close Agent dialog" }).click();
    return {
      client,
      tool: async (
        request: unknown,
        requestId: string = crypto.randomUUID(),
      ) => {
        const response = await callTool(
          "user_components",
          { request, requestId },
          { client },
        );
        return JSON.parse(response.content[0]!.text!);
      },
    };
  }
  try {
    await service.connect(context, "alice");
    await openEditor(page);
    const editor = await openNativeComponent(page);
    await authoringView(editor, "Circuit");
    await editor.getByLabel("External model netlist").fill(finiteGainSource);
    await authoringView(editor, "Circuit");
    await editor
      .getByLabel("External model entry", { exact: true })
      .selectOption("finite_gain");
    await editor
      .getByRole("button", { name: "Apply model", exact: true })
      .click();
    await editor.getByLabel("Close component editor", { exact: true }).click();
    const source = await readProject(page);
    const owner = source.externalSubcircuitDefinitions[0]!;
    const author = await paired(page);
    const publication = {
      action: "publish",
      componentId: "mcp-finite-gain",
      idempotencyKey: "publish-finite-gain",
      projectId: source.id,
      expectedStructureRevision: source.structureRevision,
      selection: {
        kind: "circuit",
        definitionId: owner.id,
        symbolId: owner.symbolId ?? externalSubcircuitSymbolId(owner.id),
        sourceRevision: source.modelSources![0]!.revision,
      },
    };
    const published = await author.tool(publication);
    expect(published, JSON.stringify(published)).toMatchObject({
      ok: true,
      result: {
        entry: {
          revision: 1,
          authorId: "alice",
          circuit: {
            source: {
              files: [{ path: "model.spice", text: finiteGainSource }],
            },
          },
        },
        digest: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(await author.tool(publication)).toMatchObject({
      ok: true,
      result: { entry: { revision: 1 } },
    });
    const browsed = await author.tool({ action: "browse" });
    expect(browsed).toMatchObject({
      ok: true,
      result: {
        entries: [
          expect.objectContaining({
            id: "mcp-finite-gain",
            capability: "circuit",
            pinCount: 3,
          }),
        ],
      },
    });
    expect(browsed.result.entries[0]).not.toHaveProperty("circuit");
    await service.connect(visitor, "bob");
    const receiver = await visitor.newPage();
    await openEditor(receiver);
    const destination = await readProject(receiver);
    const recipient = await paired(receiver);
    expect(
      await recipient.tool({ action: "read", componentId: "mcp-finite-gain" }),
    ).toMatchObject({ ok: true, result: { digest: published.result.digest } });
    const insertion = {
      action: "insert",
      componentId: "mcp-finite-gain",
      expectedLibraryRevision: 1,
      projectId: destination.id,
      targetDocumentId: destination.topDocumentId,
      expectedStructureRevision: destination.structureRevision,
      expectedRevision: destination.documents[0]!.revision,
      position: { x: 250, y: 180 },
    };
    const receipt = await recipient.tool(insertion, "insert-fixed-component");
    expect(receipt).toMatchObject({
      ok: true,
      result: { libraryRevision: 1, symbolId: "user-mcp-finite-gain-r1" },
    });
    expect(
      await recipient.tool(insertion, "insert-fixed-component"),
    ).toMatchObject({ ok: true, result: receipt.result });
    const captured = await readProject(receiver);
    expect(captured.documents[0]!.instances).toHaveLength(1);
    expect(captured.modelSources![0]!.files[0]!.text).toBe(finiteGainSource);
    expect(
      captured.componentDefinitions![0]!.circuitBinding!.terminals,
    ).toHaveLength(3);
    await receiver.getByRole("button", { name: "Undo", exact: true }).click();
    const undone = await readProject(receiver);
    expect(undone.documents[0]!.instances).toEqual([]);
    expect(undone.modelSources ?? []).toEqual([]);
    await receiver.getByRole("button", { name: "Redo", exact: true }).click();
    expect((await readProject(receiver)).componentDefinitions).toEqual(
      captured.componentDefinitions,
    );
    expect(
      await recipient.tool({
        ...publication,
        action: "update",
        expectedLibraryRevision: 1,
        idempotencyKey: "bob-update",
      }),
    ).toMatchObject({ ok: false });
    expect(
      await recipient.tool({
        action: "fork",
        componentId: "mcp-finite-gain",
        expectedLibraryRevision: 1,
        newComponentId: "bob-finite-gain",
        idempotencyKey: "bob-fork",
      }),
    ).toMatchObject({ ok: true, result: { entry: { authorId: "bob" } } });
    expect(
      await author.tool({
        ...publication,
        action: "update",
        expectedLibraryRevision: 1,
        idempotencyKey: "author-update",
      }),
    ).toMatchObject({ ok: true, result: { entry: { revision: 2 } } });
    const current = await readProject(receiver);
    expect(
      await recipient.tool({
        ...insertion,
        expectedStructureRevision: current.structureRevision,
        expectedRevision: current.documents[0]!.revision,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "COMPONENT_REVISION_CONFLICT" },
    });
    expect((await readProject(receiver)).modelSources).toEqual(
      captured.modelSources,
    );
  } finally {
    await visitor.close();
    service.close();
  }
});

test("publishes an applied native component and captures another user's complete revision on insertion", async ({
  page,
  context,
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(120_000);
  const service = library();
  const visitor = await browser.newContext({ baseURL: baseURL! });
  const administrator = await browser.newContext({ baseURL: baseURL! });
  const savedContext = await browser.newContext({ baseURL: baseURL! });
  const cloud = privateProjectService();
  try {
    await service.connect(context, "alice");
    await openEditor(page);
    const editor = await openNativeComponent(page);
    await authoringView(editor, "Circuit");
    await editor.getByLabel("External model netlist").fill(finiteGainSource);
    await authoringView(editor, "Circuit");
    await editor
      .getByLabel("External model entry", { exact: true })
      .selectOption("finite_gain");
    await authoringView(editor, "Symbol");
    await editor.getByLabel("Symbol mode").selectOption("custom");
    await editor
      .getByRole("button", { name: "Apply model", exact: true })
      .click();
    await expect(editor.getByRole("status")).toContainText("Applied");
    await expect(
      editor.getByRole("button", {
        name: /^(Publish|Update my component)$/,
        exact: true,
      }),
    ).toBeEnabled();
    await editor
      .getByRole("button", {
        name: /^(Publish|Update my component)$/,
        exact: true,
      })
      .click();
    await expect(
      editor.getByText("Saved to the public library.", { exact: true }),
    ).toBeVisible();
    const published = await page.evaluate(
      async () => (await (await fetch("/api/components")).json()).entries[0],
    );
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
    await cloud.connect(visitor);
    const insertedPage = await visitor.newPage();
    await openEditor(insertedPage);
    const beforePlacement = await readProject(insertedPage);
    await openUserComponents(insertedPage);
    await insertedPage
      .getByRole("button", { name: "Place finite_gain", exact: true })
      .click();
    await insertedPage.keyboard.press("Escape");
    const cancelled = await readProject(insertedPage);
    expect(cancelled.modelSources ?? []).toEqual(
      beforePlacement.modelSources ?? [],
    );
    expect(cancelled.externalSubcircuitDefinitions).toEqual(
      beforePlacement.externalSubcircuitDefinitions,
    );
    expect(cancelled.componentDefinitions).toEqual(
      beforePlacement.componentDefinitions,
    );
    await openUserComponents(insertedPage);
    await insertedPage
      .getByRole("button", { name: "Place finite_gain", exact: true })
      .click();
    await place(insertedPage, 400, 220);
    const inserted = await readProject(insertedPage);
    await insertedPage
      .getByRole("button", { name: "Undo", exact: true })
      .click();
    const undonePlacement = await readProject(insertedPage);
    expect(undonePlacement.modelSources ?? []).toEqual(
      beforePlacement.modelSources ?? [],
    );
    expect(undonePlacement.externalSubcircuitDefinitions).toEqual(
      beforePlacement.externalSubcircuitDefinitions,
    );
    await insertedPage
      .getByRole("button", { name: "Redo", exact: true })
      .click();
    expect(inserted.modelSources).toHaveLength(1);
    expect(inserted.modelSources![0]!.files[0]!.text).toBe(finiteGainSource);
    const owner = inserted.externalSubcircuitDefinitions[0]!;
    const instance = inserted.documents[0]!.instances[0]!;
    expect(instance.netlist?.binding).toEqual({
      kind: "external-subcircuit",
      definitionId: owner.id,
    });
    expect(
      inserted.componentDefinitions!.find(
        (item) => item.symbol.id === instance.symbolId,
      )!.circuitBinding!.definitionId,
    ).toBe(owner.id);
    await openUserComponents(insertedPage);
    await insertedPage
      .getByRole("button", { name: "Place finite_gain", exact: true })
      .click();
    await place(insertedPage, 650, 320);
    await expect(insertedPage.getByTestId("active-instance-count")).toHaveText(
      "2",
    );
    const repeated = await readProject(insertedPage);
    expect(repeated.modelSources).toEqual(inserted.modelSources);
    expect(repeated.externalSubcircuitDefinitions).toEqual(
      inserted.externalSubcircuitDefinitions,
    );
    expect(repeated.componentDefinitions).toEqual(
      inserted.componentDefinitions,
    );
    expect(
      repeated.documents[0]!.instances.map((item) => item.reference),
    ).toEqual(["X1", "X2"]);
    for (const [reference, gain] of [
      ["X1", "20"],
      ["X2", "30"],
    ]) {
      await insertedPage.getByTestId(`hit-${reference}`).click();
      if (
        !(await insertedPage
          .getByLabel("Editable Canvas property code")
          .isVisible())
      )
        await insertedPage.keyboard.press("q");
      await setComponentParameter(insertedPage, "gain", gain!);
      await insertedPage.keyboard.press("Escape");
    }
    await placeComponent(insertedPage, "voltage-source", { x: 140, y: 380 });
    await insertedPage.getByTestId("hit-V1").click();
    if (
      !(await insertedPage
        .getByLabel("Editable Canvas property code")
        .isVisible())
    )
      await insertedPage.keyboard.press("q");
    await setComponentParameter(insertedPage, "dc", "0.1");
    await setComponentParameter(insertedPage, "acMagnitude", "1");
    await insertedPage.keyboard.press("Escape");
    await placeComponent(insertedPage, "ground", { x: 440, y: 460 });
    for (const [from, to] of [
      ["V1-+", "X1-IN"],
      ["X1-OUT", "X2-IN"],
      ["X1-VSS", "X2-VSS"],
      ["X2-VSS", "GND1-0"],
      ["V1--", "GND1-0"],
    ]) {
      await clickDrawTool(insertedPage, "wire");
      await insertedPage.getByTestId(`terminal-${from}`).click();
      await insertedPage.getByTestId(`terminal-${to}`).click();
      await insertedPage.keyboard.press("Escape");
    }
    await insertedPage
      .getByTestId("terminal-X2-OUT")
      .click({ button: "right" });
    await openSelectionShelf(insertedPage);
    await insertedPage
      .getByRole("button", { name: "Mark No Connect", exact: true })
      .click();
    await insertedPage.keyboard.press("Escape");
    await insertedPage.keyboard.press("ControlOrMeta+z");
    await insertedPage.keyboard.press("ControlOrMeta+Shift+z");
    const copied = await copyNetlistText(insertedPage, "spice");
    expect(copied).toContain(finiteGainSource);
    expect(copied.match(/\.subckt finite_gain\b/gu)).toHaveLength(1);
    expect(copied.match(/\.subckt owned_helper\b/gu)).toHaveLength(1);
    expect(copied).toContain("gain=20");
    expect(copied).toContain("gain=30");
    const portable = await downloadBytes(
      insertedPage,
      "File",
      "Export Project File…",
    );
    const exported = parseSavedProject(portable.toString()) as CircuitProject;
    const design = createDesignNetlistExport(exported, { format: "spice" });
    expect(design.status).toBe("ready");
    if (design.status !== "ready")
      throw Error(JSON.stringify(design.diagnostics));
    expect(design.file.text).toBe(copied);
    await insertedPage.getByTestId("project-file").setInputFiles({
      name: "public-native.icproj.json",
      mimeType: "application/json",
      buffer: portable,
    });
    expect(await copyNetlistText(insertedPage, "spice")).toBe(copied);
    const reopened = await readProject(insertedPage);
    expect(electricalMeaning(reopened)).toEqual(electricalMeaning(exported));
    await expectNativePreparation(reopened, copied);
    await writeFile(
      testInfo.outputPath("public-native-capture.icproj.json"),
      serializeProject(reopened),
    );
    await clickCommand(insertedPage, "File", "Save");
    await expect(insertedPage.getByTestId("status")).toContainText(
      "Saved New Circuit to Cloud",
    );
    expect(parseSavedProject(cloud.stored()!.projectText).modelSources).toEqual(
      reopened.modelSources,
    );
    await service.connect(savedContext, "bob");
    await cloud.connect(savedContext);
    const savedPage = await savedContext.newPage();
    await savedPage.goto("/editor?project=cloud-native-capture");
    await awaitEditorReady(savedPage);
    expect(await copyNetlistText(savedPage, "spice")).toBe(copied);
    expect((await readProject(savedPage)).componentDefinitions).toEqual(
      reopened.componentDefinitions,
    );
    await editor
      .getByRole("button", { name: "Close component editor" })
      .click();
    const beforeLibraryEdit = await readProject(page);
    await openUserComponents(page);
    await clickLibraryAction(page, "Edit finite_gain definition");
    const libraryEditor = page.getByRole("dialog", {
      name: "Edit Component Definition",
      exact: true,
    });
    await expect(
      libraryEditor.getByLabel("External model netlist"),
    ).toBeVisible();
    await authoringView(libraryEditor, "Circuit");
    await libraryEditor
      .getByLabel("External model netlist")
      .fill(finiteGainSource.replace("gain=10", "gain=40"));
    await expect(
      libraryEditor.getByRole("button", {
        name: /^(Publish|Update my component)$/,
        exact: true,
      }),
    ).toBeDisabled();
    await libraryEditor
      .getByRole("button", { name: "Apply model", exact: true })
      .click();
    await libraryEditor
      .getByRole("button", {
        name: /^(Publish|Update my component)$/,
        exact: true,
      })
      .click();
    await expect(
      libraryEditor.getByText("Saved to the public library.", { exact: true }),
    ).toBeVisible();
    const updated = await page.evaluate(
      async () => (await (await fetch("/api/components")).json()).entries[0],
    );
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
    expect(await copyNetlistText(insertedPage, "spice")).toBe(copied);
    expect((await readProject(insertedPage)).modelSources).toEqual(
      inserted.modelSources,
    );
    const beforeConflictingInsert = await readProject(insertedPage);
    await openUserComponents(insertedPage);
    const currentLibrary = insertedPage.getByRole("dialog", {
      name: "User Components",
      exact: true,
    });
    const refreshed = insertedPage.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/components",
    );
    await currentLibrary
      .getByRole("button", { name: "Refresh", exact: true })
      .click();
    await refreshed;
    await expect(
      currentLibrary.getByText("Loading components…", { exact: true }),
    ).toHaveCount(0);
    await insertedPage
      .getByRole("button", { name: "Place finite_gain", exact: true })
      .click();
    await expect(insertedPage.getByTestId("status")).toContainText(
      "incompatible implementation or model dependencies",
    );
    expect(await readProject(insertedPage)).toEqual(beforeConflictingInsert);
    await insertedPage.getByTestId("hit-X1").click();
    await insertedPage.keyboard.press("ControlOrMeta+c");
    await insertedPage
      .getByRole("button", { name: "New project tab", exact: true })
      .click();
    for (const x of [250, 500]) {
      await insertedPage.keyboard.press("ControlOrMeta+v");
      await place(insertedPage, x, 260);
    }
    const fragment = await readProject(insertedPage);
    expect(fragment.documents[0]!.instances).toHaveLength(2);
    expect(fragment.documents[0]!.nets).toEqual([]);
    expect(fragment.documents[0]!.connectivityEvidence).toEqual([]);
    expect(
      fragment.documents[0]!.annotations.filter(
        (item) =>
          item.kind !== "instance-value" && item.kind !== "instance-label",
      ),
    ).toEqual([]);
    expect(fragment.modelSources).toHaveLength(1);
    expect(fragment.modelSources![0]!.files[0]!.text).toBe(finiteGainSource);
    expect(fragment.externalSubcircuitDefinitions).toHaveLength(1);
    await service.connect(administrator, "admin");
    const adminPage = await administrator.newPage();
    await openEditor(adminPage);
    await openUserComponents(adminPage);
    await clickLibraryAction(adminPage, "Manage finite_gain");
    await expect(
      adminPage.getByRole("button", {
        name: "Promote to official",
        exact: true,
      }),
    ).toBeVisible();
    await adminPage
      .getByRole("button", { name: "Promote to official", exact: true })
      .click();
    await expect(
      adminPage.getByText("Promoted to an official component.", {
        exact: true,
      }),
    ).toBeVisible();
    await adminPage
      .getByRole("button", { name: "Delete component", exact: true })
      .click();
    await adminPage
      .getByRole("button", { name: "Really delete", exact: true })
      .click();
    await expect(
      adminPage.getByText("Removed from the library.", { exact: true }),
    ).toBeVisible();
    await visitor.route("**/api/components**", (route) =>
      route.abort("internetdisconnected"),
    );
    expect((await readProject(insertedPage)).modelSources).toEqual(
      fragment.modelSources,
    );
    await insertedPage.reload();
    await awaitEditorReady(insertedPage);
    const offline = await readProject(insertedPage);
    expect(offline.modelSources).toEqual(fragment.modelSources);
    expect(offline.externalSubcircuitDefinitions).toEqual(
      fragment.externalSubcircuitDefinitions,
    );
    expect(offline.componentDefinitions).toEqual(fragment.componentDefinitions);
  } finally {
    await savedContext.close();
    await administrator.close();
    await visitor.close();
    service.close();
  }
});

async function openNativeComponent(page: Page) {
  await openUserComponents(page);
  await page
    .getByRole("button", { name: "Create Component…", exact: true })
    .click();
  const editor = page.getByRole("dialog", {
    name: "Edit Component Definition",
    exact: true,
  });
  await editor.getByLabel("Definition type").selectOption("circuit");
  return editor;
}

test("forking a native public record captures its selected artwork while reusing compatible applied resources", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  test.setTimeout(60_000);
  const service = library();
  const visitor = await browser.newContext({ baseURL: baseURL! });
  try {
    await service.connect(context, "alice");
    await openEditor(page);
    const editor = await openNativeComponent(page);
    await authoringView(editor, "Circuit");
    await editor.getByLabel("External model netlist").fill(finiteGainSource);
    await authoringView(editor, "Circuit");
    await editor
      .getByLabel("External model entry", { exact: true })
      .selectOption("finite_gain");
    await editor.getByText("More", { exact: true }).click();
    await editor
      .getByRole("button", { name: "Files and dependencies", exact: true })
      .click();
    const entryPath = await editor.getByLabel("Model entry file").inputValue();
    await editor.getByLabel("New model file path").fill("private.spice");
    await editor.getByRole("button", { name: "Add file", exact: true }).click();
    await authoringView(editor, "Circuit");
    await editor
      .getByLabel("External model netlist")
      .fill("* Unrelated private Project file\n");
    await editor
      .getByLabel("Model files")
      .getByRole("button", { name: `${entryPath} (entry)`, exact: true })
      .click();
    await editor
      .getByRole("button", { name: "Apply model", exact: true })
      .click();
    await editor
      .getByRole("button", {
        name: /^(Publish|Update my component)$/,
        exact: true,
      })
      .click();
    await expect(
      editor.getByText("Saved to the public library.", { exact: true }),
    ).toBeVisible();
    const original = await page.evaluate(
      async () => (await (await fetch("/api/components")).json()).entries[0],
    );
    expect(original.circuit.source.files).toEqual([
      { path: entryPath, text: finiteGainSource },
    ]);
    await editor
      .getByRole("button", { name: "Close component editor" })
      .click();
    expect((await readProject(page)).modelSources![0]!.files).toHaveLength(2);
    await service.connect(visitor, "bob");
    const receiver = await visitor.newPage();
    await openEditor(receiver);
    await openUserComponents(receiver);
    await receiver
      .getByRole("button", { name: "Place finite_gain", exact: true })
      .click();
    await place(receiver, 250, 240);
    const captured = await readProject(receiver);
    await openUserComponents(receiver);
    await clickLibraryAction(receiver, "Create from finite_gain");
    const forkEditor = receiver.getByRole("dialog", {
      name: "Edit Component Definition",
      exact: true,
    });
    await expect(
      forkEditor.getByRole("button", {
        name: "Publish as new component",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(
      forkEditor.getByRole("button", { name: "Delete component", exact: true }),
    ).toHaveCount(0);
    await forkEditor
      .getByRole("button", { name: "Publish as new component", exact: true })
      .click();
    await expect(
      forkEditor.getByText("Saved to the public library.", { exact: true }),
    ).toBeVisible();
    const forked = await receiver.evaluate(async () =>
      (await (await fetch("/api/components")).json()).entries.find(
        (entry: { authorId: string }) => entry.authorId === "bob",
      ),
    );
    expect(forked.id).not.toBe(original.id);
    expect(forked.revision).toBe(1);
    expect(forked.circuit.source.files).toEqual(original.circuit.source.files);
    await forkEditor
      .getByRole("button", { name: "Close component editor" })
      .click();
    const afterPublication = await readProject(receiver);
    expect(afterPublication).toEqual({
      ...captured,
      structureRevision: afterPublication.structureRevision,
      componentAuthoringDrafts: afterPublication.componentAuthoringDrafts,
    });
    expect(afterPublication.componentAuthoringDrafts).toHaveLength(1);
    const publicationDraft = afterPublication.componentAuthoringDrafts![0]!;
    expect(publicationDraft.library).toEqual({
      componentId: forked.id,
      revision: 1,
    });
    expect(JSON.parse(publicationDraft.text).publication).toEqual({
      kind: "update",
      componentId: forked.id,
    });
    await openUserComponents(receiver);
    await receiver
      .locator(".user-component-tile")
      .filter({ hasText: "bob" })
      .getByRole("button", { name: "Place finite_gain", exact: true })
      .click();
    await place(receiver, 500, 240);
    await expect(receiver.getByTestId("active-instance-count")).toHaveText("2");
    const inserted = await readProject(receiver);
    expect(inserted.modelSources).toEqual(captured.modelSources);
    expect(inserted.externalSubcircuitDefinitions).toHaveLength(1);
    expect(inserted.documents[0]!.instances[0]!.symbolId).toBe(
      original.definition.symbol.id,
    );
    expect(inserted.documents[0]!.instances[1]!.symbolId).toBe(
      forked.definition.symbol.id,
    );
    expect(inserted.componentDefinitions).toHaveLength(2);
    await receiver.getByTestId("hit-X1").click();
    await receiver.keyboard.press("e");
    const localEditor = receiver.getByRole("dialog", {
      name: "Edit Component Definition",
      exact: true,
    });
    await expect(
      localEditor.getByLabel("External model netlist"),
    ).toBeVisible();
    await authoringView(localEditor, "Circuit");
    await localEditor
      .getByLabel("External model netlist")
      .fill(finiteGainSource.replace("gain=10", "gain=25"));
    await localEditor.getByText("More", { exact: true }).click();
    await localEditor
      .getByRole("button", { name: "Save draft", exact: true })
      .click();
    await expect(
      localEditor.getByRole("button", {
        name: /^(Publish|Update my component)$/,
        exact: true,
      }),
    ).toBeDisabled();
    await localEditor
      .getByRole("button", { name: "Close component editor" })
      .click();
    const withDraft = await readProject(receiver);
    expect(withDraft.modelSources![0]!.draft!.files[0]!.text).toContain(
      "gain=25",
    );
    expect(withDraft.modelSources![0]!.files[0]!.text).toBe(finiteGainSource);
    await openUserComponents(receiver);
    await receiver
      .locator(".user-component-tile")
      .filter({ hasText: "bob" })
      .getByRole("button", { name: "Place finite_gain", exact: true })
      .click();
    await place(receiver, 650, 350);
    await expect(receiver.getByTestId("active-instance-count")).toHaveText("3");
    expect((await readProject(receiver)).modelSources).toEqual(
      withDraft.modelSources,
    );
    await openUserComponents(receiver);
    await clickLibraryAction(
      receiver.locator(".user-component-tile").filter({ hasText: "bob" }),
      "Edit finite_gain definition",
    );
    const draftEditor = receiver.getByRole("dialog", {
      name: "Edit Component Definition",
      exact: true,
    });
    await authoringView(draftEditor, "Circuit");
    await draftEditor
      .getByLabel("External model netlist")
      .fill(finiteGainSource.replace("gain=10", "gain=50"));
    await draftEditor.getByText("More", { exact: true }).click();
    await draftEditor
      .getByRole("button", { name: "Save draft", exact: true })
      .click();
    await expect(
      draftEditor.getByRole("button", {
        name: /^(Publish|Update my component)$/,
        exact: true,
      }),
    ).toBeDisabled();
    await draftEditor
      .getByRole("button", { name: "View applied version", exact: true })
      .click();
    await expect(
      draftEditor.getByRole("button", {
        name: /^(Publish|Update my component)$/,
        exact: true,
      }),
    ).toBeEnabled();
    await draftEditor
      .getByRole("button", { name: "Place", exact: true })
      .click();
    await place(receiver, 700, 450);
    await expect(receiver.getByTestId("active-instance-count")).toHaveText(
      "4",
      { timeout: 5000 },
    );
    expect((await readProject(receiver)).modelSources).toEqual(
      withDraft.modelSources,
    );
    const modifiedCapture = await readProject(receiver);
    modifiedCapture
      .componentDefinitions!.find(
        (definition) => definition.symbol.id === forked.definition.symbol.id,
      )!
      .symbol.primitives.push({
        kind: "circle",
        center: { x: 0, y: 0 },
        radius: 6,
      });
    await receiver.getByTestId("project-file").setInputFiles({
      name: "modified-capture.icproj.json",
      mimeType: "application/json",
      buffer: Buffer.from(serializeProject(modifiedCapture)),
    });
    await receiver
      .getByRole("button", { name: "Continue without saving", exact: true })
      .click();
    await expect(receiver.getByTestId("active-instance-count")).toHaveText("4");
    await awaitEditorReady(receiver);
    const beforeArtworkConflict = await readProject(receiver);
    await openUserComponents(receiver);
    await receiver
      .locator(".user-component-tile")
      .filter({ hasText: "bob" })
      .getByRole("button", { name: "Place finite_gain", exact: true })
      .click();
    await expect(receiver.getByTestId("status")).toContainText(
      "conflicting artwork or Pin mapping",
    );
    expect(await readProject(receiver)).toEqual(beforeArtworkConflict);
  } finally {
    await visitor.close();
    service.close();
  }
});

test("refuses conflicting native dependency identities before capturing another model owner", async ({
  page,
  context,
}) => {
  const service = library();
  try {
    await service.connect(context, "alice");
    await openEditor(page);
    for (const [name, dependencyId, digest, mountPath] of [
      ["alpha", "vendor", "a", "vendor.lib"],
      ["beta", "vendor", "b", "vendor.lib"],
      ["delta", "other-vendor", "a", "vendor.lib"],
      ["epsilon", "vendor", "a", "other-vendor.lib"],
      ["gamma", "vendor", "a", "vendor.lib"],
    ] as const) {
      const symbolId = `dependency-${name}-artwork`;
      const definitionId = `dependency-${name}-owner`;
      const sourceId = `dependency-${name}-source`;
      const entry = {
        definition: {
          symbol: {
            ...structuredClone(
              builtInSymbols.find((symbol) => symbol.id === "resistor")!,
            ),
            id: symbolId,
            name,
          },
          circuitBinding: {
            definitionId,
            terminals: [
              { terminalId: "port-p", pinName: "1" },
              { terminalId: "port-n", pinName: "2" },
            ],
          },
        },
        circuit: {
          version: 1,
          externalDefinition: {
            id: definitionId,
            name,
            symbolId,
            terminals: [
              { id: "port-p", name: "P", direction: "passive" },
              { id: "port-n", name: "N", direction: "passive" },
            ],
            formalParameters: [],
            interfaceStatus: "declared",
            implementation: { kind: "source", sourceId, entry: name },
          },
          source: {
            id: sourceId,
            language: "spice",
            entry: "model.spice",
            revision: 1,
            files: [
              {
                path: "model.spice",
                text: `.include ${mountPath}\n.subckt ${name} P N\nR1 P N 1k\n.ends ${name}\n`,
              },
            ],
            dependencies: [
              {
                id: dependencyId,
                mountPath,
                sha256: digest.repeat(64),
              },
            ],
          },
        },
      };
      const status = await page.evaluate(
        async ({ name, entry }) =>
          (
            await fetch(`/api/components/dependency-${name}-public`, {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ ...entry, revision: 0 }),
            })
          ).status,
        { name, entry },
      );
      expect(status).toBe(200);
    }
    await openUserComponents(page);
    await page
      .getByRole("button", { name: "Place alpha", exact: true })
      .click();
    await place(page, 300, 250);
    const captured = await readProject(page);
    for (const [name, dependencyId] of [
      ["beta", "vendor"],
      ["delta", "other-vendor"],
      ["epsilon", "vendor"],
    ]) {
      await openUserComponents(page);
      await page
        .getByRole("button", { name: `Place ${name}`, exact: true })
        .click();
      await expect(page.getByTestId("status")).toContainText(
        `Conflicting model dependency ${dependencyId}`,
      );
      expect(await readProject(page)).toEqual(captured);
    }
    await openUserComponents(page);
    await page
      .getByRole("button", { name: "Place gamma", exact: true })
      .click();
    await place(page, 550, 250);
    await expect(page.getByTestId("active-instance-count")).toHaveText("2");
    expect((await readProject(page)).modelSources).toHaveLength(2);
  } finally {
    service.close();
  }
});

async function prepareNativeProject(project: CircuitProject) {
  return prepareNgspiceExecutionInput(
    project,
    createSimulationFolder({
      id: "native-interface-check",
      name: "Native interface check",
      engine: "ngspice",
      profileId: profile.id,
      documentId: project.topDocumentId,
    }),
    {
      configured: true,
      inputs: ["source"],
      analyses: ["op"],
      parsedAnalyses: ["op"],
      profiles: [{ id: profile.id, corners: ["tt"] }],
      maxTimeoutMs: 120000,
      maxInputBytes: 1048576,
      cancel: true,
      rawfileCollection: "declared-single-ascii",
    },
  );
}
async function expectNativePreparation(
  project: CircuitProject,
  copied: string,
) {
  const prepared = await prepareNativeProject(project);
  expect(prepared.ok, JSON.stringify(prepared)).toBe(true);
  if (!prepared.ok) throw Error("Native preparation refused");
  const circuit = prepared.input.files.find(
    (file) => file.path === "circuit.spice",
  )!.text;
  const owner = project.modelSources![0]!;
  expect(copied).toContain(owner.files[0]!.text);
  expect(circuit).toContain(owner.files[0]!.text);
  expect(circuit.split("\n").find((line) => /^X1\s/u.test(line))).toBe(
    // Design output exposes its ground as VSS; the execution root binds it to 0.
    copied
      .split("\n")
      .find((line) => /^X1\s/u.test(line))!
      .replace(/\bVSS\b/gu, "0"),
  );
  expect(
    prepared.sourceMaps.some((map) =>
      map.segments.some(
        (segment) =>
          segment.origin.kind === "model-source" &&
          segment.origin.sourceId === owner.id &&
          segment.origin.revision === owner.revision,
      ),
    ),
  ).toBe(true);
}

test("repairs a wired legacy custom component with explicit native port mapping in one undo", async ({
  page,
  context,
  baseURL,
  browser,
}) => {
  test.setTimeout(120_000);
  const service = library();
  const cloud = privateProjectService();
  const savedContext = await browser.newContext();
  try {
    await service.connect(context, "alice");
    await cloud.connect(context);
    await openEditor(page);
    const symbol = structuredClone(
      builtInSymbols.find((item) => item.id === "resistor")!,
    );
    symbol.id = "legacy-repair-artwork";
    symbol.name = "Legacy gain";
    symbol.pins[0]!.name = "sense";
    symbol.pins[1]!.name = "drive";
    symbol.variants = [
      { id: "base", hiddenPinNames: [] },
      {
        id: "alternate",
        hiddenPinNames: [],
        additionalPrimitives: [
          { kind: "circle", center: { x: 0, y: 0 }, radius: 10 },
        ],
      },
    ];
    symbol.defaultVariantId = "base";
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
    expect(
      await page.evaluate(
        async (definition) =>
          (
            await fetch("/api/components/legacy-repair", {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ definition, revision: 0 }),
            })
          ).status,
        definition,
      ),
    ).toBe(200);
    await openUserComponents(page);
    await page
      .getByRole("button", { name: "Place Legacy gain", exact: true })
      .click();
    await place(page, 400, 230);
    const label = await page
      .getByTestId("annotation-hit-instance-label-X1")
      .boundingBox();
    if (!label) throw Error("Missing occurrence label");
    await page.mouse.move(
      label.x + label.width / 2,
      label.y + label.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(label.x + 100, label.y + 70, { steps: 5 });
    await page.mouse.up();
    await placeComponent(page, "voltage-source", { x: 140, y: 380 });
    await placeComponent(page, "ground", { x: 440, y: 460 });
    for (const [from, to] of [
      ["V1-+", "X1-sense"],
      ["V1--", "GND1-0"],
    ]) {
      await clickDrawTool(page, "wire");
      await page.getByTestId(`terminal-${from}`).click();
      await page.getByTestId(`terminal-${to}`).click();
      await page.keyboard.press("Escape");
    }
    await page.getByTestId("terminal-X1-drive").click({ button: "right" });
    await openSelectionShelf(page);
    await page
      .getByRole("button", { name: "Mark No Connect", exact: true })
      .click();
    await page.keyboard.press("Escape");
    let before = await readProject(page);
    expect(createDesignNetlistExport(before, { format: "spice" }).status).toBe(
      "blocked",
    );
    await page.getByTestId("open-agent").click();
    const panel = page.getByTestId("connect-agent-panel");
    const claim = panel.getByTestId("agent-copy-text");
    await expect(claim).toHaveValue(/Claim: /, { timeout: 45_000 });
    const client = new AgentSessionClient({
      http: new AgentHttpClient({ baseUrl: baseURL! }),
    });
    await client.connect(
      JSON.parse(/^Claim: (.+)$/mu.exec(await claim.inputValue())![1]!)
        .claimCode,
    );
    await panel.getByRole("button", { name: "Close Agent dialog" }).click();
    const selectedVariant = await client.advancedTransact([
      {
        kind: "set_instance_symbol",
        instanceId: before.documents[0]!.instances[0]!.id,
        symbolId: before.documents[0]!.instances[0]!.symbolId,
        symbolVariantId: "alternate",
      },
    ]);
    expect(selectedVariant.ok, selectedVariant.message).toBe(true);
    const original = (await client.refreshSnapshot()).snapshot.project;
    expect(
      (await readProject(page)).documents[0]!.instances[0]!.symbolVariantId,
    ).toBe("alternate");
    await page.getByTestId("hit-X1").click();
    await page.keyboard.press("e");
    const dialog = page.getByRole("dialog", {
      name: "Edit Component Definition",
      exact: true,
    });
    await authoringView(dialog, "Circuit");
    await expect(
      dialog.getByRole("button", { name: "Place", exact: true }),
    ).toHaveCount(0);
    await dialog
      .getByLabel("External model netlist", { exact: true })
      .fill(".subckt incomplete IN OUT VSS\n");
    await expect(
      dialog.getByRole("button", { name: "Apply model", exact: true }),
    ).toBeDisabled();
    await expect(
      dialog.getByText("Missing .ends for incomplete", { exact: true }).first(),
    ).toBeVisible();
    expect((await client.refreshSnapshot()).snapshot.project).toEqual(original);
    await dialog
      .getByRole("textbox", { name: "External model netlist", exact: true })
      .fill(finiteGainSource);
    await dialog
      .getByLabel("External model entry", { exact: true })
      .selectOption("finite_gain");
    await expect(
      dialog.getByRole("button", { name: "Apply model", exact: true }),
    ).toBeDisabled();
    await expect(
      dialog
        .getByText(/Unknown native terminal; repair the Pin mapping/)
        .first(),
    ).toBeVisible();
    expect((await client.refreshSnapshot()).snapshot.project).toEqual(original);
    for (const [old, next] of [
      ["A", "IN"],
      ["B", "OUT"],
      ["GND", "VSS"],
    ])
      await dialog
        .getByLabel(`Migrate legacy_gain.${old}`, { exact: true })
        .selectOption(next!);
    const changed = await client.applyActions([
      {
        kind: "set-property",
        target: { kind: "instance", reference: "V1" },
        set: { dc: "0.2" },
      },
    ]);
    expect(changed.ok, changed.message).toBe(true);
    const live = (await client.refreshSnapshot()).snapshot.project;
    await dialog
      .getByRole("button", { name: "Apply model", exact: true })
      .click();
    await expect(dialog.locator(".cell-external-result")).toContainText(
      "Project changed",
    );
    expect((await client.refreshSnapshot()).snapshot.project).toEqual(live);
    await dialog.getByLabel("Close component editor", { exact: true }).click();
    await dialog
      .getByRole("button", { name: "Discard changes", exact: true })
      .click();
    before = await readProject(page);
    await page.getByTestId("hit-X1").click();
    await page.keyboard.press("e");
    await authoringView(dialog, "Circuit");
    await dialog
      .getByLabel("External model netlist", { exact: true })
      .fill(finiteGainSource);
    await dialog
      .getByLabel("External model entry", { exact: true })
      .selectOption("finite_gain");
    for (const [old, next] of [
      ["A", "IN"],
      ["B", "OUT"],
      ["GND", "VSS"],
    ])
      await dialog
        .getByLabel(`Migrate legacy_gain.${old}`, { exact: true })
        .selectOption(next!);
    await dialog
      .getByRole("button", { name: "Apply model", exact: true })
      .click();
    await expect(dialog.locator(".cell-external-result")).toContainText(
      "Applied",
    );
    await dialog
      .getByRole("button", { name: "Close component editor", exact: true })
      .click();
    const repaired = await readProject(page);
    expect(repaired.documents[0]!.instances[0]!.symbolVariantId).toBe(
      "alternate",
    );
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
    await openCellManager(page);
    const manager = page.getByRole("dialog", {
      name: "Cell Manager",
      exact: true,
    });
    await manager
      .getByRole("tab", { name: "External Circuits", exact: true })
      .click();
    await manager
      .locator(".cell-manager-list-item")
      .filter({ hasText: "finite_gain" })
      .click();
    await manager.getByLabel("External model netlist", { exact: true }).focus();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+c");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      finiteGainSource,
    );
    await manager.getByLabel("Close Cell Manager", { exact: true }).click();
    const deck = await copyNetlistText(page, "spice");
    expect(deck).toContain(finiteGainSource);
    await expectNativePreparation(repaired, deck);
    await page.keyboard.press("ControlOrMeta+z");
    const undone = await readProject(page);
    expect(undone.componentDefinitions).toEqual(before.componentDefinitions);
    expect(undone.documents[0]!.instances).toEqual(
      before.documents[0]!.instances,
    );
    expect(undone.modelSources ?? []).toEqual([]);
    const oldPortable = await downloadBytes(
      page,
      "File",
      "Export Project File…",
    );
    expect(
      parseSavedProject(oldPortable.toString()).componentDefinitions,
    ).toEqual(before.componentDefinitions);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    expect(await copyNetlistText(page, "spice")).toBe(deck);
    await page.getByTestId("hit-X1").click();
    await page.keyboard.press("e");
    const updatedSource = finiteGainSource.replace("gain=10", "gain=12");
    await dialog
      .getByLabel("External model netlist", { exact: true })
      .fill(updatedSource);
    await dialog
      .getByRole("button", { name: "Apply model", exact: true })
      .click();
    await expect(dialog.locator(".cell-external-result")).toContainText(
      "Applied",
    );
    await dialog.getByLabel("Close component editor", { exact: true }).click();
    const reapplied = await readProject(page);
    expect(reapplied.documents[0]!.instances[0]!.symbolVariantId).toBe(
      "alternate",
    );
    expect(reapplied.documents[0]!.routes).toEqual(
      repaired.documents[0]!.routes,
    );
    expect(reapplied.documents[0]!.nets).toEqual(repaired.documents[0]!.nets);
    expect(reapplied.documents[0]!.noConnects).toEqual(
      repaired.documents[0]!.noConnects,
    );
    const updatedDeck = await copyNetlistText(page, "spice");
    expect(updatedDeck).toContain(updatedSource);
    await expectNativePreparation(reapplied, updatedDeck);
    await page.keyboard.press("ControlOrMeta+z");
    expect(await copyNetlistText(page, "spice")).toBe(deck);
    expect(
      (await readProject(page)).documents[0]!.instances[0]!.symbolVariantId,
    ).toBe("alternate");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    expect(await copyNetlistText(page, "spice")).toBe(updatedDeck);
    const portable = await downloadBytes(page, "File", "Export Project File…");
    await page.getByTestId("project-file").setInputFiles({
      name: "repaired-legacy.icproj.json",
      mimeType: "application/json",
      buffer: portable,
    });
    expect(await copyNetlistText(page, "spice")).toBe(updatedDeck);
    await clickCommand(page, "File", "Save");
    await expect(page.getByTestId("status")).toContainText(
      "Saved New Circuit to Cloud",
    );
    await service.connect(savedContext, "alice");
    await cloud.connect(savedContext);
    const savedPage = await savedContext.newPage();
    await savedPage.goto("/editor?project=cloud-native-capture");
    await awaitEditorReady(savedPage);
    expect(await copyNetlistText(savedPage, "spice")).toBe(updatedDeck);
    expect((await readProject(savedPage)).modelSources).toEqual(
      reapplied.modelSources,
    );
    expect(
      (await readProject(savedPage)).documents[0]!.instances[0]!
        .symbolVariantId,
    ).toBe("alternate");
  } finally {
    await savedContext.close();
    service.close();
  }
});

test("explicitly attaches a legacy class to an existing applied Project model without changing its draft or peers", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  const service = library();
  try {
    await service.connect(context, "alice");
    await openEditor(page);
    const native = await openNativeComponent(page);
    await native.getByLabel("External model netlist").fill(finiteGainSource);
    await native
      .getByLabel("External model entry", { exact: true })
      .selectOption("finite_gain");
    await native
      .getByRole("button", { name: "Apply & Place", exact: true })
      .click();
    await place(page, 650, 230);
    await page.getByTestId("hit-X1").click();
    await page.keyboard.press("e");
    const editor = page.getByRole("dialog", {
      name: "Edit Component Definition",
      exact: true,
    });
    await authoringView(editor, "Circuit");
    await editor
      .getByLabel("External model netlist")
      .fill(finiteGainSource.replace("gain=10", "gain=25"));
    await editor.getByText("More", { exact: true }).click();
    await editor
      .getByRole("button", { name: "Save draft", exact: true })
      .click();
    await editor.getByLabel("Close component editor", { exact: true }).click();
    const symbol = {
      ...structuredClone(
        builtInSymbols.find((item) => item.id === "resistor")!,
      ),
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
    expect(
      await page.evaluate(
        async (definition) =>
          (
            await fetch("/api/components/legacy-attach", {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ definition, revision: 0 }),
            })
          ).status,
        definition,
      ),
    ).toBe(200);
    for (const x of [350, 500]) {
      await openUserComponents(page);
      if (x === 350) {
        await page
          .getByRole("button", { name: "Refresh", exact: true })
          .click();
      }
      await page
        .getByRole("button", { name: "Place Legacy attach", exact: true })
        .click();
      await place(page, x, 360);
    }
    await placeComponent(page, "ground", { x: 200, y: 460 });
    for (const [reference, pins] of [
      ["X1", ["IN", "OUT", "VSS"]],
      ["X2", ["1", "2"]],
      ["X3", ["1", "2"]],
    ] as const) {
      const labels = page.getByTestId(
        `annotation-hit-instance-label-${reference}`,
      );
      if (await labels.count()) {
        const label = await labels.boundingBox();
        if (!label) throw Error("Missing occurrence label");
        await page.mouse.move(
          label.x + label.width / 2,
          label.y + label.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(label.x + 100, label.y + 70, { steps: 5 });
        await page.mouse.up();
      }
      for (const pin of pins) {
        await page
          .getByTestId(`terminal-${reference}-${pin}`)
          .click({ button: "right" });
        await openSelectionShelf(page);
        await page
          .getByRole("button", { name: "Mark No Connect", exact: true })
          .click();
        await page.keyboard.press("Escape");
      }
    }
    const captured = await readProject(page);
    expect(captured.documents[0]!.instances[1]!.netlist?.binding?.kind).toBe(
      "unresolved-subcircuit",
    );
    expect(
      createDesignNetlistExport(captured, { format: "spice" }).status,
    ).toBe("blocked");
    const blocked = await prepareNativeProject(captured);
    expect(blocked.ok, JSON.stringify(blocked)).toBe(false);
    expect(JSON.stringify(blocked)).toContain("MODEL_IMPLEMENTATION_MISSING");
    const implicit = structuredClone(captured);
    const legacyId = implicit.documents[0]!.instances[1]!.symbolId;
    const shadow = implicit.componentDefinitions!.find(
      (component) => component.symbol.id === legacyId,
    )!;
    shadow.symbol.id = "comparator";
    shadow.subcircuit!.symbolId = "comparator";
    for (const instance of implicit.documents[0]!.instances.slice(1, 3)) {
      instance.symbolId = "comparator";
      delete instance.netlist!.binding;
    }
    implicit.documents[0]!.instances[2]!.symbolVariantId = "alternate";
    await page.getByTestId("project-file").setInputFiles({
      name: "implicit-legacy.icproj.json",
      mimeType: "application/json",
      buffer: Buffer.from(serializeProject(implicit)),
    });
    await page
      .getByRole("button", { name: "Continue without saving", exact: true })
      .click();
    await awaitEditorReady(page);
    const before = await readProject(page);
    expect(before.documents[0]!.instances[1]!.netlist?.binding).toBeUndefined();
    expect(createDesignNetlistExport(before, { format: "spice" }).status).toBe(
      "blocked",
    );
    const implicitBlocked = await prepareNativeProject(before);
    expect(implicitBlocked.ok, JSON.stringify(implicitBlocked)).toBe(false);
    expect(JSON.stringify(implicitBlocked)).toContain(
      "MODEL_IMPLEMENTATION_MISSING",
    );
    await page.getByTestId("hit-X2").click();
    await page.keyboard.press("e");
    await authoringView(editor, "Circuit");
    await editor
      .getByLabel("External model source owner", { exact: true })
      .selectOption(before.modelSources![0]!.id);
    await authoringView(editor, "Mapping");
    await editor
      .getByLabel("Map native IN", { exact: true })
      .selectOption("pin:1");
    await editor
      .getByLabel("Map native OUT", { exact: true })
      .selectOption("pin:2");
    await editor
      .getByLabel("Map native VSS", { exact: true })
      .selectOption("supply:VSS");
    await editor
      .getByRole("button", { name: "Apply model", exact: true })
      .click();
    await expect(editor.getByRole("status")).toContainText("Applied");
    await editor.getByLabel("Close component editor", { exact: true }).click();
    const repaired = await readProject(page);
    expect(repaired.modelSources).toEqual(before.modelSources);
    expect(repaired.externalSubcircuitDefinitions).toHaveLength(1);
    expect(
      repaired.documents[0]!.instances.slice(1, 3).map(
        (i) => i.symbolVariantId,
      ),
    ).toEqual(["base", "alternate"]);
    expect(repaired.documents[0]!.instances[0]).toEqual(
      before.documents[0]!.instances[0],
    );
    expect(
      repaired.documents[0]!.instances.slice(1, 3).map(
        (i) => i.netlist?.binding,
      ),
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
    for (const [reference, gain] of [
      ["X2", "20"],
      ["X3", "30"],
    ]) {
      await page.getByTestId(`hit-${reference}`).click();
      if (!(await page.getByLabel("Editable Canvas property code").isVisible()))
        await page.keyboard.press("q");
      await setComponentParameter(page, "gain", gain!);
      await page.keyboard.press("Escape");
    }
    const deck = await copyNetlistText(page, "spice");
    expect(deck.match(/\.subckt finite_gain\b/gu)).toHaveLength(1);
    expect(deck).toContain("gain=20");
    expect(deck).toContain("gain=30");
    expect((await readProject(page)).modelSources).toEqual(before.modelSources);
  } finally {
    service.close();
  }
});

test("explicitly upgrades a legacy public entry or forks it without rewriting captured Projects", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(90_000);
  const service = library();
  const other = await browser.newContext();
  const fresh = await browser.newContext();
  const body = ".subckt restored_model A B\nR1 A B 1k\n.ends restored_model\n";
  try {
    await service.connect(context, "alice");
    await service.connect(other, "bob");
    await service.connect(fresh, "carol");
    await openEditor(page);
    const symbol = {
      ...structuredClone(
        builtInSymbols.find((item) => item.id === "resistor")!,
      ),
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
    expect(
      await page.evaluate(
        async (definition) =>
          (
            await fetch("/api/components/legacy-upgrade", {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ definition, revision: 0 }),
            })
          ).status,
        definition,
      ),
    ).toBe(200);
    await openUserComponents(page);
    await page
      .getByRole("button", { name: "Place Legacy public repair", exact: true })
      .click();
    await place(page);
    await expect(page.getByTestId("active-instance-count")).toHaveText("1");
    const captured = await readProject(page);
    expect(captured.documents[0]!.instances).toHaveLength(1);
    expect(
      createDesignNetlistExport(captured, { format: "spice" }).status,
    ).toBe("blocked");
    const visitor = await other.newPage();
    await openEditor(visitor);
    const empty = await readProject(visitor);
    for (const [target, save] of [
      [visitor, "Publish as new component"],
      [page, "Update my component"],
    ] as const) {
      await openUserComponents(target);
      await clickLibraryAction(
        target.locator(".user-component-tile").filter({ hasText: "alice" }),
        target === visitor
          ? "Create from Legacy public repair"
          : "Edit Legacy public repair definition",
      );
      const editor = target.getByRole("dialog", {
        name: "Edit Component Definition",
        exact: true,
      });
      await authoringView(editor, "Circuit");
      await authoringView(editor, "Circuit");
      await editor
        .getByLabel("External model netlist", { exact: true })
        .fill(body);
      await editor
        .getByRole("button", { name: "Apply model", exact: true })
        .click();
      await expect(editor.getByRole("status")).toContainText("Applied");
      const beforeSave = await target.evaluate(async () =>
        (await (await fetch("/api/components")).json()).entries.find(
          (entry: { id: string }) => entry.id === "legacy-upgrade",
        ),
      );
      expect(beforeSave.revision).toBe(1);
      expect(beforeSave.circuit).toBeUndefined();
      await editor.getByRole("button", { name: save, exact: true }).click();
      await expect(
        editor.getByText("Saved to the public library.", { exact: true }),
      ).toBeVisible();
      await editor
        .getByLabel("Close component editor", { exact: true })
        .click();
    }
    const editedAuthor = await readProject(page);
    const editedVisitor = await readProject(visitor);
    for (const [actual, before] of [
      [editedAuthor, captured],
      [editedVisitor, empty],
    ]) {
      expect(actual).toEqual({
        ...before!,
        structureRevision: actual!.structureRevision,
        componentAuthoringDrafts: actual!.componentAuthoringDrafts,
      });
      expect(actual!.componentAuthoringDrafts).toHaveLength(1);
    }
    expect(
      createDesignNetlistExport(captured, { format: "spice" }).status,
    ).toBe("blocked");
    const entries = await page.evaluate(
      async () => (await (await fetch("/api/components")).json()).entries,
    );
    const upgraded = entries.find(
      (entry: { id: string }) => entry.id === "legacy-upgrade",
    );
    const fork = entries.find(
      (entry: { authorId: string }) => entry.authorId === "bob",
    );
    expect(upgraded.revision).toBe(2);
    expect(upgraded.circuit.source.files[0].text).toBe(body);
    expect(upgraded.definition.subcircuit).toBeUndefined();
    expect(fork.id).not.toBe(upgraded.id);
    expect(fork.revision).toBe(1);
    expect(fork.circuit.source.files[0].text).toBe(body);
    const inserted = await fresh.newPage();
    await openEditor(inserted);
    await openUserComponents(inserted);
    await inserted
      .locator(".user-component-tile")
      .filter({ hasText: "alice" })
      .getByRole("button", { name: "Place Legacy public repair", exact: true })
      .click();
    await place(inserted);
    const complete = await readProject(inserted);
    expect(complete.modelSources![0]!.files[0]!.text).toBe(body);
    expect(complete.documents[0]!.instances[0]!.netlist?.binding?.kind).toBe(
      "external-subcircuit",
    );
    const portable = await downloadBytes(
      inserted,
      "File",
      "Export Project File…",
    );
    await inserted.getByTestId("project-file").setInputFiles({
      name: "repaired-library.icproj.json",
      mimeType: "application/json",
      buffer: portable,
    });
    expect((await readProject(inserted)).modelSources).toEqual(
      complete.modelSources,
    );
  } finally {
    await other.close();
    await fresh.close();
    service.close();
  }
});

test("keeps interface-only public definitions visible and placeable as unimplemented circuits", async ({
  page,
  context,
}) => {
  const service = library();
  try {
    await service.connect(context, "alice");
    await openEditor(page);
    const definition = {
      symbol: {
        ...structuredClone(
          builtInSymbols.find((item) => item.id === "resistor")!,
        ),
        id: "legacy-artwork",
        name: "Interface only",
      },
      subcircuit: {
        id: "legacy-interface",
        symbolId: "legacy-artwork",
        target: "legacy_cell",
        ports: [
          { name: "A", pinName: "1", direction: "passive" },
          { name: "B", pinName: "2", direction: "passive" },
        ],
      },
    };
    const status = await page.evaluate(
      async (definition) =>
        (
          await fetch("/api/components/legacy-public", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ definition, revision: 0 }),
          })
        ).status,
      definition,
    );
    expect(status).toBe(200);
    await openUserComponents(page);
    const tile = page
      .locator(".user-component-tile")
      .filter({ hasText: "Interface only" });
    await expect(tile.getByText("Symbol only", { exact: true })).toBeVisible();
    await tile
      .getByRole("button", { name: "Place Interface only", exact: true })
      .click();
    await place(page);
    const label = await page
      .getByTestId("annotation-hit-instance-label-X1")
      .boundingBox();
    if (!label) throw Error("Missing occurrence label");
    await page.mouse.move(
      label.x + label.width / 2,
      label.y + label.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(label.x + 100, label.y + 70, { steps: 5 });
    await page.mouse.up();
    for (const pin of ["1", "2"]) {
      await page.getByTestId(`terminal-X1-${pin}`).click({ button: "right" });
      await openSelectionShelf(page);
      await page
        .getByRole("button", { name: "Mark No Connect", exact: true })
        .click();
      await page.keyboard.press("Escape");
    }
    const captured = await readProject(page);
    expect(captured.documents[0]!.instances[0]!.netlist?.binding).toEqual({
      kind: "unresolved-subcircuit",
      name: "legacy_cell",
    });
    const copied = createDesignNetlistExport(captured, { format: "spice" });
    expect(copied.status).toBe("blocked");
    expect(captured.modelSources ?? []).toEqual([]);
  } finally {
    service.close();
  }
});
function electricalMeaning(project: CircuitProject) {
  const document = project.documents[0]!;
  return {
    sources: project.modelSources?.map((source) => ({
      language: source.language,
      files: source.files,
      dependencies: source.dependencies,
    })),
    definitions: project.externalSubcircuitDefinitions.map((definition) => ({
      name: definition.name,
      ports: definition.terminals.map((terminal) => terminal.name),
      defaults: definition.formalParameters,
    })),
    instances: document.instances.map((instance) => {
      const binding = instance.netlist?.binding;
      return {
        reference: instance.reference,
        master:
          binding?.kind === "external-subcircuit"
            ? project.externalSubcircuitDefinitions.find(
                (definition) => definition.id === binding.definitionId,
              )?.name
            : instance.symbolId,
        parameters: instance.netlist?.parameters,
      };
    }),
    connections: document.nets
      .map((net) =>
        net.terminals
          .map((terminal) => `${terminal.instanceId}.${terminal.pinName}`)
          .sort(),
      )
      .sort(),
    noConnects: document.noConnects.map((item) => item.endpoint),
  };
}

test("E edits one instance, publicly saves its definition, and leaves Q and peers intact", async ({
  page,
  context,
}) => {
  const service = library();
  try {
    await service.connect(context, "alice");
    await openEditor(page);
    const project = createEmptyProject("pair", "Resistor pair");
    project.documents[0]!.instances = ["R1", "R2"].map((id, index) => ({
      id,
      reference: id,
      symbolId: "resistor",
      placement: {
        position: { x: 200 + index * 100, y: 200 },
        rotation: 0,
        mirror: "none",
      },
      netlist: {
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: { value: "1k" },
      },
    }));
    await page.getByTestId("project-file").setInputFiles({
      name: "pair.icproj.json",
      mimeType: "application/json",
      buffer: Buffer.from(serializeProject(project)),
    });
    await page.getByTestId("hit-R1").click();
    await page.keyboard.press("q");
    await expect(
      page.getByLabel("Editable Canvas property code"),
    ).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "Edit Component Definition" }),
    ).toHaveCount(0);
    await page.keyboard.press("q");
    await page.keyboard.press("e");
    await editDefinition(page, "Ring resistor");
    const rejectSave = async (route: import("@playwright/test").Route) => {
      if (route.request().method() === "PUT")
        await route.fulfill({
          status: 503,
          json: { error: "Library temporarily unavailable" },
        });
      else await route.fallback();
    };
    await context.route("**/api/components**", rejectSave);
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await page.getByLabel("Close component editor", { exact: true }).click();
    await page.keyboard.press("ControlOrMeta+z");
    expect(
      (await readProject(page)).documents[0]!.instances.map(
        (item) => item.symbolId,
      ),
    ).toEqual(["resistor", "resistor"]);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await page.getByTestId("hit-R1").click();
    await page.keyboard.press("e");
    await page
      .getByRole("button", {
        name: /^(Publish|Update my component)$/,
        exact: true,
      })
      .click();
    await expect(
      page.getByText("Library temporarily unavailable"),
    ).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "Edit Component Definition" }),
    ).toBeVisible();
    await context.unroute("**/api/components**", rejectSave);
    await page
      .getByRole("button", {
        name: /^(Publish|Update my component)$/,
        exact: true,
      })
      .click();
    await expect(
      page.getByText("Published to the public library.", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("Close component editor", { exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "Edit Component Definition" }),
    ).toHaveCount(0);
    const changed = await readProject(page);
    expect(changed.documents[0]!.instances[0]!.symbolId).toMatch(/^component-/);
    expect(changed.documents[0]!.instances[1]).toEqual(
      project.documents[0]!.instances[1],
    );
    expect(changed.componentDefinitions).toHaveLength(2);
    await openUserComponents(page);
    await expect(
      page.getByRole("button", { name: "Place Ring resistor", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("dialog", { name: "User Components", exact: true })
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await page.getByTestId("hit-R1").click();
    await page.getByTestId("hit-R1").click({ button: "right" });
    await page
      .getByRole("menuitem", {
        name: "Edit Component Definition (E)",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Edit Component Definition" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close component editor" }).click();
  } finally {
    service.close();
  }
});

test("create, live preview, public sharing, standard insertion and administrator lifecycle", async ({
  page,
  context,
  browser,
}) => {
  // Three isolated editor boots plus sharing, deletion and restoration can
  // exceed a single-page journey's budget on the shared CI runner.
  test.slow();
  const service = library();
  const second = await browser.newContext();
  const admin = await browser.newContext();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await service.connect(context, "alice");
    await openEditor(page);
    await openUserComponents(page);
    await page
      .getByRole("button", { name: "Create Component…", exact: true })
      .click();
    await editDefinition(page, "Shared amplifier");
    await expect(
      page.getByLabel("Component preview").locator("circle"),
    ).toHaveCount(1);
    await page.screenshot({
      path: "plan/user-component-definition-editor.png",
    });
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await page
      .getByRole("button", {
        name: /^(Publish|Update my component)$/,
        exact: true,
      })
      .click();
    await expect(
      page.getByText("Published to the public library.", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Place", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "Edit Component Definition" }),
    ).toHaveCount(0);
    await place(page);
    const firstProject = await readProject(page);
    expect(firstProject.documents[0]!.instances).toHaveLength(1);
    const captured = firstProject.componentDefinitions;
    await service.connect(second, "bob");
    const receiver = await second.newPage();
    await openEditor(receiver);
    await openUserComponents(receiver);
    await receiver
      .getByRole("button", { name: "Place Shared amplifier", exact: true })
      .click();
    await place(receiver);
    const received = await readProject(receiver);
    expect(received.componentDefinitions![0]!.symbol.primitives).toEqual(
      captured![0]!.symbol.primitives,
    );
    expect(received.componentDefinitions![0]!.symbol.pins).toEqual(
      captured![0]!.symbol.pins,
    );
    expect(received.componentDefinitions![0]!.subcircuit!.ports).toEqual(
      captured![0]!.subcircuit!.ports,
    );
    await openUserComponents(receiver);
    await clickLibraryAction(receiver, "Create from Shared amplifier");
    await expect(
      receiver.getByRole("button", {
        name: "Publish as new component",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      receiver.getByRole("button", { name: "Delete component", exact: true }),
    ).toHaveCount(0);
    await receiver
      .getByRole("button", { name: "Close component editor" })
      .click();
    await service.connect(admin, "admin");
    const administrator = await admin.newPage();
    await openEditor(administrator);
    await openUserComponents(administrator);
    await clickLibraryAction(administrator, "Manage Shared amplifier");
    await administrator
      .getByRole("button", { name: "Promote to official", exact: true })
      .click();
    await expect(
      administrator.getByText("Promoted to an official component."),
    ).toBeVisible();
    await administrator
      .getByRole("button", { name: "Delete component", exact: true })
      .click();
    await administrator
      .getByRole("button", { name: "Really delete", exact: true })
      .click();
    await expect(
      administrator.getByText("Removed from the library."),
    ).toBeVisible();
    await administrator
      .getByRole("button", { name: "Close component editor" })
      .click();
    await receiver.reload();
    await openUserComponents(receiver);
    await expect(
      receiver.getByRole("button", {
        name: "Place Shared amplifier",
        exact: true,
      }),
    ).toHaveCount(0);
    expect((await readProject(page)).componentDefinitions).toEqual(captured);
    await openUserComponents(administrator);
    await administrator
      .getByRole("button", {
        name: "Review deleted components",
        exact: true,
      })
      .click();
    await clickLibraryAction(administrator, "Review Shared amplifier");
    await administrator
      .getByRole("button", { name: "Restore", exact: true })
      .click();
    await expect(
      administrator.getByText("Restored to User Defined."),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await second.close();
    await admin.close();
    service.close();
  }
});

test("anonymous creation keeps public publication disabled and invalid code leaves the circuit untouched", async ({
  page,
  context,
}) => {
  const service = library();
  try {
    await service.connect(context, null);
    await openEditor(page);
    await openUserComponents(page);
    await page
      .getByRole("button", { name: "Create Component…", exact: true })
      .click();
    await page
      .getByLabel("Definition type", { exact: true })
      .selectOption("json");
    await expect(
      page.getByRole("button", {
        name: /^(Publish|Update my component)$/,
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Apply", exact: true }),
    ).toBeEnabled();
    const code = page.getByRole("textbox", {
      name: "Component definition code",
      exact: true,
    });
    await code.fill("{");
    await expect(page.getByRole("alert")).toBeVisible();
    await page.getByRole("button", { name: "Close component editor" }).click();
    await page
      .getByRole("button", { name: "Keep editing", exact: true })
      .click();
    await expect(code).toContainText("{");
    await page.getByRole("button", { name: "Close component editor" }).click();
    await page
      .getByRole("button", { name: "Discard changes", exact: true })
      .click();
    expect((await readProject(page)).documents[0]!.instances).toHaveLength(0);
  } finally {
    service.close();
  }
});

test("creates a native User Component through the shared model owner and places its automatic symbol", async ({
  page,
  context,
}) => {
  const service = library();
  const model = [
    ".subckt finite_gain IN OUT VSS params: gain=10 poleHz=1000",
    "E1 DRIVE VSS IN VSS {gain}",
    "R1 DRIVE OUT 1k",
    "C1 OUT VSS {1/(6.283185307179586*1k*poleHz)}",
    ".ends finite_gain",
    "",
  ].join("\n");
  try {
    await service.connect(context, "alice");
    await openEditor(page);
    await openUserComponents(page);
    await page
      .getByRole("button", { name: "Create Component…", exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "Edit Component Definition",
      exact: true,
    });
    await expect(editor.getByLabel("Definition type")).toBeVisible({
      timeout: 5_000,
    });
    await editor.getByLabel("Definition type").selectOption("circuit");
    await authoringView(editor, "Circuit");
    await editor.getByLabel("External model netlist").fill(model);
    await editor
      .getByRole("button", { name: "Apply model", exact: true })
      .click();
    await expect(editor.getByLabel("Parsed model interface")).toContainText(
      "IN",
    );
    await authoringView(editor, "Symbol");
    await expect(editor.getByLabel("Symbol preview")).toBeVisible();
    await editor.getByRole("button", { name: "Place", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await place(page);
    const project = await readProject(page);
    expect(project.modelSources).toHaveLength(1);
    expect(project.modelSources![0]!.files[0]!.text).toBe(model);
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
    expect(project.documents[0]!.instances[0]!.netlist?.binding).toEqual({
      kind: "external-subcircuit",
      definitionId: definition.id,
    });
    await expect(page.locator('[data-pin-name="OUT"]')).toBeVisible();
    await openUserComponents(page);
    await expect(
      page.getByRole("button", { name: "Place finite_gain", exact: true }),
    ).toHaveCount(0);
  } finally {
    service.close();
  }
});

test("native User Components and External Circuits retain equivalent ordinary instances and complete copied models", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(120_000);
  const service = library();
  const projects: CircuitProject[] = [];
  try {
    // Project Apply does not require or perform public-library publication.
    await service.connect(context, null);
    for (const entrance of ["user", "user-custom", "manager"]) {
      await openEditor(page);
      let editor;
      if (entrance.startsWith("user")) editor = await openNativeComponent(page);
      else {
        await openCellManager(page);
        editor = page.getByRole("dialog", {
          name: "Cell Manager",
          exact: true,
        });
        await editor
          .getByRole("tab", { name: "External Circuits", exact: true })
          .click();
      }
      await authoringView(editor, "Circuit");
      await editor.getByLabel("External model netlist").fill(finiteGainSource);
      await authoringView(editor, "Circuit");
      await editor
        .getByLabel("External model entry", { exact: true })
        .selectOption("finite_gain");
      if (entrance === "user-custom") {
        await authoringView(editor, "Symbol");
        await editor
          .getByLabel("Symbol mode", { exact: true })
          .selectOption("custom");
      }
      await editor
        .getByRole("button", { name: "Apply & Place", exact: true })
        .click();
      await expect(editor).toHaveCount(0);
      const canvas = page.getByTestId("schematic-canvas");
      await canvas.click({ position: { x: 280, y: 180 } });
      await canvas.click({ position: { x: 540, y: 280 } });
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("active-instance-count")).toHaveText("2");
      await page.getByTestId("hit-X1").click();
      await page.keyboard.press("q");
      await setComponentParameter(page, "gain", "20");
      await page.getByTestId("hit-X2").click();
      await setComponentParameter(page, "gain", "30");
      await page.keyboard.press("Escape");
      await page.getByTestId("hit-X2").click();
      await page.keyboard.press("r");
      await page.keyboard.press("Escape");
      await page.keyboard.press("ControlOrMeta+z");
      await page.keyboard.press("ControlOrMeta+Shift+z");
      await placeComponent(page, "voltage-source", { x: 140, y: 330 });
      await page.getByTestId("hit-V1").click();
      if (!(await page.getByLabel("Editable Canvas property code").isVisible()))
        await page.keyboard.press("q");
      await setComponentParameter(page, "dc", "0.1");
      await setComponentParameter(page, "acMagnitude", "1");
      await page.keyboard.press("Escape");
      await placeComponent(page, "ground", { x: 440, y: 460 });
      for (const [from, to] of [
        ["V1-+", "X1-IN"],
        ["X1-OUT", "X2-IN"],
        ["X1-VSS", "X2-VSS"],
        ["X2-VSS", "GND1-0"],
        ["V1--", "GND1-0"],
      ]) {
        await clickDrawTool(page, "wire");
        await page.getByTestId(`terminal-${from}`).click();
        await page.getByTestId(`terminal-${to}`).click();
        await page.keyboard.press("Escape");
      }
      await page.getByTestId("terminal-X2-OUT").click({ button: "right" });
      await openSelectionShelf(page);
      await page
        .getByRole("button", { name: "Mark No Connect", exact: true })
        .click();
      await page.keyboard.press("Escape");
      const copied = await copyNetlistText(page, "spice");
      expect(copied.match(/\.subckt finite_gain\b/gu)).toHaveLength(1);
      expect(copied.match(/\.subckt owned_helper\b/gu)).toHaveLength(1);
      expect(copied).toContain("gain=20");
      expect(copied).toContain("gain=30");
      const exported = parseSavedProject(
        (await downloadBytes(page, "File", "Export Project File…")).toString(),
      ) as CircuitProject;
      const analysis = analyzeDesignNetlist(exported);
      expect(
        analysis.diagnostics.filter((item) => item.severity === "error"),
      ).toEqual([]);
      const design = createDesignNetlistExport(exported, { format: "spice" });
      expect(design.status).toBe("ready");
      if (design.status !== "ready")
        throw Error(JSON.stringify(design.diagnostics));
      expect(design.file.text).toBe(copied);
      expect(
        exported.documents[0]!.instances.find((item) => item.id === "X2")!
          .placement!.rotation,
      ).toBe(90);
      await page.getByTestId("project-file").setInputFiles({
        name: "native.icproj.json",
        mimeType: "application/json",
        buffer: Buffer.from(serializeProject(exported)),
      });
      expect(await copyNetlistText(page, "spice")).toBe(copied);
      const reopened = await readProject(page);
      expect(electricalMeaning(reopened)).toEqual(electricalMeaning(exported));
      projects.push(reopened);
      if (entrance.startsWith("user")) {
        await writeFile(
          testInfo.outputPath(
            entrance === "user-custom"
              ? "native-custom-user-component.icproj.json"
              : "native-user-component.icproj.json",
          ),
          serializeProject(reopened),
        );
        await page.getByTestId("hit-X1").click();
        await page.keyboard.press("ControlOrMeta+c");
        await page
          .getByRole("button", { name: "New project tab", exact: true })
          .click();
        for (const x of [250, 500]) {
          await page.keyboard.press("ControlOrMeta+v");
          await page
            .getByTestId("schematic-canvas")
            .click({ position: { x, y: 260 } });
          await expect(
            page.getByTestId("active-instance-count"),
            entrance,
          ).toHaveText(x === 250 ? "1" : "2");
          await page.keyboard.press("Escape");
        }
        const fragment = await readProject(page);
        expect(fragment.documents[0]!.instances).toHaveLength(2);
        expect(fragment.documents[0]!.nets).toEqual([]);
        expect(fragment.documents[0]!.connectivityEvidence).toEqual([]);
        expect(fragment.modelSources).toHaveLength(1);
        expect(fragment.modelSources![0]!.files[0]!.text).toBe(
          finiteGainSource,
        );
        expect(fragment.externalSubcircuitDefinitions).toHaveLength(1);
        expect(
          fragment.externalSubcircuitDefinitions[0]!.terminals.map(
            (item) => item.name,
          ),
        ).toEqual(["IN", "OUT", "VSS"]);
        expect(
          fragment.documents[0]!.instances.every(
            (item) => item.netlist?.parameters?.gain === "20",
          ),
        ).toBe(true);
      }
    }
    expect(electricalMeaning(projects[0]!)).toEqual(
      electricalMeaning(projects[1]!),
    );
    expect(electricalMeaning(projects[0]!)).toEqual(
      electricalMeaning(projects[2]!),
    );
  } finally {
    service.close();
  }
});

test("native User Components bind an existing owner, guard unsaved text and refuse an Agent's stale revision", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const service = library();
  try {
    await service.connect(context, null);
    await openEditor(page);
    let editor = await openNativeComponent(page);
    await authoringView(editor, "Circuit");
    await editor.getByLabel("External model netlist").fill(finiteGainSource);
    await authoringView(editor, "Circuit");
    await editor
      .getByLabel("External model entry", { exact: true })
      .selectOption("finite_gain");
    await editor
      .getByRole("button", { name: "Apply model", exact: true })
      .click();
    await editor.getByLabel("Close component editor", { exact: true }).click();
    await page.getByTestId("open-agent").click();
    const panel = page.getByTestId("connect-agent-panel");
    const claim = panel.getByTestId("agent-copy-text");
    await expect(claim).toHaveValue(/Claim: /, { timeout: 45_000 });
    const client = new AgentSessionClient({
      http: new AgentHttpClient({ baseUrl: baseURL! }),
    });
    await client.connect(
      JSON.parse(/^Claim: (.+)$/mu.exec(await claim.inputValue())![1]!)
        .claimCode,
    );
    await panel.getByRole("button", { name: "Close Agent dialog" }).click();
    const before = (await client.refreshSnapshot()).snapshot.project;
    const owner = before.modelSources![0]!;
    editor = await openNativeComponent(page);
    await authoringView(editor, "Circuit");
    await editor
      .getByLabel("External model source owner", { exact: true })
      .selectOption(owner.id);
    await authoringView(editor, "Circuit");
    await editor
      .getByLabel("External model entry", { exact: true })
      .selectOption("finite_gain");
    await authoringView(editor, "Circuit");
    await editor
      .getByLabel("Model format", { exact: true })
      .selectOption("spectre");
    await expect(editor.getByLabel("External model netlist")).toContainText(
      "subckt finite_gain (IN OUT VSS)",
    );
    await authoringView(editor, "Circuit");
    await editor
      .getByLabel("Model format", { exact: true })
      .selectOption("spice");
    const pendingText = finiteGainSource.replace("gain=10", "gain=17");
    await authoringView(editor, "Circuit");
    await editor.getByLabel("External model netlist").fill(pendingText);
    await authoringView(editor, "Circuit");
    await editor
      .getByLabel("Model process", { exact: true })
      .selectOption("sky130");
    await expect(
      editor.getByLabel("Model process", { exact: true }),
    ).toHaveValue("abstract");
    await expect(editor.getByRole("status")).toContainText(
      "no reviewed process devices to replace",
    );
    await editor.getByLabel("Definition type").selectOption("json");
    await expect(
      editor.getByRole("button", { name: "Discard changes", exact: true }),
    ).toHaveCount(0);
    await editor.getByLabel("Definition type").selectOption("circuit");
    await expect(editor.getByLabel("Definition type")).toHaveValue("circuit");
    await expect(editor.getByLabel("External model netlist")).toContainText(
      "gain=17",
    );
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
    await editor
      .getByRole("button", { name: "Apply model", exact: true })
      .click();
    await expect(editor.getByRole("status")).toContainText(
      "The applied model changed",
    );
    const refused = (await client.refreshSnapshot()).snapshot.project;
    expect(refused.modelSources![0]!.files[0]!.text).toContain("gain=15");
    expect(refused.externalSubcircuitDefinitions).toHaveLength(1);
    await editor
      .getByRole("button", {
        name: "Keep my draft on the latest version",
        exact: true,
      })
      .click();
    await editor
      .getByRole("button", { name: "Apply model", exact: true })
      .click();
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
    await editor
      .getByLabel("External model netlist")
      .fill(".subckt unfinished A B\n");
    await editor.getByText("More", { exact: true }).click();
    await editor
      .getByRole("button", { name: "Save draft", exact: true })
      .click();
    await expect(editor.getByRole("status")).toContainText("Saved draft");
    await editor.getByLabel("Close component editor", { exact: true }).click();
    const saved = (await client.refreshSnapshot()).snapshot.project;
    expect(saved.modelSources![0]!.draft!.files[0]!.text).toBe(
      ".subckt unfinished A B\n",
    );
    expect(saved.modelSources![0]!.files[0]!.text).toBe(pendingText);
    await openCellManager(page);
    const manager = page.getByRole("dialog", {
      name: "Cell Manager",
      exact: true,
    });
    await manager
      .getByRole("tab", { name: "External Circuits", exact: true })
      .click();
    await manager
      .locator(".cell-manager-list-item")
      .filter({
        hasText: saved.externalSubcircuitDefinitions!.find(
          (definition) => definition.implementation?.sourceId === owner.id,
        )!.name,
      })
      .last()
      .click();
    await expect(manager.getByLabel("External model netlist")).toContainText(
      ".subckt unfinished A B",
    );
    await expect(manager).toContainText("Saved draft");
  } finally {
    service.close();
  }
});

test("custom circuit artwork maps renamed pins in reversed geometry to the native X-node order", async ({
  page,
  context,
}, testInfo) => {
  const service = library();
  try {
    await service.connect(context, null);
    await openEditor(page);
    const editor = await openNativeComponent(page);
    await authoringView(editor, "Circuit");
    await editor.getByLabel("External model netlist").fill(finiteGainSource);
    await authoringView(editor, "Circuit");
    await editor
      .getByLabel("External model entry", { exact: true })
      .selectOption("finite_gain");
    await authoringView(editor, "Symbol");
    await editor
      .getByLabel("Symbol mode", { exact: true })
      .selectOption("custom");
    await authoringView(editor, "Symbol");
    const code = editor.getByRole("textbox", {
      name: "Circuit symbol JSON",
      exact: true,
    });
    await code.focus();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+c");
    const artwork = JSON.parse(
      await page.evaluate(() => navigator.clipboard.readText()),
    );
    artwork.symbol.pins = artwork.symbol.pins
      .map(
        (pin: {
          name: string;
          at: { x: number; y: number };
          direction: string;
        }) => ({
          ...pin,
          name:
            pin.name === "IN"
              ? "sense"
              : pin.name === "OUT"
                ? "drive"
                : "return",
          at: { x: -pin.at.x, y: pin.at.y },
          direction:
            pin.direction === "east"
              ? "west"
              : pin.direction === "west"
                ? "east"
                : pin.direction,
        }),
      )
      .reverse();
    artwork.symbol.primitives.push({
      kind: "circle",
      center: { x: 0, y: 0 },
      radius: 8,
    });
    artwork.circuitBinding.terminals = artwork.circuitBinding.terminals.map(
      (mapping: { pinName: string }) => ({
        ...mapping,
        pinName:
          mapping.pinName === "IN"
            ? "sense"
            : mapping.pinName === "OUT"
              ? "drive"
              : "return",
      }),
    );
    await code.fill(JSON.stringify(artwork, null, 2));
    await editor
      .getByRole("button", { name: "Apply & Place", exact: true })
      .click();
    await expect(editor).toHaveCount(0);
    await place(page, 400, 220);
    await placeComponent(page, "voltage-source", { x: 150, y: 350 });
    await placeComponent(page, "ground", { x: 480, y: 460 });
    for (const [from, to] of [
      ["V1-+", "X1-IN"],
      ["V1--", "GND1-0"],
      ["X1-VSS", "GND1-0"],
    ]) {
      await clickDrawTool(page, "wire");
      await page.getByTestId(`terminal-${from}`).click();
      await page.getByTestId(`terminal-${to}`).click();
      await page.keyboard.press("Escape");
    }
    await page.getByTestId("terminal-X1-OUT").click({ button: "right" });
    await openSelectionShelf(page);
    await page
      .getByRole("button", { name: "Mark No Connect", exact: true })
      .click();
    await page.keyboard.press("Escape");
    const exported = parseSavedProject(
      (await downloadBytes(page, "File", "Export Project File…")).toString(),
    ) as CircuitProject;
    expect(
      exported.externalSubcircuitDefinitions[0]!.terminals.map((t) => t.name),
    ).toEqual(["IN", "OUT", "VSS"]);
    const custom = exported.componentDefinitions!.find(
      (d) => d.symbol.id === exported.documents[0]!.instances[0]!.symbolId,
    )!;
    expect(custom.symbol.pins.map((pin) => pin.name)).toEqual([
      "return",
      "drive",
      "sense",
    ]);
    expect(
      exported.documents[0]!.nets.some(
        (net) =>
          net.terminals.some(
            (t) => t.instanceId === "V1" && t.pinName === "+",
          ) &&
          net.terminals.some(
            (t) => t.instanceId === "X1" && t.pinName === "IN",
          ),
      ),
    ).toBe(true);
    expect(
      analyzeDesignNetlist(exported).diagnostics.filter(
        (d) => d.severity === "error",
      ),
    ).toEqual([]);
    const copied = await copyNetlistText(page, "spice");
    expect(copied.match(/\.subckt finite_gain\b/gu)).toHaveLength(1);
    expect(copied).not.toContain("sense");
    await writeFile(
      testInfo.outputPath("custom-user-component.icproj.json"),
      serializeProject(exported),
    );
  } finally {
    service.close();
  }
});

test("complete same-name custom artwork initializes checked mappings through GUI and Agent", async ({
  page,
  context,
  baseURL,
}) => {
  const service = library();
  try {
    await service.connect(context, null);
    await openEditor(page);
    const editor = await openNativeComponent(page);
    await authoringView(editor, "Circuit");
    await editor.getByLabel("External model netlist").fill(finiteGainSource);
    await authoringView(editor, "Circuit");
    await editor
      .getByLabel("External model entry", { exact: true })
      .selectOption("finite_gain");
    await authoringView(editor, "Symbol");
    await editor.getByLabel("Symbol mode").selectOption("custom");
    await authoringView(editor, "Symbol");
    const code = editor.getByRole("textbox", {
      name: "Circuit symbol JSON",
      exact: true,
    });
    await code.focus();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+c");
    const component = JSON.parse(
      await page.evaluate(() => navigator.clipboard.readText()),
    );
    delete component.circuitBinding;
    await code.fill(JSON.stringify(component, null, 2));
    await expect(editor.getByRole("alert")).toHaveCount(0);
    await editor
      .getByRole("button", { name: "Apply & Place", exact: true })
      .click();
    await expect(editor).toHaveCount(0);
    await place(page);
    const applied = await readProject(page);
    const captured = applied.componentDefinitions!.find(
      (d) => d.symbol.id === component.symbol.id,
    )!;
    expect(
      captured.circuitBinding!.terminals.map((m) =>
        "pinName" in m ? m.pinName : m.supply,
      ),
    ).toEqual(["IN", "OUT", "VSS"]);
    expect(applied.documents[0]!.nets).toEqual([]);
    await page.getByTestId("open-agent").click();
    const panel = page.getByTestId("connect-agent-panel");
    const claim = panel.getByTestId("agent-copy-text");
    await expect(claim).toHaveValue(/Claim: /, { timeout: 45_000 });
    const client = new AgentSessionClient({
      http: new AgentHttpClient({ baseUrl: baseURL! }),
    });
    await client.connect(
      JSON.parse(/^Claim: (.+)$/mu.exec(await claim.inputValue())![1]!)
        .claimCode,
    );
    await panel.getByRole("button", { name: "Close Agent dialog" }).click();
    component.symbol.id += "-agent";
    const candidate = {
      structureEdits: [
        {
          kind: "apply_model_source",
          source: applied.modelSources![0]!,
          definitions: [
            {
              definitionId: captured.circuitBinding!.definitionId,
              entry: "finite_gain",
              authoring: {
                symbolMode: "custom",
                artworkText: JSON.stringify(component),
              },
            },
          ],
        },
      ],
    };
    const preview = await client.advancedTransact(candidate, { dryRun: true });
    expect(preview.ok, preview.message).toBe(true);
    expect(await readProject(page)).toEqual(applied);
    const accepted = await client.advancedTransact(candidate);
    expect(accepted.ok, accepted.message).toBe(true);
    const after = await readProject(page);
    expect(
      after.componentDefinitions!.find(
        (d) => d.symbol.id === component.symbol.id,
      )!.circuitBinding,
    ).toEqual(captured.circuitBinding);
    expect(after.documents).toEqual(applied.documents);
    expect(after.modelSources![0]!.files).toEqual(
      applied.modelSources![0]!.files,
    );
    const invalid = structuredClone(captured);
    invalid.symbol.id += "-invalid";
    invalid.circuitBinding!.terminals[0]!.terminalId = "unknown-formal-port";
    const refused = await client.advancedTransact({
      structureEdits: [
        { kind: "capture_component_definition", definition: invalid },
        {
          kind: "transact_document",
          documentId: after.documents[0]!.id,
          expectedRevision: after.documents[0]!.revision,
          edits: [
            {
              kind: "set_instance_symbol",
              instanceId: "X1",
              symbolId: invalid.symbol.id,
            },
          ],
        },
      ],
    });
    expect(refused.ok).toBe(false);
    expect(refused.message).toContain("circuitBinding");
    expect(await readProject(page)).toEqual(after);
  } finally {
    service.close();
  }
});

test("custom circuit mappings reject collapsed ports and use an explicit property supply through GUI and Agent", async ({
  page,
  context,
  baseURL,
}) => {
  const service = library();
  try {
    await service.connect(context, null);
    await openEditor(page);
    const editor = await openNativeComponent(page);
    await authoringView(editor, "Circuit");
    await editor.getByLabel("External model netlist").fill(finiteGainSource);
    await authoringView(editor, "Circuit");
    await editor
      .getByLabel("External model entry", { exact: true })
      .selectOption("finite_gain");
    await authoringView(editor, "Symbol");
    await editor
      .getByLabel("Symbol mode", { exact: true })
      .selectOption("custom");
    await authoringView(editor, "Symbol");
    const code = editor.getByRole("textbox", {
      name: "Circuit symbol JSON",
      exact: true,
    });
    await code.focus();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+c");
    const component = JSON.parse(
      await page.evaluate(() => navigator.clipboard.readText()),
    );
    const duplicate = structuredClone(component);
    duplicate.circuitBinding.terminals[1].pinName = "IN";
    await code.fill(JSON.stringify(duplicate, null, 2));
    await expect(
      editor
        .getByRole("status")
        .filter({ hasText: "different native terminals" }),
    ).toBeVisible();
    await expect(
      editor.getByRole("button", { name: "Apply model", exact: true }),
    ).toBeDisabled();
    await expect(page.getByTestId("active-instance-count")).toHaveText("0");
    component.symbol.pins = component.symbol.pins.filter(
      (pin: { name: string }) => pin.name !== "VSS",
    );
    component.circuitBinding.terminals[2] = {
      terminalId: component.circuitBinding.terminals[2].terminalId,
      supply: "VSS",
    };
    await code.fill(JSON.stringify(component, null, 2));
    await editor
      .getByRole("button", { name: "Apply & Place", exact: true })
      .click();
    await expect(editor).toHaveCount(0);
    await place(page, 400, 220);
    await expect(page.getByTestId("terminal-X1-VSS")).toHaveCount(0);
    await placeComponent(page, "voltage-source", { x: 160, y: 350 });
    await placeComponent(page, "ground", { x: 440, y: 460 });
    for (const [from, to] of [
      ["V1-+", "X1-IN"],
      ["V1--", "GND1-0"],
    ]) {
      await clickDrawTool(page, "wire");
      await page.getByTestId(`terminal-${from}`).click();
      await page.getByTestId(`terminal-${to}`).click();
      await page.keyboard.press("Escape");
    }
    await page.getByTestId("terminal-X1-OUT").click({ button: "right" });
    await openSelectionShelf(page);
    await page
      .getByRole("button", { name: "Mark No Connect", exact: true })
      .click();
    await page.keyboard.press("Escape");
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
    await page.getByTestId("open-agent").click();
    const panel = page.getByTestId("connect-agent-panel");
    const claim = panel.getByTestId("agent-copy-text");
    await expect(claim).toHaveValue(/Claim: /, { timeout: 45_000 });
    const client = new AgentSessionClient({
      http: new AgentHttpClient({ baseUrl: baseURL! }),
    });
    await client.connect(
      JSON.parse(/^Claim: (.+)$/mu.exec(await claim.inputValue())![1]!)
        .claimCode,
    );
    await panel.getByRole("button", { name: "Close Agent dialog" }).click();
    const before = (await client.refreshSnapshot()).snapshot.project;
    const source = before.modelSources![0]!;
    const captured = structuredClone(
      applied.componentDefinitions!.find((d) => d.circuitBinding)!,
    );
    const automatic = await client.advancedTransact({
      structureEdits: [
        {
          kind: "apply_model_source",
          source,
          definitions: [
            {
              definitionId: captured.circuitBinding!.definitionId,
              entry: "finite_gain",
              symbol: null,
              callers: [
                {
                  documentId: applied.documents[0]!.id,
                  instanceId: "X1",
                  expectedSymbolId: captured.symbol.id,
                },
              ],
            },
          ],
        },
      ],
    });
    expect(automatic.ok).toBe(false);
    expect(automatic.message).toContain("property supply");
    expect((await client.refreshSnapshot()).snapshot.project).toEqual(before);
    expect(await readProject(page)).toEqual(applied);
    const directSwitch = await client.advancedTransact({
      structureEdits: [
        {
          kind: "transact_document",
          documentId: applied.documents[0]!.id,
          expectedRevision: applied.documents[0]!.revision,
          edits: [
            {
              kind: "set_instance_symbol",
              instanceId: "X1",
              symbolId: externalSubcircuitSymbolId(
                captured.circuitBinding!.definitionId,
              ),
            },
          ],
        },
      ],
    });
    expect(directSwitch.ok).toBe(false);
    expect(directSwitch.message).toContain("property supply");
    expect((await client.refreshSnapshot()).snapshot.project).toEqual(before);
    expect(await readProject(page)).toEqual(applied);
    const switchedRuntime = structuredClone(applied);
    switchedRuntime.documents[0]!.instances.find(
      (item) => item.id === "X1",
    )!.symbolId = externalSubcircuitSymbolId(
      captured.circuitBinding!.definitionId,
    );
    const switchedCode = JSON.parse(serializeProject(switchedRuntime));
    switchedCode.documents[0].instances.find(
      (item: { id: string }) => item.id === "X1",
    ).type = externalSubcircuitSymbolId(captured.circuitBinding!.definitionId);
    await page.getByTestId("project-code-toggle").click();
    const switchCode = page.getByRole("textbox", {
      name: "Project code",
      exact: true,
    });
    await switchCode.fill(JSON.stringify(switchedCode, null, 2));
    await switchCode.press("ControlOrMeta+Enter");
    const switchPanel = page.getByRole("region", {
      name: "Project Code",
      exact: true,
    });
    await expect(switchPanel.getByRole("alert")).toContainText(
      "property supply",
    );
    await switchPanel
      .getByRole("button", { name: "Reload", exact: true })
      .click();
    expect(await readProject(page)).toEqual(applied);

    captured.symbol.id += "-bad";
    captured.circuitBinding!.terminals[1] = {
      terminalId: captured.circuitBinding!.terminals[1]!.terminalId,
      pinName: "IN",
    };
    const refused = await client.advancedTransact({
      structureEdits: [
        {
          kind: "apply_model_source",
          source,
          definitions: [
            {
              definitionId: before.externalSubcircuitDefinitions![0]!.id,
              entry: "finite_gain",
              symbol: captured,
            },
          ],
        },
      ],
    });
    expect(refused.ok).toBe(false);
    expect((await client.refreshSnapshot()).snapshot.project).toEqual(before);
    expect(await readProject(page)).toEqual(applied);
  } finally {
    service.close();
  }
});

test("editing connected custom artwork and switching modes preserves logical pins and captured peers", async ({
  page,
  context,
}) => {
  const service = library();
  try {
    await service.connect(context, null);
    await openEditor(page);
    let editor = await openNativeComponent(page);
    await authoringView(editor, "Circuit");
    await editor.getByLabel("External model netlist").fill(finiteGainSource);
    await authoringView(editor, "Circuit");
    await editor
      .getByLabel("External model entry", { exact: true })
      .selectOption("finite_gain");
    await authoringView(editor, "Symbol");
    await editor
      .getByLabel("Symbol mode", { exact: true })
      .selectOption("custom");
    await authoringView(editor, "Symbol");
    const initialCode = editor.getByRole("textbox", {
      name: "Circuit symbol JSON",
      exact: true,
    });
    await initialCode.focus();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+c");
    const initialArtwork = JSON.parse(
      await page.evaluate(() => navigator.clipboard.readText()),
    );
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
    await editor
      .getByRole("button", { name: "Apply & Place", exact: true })
      .click();
    await expect(editor).toHaveCount(0);
    const canvas = page.getByTestId("schematic-canvas");
    await canvas.click({ position: { x: 360, y: 240 } });
    await canvas.click({ position: { x: 640, y: 320 } });
    await page.keyboard.press("Escape");
    await placeComponent(page, "voltage-source", { x: 140, y: 350 });
    await clickDrawTool(page, "wire");
    await page.getByTestId("terminal-V1-+").click();
    await page.getByTestId("terminal-X1-IN").click();
    await page.keyboard.press("Escape");
    const selectedVariants = await readProject(page);
    for (const instance of selectedVariants.documents[0]!.instances.filter(
      (item) => item.id === "X1" || item.id === "X2",
    ))
      instance.symbolVariantId = "alternate";
    await page.getByTestId("project-file").setInputFiles({
      name: "selected-native-variants.icproj.json",
      mimeType: "application/json",
      buffer: Buffer.from(serializeProject(selectedVariants)),
    });
    await page
      .getByRole("button", { name: "Continue without saving", exact: true })
      .click();
    await awaitEditorReady(page);
    const before = await readProject(page);
    const peer = before.documents[0]!.instances.find((i) => i.id === "X2")!;
    expect(
      before.documents[0]!.instances.find((i) => i.id === "X1")!
        .symbolVariantId,
    ).toBe("alternate");
    expect(peer.symbolVariantId).toBe("alternate");
    await page.getByTestId("hit-X1").click({ button: "right" });
    await page
      .getByRole("menuitem", {
        name: "Edit Component Definition (E)",
        exact: true,
      })
      .click();
    editor = page.getByRole("dialog", {
      name: "Edit Component Definition",
      exact: true,
    });
    await authoringView(editor, "Symbol");
    await expect(editor.getByLabel("Symbol mode")).toHaveValue("custom");
    await authoringView(editor, "Symbol");
    const code = editor.getByRole("textbox", {
      name: "Circuit symbol JSON",
      exact: true,
    });
    await code.focus();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+c");
    const artwork = JSON.parse(
      await page.evaluate(() => navigator.clipboard.readText()),
    );
    artwork.symbol.pins.find(
      (pin: { name: string }) => pin.name === "IN",
    ).at.x -= 20;
    await code.fill(JSON.stringify(artwork, null, 2));
    await editor
      .getByRole("button", { name: "Apply model", exact: true })
      .click();
    await expect(editor.getByRole("status")).toContainText("Applied");
    await editor.getByLabel("Close component editor", { exact: true }).click();
    const moved = await readProject(page);
    expect(
      moved.documents[0]!.instances.find((i) => i.id === "X1")!.symbolVariantId,
    ).toBe("alternate");
    expect(moved.documents[0]!.nets).toEqual(before.documents[0]!.nets);
    expect(moved.modelSources![0]!.files).toEqual(
      before.modelSources![0]!.files,
    );
    expect(moved.externalSubcircuitDefinitions[0]!.terminals).toEqual(
      before.externalSubcircuitDefinitions[0]!.terminals,
    );
    expect(moved.documents[0]!.instances.find((i) => i.id === "X2")).toEqual(
      peer,
    );
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
    expect(
      moved.documents[0]!.instances.find((i) => i.id === "X1")!.symbolId,
    ).not.toBe(artwork.symbol.id);
    expect(
      moved.componentDefinitions!.find(
        (definition) => definition.symbol.id === artwork.symbol.id,
      ),
    ).toEqual(
      before.componentDefinitions!.find(
        (definition) => definition.symbol.id === artwork.symbol.id,
      ),
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
    await page.keyboard.press("ControlOrMeta+Shift+z");
    expect(await readProject(page)).toEqual({
      ...moved,
      structureRevision: expect.any(Number),
      documents: moved.documents.map((document) => ({
        ...document,
        revision: expect.any(Number),
      })),
    });
    await page.getByTestId("hit-X1").click({ button: "right" });
    await page
      .getByRole("menuitem", {
        name: "Edit Component Definition (E)",
        exact: true,
      })
      .click();
    await authoringView(editor, "Symbol");
    await expect(editor.getByLabel("Symbol mode")).toHaveValue("custom");
    await authoringView(editor, "Symbol");
    await editor.getByLabel("Symbol mode").selectOption("automatic");
    const discard = editor.getByRole("button", {
      name: "Discard changes",
      exact: true,
    });
    if (await discard.isVisible()) await discard.click();
    await editor
      .getByRole("button", { name: "Apply model", exact: true })
      .click();
    await expect(editor.getByRole("status")).toContainText("Applied");
    await editor
      .getByRole("button", { name: "Apply model", exact: true })
      .click();
    await expect(editor.getByRole("status")).toContainText("Applied");
    await editor.getByLabel("Close component editor", { exact: true }).click();
    const automatic = await readProject(page);
    expect(
      automatic.documents[0]!.instances.find((i) => i.id === "X1")!
        .symbolVariantId,
    ).toBeUndefined();
    expect(
      automatic.documents[0]!.instances.find((i) => i.id === "X1")!.netlist
        ?.binding,
    ).toEqual(
      before.documents[0]!.instances.find((i) => i.id === "X1")!.netlist
        ?.binding,
    );
    expect(automatic.modelSources![0]!.files).toEqual(
      before.modelSources![0]!.files,
    );
    expect(automatic.documents[0]!.nets).toEqual(before.documents[0]!.nets);
    expect(
      automatic.documents[0]!.instances.find((i) => i.id === "X2"),
    ).toEqual(peer);
    expect(
      automatic.documents[0]!.instances.find((i) => i.id === "X1")!.symbolId,
    ).not.toBe(artwork.symbol.id);
  } finally {
    service.close();
  }
});

test("saving a complete source draft retains pending custom artwork through reopen without applying it", async ({
  page,
  context,
}) => {
  const service = library();
  try {
    await service.connect(context, null);
    await openEditor(page);
    const editor = await openNativeComponent(page);
    await authoringView(editor, "Circuit");
    await editor.getByLabel("External model netlist").fill(finiteGainSource);
    await authoringView(editor, "Circuit");
    await editor
      .getByLabel("External model entry", { exact: true })
      .selectOption("finite_gain");
    await authoringView(editor, "Symbol");
    await editor.getByLabel("Symbol mode").selectOption("custom");
    await authoringView(editor, "Symbol");
    const code = editor.getByRole("textbox", {
      name: "Circuit symbol JSON",
      exact: true,
    });
    await code.focus();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+c");
    const pending = JSON.parse(
      await page.evaluate(() => navigator.clipboard.readText()),
    );
    pending.symbol.name = "Pending artwork";
    await code.fill(JSON.stringify(pending, null, 2));
    await editor.locator(".external-model-more > summary").click();
    await editor
      .getByRole("button", { name: "Save draft", exact: true })
      .click();
    await expect(editor.getByRole("status")).toContainText("Saved draft");
    await editor.getByLabel("Close component editor", { exact: true }).click();
    const draft = await readProject(page);
    expect(draft.componentDefinitions ?? []).toEqual([]);
    expect(draft.modelSources![0]!.files[0]!.text).toBe("");
    expect(draft.modelSources![0]!.draft!.authoring![0]!.artworkText).toContain(
      "Pending artwork",
    );
    await openUserComponents(page);
    await page.getByText(/Project drafts/).click();
    await page
      .getByRole("button", { name: "Circuit draft finite_gain", exact: true })
      .click();
    await authoringView(editor, "Symbol");
    await code.focus();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+c");
    expect(
      JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))
        .symbol.name,
    ).toBe("Pending artwork");
    await editor.getByRole("button", { name: "Place", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await place(page);
    const applied = await readProject(page);
    expect(
      applied.componentDefinitions!.find((d) => d.circuitBinding)!.symbol.name,
    ).toBe("Pending artwork");
    expect(applied.modelSources![0]!.draft).toBeUndefined();
    expect(applied.modelSources![0]!.files[0]!.text).toBe(finiteGainSource);
  } finally {
    service.close();
  }
});

test("copying custom circuits keeps terminal identities scoped to each native owner", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  const service = library();
  try {
    await service.connect(context, null);
    await openEditor(page);
    for (const [name, x] of [
      ["finite_gain", 250],
      ["second_gain", 500],
    ] as const) {
      const editor = await openNativeComponent(page);
      await authoringView(editor, "Circuit");
      await editor
        .getByLabel("External model netlist")
        .fill(
          finiteGainSource
            .split(".subckt owned_helper")[0]!
            .replaceAll("finite_gain", name),
        );
      await authoringView(editor, "Symbol");
      await editor
        .getByLabel("Symbol mode", { exact: true })
        .selectOption("custom");
      await editor
        .getByRole("button", { name: "Apply & Place", exact: true })
        .click();
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
    await page.getByTestId("project-file").setInputFiles({
      name: "scoped-terminals.icproj.json",
      mimeType: "application/json",
      buffer: Buffer.from(serializeProject(source)),
    });
    await page.getByTestId("hit-X1").click();
    await page.getByTestId("hit-X2").click({ modifiers: ["ControlOrMeta"] });
    await page.keyboard.press("ControlOrMeta+c");
    await page
      .getByRole("button", { name: "New project tab", exact: true })
      .click();
    for (const [index, y] of [200, 440].entries()) {
      await page.keyboard.press("ControlOrMeta+v");
      await page
        .getByTestId("schematic-canvas")
        .click({ position: { x: 250, y } });
      await expect(page.getByTestId("active-instance-count")).toHaveText(
        String((index + 1) * 2),
      );
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
      const artwork = copied.componentDefinitions!.find(
        (item) => item.symbol.id === instance.symbolId,
      )!;
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
    const invalid = JSON.parse(serializeProject(copied));
    const selectedInstance = copied.documents[0]!.instances[0]!;
    const selectedBinding = selectedInstance.netlist!.binding!;
    if (selectedBinding.kind !== "external-subcircuit")
      throw Error("Missing native target");
    invalid.documents[0].instances[0].target = {
      kind: "external-subcircuit",
      definitionId: copied.externalSubcircuitDefinitions.find(
        (item) => item.id !== selectedBinding.definitionId,
      )!.id,
    };
    await page.getByTestId("project-code-toggle").click();
    const projectCode = page.getByRole("textbox", {
      name: "Project code",
      exact: true,
    });
    await projectCode.fill(JSON.stringify(invalid, null, 2));
    await projectCode.press("ControlOrMeta+Enter");
    const projectPanel = page.getByRole("region", {
      name: "Project Code",
      exact: true,
    });
    await expect(projectPanel.getByRole("alert")).toContainText(
      "artwork owner",
    );
    await projectPanel.getByRole("button", { name: /Reload/ }).click();
    expect(await readProject(page)).toEqual(copied);
  } finally {
    service.close();
  }
});

test("native custom source changes diagnose missing mappings without crashing the Editor", async ({
  page,
  context,
}) => {
  const service = library();
  try {
    await service.connect(context, null);
    await openEditor(page);
    let editor = await openNativeComponent(page);
    await authoringView(editor, "Circuit");
    await editor.getByLabel("External model netlist").fill(finiteGainSource);
    await authoringView(editor, "Circuit");
    await editor
      .getByLabel("External model entry", { exact: true })
      .selectOption("finite_gain");
    await authoringView(editor, "Symbol");
    await editor.getByLabel("Symbol mode").selectOption("custom");
    await editor
      .getByRole("button", { name: "Apply & Place", exact: true })
      .click();
    await expect(editor).toHaveCount(0);
    await place(page);
    const before = await readProject(page);
    await page.getByTestId("hit-X1").click({ button: "right" });
    await page
      .getByRole("menuitem", {
        name: "Edit Component Definition (E)",
        exact: true,
      })
      .click();
    editor = page.getByRole("dialog", {
      name: "Edit Component Definition",
      exact: true,
    });
    await authoringView(editor, "Circuit");
    await editor
      .getByLabel("External model netlist")
      .fill(
        finiteGainSource.replace(
          "IN OUT VSS params:",
          "IN OUT VSS EXTRA params:",
        ),
      );
    await expect(
      editor.locator(".cell-external-result").filter({ hasText: "EXTRA" }),
    ).toBeVisible();
    await expect(
      editor.getByRole("button", { name: "Apply model", exact: true }),
    ).toBeDisabled();
    await expect(editor.locator(".cell-external-result")).toContainText(
      "EXTRA",
    );
    await editor.getByLabel("Close component editor", { exact: true }).click();
    await editor
      .getByRole("button", { name: "Discard changes", exact: true })
      .click();
    expect(await readProject(page)).toEqual(before);
    await page.getByTestId("hit-X1").click({ button: "right" });
    await page
      .getByRole("menuitem", {
        name: "Edit Component Definition (E)",
        exact: true,
      })
      .click();
    await authoringView(editor, "Circuit");
    await editor
      .getByLabel("External model netlist")
      .fill(
        finiteGainSource.replace(
          "IN OUT VSS params:",
          "IN OUT VSS EXTRA params:",
        ),
      );
    await authoringView(editor, "Symbol");
    await editor.getByLabel("Symbol mode").selectOption("automatic");
    const discard = editor.getByRole("button", {
      name: "Discard changes",
      exact: true,
    });
    if (await discard.isVisible()) await discard.click();
    await editor
      .getByRole("button", { name: "Apply model", exact: true })
      .click();
    await expect(editor.getByRole("status")).toContainText("Applied");
    await editor.getByLabel("Close component editor", { exact: true }).click();
    const added = await readProject(page);
    expect(
      added.externalSubcircuitDefinitions[0]!.terminals.map(
        (terminal) => terminal.name,
      ),
    ).toEqual(["IN", "OUT", "VSS", "EXTRA"]);
    expect(added.documents[0]!.instances[0]!.symbolId).toBe(
      externalSubcircuitSymbolId(added.externalSubcircuitDefinitions[0]!.id),
    );
    await expect(page.getByTestId("terminal-X1-EXTRA")).toBeVisible();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect(electricalMeaning(await readProject(page))).toEqual(
      electricalMeaning(before),
    );
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    expect(electricalMeaning(await readProject(page))).toEqual(
      electricalMeaning(added),
    );
  } finally {
    service.close();
  }
});

test("switching definition views retains a pending JSON draft until the user explicitly discards it", async ({
  page,
  context,
}) => {
  const service = library();
  try {
    await service.connect(context, null);
    await openEditor(page);
    await openUserComponents(page);
    await page
      .getByRole("button", { name: "Create Component…", exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "Edit Component Definition",
      exact: true,
    });
    await editDefinition(page, "Discarded artwork");
    await editor.getByLabel("Definition type").selectOption("circuit");
    await expect(editor.getByLabel("External model netlist")).toBeVisible();
    await editor.getByLabel("Definition type").selectOption("json");
    await expect(editor.getByLabel("Component definition code")).toContainText(
      "Discarded artwork",
    );
    await expect(
      editor.getByRole("button", { name: "Discard changes", exact: true }),
    ).toHaveCount(0);
  } finally {
    service.close();
  }
});

test("connected custom native port rename preserves graphical mapping, Nets and No Connects", async ({
  page,
  context,
}) => {
  const service = library();
  try {
    await service.connect(context, null);
    await openEditor(page);
    let editor = await openNativeComponent(page);
    await authoringView(editor, "Circuit");
    await editor.getByLabel("External model netlist").fill(finiteGainSource);
    await authoringView(editor, "Circuit");
    await editor
      .getByLabel("External model entry", { exact: true })
      .selectOption("finite_gain");
    await authoringView(editor, "Symbol");
    await editor.getByLabel("Symbol mode").selectOption("custom");
    await authoringView(editor, "Symbol");
    const jsonCode = editor.getByRole("textbox", {
      name: "Circuit symbol JSON",
      exact: true,
    });
    await jsonCode.focus();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+c");
    const custom = JSON.parse(
      await page.evaluate(() => navigator.clipboard.readText()),
    );
    custom.symbol.pins.find((pin: { name: string }) => pin.name === "IN").name =
      "sense";
    custom.circuitBinding.terminals.find(
      (mapping: { pinName: string }) => mapping.pinName === "IN",
    ).pinName = "sense";
    await jsonCode.fill(JSON.stringify(custom, null, 2));
    await editor
      .getByRole("button", { name: "Apply & Place", exact: true })
      .click();
    await expect(editor).toHaveCount(0);
    await place(page, 400, 220);
    await placeComponent(page, "voltage-source", { x: 150, y: 350 });
    await placeComponent(page, "ground", { x: 480, y: 460 });
    for (const [from, to] of [
      ["V1-+", "X1-IN"],
      ["V1--", "GND1-0"],
      ["X1-VSS", "GND1-0"],
    ]) {
      await clickDrawTool(page, "wire");
      await page.getByTestId(`terminal-${from}`).click();
      await page.getByTestId(`terminal-${to}`).click();
      await page.keyboard.press("Escape");
    }
    await page.getByTestId("terminal-X1-OUT").click({ button: "right" });
    await openSelectionShelf(page);
    await page
      .getByRole("button", { name: "Mark No Connect", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await page.getByTestId("hit-X1").click();
    await setComponentParameter(page, "gain", "20");
    const before = await readProject(page);
    const beforeDeck = await copyNetlistText(page, "spice");
    await expectNativePreparation(before, beforeDeck);
    const beforeOwner = before.externalSubcircuitDefinitions[0]!;
    const originalArtwork = before.componentDefinitions!.find(
      (item) =>
        item.symbol.id ===
        before.documents[0]!.instances.find((item) => item.id === "X1")!
          .symbolId,
    )!;
    await page.getByTestId("hit-X1").click({ button: "right" });
    await page
      .getByRole("menuitem", {
        name: "Edit Component Definition (E)",
        exact: true,
      })
      .click();
    editor = page.getByRole("dialog", {
      name: "Edit Component Definition",
      exact: true,
    });
    await authoringView(editor, "Circuit");
    await editor
      .getByLabel("External model netlist")
      .fill(finiteGainSource.replace(/\bIN\b/gu, "INPUT"));
    await authoringView(editor, "Circuit");
    await editor.getByLabel("Migrate finite_gain.IN").selectOption("INPUT");
    await editor
      .getByRole("button", { name: "Apply model", exact: true })
      .click();
    await expect(editor.getByRole("status")).toContainText("Applied");
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
    expect(
      renamed.componentDefinitions!.find(
        (item) => item.symbol.id === originalArtwork.symbol.id,
      ),
    ).toEqual(originalArtwork);
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
    expect(
      analyzeDesignNetlist(renamed).diagnostics.filter(
        (item) => item.severity === "error",
      ),
    ).toEqual([]);
    expect(await copyNetlistText(page, "spice")).toContain(
      ".subckt finite_gain INPUT OUT VSS",
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect(electricalMeaning(await readProject(page))).toEqual(
      electricalMeaning(before),
    );
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    expect(electricalMeaning(await readProject(page))).toEqual(
      electricalMeaning(renamed),
    );
    await page.reload();
    await awaitEditorReady(page);
    expect(electricalMeaning(await readProject(page))).toEqual(
      electricalMeaning(renamed),
    );
    await openCellManager(page);
    const manager = page.getByRole("dialog", {
      name: "Cell Manager",
      exact: true,
    });
    await manager
      .getByRole("tab", { name: "External Circuits", exact: true })
      .click();
    await manager
      .locator(".cell-manager-list-item")
      .filter({ hasText: "finite_gain" })
      .last()
      .click();
    await manager.getByLabel("External model netlist").fill(
      finiteGainSource
        .replace(/\bIN\b/gu, "INPUT")
        .replace("INPUT OUT VSS params:", "OUT INPUT VSS params:")
        .replace("gain=10", "gain=40"),
    );
    await manager
      .getByRole("button", { name: "Apply model", exact: true })
      .click();
    await expect(manager.getByRole("status")).toContainText("Applied");
    await manager
      .getByRole("button", { name: "Close Cell Manager", exact: true })
      .click();
    const reordered = await readProject(page);
    expect(
      reordered.externalSubcircuitDefinitions[0]!.terminals.map(
        (terminal) => terminal.id,
      ),
    ).toEqual([
      beforeOwner.terminals[1]!.id,
      beforeOwner.terminals[0]!.id,
      beforeOwner.terminals[2]!.id,
    ]);
    expect(reordered.documents[0]!.nets).toEqual(renamed.documents[0]!.nets);
    expect(reordered.documents[0]!.noConnects).toEqual(
      renamed.documents[0]!.noConnects,
    );
    expect(
      reordered.documents[0]!.instances.find(
        (instance) => instance.id === "X1",
      )!.netlist!.parameters!.gain,
    ).toBe("20");
    expect(
      reordered.componentDefinitions!.find(
        (item) => item.symbol.id === originalArtwork.symbol.id,
      ),
    ).toEqual(originalArtwork);
    const reorderedDeck = await copyNetlistText(page, "spice");
    const oldNodes = beforeDeck
      .split("\n")
      .find((line) => /^X1\s/u.test(line))!
      .trim()
      .split(/\s+/u);
    const newNodes = reorderedDeck
      .split("\n")
      .find((line) => /^X1\s/u.test(line))!
      .trim()
      .split(/\s+/u);
    expect(newNodes.slice(1, 4)).toEqual([
      oldNodes[2],
      oldNodes[1],
      oldNodes[3],
    ]);
    expect(reorderedDeck).toContain("gain=40");
    expect(newNodes).toContain("gain=20");
    await expectNativePreparation(reordered, reorderedDeck);
    const saved = await downloadBytes(page, "File", "Export Project File…");
    await page.getByTestId("project-file").setInputFiles({
      name: "reordered-native.icproj.json",
      mimeType: "application/json",
      buffer: saved,
    });
    await awaitEditorReady(page);
    const reopened = await readProject(page);
    expect(electricalMeaning(reopened)).toEqual(electricalMeaning(reordered));
    expect(
      reopened.componentDefinitions!.find(
        (item) => item.symbol.id === originalArtwork.symbol.id,
      ),
    ).toEqual(originalArtwork);
    expect(await copyNetlistText(page, "spice")).toBe(reorderedDeck);
    await expectNativePreparation(reopened, reorderedDeck);
  } finally {
    service.close();
  }
});

test("Agent native port removal captures repaired custom artwork and detaches removed No Connects atomically", async ({
  page,
  context,
  baseURL,
}) => {
  const service = library();
  try {
    await service.connect(context, null);
    await openEditor(page);
    const editor = await openNativeComponent(page);
    await authoringView(editor, "Circuit");
    await editor.getByLabel("External model netlist").fill(finiteGainSource);
    await authoringView(editor, "Circuit");
    await editor
      .getByLabel("External model entry", { exact: true })
      .selectOption("finite_gain");
    await authoringView(editor, "Symbol");
    await editor.getByLabel("Symbol mode").selectOption("custom");
    await editor
      .getByRole("button", { name: "Apply & Place", exact: true })
      .click();
    await expect(editor).toHaveCount(0);
    await place(page, 400, 220);
    await placeComponent(page, "ground", { x: 480, y: 460 });
    for (const pin of ["IN", "VSS"]) {
      await clickDrawTool(page, "wire");
      await page.getByTestId(`terminal-X1-${pin}`).click();
      await page.getByTestId("terminal-GND1-0").click();
      await page.keyboard.press("Escape");
    }
    await page.getByTestId("terminal-X1-OUT").click({ button: "right" });
    await openSelectionShelf(page);
    await page
      .getByRole("button", { name: "Mark No Connect", exact: true })
      .click();
    await page.keyboard.press("Escape");
    const before = await readProject(page);
    const owner = before.externalSubcircuitDefinitions[0]!;
    const original = before.componentDefinitions!.find(
      (item) => item.circuitBinding,
    )!;
    const repaired = structuredClone(original);
    repaired.symbol.id += "-removed-output";
    repaired.symbol.pins = repaired.symbol.pins.filter(
      (pin) => pin.name === "VSS",
    );
    repaired.circuitBinding!.terminals =
      repaired.circuitBinding!.terminals.filter(
        (mapping) =>
          mapping.terminalId ===
          owner.terminals.find((terminal) => terminal.name === "VSS")!.id,
      );
    const source = structuredClone(before.modelSources![0]!);
    source.files[0]!.text =
      ".subckt finite_gain VSS\nR1 VSS 0 1k\n.ends finite_gain\n.subckt owned_helper A B\nR1 A B 1k\n.ends owned_helper\n";
    await page.getByTestId("open-agent").click();
    const panel = page.getByTestId("connect-agent-panel");
    const claim = panel.getByTestId("agent-copy-text");
    await expect(claim).toHaveValue(/Claim: /, { timeout: 45000 });
    const client = new AgentSessionClient({
      http: new AgentHttpClient({ baseUrl: baseURL! }),
    });
    await client.connect(
      JSON.parse(/^Claim: (.+)$/mu.exec(await claim.inputValue())![1]!)
        .claimCode,
    );
    await panel.getByRole("button", { name: "Close Agent dialog" }).click();
    const result = await client.advancedTransact({
      structureEdits: [
        {
          kind: "apply_model_source",
          source,
          definitions: [
            {
              definitionId: owner.id,
              entry: "finite_gain",
              portMap: { IN: null, OUT: null },
              symbol: repaired,
              callers: [
                {
                  documentId: before.documents[0]!.id,
                  instanceId: "X1",
                  expectedSymbolId: original.symbol.id,
                },
              ],
            },
          ],
        },
      ],
    });
    expect(result.ok, result.message).toBe(true);
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
    expect(after.documents[0]!.routes).toHaveLength(
      before.documents[0]!.routes.length,
    );
    expect(after.documents[0]!.junctions.length).toBeGreaterThan(
      before.documents[0]!.junctions.length,
    );
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
      after.documents[0]!.instances.find((instance) => instance.id === "X1")!
        .symbolId,
    ).toBe(repaired.symbol.id);
    expect(
      after.componentDefinitions!.find(
        (item) => item.symbol.id === repaired.symbol.id,
      )!.circuitBinding,
    ).toEqual(repaired.circuitBinding);
    expect(
      analyzeDesignNetlist(after).diagnostics.filter(
        (item) => item.severity === "error",
      ),
    ).toEqual([]);
    expect(await copyNetlistText(page, "spice")).toContain(
      ".subckt finite_gain VSS",
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect(electricalMeaning(await readProject(page))).toEqual(
      electricalMeaning(before),
    );
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    expect(electricalMeaning(await readProject(page))).toEqual(
      electricalMeaning(after),
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await openCellManager(page);
    const manager = page.getByRole("dialog", {
      name: "Cell Manager",
      exact: true,
    });
    await manager
      .getByRole("tab", { name: "External Circuits", exact: true })
      .click();
    await manager
      .locator(".cell-manager-list-item")
      .filter({ hasText: "finite_gain" })
      .last()
      .click();
    await manager
      .getByLabel("External model netlist")
      .fill(source.files[0]!.text);
    await manager
      .getByLabel("Migrate finite_gain.IN")
      .selectOption("__disconnect");
    await manager
      .getByLabel("Migrate finite_gain.OUT")
      .selectOption("__disconnect");
    await manager
      .getByRole("button", { name: "Apply model", exact: true })
      .click();
    await expect(manager.getByRole("status")).toContainText("Applied");
    await manager
      .getByRole("button", { name: "Close Cell Manager", exact: true })
      .click();
    const managerRemoval = await readProject(page);
    expect(electricalMeaning(managerRemoval)).toEqual(electricalMeaning(after));
    expect(
      managerRemoval
        .componentDefinitions!.find(
          (item) =>
            item.symbol.id ===
            managerRemoval.documents[0]!.instances.find(
              (item) => item.id === "X1",
            )!.symbolId,
        )!
        .symbol.pins.map((pin) => pin.name),
    ).toEqual(["VSS"]);
  } finally {
    service.close();
  }
});

for (const placement of ["unplaced", "different placed capture"] as const) {
  test(`native port removal migrates preferred artwork with ${placement}`, async ({
    page,
    context,
  }) => {
    const service = library();
    try {
      await service.connect(context, null);
      await openEditor(page);
      let editor = await openNativeComponent(page);
      await authoringView(editor, "Circuit");
      await editor.getByLabel("External model netlist").fill(finiteGainSource);
      await authoringView(editor, "Circuit");
      await editor
        .getByLabel("External model entry", { exact: true })
        .selectOption("finite_gain");
      await authoringView(editor, "Symbol");
      await editor.getByLabel("Symbol mode").selectOption("custom");
      await editor
        .getByRole("button", { name: "Apply model", exact: true })
        .click();
      await expect(editor.getByRole("status")).toContainText("Applied");
      if (placement === "different placed capture") {
        await editor
          .getByRole("button", { name: "Place", exact: true })
          .click();
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
        await editor
          .getByLabel("External model source owner", { exact: true })
          .selectOption(placed.modelSources![0]!.id);
        await authoringView(editor, "Circuit");
        await editor
          .getByLabel("External model entry", { exact: true })
          .selectOption("finite_gain");
        await authoringView(editor, "Symbol");
        await editor.getByLabel("Symbol mode").selectOption("custom");
        await editor
          .getByRole("textbox", { name: "Circuit symbol JSON", exact: true })
          .fill(JSON.stringify(artwork, null, 2));
        await editor
          .getByRole("button", { name: "Apply model", exact: true })
          .click();
        await expect(editor.getByRole("status")).toContainText("Applied");
      }
      await editor
        .getByLabel("Close component editor", { exact: true })
        .click();
      const before = await readProject(page);
      const oldPreference = before.externalSubcircuitDefinitions[0]!.symbolId!;
      expect(
        before.documents[0]!.instances.map((item) => item.symbolId),
      ).not.toContain(oldPreference);
      await openCellManager(page);
      const manager = page.getByRole("dialog", {
        name: "Cell Manager",
        exact: true,
      });
      await manager
        .getByRole("tab", { name: "External Circuits", exact: true })
        .click();
      await manager
        .locator(".cell-manager-list-item")
        .filter({ hasText: "finite_gain" })
        .last()
        .click();
      await manager
        .getByLabel("External model netlist")
        .fill(
          ".subckt finite_gain IN VSS params: gain=10\nR1 IN VSS {gain}\n.ends finite_gain\n",
        );
      await manager
        .getByLabel("Migrate finite_gain.OUT")
        .selectOption("__disconnect");
      await manager
        .getByRole("button", { name: "Apply model", exact: true })
        .click();
      await expect(manager.getByRole("status")).toContainText("Applied");
      await manager.getByRole("button", { name: "Place", exact: true }).click();
      await place(page, 650, 320);
      for (const reference of placement === "unplaced" ? ["X1"] : ["X1", "X2"])
        for (const pin of ["IN", "VSS"]) {
          await page
            .getByTestId(`terminal-${reference}-${pin}`)
            .click({ button: "right" });
          await openSelectionShelf(page);
          await page
            .getByRole("button", { name: "Mark No Connect", exact: true })
            .click();
          await page.keyboard.press("Escape");
        }
      const after = await readProject(page);
      const definition = after.externalSubcircuitDefinitions[0]!;
      expect(definition.terminals.map((terminal) => terminal.name)).toEqual([
        "IN",
        "VSS",
      ]);
      expect(definition.symbolId).not.toBe(oldPreference);
      const preferred = after.componentDefinitions!.find(
        (item) => item.symbol.id === definition.symbolId,
      )!;
      expect(preferred.symbol.pins.map((pin) => pin.name)).toEqual([
        "IN",
        "VSS",
      ]);
      expect(preferred.symbol.primitives).toEqual(
        before.componentDefinitions!.find(
          (item) => item.symbol.id === oldPreference,
        )!.symbol.primitives,
      );
      expect(after.documents[0]!.instances.at(-1)!.symbolId).toBe(
        definition.symbolId,
      );
      for (const instance of after.documents[0]!.instances) {
        const capture = after.componentDefinitions!.find(
          (item) => item.symbol.id === instance.symbolId,
        )!;
        expect(capture.symbol.pins.map((pin) => pin.name)).toEqual([
          "IN",
          "VSS",
        ]);
      }
      expect(
        analyzeDesignNetlist(after).diagnostics.filter(
          (item) => item.severity === "error",
        ),
      ).toEqual([]);
      expect(await copyNetlistText(page, "spice")).toContain(
        after.modelSources![0]!.files[0]!.text,
      );
    } finally {
      service.close();
    }
  });
}
