import { expect, test, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { subcircuitDescriptor } from "@icm/devices";
import { AgentHttpClient } from "../../../packages/agent-client/src/http-client.js";
import {
  createEmptyProject,
  CURRENT_MODEL_SCHEMA_VERSION,
  type CircuitProject,
  type SymbolDefinition,
} from "@icm/model";

import { AGENT_SESSION_RECOVERY_STORAGE_KEY } from "../src/agent/session-recovery-presence";
import { WORKING_COPY_STORAGE_KEY } from "../src/document/recovery-coordinator";
import { CLOUD_PROJECT_LIMIT } from "../src/features/editor-shell/cloud-projects";
import {
  clickCommand,
  clickNetlistWorkflowCommand,
  downloadBytes,
  expectStatus,
  exportedProject,
  openMenu,
  openProjectFile,
  parseSavedProject,
  placeResistors,
  recoveryProjectTexts,
  openEditor,
  expectRecovered,
  openProject,
  readAgentClaim,
} from "./editor-fixtures.js";
import { sessionUser, signIn } from "./gallery-fixtures.js";
import { placedInstance } from "./canvas-fixtures.js";

async function mockCloudProjects(page: Page) {
  let stored: {
    id: string;
    name: string;
    projectText: string;
    updatedAt: string;
    revision: number;
    schemaVersion: number;
  } | null = null;
  const save = (route: Route, revision: number) => {
    const { name, projectText } = route.request().postDataJSON() as {
      name: string;
      projectText: string;
    };
    const { schemaVersion } = JSON.parse(projectText) as {
      schemaVersion: number;
    };
    stored = {
      id: "cloud-1",
      name,
      projectText,
      revision,
      schemaVersion,
      updatedAt: `2026-08-28T10:0${revision}:00.000Z`,
    };
    return route.fulfill({
      status: revision === 1 ? 201 : 200,
      json: { project: stored },
    });
  };
  await signIn(
    page,
    sessionUser({
      displayName: "Circuit Author",
      email: "author@example.com",
      role: undefined,
    }),
  );
  await page.route("**/api/projects", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { projects: stored ? [stored] : [] } })
      : save(route, 1),
  );
  await page.route("**/api/projects/cloud-1", (route) => {
    if (!stored) return route.fulfill({ status: 404, json: {} });
    return route.request().method() === "GET"
      ? route.fulfill({ json: { project: stored } })
      : save(route, stored.revision + 1);
  });
  return { stored: () => stored };
}

