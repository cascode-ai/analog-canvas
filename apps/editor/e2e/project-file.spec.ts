import { parseSavedProject } from "./editor-fixtures";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { subcircuitDescriptor } from "@icm/devices";
import { createDesignNetlistExport } from "@icm/netlist";
import { parseProject } from "@icm/project-protocol";
import { AgentHttpClient } from "../../../packages/agent-client/src/http-client.js";
import {
  createEmptyProject,
  CURRENT_MODEL_SCHEMA_VERSION,
  type CircuitProject,
  type SymbolDefinition,
} from "@icm/model";

import { AGENT_SESSION_RECOVERY_STORAGE_KEY } from "../src/agent/session-recovery";
import { WORKING_COPY_STORAGE_KEY } from "../src/document/recovery-coordinator";
import { CLOUD_PROJECT_LIMIT } from "../src/features/editor-shell/cloud-projects";
import {
  awaitEditorReady,
  chooseComponent,
  clickNetlistWorkflowCommand,
  downloadBytes,
  openMenu,
  recoveryProjectTexts,
} from "./editor-fixtures.js";

async function mockCloudProjects(page: Page) {
  let stored: {
    id: string;
    name: string;
    projectText: string;
    updatedAt: string;
    revision: number;
    schemaVersion: number;
  } | null = null;
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u1",
          displayName: "Circuit Author",
          email: "author@example.com",
          provider: "github",
          isAdmin: false,
        },
      },
    }),
  );
  await page.route("**/api/projects", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: { projects: stored ? [stored] : [] } });
    }
    const body = route.request().postDataJSON() as {
      name: string;
      projectText: string;
    };
    const parsed = JSON.parse(body.projectText) as { schemaVersion: number };
    stored = {
      id: "cloud-1",
      name: body.name,
      projectText: body.projectText,
      updatedAt: "2026-08-28T10:00:00.000Z",
      revision: 1,
      schemaVersion: parsed.schemaVersion,
    };
    return route.fulfill({ status: 201, json: { project: stored } });
  });
  await page.route("**/api/projects/cloud-1", (route) => {
    if (!stored) return route.fulfill({ status: 404, json: {} });
    if (route.request().method() === "GET") {
      return route.fulfill({ json: { project: stored } });
    }
    const body = route.request().postDataJSON() as {
      name: string;
      projectText: string;
    };
    stored = {
      ...stored,
      name: body.name,
      projectText: body.projectText,
      revision: stored.revision + 1,
      updatedAt: "2026-08-28T10:01:00.000Z",
    };
    return route.fulfill({ json: { project: stored } });
  });
  return { stored: () => stored };
}

