import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test as base, type Page } from "@playwright/test";
import { parseProject } from "@icm/project-protocol";
import { assembleServer } from "../../mcp-server/src/server.js";
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

test("delivers a local RNL revision into its own Project tab and reuses the edited copy", async ({
  context,
  baseURL,
  accountName: _accountName,
}, testInfo) => {
  const rootPath = testInfo.outputPath("source");
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
  let canvas: Page | undefined;
  const server = assembleServer({
    apiBaseUrl: baseURL!,
    connectorPath: testInfo.outputPath("legacy-connector.json"),
    openBrowser: async (url) => {
      canvas = await context.newPage();
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
  const deliver = (path = entryPath) =>
    tool("import_file", {
      action: "open-local",
      rootPath,
      entryPath: path,
    });
  await expect(deliver()).resolves.toMatchObject({
    ok: false,
    error: { code: "FILE_DEPENDENCY_MISSING" },
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
  expect(loaded.delivery.source.diagnostics).toEqual([]);
  expect(loaded).toMatchObject({
    ok: true,
    taskRef,
    sessionId,
    delivery: {
      disposition: "opened",
      modified: false,
      source: { format: "rnl", drawing: "preserved", electrical: "verified" },
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
      modified: false,
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
      modified: true,
    },
  });
  await expect(
    page.getByText("Edited since import", { exact: true }),
  ).toBeVisible();
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
      recovered: true,
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
  expect(await deliver("plain.scs")).toMatchObject({
    ok: true,
    delivery: { source: { format: "spectre", drawing: "not-provided" } },
  });
  expect(await deliver("native.icproj.json")).toMatchObject({
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
  await expect
    .poll(
      async () =>
        (await tool("open_canvas", { taskRef: second.taskRef })).error?.code,
    )
    .toBe("SESSION_REVOKED");
  expect(pages).toHaveLength(3);
});