// The repair itself and the refused interface are module contracts
// (amplifier-polarity-repair, component-interface); this is their wiring.
test("fits and repairs an old booster symbol on open, and rejects invalid imports without replacing it", async ({
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
  source.documents[0]!.instances.push({
    ...placedInstance("X1", symbol.id, 200, 200),
    reference: "X1",
    netlist: { parameters: { gain: "20" } },
  });
  await openProject(page, source, "old-booster.icproj.json");
  // An opened Project lands fitted, exactly as if F were pressed once, and
  // silently: the open's own status survives.
  await expectStatus(page, "old-booster.icproj.json");
  const canvas = page.getByTestId("schematic-canvas");
  await expect
    .poll(() => canvas.getAttribute("viewBox"))
    .not.toBe("0 0 960 640");
  const fitted = await canvas.getAttribute("viewBox");
  await page.keyboard.press("f");
  await expect.poll(() => canvas.getAttribute("viewBox")).toBe(fitted);
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

  const invalid = structuredClone(source);
  const minus = invalid.componentDefinitions![0]!.subcircuit!.ports.find(
    (port) => "pinName" in port && port.pinName === "IN-",
  )!;
  if ("pinName" in minus) minus.pinName = "IN+";
  for (const [name, buffer, code] of [
    ["broken.icproj.json", Buffer.from("{ not valid json"), "INVALID_JSON"],
    [
      "invalid-interface.icproj.json",
      Buffer.from(JSON.stringify(invalid)),
      "INVALID_PROJECT",
    ],
  ] as const) {
    await openProjectFile(page, buffer, name);
    await expectStatus(page, code);
    expect(await centers()).toEqual([-14]);
  }
  // Neither the live drawing nor its recovery copy is replaced.
  await expect(page.getByTestId("active-document-name")).toHaveText("dut");
  await expectRecovered(page, '"name": "Old booster"');
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

/** The Agent's reconnect proof is stored beside this tab's working copy. */
async function expectAgentRecoveryAlongsideWorkingCopy(
  page: Page,
  sessionId: string,
) {
  await expect
    .poll(() =>
      page.evaluate(
        ([agentKey, workingCopyKey]) =>
          sessionStorage.getItem(workingCopyKey) &&
          JSON.parse(sessionStorage.getItem(agentKey) ?? "{}").sessionId,
        [AGENT_SESSION_RECOVERY_STORAGE_KEY, WORKING_COPY_STORAGE_KEY] as const,
      ),
    )
    .toBe(sessionId);
}

test("Check and Save keeps its snapshot safe while the drawing is replaced or edited", async ({
  page,
}) => {
  await mockCloudProjects(page);
  const releases: Array<() => void> = [];
  let captured: CircuitProject | null = null;
  await page.route("**/api/projects", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as { projectText: string };
    const project = JSON.parse(body.projectText) as CircuitProject;
    captured = project;
    await new Promise<void>((resolve) => releases.push(resolve));
    await route.fulfill({
      status: 201,
      json: {
        project: {
          id: "cloud-checked",
          name: project.name,
          revision: 1,
          schemaVersion: project.schemaVersion,
          updatedAt: "2026-09-03T10:00:00Z",
        },
      },
    });
  });
  const check = page.getByTestId("check-and-save");
  const issues = page.getByTestId("statusbar-issues");
  const diagnostics = page.getByTestId("project-diagnostics");
  const checkAndSaveOneResistor = async () => {
    captured = null;
    await placeResistors(page, [360]);
    await clickNetlistWorkflowCommand(page, "check-and-save");
    await expect.poll(() => captured?.documents[0]?.instances.length).toBe(1);
    await expect(issues).toHaveAttribute("data-check-status", "current");
    await expect(diagnostics).toContainText("ERC_UNCONNECTED_PIN");
    await expect(check).toBeDisabled();
  };
  await page.goto("/editor");

  // Replaced while saving: the new drawing is neither checked nor bound to
  // the Cloud Project the old one becomes.
  await checkAndSaveOneResistor();
  const fileMenu = await openMenu(page, "File");
  await fileMenu.getByRole("button", { name: "New Project" }).click();
  await expect(page.getByTestId("hit-R1")).toHaveCount(0);
  await expect(issues).toHaveText("Not checked");
  releases.shift()!();
  await expect(check).toBeEnabled();
  await expect(issues).toHaveText("Not checked");
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("analog-canvas.recent-cloud-project.v1"),
    ),
  ).toBeNull();
  await expect(diagnostics.locator("li")).toHaveCount(0);

  // Edited while saving: the check goes stale and the newer edit stays
  // unsaved; the saved snapshot is still the checked one.
  await checkAndSaveOneResistor();
  await page.keyboard.press("Control+z");
  await expect(issues).toHaveText("Check out of date");
  await expect(page.locator(".diagnostic-marker")).toHaveCount(0);
  await expect(diagnostics.locator("button").first()).toBeDisabled();
  releases.shift()!();
  await expect(check).toBeEnabled();
  await expectStatus(page, "newer edits remain unsaved");
  await expect(page.getByTestId("project-unsaved-indicator")).toBeVisible();
  expect(captured!.documents[0]!.instances).toHaveLength(1);
});