test("opens a recognized old booster symbol with correct marks and keeps them after export and reopen", async ({
  page,
}) => {
  const symbol = JSON.parse(
    readFileSync(
      "fixtures/components/opamp-differential-wide-inputs-swapped-v8.json",
      "utf8",
    ),
  ) as SymbolDefinition;
  const source = createEmptyProject("old-booster", "Old booster", "dut");
  const descriptor = subcircuitDescriptor(symbol.id)!;
  source.componentDefinitions = [
    {
      symbol,
      subcircuit: {
        ...descriptor,
        ports: descriptor.ports.map((port) => ({ ...port })),
      },
    },
  ];
  const document = source.documents[0]!;
  document.instances.push({
    id: "X1",
    reference: "X1",
    symbolId: symbol.id,
    placement: { position: { x: 200, y: 200 }, rotation: 0, mirror: "none" },
    netlist: { parameters: { gain: "20" } },
  });
  for (const [index, pin] of symbol.pins.entries()) {
    const name = `N${index}`;
    document.nets.push({
      id: name,
      terminals: [{ instanceId: "X1", pinName: pin.name }],
    });
    document.connectivityEvidence.push({
      id: `hint-${name}`,
      kind: "net-name-hint",
      netId: name,
      sourceName: name,
      origin: "spice-import",
    });
  }
  const electrical = createDesignNetlistExport(source);
  expect(electrical.status).toBe("ready");
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.getByTestId("project-file").setInputFiles({
    name: "old-booster.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(source)),
  });
  // Positive marks are ordinary line geometry; only the page-upright minus
  // exposes a data-part. Inspect the actual SVG at the known input mark x.
  const positive = page.locator(
    '[data-layer="symbols"] [data-object-id="X1"] line[x1="-23.75"][x2="-23.75"]',
  );
  const centers = () =>
    positive.evaluateAll((lines) =>
      lines.map(
        (line) =>
          (Number(line.getAttribute("y1")) + Number(line.getAttribute("y2"))) /
          2,
      ),
    );
  await expect.poll(centers).toEqual([-14]);
  await expect(
    page.locator(
      '[data-object-id="X1"] line[data-part="upright-input-polarity-negative"]',
    ),
  ).toHaveAttribute("y1", "14");
  const svg = (await downloadBytes(page, "File", "Export SVG")).toString(
    "utf8",
  );
  expect(svg).toContain('data-part="upright-input-polarity-negative"');
  const saved = await downloadBytes(page, "File", "Export Project File…");
  const reopened = parseProject(saved.toString("utf8"));
  expect(createDesignNetlistExport(reopened)).toEqual(electrical);
  expect(reopened.documents[0]!.nets).toEqual(document.nets);
  await page.getByTestId("project-file").setInputFiles({
    name: "repaired-booster.icproj.json",
    mimeType: "application/json",
    buffer: saved,
  });
  await expect(page.getByTestId("status")).toContainText(
    "repaired-booster.icproj.json",
  );
  expect(await centers()).toEqual([-14]);
  const invalid = structuredClone(reopened);
  const ports = invalid.componentDefinitions![0]!.subcircuit!.ports;
  const minus = ports.find(
    (port) => "pinName" in port && port.pinName === "IN-",
  )!;
  if ("pinName" in minus) minus.pinName = "IN+";
  await page.getByTestId("project-file").setInputFiles({
    name: "invalid-interface.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(invalid)),
  });
  await expect(page.getByTestId("status")).toContainText("INVALID_PROJECT");
  const retained = parseProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  expect(retained).toEqual(reopened);
  expect(await centers()).toEqual([-14]);
});

test("File menu falls back to one scroll area in a short viewport", async ({
  page,
}) => {
  // Short enough that even the File commands alone overflow it.
  const height = 240;
  await page.setViewportSize({ width: 720, height });
  await page.goto("/editor");
  const fileMenu = await openMenu(page, "File");
  const popover = page
    .getByTestId("project-menu")
    .locator(".project-menu-popover");
  await expect
    .poll(() =>
      popover.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    )
    .toBe(true);
  const bounds = await popover.boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height);
  await fileMenu.getByRole("button", { name: "Export", exact: true }).click();
  const exportOption = fileMenu.getByRole("button", {
    name: "Export Project File…",
  });
  await expect(exportOption).toBeInViewport();
});

async function expectAgentRecoveryAlongsideWorkingCopy(
  page: Page,
  sessionId: string,
) {
  await expect
    .poll(() =>
      page.evaluate(
        ([agentKey, workingCopyKey, expectedSession]) => {
          const serialized = sessionStorage.getItem(agentKey);
          const workingCopyId = sessionStorage.getItem(workingCopyKey);
          if (!serialized || !workingCopyId) return false;
          const recovery = JSON.parse(serialized) as {
            sessionId?: string;
          };
          return recovery.sessionId === expectedSession;
        },
        [
          AGENT_SESSION_RECOVERY_STORAGE_KEY,
          WORKING_COPY_STORAGE_KEY,
          sessionId,
        ] as const,
      ),
    )
    .toBe(true);
}

