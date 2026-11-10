import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  expect,
  test as base,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { parseProject } from "@icm/project-protocol";
import { assembleServer } from "../../mcp-server/src/server.js";
import { openEditor } from "./editor-fixtures.js";
import { regionalAccounts } from "./regional-auth-fixture.js";

const test = base.extend<{ accountName: string | null }>({
  accountName: async ({ page, context, baseURL }, provideAccount) => {
    const editorUrl = new URL(baseURL!);
    // A deployed-site run still exercises the full task lifecycle. The
    // isolated account cookie is available only on loopback.
    if (editorUrl.hostname !== "127.0.0.1") {
      await provideAccount(null);
      return;
    }
    const accountName = "canvas-task-member";
    const accounts = await regionalAccounts(editorUrl.origin);
    try {
      await page.goto(accounts.origin + "/account");
      await page.getByTestId("account-signin").locator("summary").click();
      await page.getByTestId("signin-email").click();
      await page
        .getByLabel("邮箱", { exact: true })
        .fill(`${accountName}@example.test`);
      await page.getByRole("button", { name: "发送验证码" }).click();
      await expect.poll(accounts.emailCode).toMatch(/^\d{6}$/u);
      await page
        .getByLabel("验证码", { exact: true })
        .fill(accounts.emailCode());
      await page.getByRole("button", { name: "验证并继续" }).click();
      await expect(page).toHaveURL(accounts.origin + "/account");
      await expect(page.getByTestId("account-name")).toHaveText(accountName);
      await page.close();

      // Forward the launched editor's account reads to the isolated Auth
      // service. The browser supplies its existing loopback session cookie.
      await context.route(
        (url) =>
          url.origin === editorUrl.origin &&
          ["/api/auth/me", "/api/auth/providers"].includes(url.pathname),
        async (route) => {
          const url = new URL(route.request().url());
          const response = await route.fetch({
            url: accounts.origin + url.pathname,
          });
          await route.fulfill({ response });
        },
      );
      await provideAccount(accountName);
    } finally {
      await accounts.close();
    }
  },
});

// The one-time editor proof is posted in the browser, never in test artifacts.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
test.use({ trace: "off", screenshot: "off" });

async function openFileTask(
  browser: BrowserContext,
  apiBaseUrl: string,
  connectorPath: string,
) {
  let canvas: Page | undefined;
  const server = assembleServer({
    apiBaseUrl,
    connectorPath,
    openBrowser: async (url) => {
      canvas = await browser.newPage();
      await canvas.goto(url);
    },
  });
  const call = async (name: string, args: object) => {
    const result = await server.handler.callTool(name, args);
    const block = result.content[0];
    if (block?.type !== "text" || !block.text)
      throw new Error("Expected a tool receipt");
    return JSON.parse(block.text);
  };
  const opening = call("open_canvas", {});
  await expect.poll(() => canvas !== undefined).toBe(true);
  const page = canvas!;
  await page.getByRole("button", { name: "Allow Agent access" }).click();
  const { taskRef, sessionId, context: original } = await opening;
  const tool = (name: string, args: object) => call(name, { ...args, taskRef });
  return { page, tool, taskRef, sessionId, original };
}

async function prepareReviewSource(rootPath: string) {
  const entryPath = "cells/cell.scs";
  const packagePath = join(rootPath, "draw.rnl");
  await mkdir(join(rootPath, "cells"), { recursive: true });
  await writeFile(
    join(rootPath, entryPath),
    [
      '// @RNL(type="header") { @VERSION("0.3");',
      '// @USE-PACKAGE(name="fixture", version="0.1", path="../draw.rnl");',
      '// @USE-PACKAGE(name="rnl-std-full", version="0.3"); }',
      "simulator lang=spectre",
      "subckt dut (IN OUT)",
      "C0 (IN OUT) process_mim w=3u l=2u",
      "R1 (IN OUT) resistor r=1k",
      "// @RNL {",
      '// #C0 @SET-SYMBOL $CAPACITOR => @PLACE(0, 0) => @ORIENT("R0");',
      '// #R1 @SET-SYMBOL $RESISTOR => @PLACE(8, 0) => @ORIENT("R0");',
      '// &OUT @WIRE(mode="straight") {#C0:2 (0,-10)};',
      '// &OUT @WIRE(mode="straight") {(0,-10) (8,-10)};',
      '// &OUT @WIRE(mode="straight") {(8,-10) #R1:2};',
      "// }",
      "ends dut",
      "",
    ].join("\n"),
  );
  const packageText =
    '@RNL(type="header") { @VERSION("0.3"); @PACKAGE(name="fixture",version="0.1"); }\n';
  return { entryPath, packagePath, packageText };
}