// The paired working copy's own Gallery round trip is web-agent-session's
// ("restores the same paired working copy through refresh and Gallery…");
// this is the Cloud binding through both.
test("paired refresh and Gallery return preserve the saved Cloud binding", async ({
  page,
  baseURL,
}) => {
  test.slow();
  const cloud = await mockCloudProjects(page);
  const expectRestoredCount = (count: string) =>
    expect(page.getByTestId("active-instance-count")).toHaveText(count, {
      timeout: 15_000,
    });
  await page.goto("/editor");
  await placeResistors(page, [360]);
  await page.keyboard.press("Control+s");
  await expect.poll(() => cloud.stored()?.revision).toBe(1);
  await expectStatus(page, "Saved New Circuit to Cloud");
  await expect(page.getByTestId("project-unsaved-indicator")).toHaveCount(0);
  await page.getByTestId("open-agent").click();
  const panel = page.getByTestId("connect-agent-panel");
  const { claimCode } = await readAgentClaim(panel);
  const client = new AgentHttpClient({ baseUrl: baseURL! });
  const session = await client.claim(claimCode);
  await expect(panel.getByTestId("agent-status")).toHaveText("Connected");
  await expectAgentRecoveryAlongsideWorkingCopy(page, session.sessionId);
  await page.reload();
  await expectRestoredCount("1");
  await expect(page.getByTestId("project-unsaved-indicator")).toHaveCount(0);
  await page.keyboard.press("Control+s");
  await expect.poll(() => cloud.stored()?.revision).toBe(2);
  await expectStatus(page, "Saved New Circuit to Cloud");
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
        instance: placedInstance("paired-R", "resistor", 500, 200),
      },
    ],
  });
  await expect
    .poll(async () => (await recoveryProjectTexts(page)).includes("paired-R"))
    .toBe(true);
  await expectAgentRecoveryAlongsideWorkingCopy(page, session.sessionId);
  page.on("dialog", (dialog) => void dialog.accept());
  await page.reload();
  await expectRestoredCount("2");
  await expect(page.getByTestId("project-unsaved-indicator")).toBeVisible();
  await page.keyboard.press("Control+s");
  await expect.poll(() => cloud.stored()?.revision).toBe(3);
  await expectStatus(page, "Saved New Circuit to Cloud");
  await expect(page.getByTestId("project-unsaved-indicator")).toHaveCount(0);

  // Back from the Gallery, Ctrl+S still updates the same Cloud Project.
  await page.getByRole("link", { name: "Back to the gallery" }).click();
  await page.getByTestId("gallery-editor-link").click();
  await expectRestoredCount("2");
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
  const guard = page.getByRole("dialog", {
    name: "Unsaved changes",
  });
  const leaveAndReturn = async () => {
    await page.getByRole("link", { name: "Back to the gallery" }).click();
    await guard
      .getByRole("button", { name: "Continue without saving" })
      .click();
    // A second, browser-owned prompt would have kept the page here.
    await expect(page).toHaveURL(/\/$/u);
    // Back in the same window, its saved tabs are restored before anything
    // is counted.
    await page.goto("/editor");
    await expect(page.getByTestId("status")).toContainText(
      "Switched to New Circuit",
      { timeout: 15_000 },
    );
  };

  await page.goto("/editor");
  // The guard protects meaningful drawings: three authored objects.
  await placeResistors(page, [300, 380, 460]);
  // A drawing never saved leaves the window's tabs (#1288).
  await leaveAndReturn();
  await expect(page.getByTestId("active-instance-count")).toHaveText("0");

  // A Cloud Project returns to its saved version.
  await placeResistors(page, [300]);
  await page.keyboard.press("Control+s");
  await expect.poll(() => cloud.stored()?.revision).toBe(1);
  await expect(page.getByTestId("project-unsaved-indicator")).toHaveCount(0);
  await placeResistors(page, [380, 460]);
  await leaveAndReturn();
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
  await expect(page.getByTestId("project-unsaved-indicator")).toHaveCount(0);

  // A New Circuit link opens a blank tab beside the ones brought back.
  await page.goto("/editor?new=1");
  await expect(page.getByTestId("active-instance-count")).toHaveText("0");
});