for (const duringSave of ["edit", "replace"] as const) {
  test(`Check and Save keeps its snapshot safe during ${duringSave}`, async ({
    page,
  }) => {
    await mockCloudProjects(page);
    let releaseSave!: () => void;
    const saveReleased = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    let captured: ReturnType<typeof createEmptyProject> | null = null;
    await page.route("**/api/projects", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const body = route.request().postDataJSON() as { projectText: string };
      captured = JSON.parse(body.projectText) as ReturnType<
        typeof createEmptyProject
      >;
      await saveReleased;
      await route.fulfill({
        status: 201,
        json: {
          project: {
            id: "cloud-checked",
            name: captured.name,
            revision: 1,
            schemaVersion: captured.schemaVersion,
            updatedAt: "2026-09-03T10:00:00Z",
          },
        },
      });
    });
    await page.goto("/editor");
    await chooseComponent(page, "resistor");
    await page
      .getByTestId("schematic-canvas")
      .click({ position: { x: 360, y: 230 } });
    await page.keyboard.press("Escape");
    const check = page.getByTestId("check-and-save");
    await clickNetlistWorkflowCommand(page, "check-and-save");
    await expect.poll(() => captured?.documents[0]?.instances.length).toBe(1);
    await expect(page.getByTestId("statusbar-issues")).toHaveAttribute(
      "data-check-status",
      "current",
    );
    await expect(page.getByTestId("project-diagnostics")).toContainText(
      "ERC_UNCONNECTED_PIN",
    );
    await expect(check).toBeDisabled();
    if (duringSave === "edit") {
      await page.keyboard.press("Control+z");
      await expect(page.getByTestId("statusbar-issues")).toHaveText(
        "Check out of date",
      );
      await expect(page.locator(".diagnostic-marker")).toHaveCount(0);
      await expect(
        page.getByTestId("project-diagnostics").locator("button").first(),
      ).toBeDisabled();
    } else {
      const fileMenu = await openMenu(page, "File");
      await fileMenu.getByRole("button", { name: "New Project" }).click();
      await expect(page.getByTestId("hit-R1")).toHaveCount(0);
      await expect(page.getByTestId("statusbar-issues")).toHaveText(
        "Not checked",
      );
    }
    releaseSave();
    await expect(check).toBeEnabled();
    if (duringSave === "edit") {
      await expect(page.getByTestId("status")).toContainText(
        "newer edits remain unsaved",
      );
      await expect(page.getByTestId("project-unsaved-indicator")).toBeVisible();
    } else {
      await expect(page.getByTestId("statusbar-issues")).toHaveText(
        "Not checked",
      );
      expect(
        await page.evaluate(() =>
          sessionStorage.getItem("analog-canvas.recent-cloud-project.v1"),
        ),
      ).toBeNull();
      await expect(
        page.getByTestId("project-diagnostics").locator("li"),
      ).toHaveCount(0);
    }
    await expect.poll(() => captured?.documents[0]?.instances.length).toBe(1);
  });
}

test("Cloud Save updates one binding while local export stays interchange", async ({
  page,
}) => {
  test.slow();
  const cloud = await mockCloudProjects(page);
  await page.goto("/editor");
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("project-unsaved-indicator")).toBeVisible();

  await downloadBytes(page, "File", "Export Project File…");
  await expect(page.getByTestId("project-unsaved-indicator")).toBeVisible();
  await expect(page.getByTestId("status")).toContainText("Export requested");

  const fileMenu = await openMenu(page, "File");
  await expect(
    fileMenu.getByRole("button", { name: "Save as Cloud Copy…" }),
  ).toHaveCount(0);
  await fileMenu.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTestId("status")).toContainText(
    "Saved New Circuit to Cloud",
  );
  // A private save applies no Gallery quality gate.
  await expect(page.getByRole("dialog", { name: "Check Report" })).toHaveCount(
    0,
  );
  await expect(page.getByTestId("project-unsaved-indicator")).toHaveCount(0);
  await expect(page.getByTestId("statusbar-issues")).toHaveText("Not checked");
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 500, y: 230 } });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+s");
  await expect.poll(() => cloud.stored()?.revision).toBe(2);
  await expect(page.getByTestId("status")).toContainText(
    "Saved New Circuit to Cloud",
  );
  await expect(page.getByTestId("project-unsaved-indicator")).toHaveCount(0);
  const reopenedMenu = await openMenu(page, "File");
  await expect(
    reopenedMenu.getByRole("button", { name: "Save", exact: true }),
  ).toHaveCount(1);
  // Saved Cloud Projects are listed in the tabs' Shelf, not in File.
  await expect(reopenedMenu.getByText("Cloud Projects (")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Back to the gallery" }).click();
  await expect(page).toHaveURL(/\/$/u);
  await page.goto("/editor");
  await expect(page.getByTestId("status")).toContainText(
    "Switched to New Circuit",
    { timeout: 15_000 },
  );
  await expect(page.getByTestId("hit-R1")).toHaveCount(1);
  await expect(page.getByTestId("hit-R2")).toHaveCount(1);

  // A New Circuit link opens a blank tab beside the ones brought back.
  await page.goto("/editor?new=1");
  await expect(page.getByTestId("hit-R1")).toHaveCount(0);
});