test("delivers a local RNL revision into its own Project tab and reuses the edited copy", async ({
  context,
  baseURL,
  accountName: _accountName,
}, testInfo) => {
  const rootPath = testInfo.outputPath("source");
  const { entryPath, packagePath, packageText } =
    await prepareReviewSource(rootPath);
  const { page, tool, taskRef, sessionId, original } = await openFileTask(
    context,
    baseURL!,
    testInfo.outputPath("legacy-connector.json"),
  );
  const deliver = (path = entryPath) =>
    tool("import_file", {
      action: "open-local",
      rootPath,
      entryPath: path,
    });
  // A refusal reports the stages it ran: here only preparation.
  await expect(deliver()).resolves.toMatchObject({
    ok: false,
    error: { code: "FILE_DEPENDENCY_MISSING" },
    timingMs: {
      prepare: expect.any(Number),
      locate: 0,
      transfer: 0,
      import: 0,
      open: 0,
    },
  });
  const initialEdit = await tool("apply_actions", {
    actions: [
      {
        kind: "place-component",
        symbol: "resistor",
        reference: "R0",
        position: { x: 100, y: 100 },
      },
    ],
  });
  expect(initialEdit).toMatchObject({ ok: true, applied: true });
  await writeFile(packagePath, packageText);
  const loaded = await deliver();
  expect(loaded.ok, JSON.stringify(loaded.error)).toBe(true);
  expect(loaded.delivery.source.diagnostics).toEqual([
    expect.objectContaining({
      code: "RNL_IMPORT_PIN_NOT_ROUTED",
      message: expect.stringContaining("IN"),
    }),
  ]);
  expect(loaded).toMatchObject({
    ok: true,
    taskRef,
    sessionId,
    delivery: {
      disposition: "opened",
      modified: false,
      source: { format: "rnl", drawing: "partial", electrical: "verified" },
    },
  });
  const { source, workspaceId } = loaded.delivery;
  const nativePath = join(rootPath, "native.icproj.json");
  expect(
    await tool("export_file", { artifact: "project", outputPath: nativePath }),
  ).toMatchObject({ ok: true });
  const project = parseProject(await readFile(nativePath, "utf8"));
  expect(project.source.entry).toBe(entryPath);
  expect(project.source.files.map(({ path, hash }) => [path, hash])).toEqual(
    source.files.map(({ path, sha256 }: { path: string; sha256: string }) => [
      path,
      `sha256:${sha256}`,
    ]),
  );
  const drawn = project.documents.find(
    (item) => item.id === loaded.delivery.document.id,
  )!;
  expect(drawn.routes).toHaveLength(3);
  expect(drawn.junctions.map((item) => item.position)).toEqual([
    { x: 0, y: 100 },
    { x: 0, y: 100 },
    { x: 80, y: 100 },
    { x: 80, y: 100 },
  ]);
  expect(drawn.junctions.every((item) => item.role === "route-anchor")).toBe(
    true,
  );
  expect(source.files.map((file: { path: string }) => file.path)).toEqual([
    entryPath,
    "draw.rnl",
  ]);
  await page.getByRole("button", { name: "Project Info", exact: true }).click();
  await page.getByText("Imported source", { exact: true }).click();
  await expect(page.getByTestId("local-source-version")).toHaveText(
    source.version,
  );
  await expect(page.getByTestId("local-source-status")).toHaveText(
    "Matches the imported netlist",
  );
  await expect(page.getByText("draw.rnl", { exact: true })).toBeVisible();
  const initial = await tool("get_context", {});
  expect(initial).toMatchObject({
    projectId: loaded.delivery.projectId,
    documentId: loaded.delivery.document.id,
  });
  expect(initial.projectId).not.toBe(original.projectId);
  const deliveredTarget = {
    workspaceId,
    projectId: loaded.delivery.projectId,
    structureRevision: loaded.delivery.structureRevision,
    documentId: loaded.delivery.document.id,
    revision: loaded.delivery.document.revision,
    sourceVersion: source.version,
  };
  const picture = (name: string, request: object) =>
    tool("export_file", {
      artifact: "png",
      documentId: deliveredTarget.documentId,
      outputPath: testInfo.outputPath(`${name}.png`),
      ...request,
    });
  const legacy = await tool("export_file", {
    artifact: "svg",
    documentId: deliveredTarget.documentId,
    outputPath: testInfo.outputPath("review-legacy.svg"),
  });
  expect(legacy).toMatchObject({ ok: true });
  expect(legacy).not.toHaveProperty("review");
  const firstPicture = await picture("review-full", { includeReview: true });
  expect(firstPicture).toMatchObject({
    ok: true,
    taskRef,
    review: {
      ...deliveredTarget,
      workspaceGeneration: expect.any(String),
      unplacedInstances: 0,
    },
  });
  const target = {
    ...deliveredTarget,
    workspaceGeneration: firstPicture.review.workspaceGeneration,
  };
  expect(
    (await readFile(firstPicture.outputPath)).subarray(1, 4).toString(),
  ).toBe("PNG");
  await expect(tool("open_canvas", {})).resolves.toMatchObject({
    ok: true,
    browser: "reused",
    projectRead: "ready",
    context: { projectId: target.projectId, revision: target.revision },
  });
  const webTarget = (revision: number) => ({
    workspaceId,
    projectId: target.projectId,
    structureRevision: target.structureRevision,
    cells: expect.arrayContaining([
      expect.objectContaining({ documentId: target.documentId, revision }),
    ]),
  });
  const reviewWorkspaces = () =>
    tool("project_cells", {
      action: "workspace",
      request: { action: "list", includeReview: true },
    });
  const web = await reviewWorkspaces();
  expect(web).toMatchObject({
    ok: true,
    result: {
      activeWorkspaceId: workspaceId,
      projects: expect.arrayContaining([
        expect.objectContaining({
          ...webTarget(target.revision),
          review: {
            workspaceGeneration: target.workspaceGeneration,
            sourceVersion: target.sourceVersion,
            activeDocumentId: target.documentId,
          },
        }),
      ]),
    },
  });
  const bounds = { x: -20, y: -20, width: 40, height: 50 };
  const detail = await picture("review-detail", { expected: target, bounds });
  expect(detail).toMatchObject({ ok: true, review: { ...target, bounds } });
  const detailBytes = await readFile(detail.outputPath);
  expect([detailBytes.readUInt32BE(16), detailBytes.readUInt32BE(20)]).toEqual([
    120, 150,
  ]);
  expect(
    await tool("apply_actions", {
      actions: [
        {
          kind: "place-component",
          symbol: "resistor",
          reference: "R2",
          position: { x: 200, y: 200 },
        },
      ],
    }),
  ).toMatchObject({ ok: true, applied: true });
  const reused = await deliver();
  expect(reused).toMatchObject({
    delivery: {
      disposition: "reused",
      workspaceId,
      modified: true,
      source: { version: source.version },
    },
    timingMs: { import: 0, transfer: 0 },
  });
  expect(reused.delivery.document.revision).toBeGreaterThan(
    loaded.delivery.document.revision,
  );
  await expect(
    picture("review-stale", { expected: target, bounds }),
  ).resolves.toMatchObject({
    ok: false,
    error: { code: "REVIEW_TARGET_CHANGED" },
  });
  const currentPicture = await picture("review-current", { bounds });
  expect(currentPicture).toMatchObject({
    ok: true,
    review: {
      ...target,
      revision: reused.delivery.document.revision,
    },
  });
  // A part placed but not wired blocks the structural export, and the
  // status says the drawing could not be compared rather than guessing.
  await expect(page.getByTestId("local-source-status")).toHaveText(
    /^Not fully compared with the imported netlist: The current structural export is blocked; /u,
  );
  await page.reload();
  expect(await tool("open_canvas", {})).toMatchObject({ ok: true, sessionId });
  expect(await deliver()).toMatchObject({
    ok: true,
    delivery: {
      disposition: "reused",
      previousRevision: "recovered-snapshot",
      workspaceId,
      modified: true,
      source: { version: source.version },
    },
  });
  const editedTarget = { ...target, revision: currentPicture.review.revision };
  await expect(
    picture("review-before-recovery", { expected: editedTarget, bounds }),
  ).resolves.toMatchObject({
    ok: false,
    error: { code: "REVIEW_TARGET_CHANGED" },
  });
  const recoveredPicture = await picture("review-recovered", { bounds });
  expect(recoveredPicture).toMatchObject({
    ok: true,
    review: {
      workspaceId,
      revision: editedTarget.revision,
      sourceVersion: source.version,
    },
  });
  expect(recoveredPicture.review.workspaceGeneration).not.toBe(
    editedTarget.workspaceGeneration,
  );
  const recoveredWeb = await reviewWorkspaces();
  expect(recoveredWeb).toMatchObject({
    ok: true,
    result: {
      activeWorkspaceId: workspaceId,
      projects: expect.arrayContaining([
        expect.objectContaining({
          ...webTarget(editedTarget.revision),
          review: {
            workspaceGeneration: recoveredPicture.review.workspaceGeneration,
            sourceVersion: target.sourceVersion,
            activeDocumentId: target.documentId,
          },
        }),
      ]),
    },
  });
  await writeFile(packagePath, packageText + "\n");
  const newer = await deliver();
  expect(newer).toMatchObject({
    ok: true,
    delivery: { disposition: "opened", modified: false },
  });
  expect(newer.delivery.source.version).not.toBe(source.version);
  expect(newer.delivery.workspaceId).not.toBe(workspaceId);
  const roster = await tool("project_cells", {
    action: "workspace",
    request: { action: "list" },
  });
  const blank = roster.result.projects.find(
    (item: { projectId: string }) => item.projectId === original.projectId,
  );
  expect(blank).toBeDefined();
  expect(blank).not.toHaveProperty("review");
  await tool("project_cells", {
    action: "workspace",
    request: { action: "activate", workspaceId: blank.workspaceId },
  });
  await tool("project_cells", {
    action: "bind-workspace",
    workspaceId: blank.workspaceId,
  });
  expect(await tool("get_context", { refresh: true })).toMatchObject({
    projectId: original.projectId,
    instanceCount: 1,
  });

  await writeFile(
    join(rootPath, "plain.sp"),
    "* plain\n.subckt plain A B\nR1 A B 1k\n.ends\n",
  );
  const undrawn = await deliver("plain.sp");
  expect(undrawn).toMatchObject({
    ok: true,
    delivery: {
      source: {
        format: "spice",
        drawing: "not-provided",
        electrical: "not-verified",
      },
    },
  });
  await page
    .getByRole("button", { name: "Close tab plain (SPICE Import)" })
    .click();
  await page.getByRole("button", { name: "Close without saving" }).click();
  const reopened = await deliver("plain.sp");
  expect(reopened).toMatchObject({
    ok: true,
    delivery: {
      disposition: "opened",
      previousRevision: "unconfirmed",
      source: { version: undrawn.delivery.source.version },
    },
  });
  expect(reopened.delivery.workspaceId).not.toBe(undrawn.delivery.workspaceId);
  await writeFile(
    join(rootPath, "plain.scs"),
    "simulator lang=spectre\nsubckt plain (A B)\nR1 (A B) resistor r=1k\nends plain\n",
  );
  const spectre = await deliver("plain.scs");
  expect(spectre, JSON.stringify(spectre.error)).toMatchObject({
    ok: true,
    delivery: { source: { format: "spectre", drawing: "not-provided" } },
  });
  const openedProject = await deliver("native.icproj.json");
  expect(openedProject, JSON.stringify(openedProject.error)).toMatchObject({
    ok: true,
    delivery: { source: { format: "project", drawing: "native" } },
  });
  expect(
    await tool("import_file", {
      action: "open",
      candidateId: "wrong-candidate",
    }),
  ).toMatchObject({
    ok: false,
    error: { code: "FILE_CANDIDATE_NOT_FOUND" },
  });
  await writeFile(join(rootPath, "invalid.icproj.json"), "{}");
  expect(await deliver("invalid.icproj.json")).toMatchObject({
    ok: false,
    error: { code: "FILE_IMPORT_FAILED" },
  });
  await tool("disconnect", {});
});

