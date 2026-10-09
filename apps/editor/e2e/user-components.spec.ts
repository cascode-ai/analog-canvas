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
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import {
  createEmptyProject,
  createSimulationFolder,
  routeEnd,
  type CircuitProject,
} from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { prepareNgspiceExecutionInput } from "../../../packages/simulation-service/src/prepare-ngspice";
import { profile } from "./simulation-e2e-fixtures";
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
    await editor.getByLabel("External model netlist").fill(finiteGainSource);
    await editor
      .getByLabel("External model entry", { exact: true })
      .selectOption("finite_gain");
    await editor.getByLabel("Symbol mode").selectOption("custom");
    await editor
      .getByRole("button", { name: "Apply model", exact: true })
      .click();
    await expect(editor.getByRole("status")).toContainText("Applied");
    await expect(
      editor.getByRole("button", { name: "Save publicly", exact: true }),
    ).toBeEnabled();
    await editor
      .getByRole("button", { name: "Save publicly", exact: true })
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
    await openUserComponents(insertedPage);
    await insertedPage
      .getByRole("button", { name: "Place finite_gain", exact: true })
      .click();
    await place(insertedPage, 400, 220);
    const inserted = await readProject(insertedPage);
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
    await page
      .getByRole("button", { name: "Edit finite_gain definition", exact: true })
      .click();
    const libraryEditor = page.getByRole("dialog", {
      name: "Edit Component Definition",
      exact: true,
    });
    await expect(
      libraryEditor.getByLabel("External model netlist"),
    ).toBeVisible();
    await libraryEditor
      .getByLabel("External model netlist")
      .fill(finiteGainSource.replace("gain=10", "gain=40"));
    await expect(
      libraryEditor.getByRole("button", { name: "Save publicly", exact: true }),
    ).toBeDisabled();
    await libraryEditor
      .getByRole("button", { name: "Apply model", exact: true })
      .click();
    await libraryEditor
      .getByRole("button", { name: "Save publicly", exact: true })
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
    expect(await readProject(page)).toEqual(beforeLibraryEdit);
    expect(await copyNetlistText(insertedPage, "spice")).toBe(copied);
    expect((await readProject(insertedPage)).modelSources).toEqual(
      inserted.modelSources,
    );
    const beforeConflictingInsert = await readProject(insertedPage);
    await openUserComponents(insertedPage);
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
    await adminPage
      .getByRole("button", { name: "Edit finite_gain definition", exact: true })
      .click();
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
    await editor.getByLabel("External model netlist").fill(finiteGainSource);
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
      .getByRole("button", { name: "Save publicly", exact: true })
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
    await receiver
      .getByRole("button", { name: "Edit finite_gain definition", exact: true })
      .click();
    const forkEditor = receiver.getByRole("dialog", {
      name: "Edit Component Definition",
      exact: true,
    });
    await expect(
      forkEditor.getByRole("button", {
        name: "Save as new component",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(
      forkEditor.getByRole("button", { name: "Delete component", exact: true }),
    ).toHaveCount(0);
    await forkEditor
      .getByRole("button", { name: "Save as new component", exact: true })
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
    expect(await readProject(receiver)).toEqual(captured);
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
    await localEditor
      .getByLabel("External model netlist")
      .fill(finiteGainSource.replace("gain=10", "gain=25"));
    await localEditor.getByText("More", { exact: true }).click();
    await localEditor
      .getByRole("button", { name: "Save draft", exact: true })
      .click();
    await expect(
      localEditor.getByRole("button", { name: "Save publicly", exact: true }),
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
    await receiver
      .locator(".user-component-tile")
      .filter({ hasText: "bob" })
      .getByRole("button", { name: "Edit finite_gain definition", exact: true })
      .click();
    const draftEditor = receiver.getByRole("dialog", {
      name: "Edit Component Definition",
      exact: true,
    });
    await draftEditor
      .getByLabel("External model netlist")
      .fill(finiteGainSource.replace("gain=10", "gain=50"));
    await draftEditor.getByText("More", { exact: true }).click();
    await draftEditor
      .getByRole("button", { name: "Save draft", exact: true })
      .click();
    await expect(
      draftEditor.getByRole("button", { name: "Save publicly", exact: true }),
    ).toBeDisabled();
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
    await expect(
      dialog.getByText("Implementation missing", { exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: "Repair implementation", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Place", exact: true }),
    ).toHaveCount(0);
    await dialog
      .getByLabel("External model netlist", { exact: true })
      .fill(".subckt incomplete IN OUT VSS\n");
    await dialog
      .getByRole("button", { name: "Apply model", exact: true })
      .click();
    await expect(dialog.getByRole("status")).toBeVisible();
    expect((await client.refreshSnapshot()).snapshot.project).toEqual(original);
    await dialog
      .getByRole("textbox", { name: "External model netlist", exact: true })
      .fill(finiteGainSource);
    await dialog
      .getByLabel("External model entry", { exact: true })
      .selectOption("finite_gain");
    await dialog
      .getByRole("button", { name: "Apply model", exact: true })
      .click();
    await expect(dialog.getByRole("status")).toContainText(
      /terminal|mapping/iu,
    );
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
    await expect(dialog.getByRole("status")).toContainText("Project changed");
    expect((await client.refreshSnapshot()).snapshot.project).toEqual(live);
    await dialog.getByLabel("Close component editor", { exact: true }).click();
    await dialog
      .getByRole("button", { name: "Discard changes", exact: true })
      .click();
    before = await readProject(page);
    await page.getByTestId("hit-X1").click();
    await page.keyboard.press("e");
    await dialog
      .getByRole("button", { name: "Repair implementation", exact: true })
      .click();
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
    await expect(dialog.getByRole("status")).toContainText("Applied");
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
    await expect(dialog.getByRole("status")).toContainText("Applied");
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
    await expect(
      editor.getByLabel("Repair model", { exact: true }),
    ).toBeVisible();
    await editor
      .getByLabel("Repair model", { exact: true })
      .selectOption(before.externalSubcircuitDefinitions[0]!.id);
    for (const [old, next] of [
      ["A", "IN"],
      ["B", "OUT"],
      ["GND", "VSS"],
    ])
      await editor
        .getByLabel(`Map legacy ${old}`, { exact: true })
        .selectOption(next!);
    await editor
      .getByRole("button", { name: "Apply repair", exact: true })
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
    const captured = await readProject(page);
    const visitor = await other.newPage();
    await openEditor(visitor);
    const empty = await readProject(visitor);
    for (const [target, save] of [
      [visitor, "Save as new component"],
      [page, "Save publicly"],
    ] as const) {
      await openUserComponents(target);
      await target
        .locator(".user-component-tile")
        .filter({ hasText: "alice" })
        .getByRole("button", {
          name: "Edit Legacy public repair definition",
          exact: true,
        })
        .click();
      const editor = target.getByRole("dialog", {
        name: "Edit Component Definition",
        exact: true,
      });
      await editor
        .getByRole("button", { name: "Repair implementation", exact: true })
        .click();
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
    expect(await readProject(page)).toEqual(captured);
    expect(await readProject(visitor)).toEqual(empty);
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
    await expect(
      tile.getByText("Implementation missing", { exact: true }),
    ).toBeVisible();
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
    await openUserComponents(page);
    await expect(
      page.getByRole("button", { name: "Place Ring resistor", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("dialog", { name: "User Components", exact: true })
      .getByRole("button", { name: "Close", exact: true })
      .click();
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
    await openUserComponents(receiver);
    await receiver
      .getByRole("button", { name: "Place Shared amplifier", exact: true })
      .click();
    await place(receiver);
    const received = await readProject(receiver);
    expect(received.componentDefinitions).toEqual(captured);
    await openUserComponents(receiver);
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
    await openUserComponents(administrator);
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
    await openUserComponents(page);
    await page
      .getByRole("button", { name: "Create Component…", exact: true })
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
    await editor.getByLabel("External model netlist").fill(model);
    await editor
      .getByRole("button", { name: "Apply model", exact: true })
      .click();
    await expect(editor.getByLabel("Parsed model interface")).toContainText(
      "IN",
    );
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
      await editor.getByLabel("External model netlist").fill(finiteGainSource);
      await editor
        .getByLabel("External model entry", { exact: true })
        .selectOption("finite_gain");
      if (entrance === "user-custom")
        await editor
          .getByLabel("Symbol mode", { exact: true })
          .selectOption("custom");
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
    await editor.getByLabel("External model netlist").fill(finiteGainSource);
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
    await editor
      .getByLabel("External model source owner", { exact: true })
      .selectOption(owner.id);
    await editor
      .getByLabel("External model entry", { exact: true })
      .selectOption("finite_gain");
    await editor
      .getByLabel("Model format", { exact: true })
      .selectOption("spectre");
    await expect(editor.getByLabel("External model netlist")).toContainText(
      "subckt finite_gain (IN OUT VSS)",
    );
    await editor
      .getByLabel("Model format", { exact: true })
      .selectOption("spice");
    const pendingText = finiteGainSource.replace("gain=10", "gain=17");
    await editor.getByLabel("External model netlist").fill(pendingText);
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
    ).toBeVisible();
    await editor
      .getByRole("button", { name: "Keep editing", exact: true })
      .click();
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
      .filter({ hasText: "finite_gain" })
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
    await editor.getByLabel("External model netlist").fill(finiteGainSource);
    await editor
      .getByLabel("External model entry", { exact: true })
      .selectOption("finite_gain");
    await editor
      .getByLabel("Symbol mode", { exact: true })
      .selectOption("custom");
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
    await editor.getByLabel("External model netlist").fill(finiteGainSource);
    await editor
      .getByLabel("External model entry", { exact: true })
      .selectOption("finite_gain");
    await editor.getByLabel("Symbol mode").selectOption("custom");
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
    const accepted = await client.advancedTransact({
      structureEdits: [
        {
          kind: "apply_model_source",
          source: applied.modelSources![0]!,
          definitions: [
            {
              definitionId: captured.circuitBinding!.definitionId,
              entry: "finite_gain",
              symbol: component,
            },
          ],
        },
      ],
    });
    expect(accepted.ok).toBe(true);
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
    await editor.getByLabel("External model netlist").fill(finiteGainSource);
    await editor
      .getByLabel("External model entry", { exact: true })
      .selectOption("finite_gain");
    await editor
      .getByLabel("Symbol mode", { exact: true })
      .selectOption("custom");
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
    await expect(editor.getByRole("alert")).toContainText(
      "different native terminals",
    );
    await editor
      .getByRole("button", { name: "Apply model", exact: true })
      .click();
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
    await editor.getByLabel("External model netlist").fill(finiteGainSource);
    await editor
      .getByLabel("External model entry", { exact: true })
      .selectOption("finite_gain");
    await editor
      .getByLabel("Symbol mode", { exact: true })
      .selectOption("custom");
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
    await expect(editor.getByLabel("Symbol mode")).toHaveValue("custom");
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
    await expect(editor.getByRole("status")).toContainText("immutable");
    artwork.symbol.id += "-moved";
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
    ).toBe(artwork.symbol.id);
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
    await expect(editor.getByLabel("Symbol mode")).toHaveValue("custom");
    await editor.getByLabel("Symbol mode").selectOption("automatic");
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

test("saving a source draft does not mark pending custom artwork saved or discard it", async ({
  page,
  context,
}) => {
  const service = library();
  try {
    await service.connect(context, null);
    await openEditor(page);
    const editor = await openNativeComponent(page);
    await editor.getByLabel("External model netlist").fill(finiteGainSource);
    await editor
      .getByLabel("External model entry", { exact: true })
      .selectOption("finite_gain");
    await editor.getByLabel("Symbol mode").selectOption("custom");
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
    await expect(editor.getByRole("status")).toContainText("artwork");
    await editor.getByLabel("Close component editor", { exact: true }).click();
    await editor
      .getByRole("button", { name: "Keep editing", exact: true })
      .click();
    await code.focus();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+c");
    expect(
      JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))
        .symbol.name,
    ).toBe("Pending artwork");
    await editor
      .getByRole("button", { name: "Apply & Place", exact: true })
      .click();
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
      await editor
        .getByLabel("External model netlist")
        .fill(
          finiteGainSource
            .split(".subckt owned_helper")[0]!
            .replaceAll("finite_gain", name),
        );
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
    await editor.getByLabel("External model netlist").fill(finiteGainSource);
    await editor
      .getByLabel("External model entry", { exact: true })
      .selectOption("finite_gain");
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
    await editor
      .getByLabel("External model netlist")
      .fill(
        finiteGainSource.replace(
          "IN OUT VSS params:",
          "IN OUT VSS EXTRA params:",
        ),
      );
    await expect(editor.getByRole("alert")).toContainText("EXTRA");
    await editor
      .getByRole("button", { name: "Apply model", exact: true })
      .click();
    await expect(editor.getByRole("status")).toContainText("EXTRA");
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
    await editor
      .getByLabel("External model netlist")
      .fill(
        finiteGainSource.replace(
          "IN OUT VSS params:",
          "IN OUT VSS EXTRA params:",
        ),
      );
    await editor.getByLabel("Symbol mode").selectOption("automatic");
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

test("discarding a JSON draft before switching to native authoring restores the saved artwork", async ({
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
    await editor
      .getByRole("button", { name: "Discard changes", exact: true })
      .click();
    await expect(editor.getByLabel("External model netlist")).toBeVisible();
    await editor.getByLabel("Definition type").selectOption("json");
    await expect(
      editor.getByLabel("Component definition code"),
    ).not.toContainText("Discarded artwork");
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
    await editor.getByLabel("External model netlist").fill(finiteGainSource);
    await editor
      .getByLabel("External model entry", { exact: true })
      .selectOption("finite_gain");
    await editor.getByLabel("Symbol mode").selectOption("custom");
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
    await editor
      .getByLabel("External model netlist")
      .fill(finiteGainSource.replace(/\bIN\b/gu, "INPUT"));
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
    await editor.getByLabel("External model netlist").fill(finiteGainSource);
    await editor
      .getByLabel("External model entry", { exact: true })
      .selectOption("finite_gain");
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
      await editor.getByLabel("External model netlist").fill(finiteGainSource);
      await editor
        .getByLabel("External model entry", { exact: true })
        .selectOption("finite_gain");
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
        await editor
          .getByLabel("External model source owner", { exact: true })
          .selectOption(placed.modelSources![0]!.id);
        await editor
          .getByLabel("External model entry", { exact: true })
          .selectOption("finite_gain");
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