test("paired refresh and Gallery return preserve the saved Cloud binding", async ({
  page,
  baseURL,
}) => {
  test.slow();
  const cloud = await mockCloudProjects(page);
  await page.goto("/editor");
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+s");
  await expect.poll(() => cloud.stored()?.revision).toBe(1);
  await expect(page.getByTestId("status")).toContainText(
    "Saved New Circuit to Cloud",
  );
  await expect(page.getByTestId("project-unsaved-indicator")).toHaveCount(0);
  await page.getByTestId("open-agent").click();
  const panel = page.getByTestId("connect-agent-panel");
  const handoff = await panel.getByTestId("agent-copy-text").inputValue();
  const { claimCode } = JSON.parse(handoff.match(/Claim: (.+)/u)![1]!);
  const client = new AgentHttpClient({ baseUrl: baseURL! });
  const session = await client.claim(claimCode);
  await expect(panel.getByTestId("agent-status")).toHaveText("Connected");
  await expectAgentRecoveryAlongsideWorkingCopy(page, session.sessionId);
  await page.reload();
  await expect(page.getByTestId("active-instance-count")).toHaveText("1", {
    timeout: 15_000,
  });
  await expect(page.getByTestId("project-unsaved-indicator")).toHaveCount(0);
  await page.keyboard.press("Control+s");
  await expect.poll(() => cloud.stored()?.revision).toBe(2);
  await expect(page.getByTestId("status")).toContainText(
    "Saved New Circuit to Cloud",
  );
  await expect
    .poll(
      async () =>
        (await client.status(session.sessionId, session.agentToken)).editor,
    )
    .toBe("attached");
  const documentId = session.documentIds[0]!;
  const snapshot = await client.circuit(session.sessionId, session.agentToken, {
    apiVersion: "3.0",
    requestId: "bound-before-edit",
    operation: "snapshot",
    documentId,
  });
  if (!snapshot.ok || snapshot.operation !== "snapshot")
    throw new Error("Snapshot failed");
  await client.circuit(session.sessionId, session.agentToken, {
    apiVersion: "3.0",
    requestId: "bound-edit",
    operation: "transact",
    documentId,
    transactionId: "bound-edit",
    expectedRevision: snapshot.revision,
    edits: [
      {
        kind: "add_instance",
        instance: {
          id: "paired-R",
          symbolId: "resistor",
          placement: {
            position: { x: 500, y: 200 },
            rotation: 0,
            mirror: "none",
          },
        },
      },
    ],
  });
  await expect
    .poll(async () => (await recoveryProjectTexts(page)).includes("paired-R"))
    .toBe(true);
  await expectAgentRecoveryAlongsideWorkingCopy(page, session.sessionId);
  page.on("dialog", (dialog) => void dialog.accept());
  await page.reload();
  await expect(page.getByTestId("active-instance-count")).toHaveText("2", {
    timeout: 15_000,
  });
  await expect(page.getByTestId("project-unsaved-indicator")).toBeVisible();
  await page.keyboard.press("Control+s");
  await expect.poll(() => cloud.stored()?.revision).toBe(3);
  await expect(page.getByTestId("status")).toContainText(
    "Saved New Circuit to Cloud",
  );
  await expect(page.getByTestId("project-unsaved-indicator")).toHaveCount(0);
  await page.getByRole("link", { name: "Back to the gallery" }).click();
  await expect(page.getByTestId("gallery-agent-return")).toHaveCount(0);
  const agentReturn = page.getByTestId("gallery-editor-link");
  await expect(agentReturn).toBeVisible({ timeout: 15_000 });
  await agentReturn.click();
  await expect(page.getByTestId("active-instance-count")).toHaveText("2", {
    timeout: 15_000,
  });
  await expect(page.getByTestId("project-unsaved-indicator")).toHaveCount(0);
  await page.keyboard.press("Control+s");
  await expect.poll(() => cloud.stored()?.revision).toBe(4);
  expect(
    await client.status(session.sessionId, session.agentToken),
  ).toMatchObject({ editor: "attached" });
});

