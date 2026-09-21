import { test, expect, type WebSocketRoute } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  createSimulationEnvironmentMetadata,
  createSimulationInputMetadata,
  readSimulationData,
} from "@icm/spice-run";

import {
  clickNetlistWorkflowCommand,
  awaitEditorReady,
} from "./editor-fixtures.js";
import { profile } from "./simulation-e2e-fixtures.js";
import { createSimulationFolder, createEmptyProject } from "@icm/model";
import { createHash } from "node:crypto";

// No MCP, Agent client, Project fixture import, or injected relay messages.
// Only the simulator backend is a fixture: this proves HTTP authoring/handoff,
// not new electrical accuracy. All Agent work crosses the real local relay.
test("HTTP Kit alone authors native objects and hands off a Project-folder run", async ({
  page,
  request,
  baseURL,
}) => {
  test.setTimeout(90_000);
  let executions = 0;
  const rawfile = readFileSync(
    new URL(
      "../../../fixtures/ngspice-rawfile/divider-op.raw",
      import.meta.url,
    ),
    "utf8",
  );
  await page.route("**/api/simulate", async (route) => {
    const body = route.request().postDataJSON();
    if (body.operation === "capabilities") {
      await route.fulfill({
        json: {
          configured: true,
          rawfileCollection: "declared-single-ascii",
          inputs: ["structured", "raw"],
          analyses: ["op"],
          parsedAnalyses: ["op"],
          profiles: [{ id: profile.id, corners: ["tt"] }],
          maxTimeoutMs: 120000,
          maxInputBytes: 1048576,
          cancel: true,
        },
      });
      return;
    }
    executions++;
    expect(body.preparedDeck).toContain('.include "circuit.spice"');
    const generatedCircuit = body.files.find(
      (file: { path: string }) => file.path === "circuit.spice",
    ).text;
    expect(generatedCircuit).toContain("R1");
    expect(generatedCircuit).toContain("R2");
    const reading = readSimulationData(rawfile);
    if (reading.status !== "read") throw Error("Invalid rawfile fixture");
    await route.fulfill({
      json: {
        outcome: { status: "completed" },
        diagnostics: [],
        log: "fixture OP",
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
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  const panel = page.getByTestId("connect-agent-panel");
  await expect(panel.getByTestId("agent-copy-text")).toBeVisible({
    timeout: 30000,
  });
  const handoff = await panel.getByTestId("agent-copy-text").inputValue();
  const kit = await (
    await request.get(handoff.match(/HTTP Agent Kit: (\S+)/u)![1]!)
  ).json();
  const files = new Map<string, string>(
    kit.files.map((file: { path: string; content: string }) => [
      file.path,
      file.content,
    ]),
  );
  expect(files.get("references/authoring-contract.md")).toContain(
    "](simulation-workflow.md)",
  );
  expect(files.get("references/simulation-workflow.md")).toContain(
    "](simulation-result-handoff.md)",
  );
  expect(files.get("references/simulation-result-handoff.md")).toContain(
    "evidence bundle",
  );
  const catalog = JSON.parse(
    files.get("references/razavi-authoring-catalog.json")!,
  );
  const openapiResponse = await request.get(
    `${baseURL}/api/agent/openapi.json`,
  );
  expect(openapiResponse.ok()).toBe(true);
  const openapi = await openapiResponse.text();
  for (const term of [
    "place-components",
    "set-net-label",
    "upsert_simulation_folder",
    "simulation-input",
  ])
    expect(openapi).toContain(term);
  const claim = JSON.parse(handoff.match(/Claim: (.+)/u)![1]!);
  const claimed = await request.post(`${baseURL}/api/agent/claims`, {
    data: claim,
  });
  expect(claimed.ok()).toBe(true);
  const session = await claimed.json();
  const documentId = session.documentIds[0];
  const send = async (resource: string, payload: Record<string, unknown>) => {
    const response = await request.post(
      `${baseURL}/api/agent/sessions/${session.sessionId}/${resource}`,
      {
        headers: { Authorization: `Bearer ${session.agentToken}` },
        data: { apiVersion: "3.0", requestId: crypto.randomUUID(), ...payload },
      },
    );
    const result = await response.json();
    // Never log the claim or credentials, even on failure.
    expect(response.ok(), JSON.stringify(result.error)).toBe(true);
    expect(result.ok, JSON.stringify(result.error ?? result.diagnostics)).toBe(
      true,
    );
    return result;
  };
  await send("circuit", { operation: "capabilities" });
  const snapshot = () => send("circuit", { operation: "snapshot", documentId });
  const transact = async (operation: Record<string, unknown>) => {
    const current = await snapshot();
    return send("circuit", {
      operation: "transact",
      documentId,
      transactionId: crypto.randomUUID(),
      expectedRevision: current.revision,
      expectedStructureRevision: current.snapshot.project.structureRevision,
      ...operation,
    });
  };
  const definitions = [
    ["http-v", "voltage-source", "V1", { dc: "1" }],
    ["http-r1", "resistor", "R1", { value: "1k" }],
    ["http-r2", "resistor", "R2", { value: "1k" }],
    ["http-g", "ground", undefined, undefined],
    ["http-port", "port", "OUT", undefined],
  ] as const;
  await transact({
    command: {
      kind: "place-components",
      instances: definitions.map(
        ([id, symbolId, reference, parameters], index) => {
          expect(
            catalog.symbols.some(
              (symbol: { symbolId: string }) => symbol.symbolId === symbolId,
            ),
          ).toBe(true);
          return {
            id,
            symbolId,
            ...(reference ? { reference } : {}),
            ...(parameters ? { netlist: { parameters } } : {}),
            placement: {
              position: { x: 200 + index * 140, y: 200 },
              rotation: 0,
              mirror: "none",
            },
          };
        },
      ),
    },
  });
  const placed = await snapshot();
  expect(placed.snapshot.document.annotations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "instance-value",
        binding: expect.objectContaining({ instanceId: "http-r1" }),
      }),
      expect.objectContaining({
        binding: expect.objectContaining({ kind: "cell-terminal-name" }),
      }),
    ]),
  );
  expect(placed.snapshot.document.cellInterface.terminals).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: "OUT" })]),
  );
  const endpoint = (id: string, pinIndex: number) => {
    const instance = placed.snapshot.document.instances.find(
      (item: { id: string }) => item.id === id,
    );
    const symbol = catalog.symbols.find(
      (item: { symbolId: string }) => item.symbolId === instance.symbolId,
    );
    const pinName = symbol.pins[pinIndex].name;
    expect(
      instance.pins.some((pin: { name: string }) => pin.name === pinName),
    ).toBe(true);
    return {
      kind: "endpoint",
      endpoint: { kind: "terminal", instanceId: id, pinName },
    };
  };
  for (const [a, ai, b, bi] of [
    ["http-v", 0, "http-r1", 0],
    ["http-r1", 1, "http-r2", 0],
    ["http-r2", 1, "http-g", 0],
    ["http-v", 1, "http-g", 0],
    ["http-port", 0, "http-r1", 1],
  ] as const)
    await transact({
      wireIntent: {
        id: crypto.randomUUID(),
        from: endpoint(a, ai),
        to: endpoint(b, bi),
      },
    });
  const wired = await snapshot();
  const netId = wired.snapshot.document.instances.find(
    (item: { id: string }) => item.id === "http-r1",
  ).pins[1].netId;
  await transact({
    command: {
      kind: "set-net-label",
      annotationId: "http-label",
      netId,
      position: { x: 420, y: 260 },
      text: { runs: [{ kind: "text", value: "OUT" }] },
    },
  });
  const labelled = await snapshot();
  expect(labelled.snapshot.document.annotations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "http-label",
        binding: expect.objectContaining({ netId }),
      }),
    ]),
  );
  await send("circuit", { operation: "render", documentId, mode: "formal" });
  const capabilities = await send("simulation", { operation: "capabilities" });
  // Use the advertised profile, not a hard-coded production environment.
  const profileId = capabilities.capabilities.profiles[0]?.id;
  expect(profileId).toBeTruthy();
  await transact({
    structureEdits: [
      {
        kind: "upsert_simulation_folder",
        folder: {
          id: "http-folder",
          name: "HTTP divider",
          version: 4,
          input: {
            kind: "source",
            entry: "run.cir",
            configPath: "experiment.json",
            files: [
              {
                path: "run.cir",
                text: '* HTTP divider\n.include "circuit.spice"\n.control\nset filetype=ascii\nop\nwrite out.raw\n.endc\n.end\n',
              },
              {
                path: "experiment.json",
                text: JSON.stringify({
                  version: 2,
                  environment: { profileId },
                }),
              },
            ],
            circuitBindings: [
              {
                id: "circuit",
                path: "circuit.spice",
                documentId,
                emission: "top-level",
              },
            ],
            dependencies: [],
          },
        },
      },
    ],
  });
  const sourceOwner = { kind: "project-folder", folderId: "http-folder" };
  const sourceRead = (
    await send("files", {
      operation: "simulation-input",
      input: {
        action: "read",
        owner: sourceOwner,
        path: "run.cir",
      },
    })
  ).result;
  const edited = (
    await send("files", {
      operation: "simulation-input",
      input: {
        action: "update",
        owner: sourceOwner,
        expectedRevision: sourceRead.revision,
        replacements: [
          {
            path: "run.cir",
            textDigest: sourceRead.textDigest,
            oldText: "* HTTP divider",
            newText: "* HTTP divider online edit",
          },
        ],
      },
    })
  ).result;
  expect(edited.ok).toBe(true);
  expect(edited.update).toMatchObject({
    changed: true,
    files: [{ path: "run.cir", action: "updated" }],
  });
  expect(edited.update.files[0].textDigest).toBe(
    createHash("sha256")
      .update(
        sourceRead.text.replace("* HTTP divider", "* HTTP divider online edit"),
      )
      .digest("hex"),
  );
  const noChange = (
    await send("files", {
      operation: "simulation-input",
      input: {
        action: "update",
        owner: sourceOwner,
        expectedRevision: edited.source.revision,
        replacements: [
          {
            path: "run.cir",
            textDigest: edited.update.files[0].textDigest,
            oldText: "* HTTP divider online edit",
            newText: "* HTTP divider online edit",
          },
        ],
      },
    })
  ).result;
  expect(noChange.update).toEqual({ changed: false, files: [] });
  expect(noChange.source.revision).toBe(edited.source.revision);
  const current = await snapshot();
  const prepared = (
    await send("simulation", {
      operation: "prepare",
      source: {
        kind: "project-folder",
        folderId: "http-folder",
        expectedStructureRevision: current.snapshot.project.structureRevision,
      },
    })
  ).prepared;
  const run = (
    await send("simulation", {
      operation: "start",
      preparedId: prepared.id,
      digest: prepared.digest,
    })
  ).run;
  // No Agent read is needed for the browser observer to finish the handoff.
  await panel.getByRole("button", { name: "Close Agent dialog" }).click();
  await clickNetlistWorkflowCommand(page, "open-analog-simulation");
  await page.locator(".simulation-run-history > summary").click();
  const records = page.getByRole("region", {
    name: "Project runs",
    exact: true,
  });
  await expect(
    records.getByRole("button", { name: "Open result" }),
  ).toBeEnabled();
  await records.getByRole("button", { name: "Open result" }).click();
  await expect(
    page.getByRole("region", { name: "Analog simulation" }).getByRole("status"),
  ).toHaveText("completed");
  expect(executions).toBe(1);
  expect(
    (await send("simulation", { operation: "read", runId: run.id })).run.state,
  ).toBe("finished");
  const resultCatalog = (
    await send("simulation", { operation: "catalog", runId: run.id })
  ).catalog;
  const raw = resultCatalog.files.find(
    (file: { role?: string }) => file.role === "raw",
  );
  expect(raw).toBeTruthy();
  let transfer: any;
  await expect
    .poll(async () => {
      transfer = (
        await send("files", {
          operation: "simulation-input",
          input: { action: "download", artifactId: raw.id },
        })
      ).result;
      if (!transfer.ok)
        expect(transfer.error.code).toBe("ARTIFACT_TRANSFER_PENDING");
      return transfer.ok;
    })
    .toBe(true);
  expect(transfer.ok, JSON.stringify(transfer.error)).toBe(true);
  const downloaded = await request.get(`${baseURL}${transfer.download.path}`, {
    headers: { authorization: `Bearer ${session.agentToken}` },
  });
  expect(downloaded.status()).toBe(200);
  expect(await downloaded.text()).toBe(rawfile);
  const suffix = await request.get(`${baseURL}${transfer.download.path}`, {
    headers: {
      authorization: `Bearer ${session.agentToken}`,
      range: "bytes=10-",
    },
  });
  expect(suffix.status()).toBe(206);
  expect(await suffix.body()).toEqual(Buffer.from(rawfile).subarray(10));
  expect(
    (await request.get(`${baseURL}${transfer.download.path}`)).status(),
  ).toBe(401);
  await page.reload();
  await awaitEditorReady(page);
  await expect
    .poll(async () => {
      try {
        const history = await send("simulation", { operation: "history" });
        return history.runs?.some(
          (item: { runId: string; storage: string }) =>
            item.runId === run.id && item.storage === "persistent",
        );
      } catch {
        return false;
      } // the original connector may still be reattaching
    })
    .toBe(true);
  const recovered = await send("simulation", {
    operation: "catalog",
    runId: run.id,
  });
  expect(recovered.catalog).toEqual(resultCatalog);
  const recoveredBody = await send("files", {
    operation: "simulation-input",
    input: { action: "artifact", artifactId: raw.id },
  });
  expect(recoveredBody.result.text).toBe(rawfile);
  await expect
    .poll(async () => {
      const response = await send("files", {
        operation: "simulation-input",
        input: { action: "download", artifactId: raw.id },
      });
      return response.result.ok;
    })
    .toBe(true);
  expect(executions).toBe(1);
  const exported = await send("files", {
    operation: "download",
    artifact: "project",
  });
  const bytes = Buffer.from(exported.artifact.data, "base64");
  expect(bytes.byteLength).toBe(exported.artifact.byteLength);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    exported.artifact.sha256,
  );
  // Test portable import into a new workspace; paired reload now restores
  // the original dirty Project and correctly requires replacement approval.
  await page.goto("/editor?new=1");
  await page.getByTestId("project-file").setInputFiles({
    name: "http.icproj.json",
    mimeType: "application/json",
    buffer: bytes,
  });
  await clickNetlistWorkflowCommand(page, "open-analog-simulation");
  await page.locator(".simulation-run-history > summary").click();
  await expect(
    page.getByRole("region", { name: "Saved folder results" }),
  ).toContainText("Agent");
  expect(executions).toBe(1);
});

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
    await page.getByRole("button", { name: "Agent", exact: true }).click();
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
      await page.getByRole("button", { name: "Close Agent dialog" }).click();
      await expect(
        page.getByRole("region", { name: "Analog simulation" }),
      ).toHaveCount(0);
      await clickNetlistWorkflowCommand(page, "open-analog-simulation");
      await page.locator(".simulation-run-history > summary").click();
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
        page
          .getByRole("region", { name: "Analog simulation" })
          .getByRole("status"),
      ).toHaveText("completed");
      await page
        .getByRole("treeitem", { name: "Folder Divider", exact: true })
        .click({ button: "right" });
      await expect(
        page.getByRole("menuitem", { name: "Download project + results…" }),
      ).toBeEnabled();
      await page.keyboard.press("Escape");
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
    expect(finished.result.data).toBeUndefined();
    const resultFile = finished.artifacts.find(
      (a: { name: string }) => a.name === "result.json",
    );
    const fullResult = JSON.parse(
      (
        await send("file", {
          operation: "simulation-input",
          input: { action: "artifact", artifactId: resultFile.id },
        })
      ).result.text,
    );
    expect(fullResult.data.analyses[0].probes).toEqual(
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
    expect(
      await send("file", {
        operation: "download",
        artifact: "simulation-plot",
        simulation: { runId: run.id, analysisIndex: 0, format: "svg" },
      }),
    ).toMatchObject({ ok: false, error: { code: "SIMULATION_PLOT_RETIRED" } });
    const report = finished.artifacts.find(
      (a: { name: string }) => a.name === "specs.json",
    );
    expect(report).toBeDefined();
    expect(
      JSON.parse(
        (
          await send("file", {
            operation: "simulation-input",
            input: { action: "artifact", artifactId: report.id },
          })
        ).result.text,
      ).runId,
    ).toBe(run.id);
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
      await page.locator(".simulation-run-history > summary").click();
      const saved = page.getByRole("region", { name: "Saved folder results" });
      await expect(saved).toContainText("Agent");
      await saved.getByRole("button", { name: "Open result" }).click();
      await expect(
        page
          .getByRole("region", { name: "Analog simulation" })
          .getByRole("status"),
      ).toHaveText("completed");
      expect(executions).toBe(1);
    }
  });
