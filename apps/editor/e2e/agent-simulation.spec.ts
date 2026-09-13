import { test, expect, type WebSocketRoute } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  createSimulationEnvironmentMetadata,
  createSimulationInputMetadata,
  readSimulationData,
} from "@icm/spice-run";

import { openMenu, clickNetlistWorkflowCommand } from "./editor-fixtures.js";
import { profile } from "./simulation-e2e-fixtures.js";
import { createSimulationFolder, createEmptyProject } from "@icm/model";
import { unzipSync, strFromU8 } from "fflate";
for (const sourceKind of ["workspace", "project-folder"] as const)
  test(`Agent ${sourceKind} simulation recovers errors, exports and hands off project results`, async ({
    page,
  }) => {
    const id = "simulation-e2e",
      secret = "simulation-editor-secret";
    let socket: WebSocketRoute | undefined;
    const replies: Array<{ kind: string; requestId: string; payload: any }> =
      [];
    let executions = 0;
    let release = () => {};
    const hold = new Promise<void>((r) => (release = r));
    await page.routeWebSocket(`**/api/agent/sessions/${id}/editor`, (s) => {
      socket = s;
      s.onMessage((m) => replies.push(JSON.parse(String(m))));
    });
    await page.route("**/api/agent/sessions**", async (route) => {
      if (
        route.request().method() === "POST" &&
        new URL(route.request().url()).pathname === "/api/agent/sessions"
      ) {
        expect(route.request().postDataJSON().scopes).toContain(
          "simulation.run",
        );
        await route.fulfill({
          json: {
            ok: true,
            session: {
              sessionId: id,
              editorSecret: secret,
              claimCode: `${id}.claim`,
              claimExpiresAt: Date.now() + 300000,
              expiresAt: Date.now() + 3600000,
            },
          },
        });
      } else await route.fulfill({ json: { ok: true, status: "active" } });
    });
    const rawfile =
      readFileSync(
        new URL(
          "../../../fixtures/ngspice-rawfile/divider-op.raw",
          import.meta.url,
        ),
        "utf8",
      ) +
      "\n" +
      readFileSync(
        new URL("../../../fixtures/ngspice-rawfile/rc-ac.raw", import.meta.url),
        "utf8",
      );
    await page.route("**/api/simulate", async (route) => {
      const body = route.request().postDataJSON();
      if (body.operation === "capabilities")
        return route.fulfill({
          json: {
            configured: true,
            rawfileCollection: "declared-single-ascii",
            inputs: ["structured", "raw"],
            analyses: ["op", "ac"],
            parsedAnalyses: ["op", "ac", "tran"],
            profiles: [{ id: profile.id, corners: ["tt"] }],
            maxTimeoutMs: 120000,
            maxInputBytes: 1048576,
            cancel: true,
          },
        });
      executions++;
      await hold;
      const reading = readSimulationData(rawfile);
      if (reading.status !== "read") throw Error("raw fixture");
      await route.fulfill({
        json: {
          outcome: { status: "completed" },
          diagnostics: [],
          log: "ngspice OP",
          durationMs: 1,
          data: reading.data,
          rawfile,
          executedDeck: body.preparedDeck,
          cancelled: false,
          metadata: {
            schemaVersion: 1,
            input: await createSimulationInputMetadata({
              inputRevision: body.inputRevision,
              netlist: body.netlist,
              testbench: body.testbench,
              deck: body.preparedDeck,
            }),
            configuration: { modelLibrary: null },
            environment: await createSimulationEnvironmentMetadata({
              executor: "local-host",
              reproducibility: "observed",
              profileId: profile.id,
              platform: "linux/x64",
              simulator: {
                name: "ngspice",
                version: profile.simulator.version,
                binarySha256: null,
              },
              models: null,
              startupSha256: null,
            }),
          },
        },
      });
    });
    await page.goto("/editor");
    if (sourceKind === "project-folder") {
      const project = createEmptyProject(
        "agent-result-project",
        "Agent results",
      );
      project.simulationFolders.push(
        createSimulationFolder({
          id: "e2e",
          name: "Divider",
          profileId: profile.id,
        }),
      );
      await page.getByTestId("project-file").setInputFiles({
        name: "agent-results.icproj.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(project)),
      });
    }
    await (
      await openMenu(page, "Agent")
    )
      .getByRole("button", { name: "Connect Agent" })
      .click();
    await expect.poll(() => !!socket).toBe(true);
    const send = async (
      kind: "simulation" | "file",
      payload: Record<string, unknown>,
      requestId: string = crypto.randomUUID(),
    ) => {
      const count = replies.filter(
        (r) => r.requestId === requestId && r.kind === `${kind}-response`,
      ).length;
      socket!.send(
        JSON.stringify({
          protocolVersion: "1.0",
          sessionId: id,
          messageId: crypto.randomUUID(),
          requestId,
          sentAt: new Date().toISOString(),
          kind: `${kind}-request`,
          payload: { apiVersion: "3.0", requestId, ...payload },
        }),
      );
      await expect
        .poll(
          () =>
            replies.filter(
              (r) => r.requestId === requestId && r.kind === `${kind}-response`,
            ).length,
        )
        .toBe(count + 1);
      return replies
        .filter(
          (r) => r.requestId === requestId && r.kind === `${kind}-response`,
        )
        .at(-1)!.payload;
    };
    expect(
      await send("simulation", {
        operation: "start",
        preparedId: "missing-digest",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "SIMULATION_REQUEST_INVALID", recovery: "fix-input" },
    });
    expect(
      await send("file", {
        operation: "simulation-input",
        input: { action: "read" },
      }),
    ).toMatchObject({ ok: false, error: { code: "FILE_REQUEST_INVALID" } });
    expect(
      await send("simulation", {
        operation: "prepare",
        source: {
          kind: "project-folder",
          folderId: "missing-folder",
          expectedStructureRevision: 0,
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "SIMULATION_FOLDER_MISSING" },
    });
    const workspace = (
      await send("file", {
        operation: "simulation-input",
        input: { action: "create" },
      })
    ).result.workspace;
    const sourceSetup = createSimulationFolder({
      id: "e2e",
      name: "Divider",
      profileId: profile.id,
    });
    await send("file", {
      operation: "simulation-input",
      input: {
        action: "update",
        owner:
          sourceKind === "workspace"
            ? { kind: "session-workspace", workspaceId: workspace.id }
            : { kind: "project-folder", folderId: "e2e" },
        expectedRevision: 0,
        entry: "main.cir",
        writes: [
          {
            path: "main.cir",
            text: "divider\nV1 in 0 1\nR1 in mid 1k\nR2 mid 0 1k\n.control\nset appendwrite\nop\nwrite out.raw\nac dec 10 1 1e6\nwrite out.raw\n.endc\n.end",
          },
          ...sourceSetup.input.files.filter(
            (file) => file.path === sourceSetup.input.configPath,
          ),
        ],
      },
    });
    const prepared = (
      await send("simulation", {
        operation: "prepare",
        source:
          sourceKind === "project-folder"
            ? {
                kind: "project-folder",
                folderId: "e2e",
                expectedStructureRevision: 1,
              }
            : {
                kind: "workspace",
                workspaceId: workspace.id,
                expectedRevision: 1,
              },
      })
    ).prepared;
    expect(executions).toBe(0);
    const start = {
      operation: "start",
      preparedId: prepared.id,
      digest: prepared.digest,
    };
    const run = (await send("simulation", start, "start-id")).run;
    expect(run.state).toBe("running");
    expect((await send("simulation", start, "start-id")).run.id).toBe(run.id);
    expect(executions).toBe(1);
    release();
    if (sourceKind === "project-folder") {
      // No Agent read: the project handoff must finish and archive autonomously.
      await page.getByRole("button", { name: "Hide Agent details" }).click();
      await expect(
        page.getByRole("region", { name: "Analog simulation" }),
      ).toHaveCount(0);
      await clickNetlistWorkflowCommand(page, "open-analog-simulation");
      const records = page.getByRole("region", {
        name: "Project runs",
        exact: true,
      });
      await expect(records).toContainText("Agent");
      await expect(
        records.getByRole("button", { name: "Open result" }),
      ).toBeEnabled();
      await records.getByRole("button", { name: "Open result" }).click();
      await expect(
        page.getByRole("button", { name: "Project + results ZIP" }),
      ).toBeVisible();
      expect(executions).toBe(1);
    }
    let finished: any;
    await expect
      .poll(async () => {
        finished = (
          await send("simulation", { operation: "read", runId: run.id })
        ).run;
        return finished.state;
      })
      .toBe("finished");
    expect(finished.result.data.analyses[0].probes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "v(mid)", value: 0.5 }),
      ]),
    );
    const csv = finished.artifacts.find(
      (a: { name: string }) => a.name === "op-0.csv",
    );
    expect(
      (
        await send("file", {
          operation: "simulation-input",
          input: { action: "artifact", artifactId: csv.id },
        })
      ).result.text,
    ).toContain("0.5");
    const recordIndex = finished.outputData
      ? finished.outputData.analyses.findIndex(
          (analysis: { analysis: string }) => analysis.analysis === "ac",
        )
      : finished.result.data.analyses.findIndex(
          (analysis: { analysis: string }) => analysis.analysis === "ac",
        );
    expect(recordIndex).toBeGreaterThanOrEqual(0);
    const image = await send("file", {
      operation: "download",
      artifact: "simulation-plot",
      simulation: { runId: run.id, analysisIndex: recordIndex, format: "svg" },
    });
    expect(image.ok, JSON.stringify(image)).toBe(true);
    const imageBytes = Buffer.from(image.artifact.data, "base64");
    const svgs =
      image.artifact.mediaType === "application/zip"
        ? Object.values(unzipSync(imageBytes)).map((bytes) => strFromU8(bytes))
        : [imageBytes.toString("utf8")];
    expect(svgs.length).toBeGreaterThan(0);
    for (const svg of svgs) {
      expect(svg).toContain('fill="white"');
      expect(svg).toMatch(/<(?:path|polyline)/u);
      expect(svg).toContain("stroke:");
    }
    const raster = await send("file", {
      operation: "download",
      artifact: "simulation-plot",
      simulation: { runId: run.id, analysisIndex: recordIndex, format: "png" },
    });
    expect(raster.ok, JSON.stringify(raster)).toBe(true);
    const rasterBytes = Buffer.from(raster.artifact.data, "base64");
    const pngs =
      raster.artifact.mediaType === "application/zip"
        ? Object.values(unzipSync(rasterBytes))
        : [rasterBytes];
    for (const png of pngs)
      expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    await expect(page.locator(".simulation-file-export")).toHaveCount(0);
    expect(
      await send("file", {
        operation: "download",
        artifact: "simulation-plot",
        simulation: { runId: run.id, analysisIndex: 999, format: "svg" },
      }),
    ).toMatchObject({ ok: false, error: { code: "FILE_EXPORT_FAILED" } });
    expect(
      (await send("simulation", { operation: "read", runId: run.id })).run.id,
    ).toBe(run.id);
    if (sourceKind === "project-folder") {
      const exported = await send("file", {
        operation: "download",
        artifact: "project",
      });
      await page.reload();
      // Project recovery/Cloud Save is a separate contract. Reopen the same
      // source-only Project; no result artifact is imported with this file.
      await page.getByTestId("project-file").setInputFiles({
        name: "reopened.icproj.json",
        mimeType: "application/json",
        buffer: Buffer.from(exported.artifact.data, "base64"),
      });
      await clickNetlistWorkflowCommand(page, "open-analog-simulation");
      const saved = page.getByRole("region", { name: "Saved folder results" });
      await expect(saved).toContainText("Agent");
      await saved.getByRole("button", { name: "Open result" }).click();
      await expect(
        page.getByRole("button", { name: "Project + results ZIP" }),
      ).toBeVisible();
      expect(executions).toBe(1);
    }
  });