test("Continue without saving to the Gallery drops the edits without a second browser prompt", async ({
  page,
}) => {
  const cloud = await mockCloudProjects(page);
  const canvas = page.getByTestId("schematic-canvas");
  const placeResistors = async (xs: number[]) => {
    for (const x of xs) {
      await chooseComponent(page, "resistor");
      await canvas.click({ position: { x, y: 230 } });
      await page.keyboard.press("Escape");
    }
  };
  const guard = page.getByRole("dialog", {
    name: "Unsaved changes",
  });
  // Back in the same window, its saved tabs are restored before anything
  // is counted.
  const returnToEditor = async () => {
    await page.goto("/editor");
    await expect(page.getByTestId("status")).toContainText(
      "Switched to New Circuit",
      { timeout: 15_000 },
    );
  };

  await page.goto("/editor");
  // The guard protects meaningful drawings: three authored objects.
  await placeResistors([300, 380, 460]);
  await page.getByRole("link", { name: "Back to the gallery" }).click();
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: "Stay" }).click();
  await expect(page).toHaveURL(/\/editor/u);

  await page.getByRole("link", { name: "Back to the gallery" }).click();
  await guard.getByRole("button", { name: "Continue without saving" }).click();
  // A second, browser-owned prompt would have kept the page here.
  await expect(page).toHaveURL(/\/$/u);
  // A drawing never saved leaves the window's tabs (#1288).
  await returnToEditor();
  await expect(page.getByTestId("active-instance-count")).toHaveText("0");

  // A Cloud Project returns to its saved version.
  await placeResistors([300]);
  await page.keyboard.press("Control+s");
  await expect.poll(() => cloud.stored()?.revision).toBe(1);
  await expect(page.getByTestId("project-unsaved-indicator")).toHaveCount(0);
  await placeResistors([380, 460]);
  await page.getByRole("link", { name: "Back to the gallery" }).click();
  await guard.getByRole("button", { name: "Continue without saving" }).click();
  await expect(page).toHaveURL(/\/$/u);
  await returnToEditor();
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
  await expect(page.getByTestId("project-unsaved-indicator")).toHaveCount(0);
});

test("imports and upgrades a portable Project before explicit export", async ({
  page,
}) => {
  const source = parseSavedProject(
    readFileSync(
      resolve(process.cwd(), "fixtures/projects/minimal/project.icproj.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;
  const previousVersion = CURRENT_MODEL_SCHEMA_VERSION - 1;
  source.schemaVersion = previousVersion;
  // Schema 49 stored the same source folders under the former collection name.
  if (previousVersion < 50) {
    source.simulationSetups = source.simulationFolders;
    delete source.simulationFolders;
  }
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: `minimal-v${previousVersion}.icproj.json`,
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(source)),
  });
  await expect(page.getByTestId("status")).toContainText(
    `upgraded minimal-v${previousVersion}.icproj.json`,
  );
  const exported = parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  ) as { schemaVersion: number };
  expect(exported.schemaVersion).toBe(CURRENT_MODEL_SCHEMA_VERSION);
});