test("copies a review comment on an object as plain text", async ({
  context,
  baseURL,
  accountName: _accountName,
}, testInfo) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const rootPath = testInfo.outputPath("source");
  const { entryPath, packagePath, packageText } =
    await prepareReviewSource(rootPath);
  await writeFile(packagePath, packageText);
  const { page, tool } = await openFileTask(
    context,
    baseURL!,
    testInfo.outputPath("connector.json"),
  );
  const loaded = await tool("import_file", {
    action: "open-local",
    rootPath,
    entryPath,
  });
  expect(loaded).toMatchObject({ ok: true });
  const snapshotPath = testInfo.outputPath("fixture.icproj.json");
  expect(
    await tool("export_file", {
      artifact: "project",
      outputPath: snapshotPath,
    }),
  ).toMatchObject({ ok: true });
  const project = parseProject(await readFile(snapshotPath, "utf8"));
  const cell = project.documents.find(
    ({ id }) => id === loaded.delivery.document.id,
  )!;
  const resistor = cell.instances.find(({ reference }) => reference === "R1")!;
  const selection = await tool("circuit_view", {
    actions: [
      {
        kind: "focus",
        intent: {
          kind: "select",
          locator: {
            documentId: cell.id,
            hierarchyPath: [],
            kind: "instance",
            objectId: resistor.id,
          },
        },
      },
    ],
  });
  expect(selection).toMatchObject({ ok: true });
  await expect(page.getByTestId("hit-R1")).toHaveClass(/selected/u);

  const panel = page.getByRole("button", {
    name: "Review feedback",
    exact: true,
  });
  if (!(await panel.isVisible()))
    await page
      .getByRole("button", { name: "Project Info", exact: true })
      .click();
  await panel.click();
  const comment = page.getByLabel("Review comment");
  const copy = page.getByRole("button", {
    name: "Copy review feedback",
    exact: true,
  });
  const copied = page.getByText("Copied. Paste it into the Agent chat.", {
    exact: true,
  });
  // The system clipboard may hand the lines back with CRLF.
  const clipboard = async () =>
    (await page.evaluate(() => navigator.clipboard.readText())).replaceAll(
      "\r\n",
      "\n",
    );
  await comment.fill("Check the connection at R1.");
  await copy.click();
  await expect(copied).toBeVisible();
  // An RNL-annotated file converts through its drawing package, so its
  // line cannot be matched and is left out (plain Spectre: unit test).
  expect(await clipboard()).toBe(
    [
      "Canvas review feedback",
      `Cell: ${cell.name}`,
      `Object: R1 (instance ${resistor.id})`,
      "",
      "Check the connection at R1.",
    ].join("\n"),
  );
  // An edit elsewhere keeps the comment being written for the same object.
  await comment.fill("Draft that outlives an edit.");
  expect(
    await tool("apply_actions", {
      actions: [
        {
          kind: "set-property",
          target: { kind: "instance", reference: "R1" },
          set: { value: "2k" },
        },
      ],
    }),
  ).toMatchObject({ ok: true, applied: true });
  await expect(comment).toHaveValue("Draft that outlives an edit.");

  const net = cell.nets.find(({ id }) =>
    cell.routes.some(({ netId }) => netId === id),
  )!;
  expect(
    await tool("circuit_view", {
      actions: [
        { kind: "focus", intent: { kind: "highlight-net", netId: net.id } },
      ],
    }),
  ).toMatchObject({ ok: true });
  await expect(page.getByTestId("net-highlight-overlay")).toBeVisible();
  await panel.click();
  await comment.fill("Check the highlighted Net.");
  await copy.click();
  await expect(copied).toBeVisible();
  const netFeedback = await clipboard();
  expect(netFeedback).toContain(`(net ${net.id})`);
  expect(netFeedback).not.toContain("Source:");
  expect(netFeedback.endsWith("\n\nCheck the highlighted Net.")).toBe(true);
  await tool("disconnect", {});
});