// The migration chain is legacy-load's and the split-Ground repair is
// project-import-normalization's; this is the import's wiring and status.
test("imports an older Project, upgrades it and repairs split Ground markers before explicit export", async ({
  page,
}) => {
  const source = createEmptyProject("split-ground", "Split ground");
  const document = source.documents[0]!;
  for (const [index, id] of ["G1", "G2"].entries()) {
    document.instances.push(
      placedInstance(id, "ground", 200 + index * 200, 300),
    );
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
  const previousVersion = CURRENT_MODEL_SCHEMA_VERSION - 1;
  await openProject(
    page,
    { ...source, schemaVersion: previousVersion },
    `split-ground-v${previousVersion}.icproj.json`,
  );
  const status = page.getByTestId("status");
  await expect(status).toContainText(
    `upgraded split-ground-v${previousVersion}.icproj.json`,
  );
  await expect(status).toContainText(
    "normalized connectivity and Wire topology in 1 Cell",
  );
  await expect(status).toContainText("save to Cloud or export to keep the");
  const exported = (await exportedProject(page)) as typeof source;
  expect(exported.schemaVersion).toBe(CURRENT_MODEL_SCHEMA_VERSION);
  const repaired = exported.documents[0]!;
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
          owner: { kind: "power-marker", objectId },
        }),
      ),
    ),
  );
});

// Stay and Continue without saving are the Gallery and simulation
// guards' too (gallery-wall, simulation-workspace).
test("replacement guard saves to Cloud and continues", async ({ page }) => {
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
  await placeResistors(page, [300, 380, 460]);

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
  await dialog
    .getByRole("button", { name: "Save to Cloud and continue" })
    .click();
  await expect(dialog).toBeHidden();
  expect(cloud.stored()?.projectText).toContain("resistor");
  await expect(page.getByTestId("active-document-name")).toHaveText(
    "Manual Editor Demo",
  );
});

test("Cloud Save keeps one binding through rename and revert while export stays interchange", async ({
  page,
}) => {
  const cloud = await mockCloudProjects(page);
  await openEditor(page);
  await placeResistors(page, [320]);
  await expect(page.getByTestId("project-unsaved-indicator")).toBeVisible();
  // A local export is interchange: the drawing stays unsaved.
  await downloadBytes(page, "File", "Export Project File…");
  await expectStatus(page, "Export requested");
  await expect(page.getByTestId("project-unsaved-indicator")).toBeVisible();

  await page.getByRole("tab", { selected: true }).dblclick();
  const name = page.getByRole("textbox", { name: "Project name", exact: true });
  await expect(name).toHaveAttribute("autocomplete", "off");
  await name.fill("Bandgap Reference");
  await name.press("Enter");
  const fileMenu = await openMenu(page, "File");
  await fileMenu.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => cloud.stored()?.name).toBe("Bandgap Reference");
  await expect(page.getByTestId("project-unsaved-indicator")).toHaveCount(0);
  // A private save applies no Gallery quality gate.
  await expect(page.getByRole("dialog", { name: "Check Report" })).toHaveCount(
    0,
  );
  await expect(page.getByTestId("statusbar-issues")).toHaveText("Not checked");

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
  const exported = (await exportedProject(page)) as { name?: string };
  expect(exported.name).toBe("Bandgap characterization");
  // Saved Cloud Projects are listed in the tabs' Shelf, not in File.
  await expect(
    (await openMenu(page, "File")).getByText("Cloud Projects ("),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Two more parts push the drawing over the guard's meaningful-content
  // threshold while staying unsaved; Revert returns to the saved revision.
  await placeResistors(page, [500, 560]);
  await clickCommand(page, "File", "Revert to Last Saved");
  await page
    .getByRole("dialog", { name: "Unsaved changes" })
    .getByRole("button", { name: "Continue without saving" })
    .click();
  await expect(page.getByTestId("hit-R1")).toHaveCount(1);
  await expect(page.getByTestId("hit-R2")).toHaveCount(0);
  await expect(page.getByTestId("hit-R3")).toHaveCount(0);
});

