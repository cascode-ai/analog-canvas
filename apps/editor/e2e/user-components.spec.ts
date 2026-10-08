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
import { writeFile } from "node:fs/promises";
import { AgentHttpClient } from "../../../packages/agent-client/src/http-client";
import { AgentSessionClient } from "../../../packages/agent-client/src/session-client";
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
  await awaitEditorReady(page);
  await expect(page.getByTestId("shapes-category-user-defined")).toHaveCount(0);
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
    for (const entrance of ["user", "manager"]) {
      await openEditor(page);
      let editor;
      if (entrance === "user") editor = await openNativeComponent(page);
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
      if (entrance === "user") {
        await writeFile(
          testInfo.outputPath("native-user-component.icproj.json"),
          serializeProject(reopened),
        );
        await page.getByTestId("hit-X1").click();
        await page.keyboard.press("ControlOrMeta+c");
        await page
          .getByRole("button", { name: "New project tab", exact: true })
          .click();
        for (const x of [250, 500]) {
          await page.keyboard.press("ControlOrMeta+v");
          await place(page, x, 260);
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