test("reads the whole design against the delivered netlist, whichever Cell is open", async ({
  context,
  baseURL,
  accountName: _accountName,
}, testInfo) => {
  const rootPath = testInfo.outputPath("source");
  await mkdir(join(rootPath, "cells"), { recursive: true });
  const entryPath = "dut.scs";
  const childPath = join(rootPath, "cells", "load.scs");
  const child = [
    "// original source",
    "",
    "subckt load (A B C)",
    "R1 (A B) resistor r=1k",
    "R2 (A B) resistor r=3k",
    "R3 (A C) resistor r=5k",
    "R5 (B C) resistor r=6k",
    "ends load",
    "",
  ].join("\n");
  await writeFile(
    join(rootPath, entryPath),
    'simulator lang=spectre\ninclude "cells/load.scs"\nsubckt dut (A B C)\nX1 (A B C) load\nends dut\n',
  );
  await writeFile(childPath, child);
  const { tool } = await openFileTask(
    context,
    baseURL!,
    testInfo.outputPath("connector.json"),
  );
  const loaded = await tool("import_file", {
    action: "open-local",
    rootPath,
    entryPath,
  });
  expect(loaded).toMatchObject({ ok: true });
  const { version } = loaded.delivery.source;
  const exportedPath = testInfo.outputPath("fixture.icproj.json");
  expect(
    await tool("export_file", {
      artifact: "project",
      outputPath: exportedPath,
    }),
  ).toMatchObject({ ok: true });
  const project = parseProject(await readFile(exportedPath, "utf8"));
  const load = project.documents.find(({ name }) => name === "load")!;
  const top = project.documents.find(({ name }) => name === "dut")!;
  const unchanged = await tool("review_delivery", {});
  expect(unchanged, JSON.stringify(unchanged)).toMatchObject({
    ok: true,
    delivery: {
      workspaceId: loaded.delivery.workspaceId,
      source: { entryPath, version },
      incompleteCells: expect.any(Array),
    },
    comparison: { status: "equal", sourceVersion: version, differences: [] },
  });
  // The child Cell is open; edits in it and in the top Cell both count.
  expect(
    await tool("circuit_view", {
      documentId: load.id,
      actions: [{ kind: "focus", intent: { kind: "activate-document" } }],
    }),
  ).toMatchObject({ ok: true });
  const pin = (instance: string, name: string) => ({
    kind: "pin",
    instance,
    pin: name,
  });
  const batches = [
    // Moving a part changes no electrical fact.
    [
      {
        kind: "move",
        target: { kind: "instance", reference: "R1" },
        position: { x: 200, y: 120 },
      },
    ],
    [
      {
        kind: "set-property",
        target: { kind: "instance", reference: "R1" },
        set: { value: "2k" },
      },
    ],
    [{ kind: "delete", target: { kind: "instance", reference: "R3" } }],
    [
      {
        kind: "move",
        target: { kind: "instance", reference: "R2" },
        position: { x: 400, y: 120 },
      },
      {
        kind: "move",
        target: { kind: "instance", reference: "R5" },
        position: { x: 600, y: 120 },
      },
      { kind: "disconnect", target: pin("R2", "2") },
    ],
    [{ kind: "connect", from: pin("R2", "2"), to: pin("R5", "2") }],
    [
      {
        kind: "place-component",
        symbol: "resistor",
        reference: "R4",
        position: { x: 200, y: 320 },
        parameters: { value: "4k" },
      },
    ],
    [
      { kind: "connect", from: pin("R4", "1"), to: pin("R1", "1") },
      { kind: "connect", from: pin("R4", "2"), to: pin("R5", "2") },
    ],
  ].map((actions) => ({ documentId: load.id, actions }));
  batches.push(
    {
      documentId: top.id,
      actions: [
        {
          kind: "place-component",
          symbol: "resistor",
          reference: "R9",
          position: { x: 400, y: 400 },
          parameters: { value: "9k" },
        },
      ],
    },
    {
      documentId: top.id,
      actions: [
        { kind: "connect", from: pin("R9", "1"), to: pin("X1", "A") },
        { kind: "connect", from: pin("R9", "2"), to: pin("X1", "B") },
      ],
    },
  );
  for (const batch of batches) {
    const changed = await tool("apply_actions", batch);
    expect(changed, JSON.stringify(changed)).toMatchObject({
      ok: true,
      applied: true,
    });
  }
  const changes = await tool("review_delivery", {});
  expect(changes, JSON.stringify(changes)).toMatchObject({
    ok: true,
    comparison: {
      status: "different",
      sourceVersion: version,
      differences: expect.arrayContaining([
        expect.objectContaining({
          kind: "parameter",
          cell: "load",
          source: { path: "cells/load.scs", line: 4 },
        }),
        expect.objectContaining({
          kind: "connection",
          cell: "load",
          object: "r2:1",
          source: { path: "cells/load.scs", line: 5 },
        }),
        expect.objectContaining({
          kind: "device",
          cell: "load",
          object: "r3",
          actual: false,
          source: { path: "cells/load.scs", line: 6 },
        }),
        expect.objectContaining({
          kind: "device",
          cell: "load",
          object: "r4",
          actual: expect.objectContaining({
            terminals: [
              { name: "1", net: "A" },
              { name: "2", net: "C" },
            ],
          }),
        }),
        expect.objectContaining({
          kind: "device",
          cell: "dut",
          object: "r9",
          actual: expect.objectContaining({
            terminals: [
              { name: "1", net: "A" },
              { name: "2", net: "B" },
            ],
          }),
        }),
      ]),
    },
  });
  // Canvas only reads; the Agent writes the source files.
  expect(await readFile(childPath, "utf8")).toBe(child);
  await tool("disconnect", {});
});