test("imports split source-ground markers with independent owners and saves the repair", async ({
  page,
}) => {
  const source = createEmptyProject("split-ground", "Split ground");
  const document = source.documents[0]!;
  for (const [index, id] of ["G1", "G2"].entries()) {
    document.instances.push({
      id,
      symbolId: "ground",
      placement: {
        position: { x: 200 + index * 200, y: 300 },
        rotation: 0,
        mirror: "none",
      },
    });
    document.nets.push({
      id: `net-${id}`,
      terminals: [{ instanceId: id, pinName: "0" }],
    });
    document.connectivityEvidence.push({
      id: `source-${id}`,
      kind: "spice-source",
      netId: `net-${id}`,
      sourceNetId: "original-0",
    });
  }
  document.connectivityEvidence.push({
    id: "global",
    kind: "name-claim",
    netId: "net-G1",
    name: "0",
    scope: "global",
    powerDomain: "ground",
    owner: { kind: "global-declaration", sourceNetId: "original-0" },
  });
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "split-ground.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(source)),
  });
  await expect(page.getByTestId("status")).toContainText(
    "normalized connectivity and Wire topology in 1 Cell",
  );
  await expect(page.getByTestId("status")).toContainText(
    "save to Cloud or export to keep the",
  );
  const exported = parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  ) as typeof source;
  const repaired = exported.documents[0]!;
  expect(repaired.nets).toEqual(document.nets);
  expect(repaired.routes).toEqual([]);
  expect(repaired.sourceStatus).toBe("connectivity-modified");
  expect(
    repaired.connectivityEvidence.filter(
      (e) => e.kind === "name-claim" && e.owner.kind === "power-marker",
    ),
  ).toEqual(
    expect.arrayContaining(
      ["G1", "G2"].map((objectId) =>
        expect.objectContaining({
          name: "0",
          scope: "global",
          owner: { kind: "power-marker", objectId },
        }),
      ),
    ),
  );
});

test("rejects invalid imports without replacing live or recovered work", async ({
  page,
}) => {
  await page.goto("/editor");
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await page.getByTestId("project-file").setInputFiles({
    name: "broken.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from("{ not valid json"),
  });
  await expect(page.getByTestId("status")).toContainText("INVALID_JSON");
  await expect(page.getByTestId("revision")).toHaveText("1");
  await expect
    .poll(() => recoveryProjectTexts(page))
    .toContain('"revision": 1');
});

test("replacement guard offers cancel, discard, and Cloud Save", async ({
  page,
}) => {
  const cloud = await mockCloudProjects(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      configurable: false,
      get() {
        throw new DOMException("storage blocked", "InvalidStateError");
      },
    });
  });
  await page.goto("/editor");
  // The guard protects meaningful drawings: three authored objects.
  for (const x of [300, 380, 460]) {
    await chooseComponent(page, "resistor");
    await page
      .getByTestId("schematic-canvas")
      .click({ position: { x, y: 230 } });
    await page.keyboard.press("Escape");
  }

  const input = page.getByTestId("project-file");
  const replacement = resolve(
    process.cwd(),
    "fixtures/projects/manual-basics/project.icproj.json",
  );
  await input.setInputFiles(replacement);
  const dialog = page.getByRole("dialog", {
    name: "Unsaved changes",
  });
  await expect(dialog).toContainText(
    `Cloud Projects (up to ${CLOUD_PROJECT_LIMIT})`,
  );
  await dialog.getByRole("button", { name: "Stay" }).click();
  await expect(page.getByTestId("revision")).toHaveText("3");

  await input.evaluate((element) => ((element as HTMLInputElement).value = ""));
  await input.setInputFiles(replacement);
  await dialog
    .getByRole("button", { name: "Save to Cloud and continue" })
    .click();
  await expect(dialog).toBeHidden();
  expect(cloud.stored()?.projectText).toContain("resistor");
  await expect(page.getByTestId("active-document-name")).toHaveText(
    "Manual Editor Demo",
  );
});

test("discarding a dirty replacement does not leave a second project stack", async ({
  page,
}) => {
  await page.goto("/editor");
  // The guard protects meaningful drawings: three authored objects.
  for (const x of [300, 380, 460]) {
    await chooseComponent(page, "resistor");
    await page
      .getByTestId("schematic-canvas")
      .click({ position: { x, y: 230 } });
    await page.keyboard.press("Escape");
  }
  let fileMenu = await openMenu(page, "File");
  await fileMenu.getByRole("button", { name: "New Project" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Unsaved changes",
  });
  await dialog.getByRole("button", { name: "Continue without saving" }).click();
  await expect(page.getByTestId("hit-R1")).toHaveCount(0);
  fileMenu = await openMenu(page, "File");
  await expect(
    fileMenu.getByRole("button", { name: "Previous Project" }),
  ).toHaveCount(0);
  await expect(
    fileMenu.getByRole("button", { name: "Download Backup" }),
  ).toHaveCount(0);
});

