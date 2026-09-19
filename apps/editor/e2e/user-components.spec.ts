import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { createEmptyProject, type CircuitProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import {
  ComponentLibraryDO,
  routeComponentLibraryRequest,
} from "../../../worker/component-library";

/** Browser journeys use the real HTTP policy and SQLite storage, with isolated test sessions. */
function library() {
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
  await expect(page.getByTestId("schematic-canvas")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "+ Create component", exact: true }),
  ).toBeVisible();
}
async function readProject(page: Page): Promise<CircuitProject> {
  const editor = page.getByRole("textbox", {
    name: "Project code",
    exact: true,
  });
  if (!(await editor.isVisible()))
    await page.getByTestId("project-code-toggle").click();
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+c");
  const project = JSON.parse(
    await page.evaluate(() => navigator.clipboard.readText()),
  );
  await page.getByTestId("project-code-toggle").click();
  return project;
}
async function editDefinition(page: Page, name: string) {
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
async function place(page: Page, x = 350, y = 300) {
  await page.getByTestId("schematic-canvas").click({ position: { x, y } });
  await page.keyboard.press("Escape");
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
    await page
      .getByRole("button", { name: "Save & apply", exact: true })
      .click();
    await expect(
      page.getByText("Library temporarily unavailable"),
    ).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "Edit Component Definition" }),
    ).toBeVisible();
    await context.unroute("**/api/components**", rejectSave);
    await page
      .getByRole("button", { name: "Save & apply", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Edit Component Definition" }),
    ).toHaveCount(0);
    const changed = await readProject(page);
    expect(changed.documents[0]!.instances[0]!.symbolId).toMatch(/^user-/);
    expect(changed.documents[0]!.instances[1]).toEqual(
      project.documents[0]!.instances[1],
    );
    expect(changed.componentDefinitions).toHaveLength(2);
    await expect(
      page.getByRole("button", { name: "Place Ring resistor", exact: true }),
    ).toBeVisible();
    await page.getByTestId("hit-R1").click();
    await page.keyboard.press("ControlOrMeta+z");
    expect(
      (await readProject(page)).documents[0]!.instances.map(
        (item) => item.symbolId,
      ),
    ).toEqual(["resistor", "resistor"]);
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
  const service = library();
  const second = await browser.newContext();
  const admin = await browser.newContext();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await service.connect(context, "alice");
    await openEditor(page);
    const extended = await page
      .getByTestId("shapes-category-extended-devices")
      .boundingBox();
    const shared = await page
      .getByTestId("shapes-category-user-defined")
      .boundingBox();
    expect(shared!.y).toBeGreaterThan(extended!.y);
    await page
      .getByRole("button", { name: "+ Create component", exact: true })
      .click();
    await editDefinition(page, "Shared amplifier");
    await expect(
      page.getByLabel("Component preview").locator("circle"),
    ).toHaveCount(1);
    await page.screenshot({
      path: "plan/user-component-definition-editor.png",
    });
    await page
      .getByRole("button", { name: "Save & place", exact: true })
      .click();
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
    await receiver
      .getByRole("button", { name: "Place Shared amplifier", exact: true })
      .click();
    await place(receiver);
    const received = await readProject(receiver);
    expect(received.componentDefinitions).toEqual(captured);
    await receiver
      .getByRole("button", {
        name: "Edit Shared amplifier definition",
        exact: true,
      })
      .click();
    await expect(
      receiver.getByRole("button", {
        name: "Save as new component",
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
    await administrator
      .getByRole("button", {
        name: "Edit Shared amplifier definition",
        exact: true,
      })
      .click();
    await administrator
      .getByRole("button", { name: "Promote to official", exact: true })
      .click();
    await expect(
      administrator.getByText("Promoted to an official component."),
    ).toBeVisible();
    administrator.once("dialog", (dialog) => dialog.accept());
    await administrator
      .getByRole("button", { name: "Delete component", exact: true })
      .click();
    await expect(
      administrator.getByText("Removed from the library."),
    ).toBeVisible();
    await administrator
      .getByRole("button", { name: "Close component editor" })
      .click();
    await receiver.reload();
    await expect(
      receiver.getByRole("button", {
        name: "Place Shared amplifier",
        exact: true,
      }),
    ).toHaveCount(0);
    expect((await readProject(page)).componentDefinitions).toEqual(captured);
    await administrator
      .getByRole("checkbox", { name: "Deleted", exact: true })
      .check();
    await administrator
      .getByRole("button", {
        name: "Edit Shared amplifier definition",
        exact: true,
      })
      .click();
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

test("anonymous creation cannot save privately, and invalid code leaves the circuit untouched", async ({
  page,
  context,
}) => {
  const service = library();
  try {
    await service.connect(context, null);
    await openEditor(page);
    await page
      .getByRole("button", { name: "+ Create component", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Save & place", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText("Sign in to save.", { exact: false }),
    ).toBeVisible();
    const code = page.getByRole("textbox", {
      name: "Component definition code",
      exact: true,
    });
    await code.fill("{");
    await expect(page.getByRole("alert")).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Close component editor" }).click();
    expect((await readProject(page)).documents[0]!.instances).toHaveLength(0);
  } finally {
    service.close();
  }
});