test("reads a saved Project against the netlist it was imported from", async ({
  context,
  baseURL,
  accountName: _accountName,
}, testInfo) => {
  const rootPath = testInfo.outputPath("source");
  const { entryPath, packagePath, packageText } =
    await prepareReviewSource(rootPath);
  await writeFile(packagePath, packageText);
  const { page, tool } = await openFileTask(
    context,
    baseURL!,
    testInfo.outputPath("connector.json"),
  );
  const deliver = (path: string) =>
    tool("import_file", { action: "open-local", rootPath, entryPath: path });
  const loaded = await deliver(entryPath);
  expect(loaded).toMatchObject({ ok: true });
  const { version } = loaded.delivery.source;
  expect(
    await tool("export_file", {
      artifact: "project",
      outputPath: join(rootPath, "saved.icproj.json"),
    }),
  ).toMatchObject({ ok: true });
  const reopened = await deliver("saved.icproj.json");
  expect(reopened, JSON.stringify(reopened.error)).toMatchObject({
    ok: true,
    delivery: { source: { format: "project" } },
  });
  expect(reopened.delivery.source.version).not.toBe(version);
  expect(await tool("review_delivery", {})).toMatchObject({
    ok: true,
    delivery: {
      workspaceId: reopened.delivery.workspaceId,
      source: { entryPath, version },
    },
    comparison: { status: "equal", sourceVersion: version },
  });
  // Project Info names the netlist, not the Project file.
  const imported = page.getByText("Imported source", { exact: true });
  if (!(await imported.isVisible()))
    await page
      .getByRole("button", { name: "Project Info", exact: true })
      .click();
  await imported.click();
  await expect(page.getByTestId("local-source-version")).toHaveText(version);
  await expect(page.getByText("draw.rnl", { exact: true })).toBeVisible();
  await tool("disconnect", {});
});