test("reverts to the last acknowledged Cloud revision", async ({ page }) => {
  await mockCloudProjects(page);
  await page.goto("/editor");
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 320, y: 230 } });
  await page.keyboard.press("Escape");
  let fileMenu = await openMenu(page, "File");
  await fileMenu.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTestId("project-unsaved-indicator")).toHaveCount(0);

  // Two more parts push the drawing over the guard's meaningful-content
  // threshold while staying unsaved.
  for (const x of [500, 560]) {
    await chooseComponent(page, "resistor");
    await page
      .getByTestId("schematic-canvas")
      .click({ position: { x, y: 230 } });
    await page.keyboard.press("Escape");
  }
  fileMenu = await openMenu(page, "File");
  await fileMenu.getByRole("button", { name: "Revert to Last Saved" }).click();
  await page
    .getByRole("dialog", { name: "Unsaved changes" })
    .getByRole("button", { name: "Continue without saving" })
    .click();
  await expect(page.getByTestId("hit-R1")).toHaveCount(1);
  await expect(page.getByTestId("hit-R2")).toHaveCount(0);
  await expect(page.getByTestId("hit-R3")).toHaveCount(0);
});

test("the circuit name drives Cloud Save and portable export", async ({
  page,
}) => {
  const cloud = await mockCloudProjects(page);
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.getByRole("tab", { selected: true }).dblclick();
  const name = page.getByRole("textbox", { name: "Project name", exact: true });
  await expect(name).toHaveAttribute("autocomplete", "off");
  await name.fill("Bandgap Reference");
  await name.press("Enter");
  const fileMenu = await openMenu(page, "File");
  await fileMenu.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => cloud.stored()?.name).toBe("Bandgap Reference");
  // Renaming is local until Save and retains the same Cloud identity.
  const originalCloudId = cloud.stored()!.id;
  await page.getByRole("tab", { selected: true }).dblclick();
  await name.fill("Bandgap characterization");
  await name.press("Enter");
  expect(cloud.stored()!.name).toBe("Bandgap Reference");
  await expect(
    page.getByRole("tab", { selected: true }).getByLabel("Unsaved"),
  ).toBeVisible();
  await page.keyboard.press("ControlOrMeta+s");
  await expect
    .poll(() => cloud.stored()?.name)
    .toBe("Bandgap characterization");
  expect(cloud.stored()!.id).toBe(originalCloudId);
  expect(cloud.stored()!.revision).toBe(2);
  const exported = parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  ) as { name?: string };
  expect(exported.name).toBe("Bandgap characterization");
});

