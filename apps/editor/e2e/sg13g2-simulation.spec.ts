import { test, expect } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sg13g2Project } from "../../../packages/simulation-service/test-support/sg13g2-project.js";
import { routeSimulationRequest } from "../../../worker/simulation.js";
import profile from "../../../containers/ngspice/sg13g2/profile.json" with { type: "json" };
import { exportedProject, readAgentClaim } from "./editor-fixtures.js";
import { openSimulation } from "./simulation-e2e-fixtures.js";
import { startMcp } from "./mcp-stdio-fixture.js";

test("GUI and public MCP run the saved SG13G2 circuit on its real Profile", async ({
  page,
  baseURL,
}) => {
  test.skip(
    !process.env.ICM_SG13G2_URL,
    "Requires the qualified SG13G2 image and built MCP dependencies",
  );
  test.setTimeout(120000);
  const root = await mkdtemp(join(tmpdir(), "icm-sg13g2-mcp-"));
  let child: ReturnType<typeof startMcp> | undefined;
  let executions = 0;
  try {
    // Only the external HTTP boundary is redirected. Worker routing, harness,
    // native simulator, browser service and stdio MCP execute their real code.
    await page.route("**/api/simulate", async (route) => {
      const body = route.request().postDataJSON();
      if (!body.operation) executions++;
      const response = await routeSimulationRequest(
        new Request("http://local.test/api/simulate", {
          method: "POST",
          body: JSON.stringify(body),
        }),
        { SG13G2_UPSTREAM_URL: process.env.ICM_SG13G2_URL! },
      );
      await route.fulfill({
        status: response!.status,
        contentType: "application/json",
        body: await response!.text(),
      });
    });
    const { project, folder } = sg13g2Project();
    const panel = await openSimulation(page, project, "sg13g2.icproj.json");
    await panel.getByRole("button", { name: "Run", exact: true }).click();
    await expect(panel.getByRole("status")).toHaveText("completed", {
      timeout: 30000,
    });
    expect(executions).toBe(1);
    const saved = await exportedProject(page);
    const config = saved.simulationFolders[0].input.files.find(
      (f: { path: string }) => f.path === folder.input.configPath,
    );
    expect(JSON.parse(config.text).environment.profileId).toBe(profile.id);

    await page.getByRole("button", { name: "Agent", exact: true }).click();
    const claim = await readAgentClaim(page.getByTestId("connect-agent-panel"));
    child = startMcp(baseURL!, join(root, "connector.json"));
    await child.request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "sg13g2-qualification", version: "1" },
    });
    child.notify("notifications/initialized");
    const connected = await child.tool("connect", claim);
    expect(connected.ok, JSON.stringify(connected)).toBe(true);
    const prepared = await child.tool("simulation", {
      request: {
        operation: "prepare",
        source: {
          kind: "project-folder",
          folderId: folder.id,
          expectedStructureRevision: saved.structureRevision,
        },
      },
    });
    expect(prepared.ok, JSON.stringify(prepared)).toBe(true);
    const started = await child.tool("simulation", {
      request: {
        operation: "start",
        preparedId: prepared.prepared.id,
        digest: prepared.prepared.digest,
      },
    });
    expect(started.ok, JSON.stringify(started)).toBe(true);
    let finished: any;
    await expect
      .poll(
        async () => {
          const read = await child!.tool("simulation", {
            request: { operation: "read", runId: started.run.id },
            detail: "full",
          });
          expect(read.ok, JSON.stringify(read)).toBe(true);
          finished = read.run;
          return finished.state;
        },
        { timeout: 30000 },
      )
      .toBe("finished");
    expect(finished.result.outcome.status, JSON.stringify(finished)).toBe(
      "completed",
    );
    expect(finished.result.metadata.environment).toMatchObject({
      profileId: profile.id,
      models: { contentSha256: profile.models.contentSha256 },
    });
    expect(executions).toBe(2);
    const synced = await child.tool("simulation_files", {
      request: { action: "sync", runId: finished.id },
      basePath: join(root, "evidence"),
      detail: "full",
    });
    expect(synced.ok, JSON.stringify(synced)).toBe(true);
    const artifact = finished.artifacts.find(
      (a: { name: string }) => a.name === "result.json",
    );
    const file = synced.files.find((f: { id: string }) => f.id === artifact.id);
    const bytes = await readFile(file.outputPath);
    const result = JSON.parse(bytes.toString("utf8"));
    expect(result.outcome.status).toBe("completed");
    expect(result.data).toBeDefined();
    await test.info().attach("sg13g2-real-mcp-result", {
      body: bytes,
      contentType: "application/json",
    });
    await test.info().attach("sg13g2-saved-project", {
      body: Buffer.from(JSON.stringify(saved)),
      contentType: "application/json",
    });
  } finally {
    await child?.close();
    await rm(root, { recursive: true, force: true });
  }
});