test("delivers a Virtuoso netlist whose foundry library stays external, typed by the Agent", async ({
  context,
  baseURL,
  accountName: _accountName,
}, testInfo) => {
  // A Virtuoso netlist names its foundry's library by an absolute path: it
  // stays external and unread, and the Agent gives its models' device types.
  // A local card, a parameter and an analysis ride along unchanged. A task
  // of its own keeps the deliveries above within one session's request rate.
  const rootPath = testInfo.outputPath("virtuoso");
  await mkdir(rootPath, { recursive: true });
  await writeFile(
    join(rootPath, "top.scs"),
    [
      "simulator lang=spectre",
      'include "/pdk/tsmc28/models/spectre/toplevel.scs" section=tt',
      'include "models.scs"',
      "parameters wn=1u",
      "subckt inv (in out vdd vss)",
      "M1 (out in vdd vdd) pch_mac w=2u l=30n",
      "M0 (out in vss vss) nch_mac w=wn l=30n",
      "M2 (out in vss vss) nlocal w=1u l=30n",
      "ends inv",
      "tran tran step=10p stop=10n",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(rootPath, "models.scs"),
    "simulator lang=spectre\nmodel nlocal bsim3v3 type=n\n",
  );
  const { tool } = await openFileTask(
    context,
    baseURL!,
    testInfo.outputPath("legacy-connector.json"),
  );
  const deliver = (modelTypes?: Record<string, string>) =>
    tool("import_file", {
      action: "open-local",
      rootPath,
      entryPath: "top.scs",
      ...(modelTypes ? { modelTypes } : {}),
    });
  expect(await deliver()).toMatchObject({
    ok: false,
    error: {
      code: "FILE_IMPORT_FAILED",
      message: expect.stringContaining("modelTypes"),
    },
    timingMs: { transfer: expect.any(Number), open: 0 },
  });
  const typed = await deliver({ nch_mac: "nmos", pch_mac: "pmos" });
  expect(typed, JSON.stringify(typed.error)).toMatchObject({
    ok: true,
    delivery: {
      source: {
        format: "spectre",
        files: [{ path: "top.scs" }, { path: "models.scs" }],
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: "SPICE_SOURCE_INCLUDE_EXTERNAL" }),
          expect.objectContaining({ code: "LOCAL_MODEL_TYPES_GIVEN" }),
          expect.objectContaining({ code: "SPICE_CONVERSION_MODEL_EXTERNAL" }),
        ]),
      },
    },
  });
  // What the review leaves out is named, and the drawing still gets a verdict.
  const review = await tool("review_delivery", {});
  expect(review, JSON.stringify(review)).toMatchObject({
    ok: true,
    delivery: { source: { version: typed.delivery.source.version } },
    comparison: {
      status: "equal",
      notes: expect.arrayContaining([
        expect.stringMatching(/^Includes not read: .*toplevel\.scs/u),
        expect.stringMatching(/^Parameters not compared: wn/u),
        expect.stringMatching(/^Statements not compared: .*tran/u),
        expect.stringContaining("bsim3v3 model nlocal"),
      ]),
    },
  });
  await tool("disconnect", {});
});