test("native cross-page clipboard preserves an editable circuit and text-field shortcuts", async ({
  page,
  context,
  browser,
}) => {
  // This journey opens multiple Projects and verifies copy, export, undo and
  // code editing. Keep per-action assertions bounded, but allow the complete
  // workflow more than 30 seconds on the shared CI runner.
  test.slow();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const source = parseSavedProject(
    readFileSync(
      "apps/editor/src/examples/simulation-common-source.icproj.json",
      "utf8",
    ),
  );
  const typedSource = source as CircuitProject;
  const active = typedSource.documents.find(
    (document) => document.id === typedSource.topDocumentId,
  )!;
  await page.goto("/editor?new=1");
  await page.getByTestId("project-file").setInputFiles({
    name: "clipboard-source.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(source)),
  });
  await expect(page.getByTestId("active-instance-count")).toHaveText(
    String(active.instances.length),
  );
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 80, y: 80 } });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+c");
  await expect(page.getByTestId("status")).toContainText("Circuit copied");
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(JSON.parse(clipboard).format).toBe("analog-canvas/clipboard");

  // A different page reads the real browser clipboard, not a shared React store.
  const target = await context.newPage();
  await target.goto("/editor?new=1");
  await target.bringToFront();
  const canvas = target.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 90, y: 90 } });
  await target.keyboard.press("ControlOrMeta+v");
  await expect(target.getByTestId("status")).toContainText("click to place");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Missing canvas");
  await target.mouse.move(box.x + 280, box.y + 240);
  await expect(target.getByTestId("copy-placement-preview")).toBeVisible();
  // Cancelling a paste installs neither devices nor dependencies.
  await target.keyboard.press("Escape");
  await expect(target.getByTestId("active-instance-count")).toHaveText("0");
  await target.keyboard.press("ControlOrMeta+v");
  await canvas.click({ position: { x: 280, y: 240 } });
  await target.keyboard.press("Escape");
  await expect(target.getByTestId("active-instance-count")).toHaveText(
    String(active.instances.length),
  );
  const copied = parseSavedProject(
    (await downloadBytes(target, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  const typedCopied = copied as CircuitProject;
  const pasted = typedCopied.documents.find(
    (document) => document.id === typedCopied.topDocumentId,
  )!;
  expect(
    pasted.instances.map((item) => [item.reference, item.netlist?.parameters]),
  ).toEqual(
    active.instances.map((item) => [item.reference, item.netlist?.parameters]),
  );
  expect(copied.externalSubcircuitDefinitions.length).toBeGreaterThan(0);
  expect(
    typedCopied.simulationFolders.map((folder) => folder.input.files),
  ).toEqual(typedSource.simulationFolders.map((folder) => folder.input.files));
  const { projectElectricalGraph, compareElectricalGraphs } =
    await import("@icm/netlist");
  const left = projectElectricalGraph(source),
    right = projectElectricalGraph(copied);
  expect(left.status).toBe("ready");
  expect(right.status).toBe("ready");
  if (left.status === "ready" && right.status === "ready")
    expect(compareElectricalGraphs(left.graph, right.graph)).toBe("equal");
  await target.keyboard.press("ControlOrMeta+z");
  await expect(target.getByTestId("active-instance-count")).toHaveText("0");
  await target.keyboard.press("ControlOrMeta+Shift+z");
  await expect(target.getByTestId("active-instance-count")).toHaveText(
    String(active.instances.length),
  );

  // A real code editor keeps native text copy/paste, despite a canvas selection.
  await target.getByTestId("project-code-toggle").click();
  const editor = target.getByRole("textbox", {
    name: "Project code",
    exact: true,
  });
  await editor.click();
  await target.keyboard.press("ControlOrMeta+a");
  await target.keyboard.press("ControlOrMeta+c");
  const code = await target.evaluate(() => navigator.clipboard.readText());
  expect(code).not.toContain('"analog-canvas/clipboard"');
  expect(code).toContain("schemaVersion");
  await target.keyboard.press("ControlOrMeta+v");
  await expect(target.getByTestId("copy-placement-preview")).toHaveCount(0);
  await target.screenshot({ path: "plan/cross-page-clipboard.png" });
  await target.close();

  // A separate browser context/window has no shared app storage or clipboard state.
  await page.bringToFront();
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 80, y: 80 } });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+c");
  const otherWindow = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    permissions: ["clipboard-read", "clipboard-write"],
  });
  try {
    const other = await otherWindow.newPage();
    await other.goto("/editor?new=1");
    await other.bringToFront();
    await other
      .getByTestId("schematic-canvas")
      .click({ position: { x: 90, y: 90 } });
    await other.keyboard.press("ControlOrMeta+v");
    await expect(other.getByTestId("status")).toContainText("click to place");
    await other
      .getByTestId("schematic-canvas")
      .click({ position: { x: 280, y: 240 } });
    await other.keyboard.press("Escape");
    await expect(other.getByTestId("active-instance-count")).toHaveText(
      String(active.instances.length),
    );
    await other.evaluate(() =>
      navigator.clipboard.writeText(
        '{"format":"analog-canvas/clipboard","version":999}',
      ),
    );
    await other.keyboard.press("ControlOrMeta+v");
    await expect(other.getByTestId("status")).toContainText(
      "unsupported version",
    );
    await expect(other.getByTestId("active-instance-count")).toHaveText(
      String(active.instances.length),
    );
    await expect(other.getByTestId("copy-placement-preview")).toHaveCount(0);
  } finally {
    await otherWindow.close();
  }
});
