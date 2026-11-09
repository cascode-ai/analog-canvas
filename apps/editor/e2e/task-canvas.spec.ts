import { expect, test as base } from "@playwright/test";
import { assembleServer } from "../../mcp-server/src/server.js";
import { regionalAccounts } from "./regional-auth-fixture.js";

const test = base.extend<{ accountName: string | null }>({
  accountName: async ({ page, context, baseURL }, use) => {
    const editorUrl = new URL(baseURL!);
    // A deployed-site run still exercises the full task lifecycle. The
    // isolated account cookie is available only on loopback.
    if (editorUrl.hostname !== "127.0.0.1") {
      await use(null);
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
      await use(accountName);
    } finally {
      await accounts.close();
    }
  },
});

// The one-time editor proof is posted in the browser, never in test artifacts.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
test.use({ trace: "off", screenshot: "off" });

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