test("keeps Canvas and source RNL copies distinct across recovery", async ({
  context,
  baseURL,
  accountName: _accountName,
}, testInfo) => {
  const rootPath = testInfo.outputPath("source");
  const entryPath = "cell.scs";
  await mkdir(rootPath, { recursive: true });
  await writeFile(
    join(rootPath, entryPath),
    [
      '// @RNL(type="header") { @VERSION("0.3");',
      '// @USE-PACKAGE(name="rnl-std-full", version="0.3"); }',
      "simulator lang=spectre",
      "subckt dut (IN OUT)",
      "R1 (IN OUT) resistor r=1k",
      "// @RNL {",
      '// #R1 @SET-SYMBOL $RESISTOR => @PLACE(0, 0) => @ORIENT("R0");',
      '// &IN @WIRE(mode="straight") {#R1:1 (0,10)};',
      '// &OUT @WIRE(mode="straight") {#R1:2 (0,-10)};',
      "// }",
      "ends dut",
      "",
    ].join("\n"),
  );
  const { page, tool, sessionId } = await openFileTask(
    context,
    baseURL!,
    testInfo.outputPath("legacy-connector.json"),
  );
  const deliver = (rnlAppearance?: "canvas" | "source") =>
    tool("import_file", {
      action: "open-local",
      rootPath,
      entryPath,
      ...(rnlAppearance ? { rnlAppearance } : {}),
    });
  const native = await deliver();
  expect(native, JSON.stringify(native.error)).toMatchObject({
    ok: true,
    delivery: {
      disposition: "opened",
      source: { format: "rnl", version: expect.any(String) },
    },
  });
  const { source, workspaceId } = native.delivery;
  const faithful = await deliver("source");
  expect(faithful, JSON.stringify(faithful.error)).toMatchObject({
    ok: true,
    delivery: {
      disposition: "opened",
      source: { version: source.version },
    },
  });
  expect(faithful.delivery.workspaceId).not.toBe(workspaceId);
  await expect(deliver("canvas")).resolves.toMatchObject({
    ok: true,
    delivery: { disposition: "reused", workspaceId },
  });

  await page.reload();
  await expect(tool("open_canvas", {})).resolves.toMatchObject({
    ok: true,
    sessionId,
  });
  await expect(deliver("source")).resolves.toMatchObject({
    ok: true,
    delivery: {
      disposition: "reused",
      previousRevision: "recovered-snapshot",
      workspaceId: faithful.delivery.workspaceId,
      source: { version: source.version },
    },
  });
  await tool("disconnect", {});
});

test("opens and reuses only the Canvas authorized for each Agent task", async ({
  context,
  baseURL,
  request,
  accountName,
}, testInfo) => {
  const pages: Awaited<ReturnType<typeof context.newPage>>[] = [];
  const launchBodies: string[] = [];
  const server = assembleServer({
    apiBaseUrl: baseURL!,
    connectorPath: testInfo.outputPath("legacy-connector.json"),
    openBrowser: async (url) => {
      const page = await context.newPage();
      pages.push(page);
      page.on("request", (incoming) => {
        if (
          incoming.url() === `${baseURL}/api/agent/editor-launch` &&
          incoming.isNavigationRequest()
        ) {
          const body = incoming.postData();
          if (body) launchBodies.push(body);
        }
      });
      await page.goto(url);
    },
  });
  const tool = async (name: string, args: unknown = {}) => {
    const result = await server.handler.callTool(name, args);
    const block = result.content[0];
    if (block?.type !== "text" || !block.text)
      throw new Error("Expected a tool receipt");
    return JSON.parse(block.text);
  };
  const open = async (taskRef?: string) => {
    const count = pages.length;
    const opening = tool("open_canvas", { taskRef });
    await Promise.race([
      expect.poll(() => pages.length, { timeout: 15_000 }).toBe(count + 1),
      opening.then((receipt) => {
        if (pages.length === count)
          throw new Error(
            `Canvas did not request a tab: ${JSON.stringify(receipt)}`,
          );
      }),
    ]);
    await pages[count]!.getByRole("button", {
      name: "Allow Agent access",
    }).click();
    const receipt = await opening;
    expect(receipt).toMatchObject({
      ok: true,
      authorization: "active",
      projectRead: "ready",
      context: { documentId: "document-main", instanceCount: 0 },
    });
    if (accountName)
      await expect(pages[count]!.getByTestId("account-name")).toHaveText(
        accountName,
      );
    return receipt;
  };

  const first = await open();
  expect(first.taskRef).toBeTruthy();
  const replay = await request.post("/api/agent/editor-launch", {
    headers: {
      origin: baseURL!,
      "sec-fetch-mode": "same-origin",
      "sec-fetch-site": "same-origin",
      "content-type": "application/x-www-form-urlencoded",
    },
    data: launchBodies[0]!,
  });
  expect(replay.status()).toBe(409);
  expect(
    await tool("apply_actions", {
      taskRef: first.taskRef,
      actions: [
        {
          kind: "place-component",
          symbol: "resistor",
          reference: "R1",
          position: { x: 200, y: 200 },
        },
      ],
    }),
  ).toMatchObject({ ok: true, applied: true });

  const second = await open();
  expect(second.sessionId).not.toBe(first.sessionId);
  await pages[0]!.reload();
  const reused = await tool("open_canvas", { taskRef: first.taskRef });
  expect(reused.ok, JSON.stringify(reused.error)).toBe(true);
  expect(reused).toMatchObject({
    ok: true,
    browser: "reused",
    sessionId: first.sessionId,
    context: { instanceCount: 1 },
  });
  expect(pages).toHaveLength(2);
  expect(await tool("get_context", { taskRef: second.taskRef })).toMatchObject({
    instanceCount: 0,
  });
  expect(await tool("get_context")).toMatchObject({
    ok: false,
    error: { code: "CANVAS_TASK_REQUIRED" },
  });
  expect(
    await tool("get_context", { taskRef: crypto.randomUUID() }),
  ).toMatchObject({
    ok: false,
    error: { code: "CANVAS_TASK_NOT_FOUND" },
  });

  await pages[1]!.getByTestId("open-agent").click();
  await pages[1]!.getByTestId("agent-pause").click();
  await expect(pages[1]!.getByTestId("agent-resume")).toBeVisible();
  expect(await tool("open_canvas", { taskRef: second.taskRef })).toMatchObject({
    ok: false,
    authorization: "paused",
    error: { code: "SESSION_PAUSED" },
  });
  expect(pages).toHaveLength(2);
  await pages[1]!.getByTestId("agent-resume").click();
  await expect(pages[1]!.getByTestId("open-agent")).toHaveAttribute(
    "data-connection",
    "live",
  );

  const closed = pages[0]!.waitForEvent("close");
  await pages[0]!.close({ runBeforeUnload: true });
  await closed;
  const reopened = await open(first.taskRef);
  expect(reopened.taskRef).toBe(first.taskRef);
  expect(reopened.sessionId).not.toBe(first.sessionId);
  expect(reopened.recovery).toBe("previous-project-unconfirmed");
  expect(await tool("disconnect", { taskRef: reopened.taskRef })).toMatchObject(
    {
      ok: true,
    },
  );
  expect(await tool("open_canvas", { taskRef: first.taskRef })).toMatchObject({
    ok: false,
    error: { code: "SESSION_REVOKED" },
  });
  await pages[1]!.getByTestId("agent-revoke").click();
  // Every call on the task after the revocation says so, even one that fails
  // before it reaches the relay: none asks for a Claim or blames the relay.
  await expect
    .poll(
      async () =>
        (
          await tool("import_file", {
            taskRef: second.taskRef,
            action: "open-local",
            rootPath: ".",
            entryPath: "missing.sp",
          })
        ).error?.code,
    )
    .toBe("SESSION_REVOKED");
  expect(await tool("get_context", { taskRef: second.taskRef })).toMatchObject({
    ok: false,
    error: { code: "SESSION_REVOKED" },
  });
  expect(await tool("open_canvas", { taskRef: second.taskRef })).toMatchObject({
    ok: false,
    authorization: "revoked",
    error: {
      code: "SESSION_REVOKED",
      message: expect.stringContaining("open_canvas without a taskRef"),
    },
  });
  expect(pages).toHaveLength(3);
});

