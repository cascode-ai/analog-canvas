import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMcp } from "./mcp-stdio-fixture.js";
import { placedInstance } from "./canvas-fixtures.js";
import { openEditor } from "./editor-fixtures.js";

// Playwright's separate failure ARIA snapshot also contains the live Claim.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
// Credentials stay out of failure artifacts, including deployed acceptance runs.
test.use({ trace: "off", screenshot: "off" });

test.describe("first connection handoff", () => {
  for (const transport of ["MCP", "raw HTTP"] as const) {
    test(`${transport} pairs from one handoff, reads the circuit, edits and shares undo`, async ({
      page,
      request,
      baseURL,
    }) => {
      await openEditor(page);
      await page.getByTestId("open-agent").click();
      const panel = page.getByTestId("connect-agent-panel");
      await expect(
        panel.getByTestId("agent-claim").locator(".agent-connection-hint"),
      ).toContainText("MCP first; HTTP API fallback is authorized");
      const message = panel.getByTestId("agent-copy-text");
      await expect
        .poll(async () => /^Claim: .+$/mu.test(await message.inputValue()), {
          timeout: 30_000,
        })
        .toBe(true);
      const handoff = await message.inputValue();
      expect(handoff.includes("I authorize MCP first")).toBe(true);
      let claim: { claimCode: string };
      try {
        claim = JSON.parse(/^Claim: (.+)$/mu.exec(handoff)![1]!);
      } catch {
        throw new Error("Connection handoff must contain a JSON Claim");
      }
      const directory = await mkdtemp(join(tmpdir(), "icm-first-connect-"));
      let mcp: ReturnType<typeof startMcp> | undefined;
      let verifyEmpty: () => Promise<void>;
      try {
        if (transport === "MCP") {
          mcp = startMcp(baseURL!, join(directory, "connector.json"));
          await mcp.request("initialize", {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "first-connection-acceptance", version: "1" },
          });
          mcp.notify("notifications/initialized");
          expect((await mcp.tool("connect", claim)).ok).toBe(true);
          const context = await mcp.tool("get_context", { refresh: true });
          expect(context).toMatchObject({
            documentId: "document-main",
            instanceCount: 0,
            connection: "online",
          });
          const edited = await mcp.tool("apply_actions", {
            documentId: context.documentId,
            actions: [
              {
                kind: "place-component",
                symbol: "resistor",
                reference: "R1",
                position: { x: 300, y: 200 },
              },
            ],
          });
          expect(edited.ok).toBe(true);
          verifyEmpty = async () => {
            expect(
              await mcp!.tool("get_context", { refresh: true }),
            ).toMatchObject({ instanceCount: 0 });
          };
        } else {
          // Raw wire requests: no adapter package, Agent client, or MCP registration.
          const kitResponse = await request.get(`${baseURL}/api/agent/kit`);
          expect(kitResponse.ok()).toBe(true);
          expect(JSON.stringify(await kitResponse.json())).toContain(
            "authorized bootstrap fallback",
          );
          expect(
            (await request.get(`${baseURL}/api/agent/openapi.json`)).ok(),
          ).toBe(true);
          const claimed = await request
            .post(`${baseURL}/api/agent/claims`, { data: claim })
            .catch(() => {
              throw new Error("Claim request failed");
            });
          expect(claimed.ok()).toBe(true);
          const session = await claimed.json();
          const circuit = async (data: Record<string, unknown>) => {
            const response = await request
              .post(
                `${baseURL}/api/agent/sessions/${session.sessionId}/circuit`,
                {
                  headers: {
                    Authorization: `Bearer ${session.agentToken}`,
                    "x-agent-context": session.contextRevision,
                  },
                  data: {
                    apiVersion: "3.0",
                    requestId: crypto.randomUUID(),
                    documentId: session.documentIds[0],
                    ...data,
                  },
                },
              )
              .catch(() => {
                throw new Error("Circuit request failed");
              });
            expect(response.ok()).toBe(true);
            const result = await response.json();
            expect(result.ok).toBe(true);
            return result;
          };
          await expect(panel.getByTestId("agent-status")).toHaveText(
            "Connected",
          );
          const before = await circuit({ operation: "snapshot" });
          expect(before.snapshot.document.instances).toHaveLength(0);
          const edited = await circuit({
            operation: "transact",
            transactionId: crypto.randomUUID(),
            expectedRevision: before.revision,
            edits: [
              {
                kind: "add_instance",
                instance: placedInstance("R-http", "resistor", 300, 200),
              },
            ],
          });
          expect(edited.applied).toBe(true);
          verifyEmpty = async () => {
            expect(
              (await circuit({ operation: "snapshot" })).snapshot.document
                .instances,
            ).toHaveLength(0);
          };
        }
        await expect(panel.getByTestId("agent-status")).toHaveText("Connected");
        await panel.getByLabel("Close Agent dialog").click();
        await expect(page.getByTestId("active-instance-count")).toHaveText("1");
        await page.getByTestId("draw-tool-undo").click();
        await expect(page.getByTestId("active-instance-count")).toHaveText("0");
        await verifyEmpty();
      } finally {
        await mcp?.close();
        await rm(directory, { recursive: true, force: true });
      }
    });
  }
});