test("native cross-window clipboard preserves an editable circuit and text-field shortcuts", async ({
  page,
  context,
  browser,
}) => {
  // The copied circuit's electrical identity and dependencies are
  // system-clipboard's ("preserves %s electrical structure…"). Keep
  // per-action assertions bounded, but allow the complete workflow more than
  // 30 seconds on the shared CI runner.
  test.slow();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const source = parseSavedProject(
    readFileSync(
      "apps/editor/src/examples/simulation-common-source.icproj.json",
      "utf8",
    ),
  );
  const active = (source as CircuitProject).documents.find(
    (document) => document.id === source.topDocumentId,
  )!;
  await page.goto("/editor?new=1");
  await openProjectFile(page, source, "clipboard-source.icproj.json");
  await expect(page.getByTestId("active-instance-count")).toHaveText(
    String(active.instances.length),
  );
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 80, y: 80 } });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+c");
  await expectStatus(page, "Circuit copied");
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(JSON.parse(clipboard).format).toBe("analog-canvas/clipboard");

  // A separate browser context/window reads the real browser clipboard: it
  // shares neither app storage nor a React store with this page.
  const otherWindow = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    permissions: ["clipboard-read", "clipboard-write"],
  });
  try {
    const other = await otherWindow.newPage();
    await other.goto("/editor?new=1");
    await other.bringToFront();
    const canvas = other.getByTestId("schematic-canvas");
    const count = other.getByTestId("active-instance-count");
    await canvas.click({ position: { x: 90, y: 90 } });
    await other.keyboard.press("ControlOrMeta+v");
    await expectStatus(other, "click to place");
    const box = (await canvas.boundingBox())!;
    await other.mouse.move(box.x + 280, box.y + 240);
    await expect(other.getByTestId("copy-placement-preview")).toBeVisible();
    // Cancelling a paste installs neither devices nor dependencies.
    await other.keyboard.press("Escape");
    await expect(count).toHaveText("0");
    await other.keyboard.press("ControlOrMeta+v");
    await canvas.click({ position: { x: 280, y: 240 } });
    await other.keyboard.press("Escape");
    await expect(count).toHaveText(String(active.instances.length));
    await other.keyboard.press("ControlOrMeta+z");
    await expect(count).toHaveText("0");
    await other.keyboard.press("ControlOrMeta+Shift+z");
    await expect(count).toHaveText(String(active.instances.length));

    await other.evaluate(() =>
      navigator.clipboard.writeText(
        '{"format":"analog-canvas/clipboard","version":999}',
      ),
    );
    await other.keyboard.press("ControlOrMeta+v");
    await expectStatus(other, "unsupported version");
    await expect(count).toHaveText(String(active.instances.length));
    await expect(other.getByTestId("copy-placement-preview")).toHaveCount(0);

    // A real code editor keeps native text copy/paste, despite a canvas
    // selection.
    await other.getByTestId("project-code-toggle").click();
    await other
      .getByRole("textbox", { name: "Project code", exact: true })
      .click();
    await other.keyboard.press("ControlOrMeta+a");
    await other.keyboard.press("ControlOrMeta+c");
    const code = await other.evaluate(() => navigator.clipboard.readText());
    expect(code).not.toContain('"analog-canvas/clipboard"');
    expect(code).toContain("schemaVersion");
    await other.keyboard.press("ControlOrMeta+v");
    await expect(other.getByTestId("copy-placement-preview")).toHaveCount(0);
  } finally {
    await otherWindow.close();
  }
});
