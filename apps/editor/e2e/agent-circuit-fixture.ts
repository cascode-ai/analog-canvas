import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { readAgentClaim } from "./editor-fixtures";

export async function openCircuitAgent(
  {
    page,
    request,
    baseURL,
  }: { page: Page; request: APIRequestContext; baseURL: string | undefined },
  documentId: string,
) {
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  const panel = page.getByTestId("connect-agent-panel");
  const claimed = await request.post(`${baseURL}/api/agent/claims`, {
    data: await readAgentClaim(panel),
  });
  expect(claimed.ok()).toBe(true);
  const session = await claimed.json();
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId("open-agent")).toHaveAttribute(
    "data-connection",
    "live",
  );
  return {
    panel,
    async post(payload: Record<string, unknown>) {
      const response = await request.post(
        `${baseURL}/api/agent/sessions/${session.sessionId}/circuit`,
        {
          headers: {
            Authorization: `Bearer ${session.agentToken}`,
            "x-agent-context": session.contextRevision,
          },
          data: {
            apiVersion: "3.0",
            requestId: crypto.randomUUID(),
            documentId,
            ...payload,
          },
        },
      );
      const body = await response.json();
      if (payload.operation === "snapshot" && body.ok)
        session.contextRevision = response.headers()["x-agent-context"];
      return { response, body };
    },
  };
}