test("confirms a review copy delivered into a tab paired by Claim", async ({
  page,
  baseURL,
}, testInfo) => {
  const rootPath = testInfo.outputPath("claim-source");
  const { entryPath, packagePath, packageText } =
    await prepareReviewSource(rootPath);
  await writeFile(packagePath, packageText);
  await openEditor(page);
  await page.getByTestId("open-agent").click();
  const message = page
    .getByTestId("connect-agent-panel")
    .getByTestId("agent-copy-text");
  await expect
    .poll(async () => /^Claim: .+$/mu.test(await message.inputValue()), {
      timeout: 30_000,
    })
    .toBe(true);
  const claim = JSON.parse(
    /^Claim: (.+)$/mu.exec(await message.inputValue())![1]!,
  ) as { claimCode: string };
  const server = assembleServer({
    apiBaseUrl: baseURL!,
    connectorPath: testInfo.outputPath("claim-connector.json"),
  });
  const tool = async (name: string, args: object) => {
    const result = await server.handler.callTool(name, args);
    const block = result.content[0];
    if (block?.type !== "text" || !block.text)
      throw new Error("Expected a tool receipt");
    return JSON.parse(block.text);
  };
  expect(await tool("connect", claim)).toMatchObject({ ok: true });
  const loaded = await tool("import_file", {
    action: "open-local",
    rootPath,
    entryPath,
  });
  expect(loaded, JSON.stringify(loaded.error)).toMatchObject({ ok: true });
  // Canvas, not the kind of pairing, decides that this tab holds a delivery.
  const review = await tool("review_delivery", {});
  expect(review, JSON.stringify(review.error)).toMatchObject({
    ok: true,
    delivery: {
      workspaceId: loaded.delivery.workspaceId,
      source: { entryPath, version: loaded.delivery.source.version },
    },
    comparison: { status: "equal" },
  });
  expect(review.taskRef).toBeUndefined();
  await tool("disconnect", {});
});

test("offers only the one-time approval when the Agent asks for it", async ({
  context,
  baseURL,
}, testInfo) => {
  const pages: Page[] = [];
  const server = assembleServer({
    apiBaseUrl: baseURL!,
    connectorPath: testInfo.outputPath("connector.json"),
    openBrowser: async (url) => {
      const page = await context.newPage();
      pages.push(page);
      await page.goto(url);
    },
  });
  const tool = async (name: string, args: object) => {
    const result = await server.handler.callTool(name, args);
    const block = result.content[0];
    if (block?.type !== "text" || !block.text)
      throw new Error("Expected a tool receipt");
    return JSON.parse(block.text);
  };
  const open = async (args: object) => {
    const count = pages.length;
    const opening = tool("open_canvas", args);
    await expect.poll(() => pages.length).toBe(count + 1);
    const page = pages[count]!;
    await expect(
      page.getByRole("button", { name: "Allow Agent access" }),
    ).toBeVisible();
    const trust = await page
      .getByRole("button", { name: "Trust this device" })
      .count();
    await page.getByRole("button", { name: "Allow Agent access" }).click();
    return { receipt: await opening, trust };
  };
  // This installation proves itself, so Canvas offers to trust it.
  const usual = await open({});
  expect(usual.trust).toBe(1);
  expect(usual.receipt).toMatchObject({ ok: true, projectRead: "ready" });
  // A one-time approval sends no proof: there is nothing to trust.
  const once = await open({ approval: "once" });
  expect(once.trust).toBe(0);
  expect(once.receipt).toMatchObject({
    ok: true,
    authorization: "active",
    projectRead: "ready",
  });
  // Neither task was opened by a trusted device.
  expect(usual.receipt.trusted).toBeUndefined();
  expect(once.receipt.trusted).toBeUndefined();
  for (const { receipt } of [usual, once])
    await tool("disconnect", { taskRef: receipt.taskRef });
});
