import { test, expect, type WebSocketRoute } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  createSimulationEnvironmentMetadata,
  createSimulationInputMetadata,
  readSimulationData,
} from "@icm/spice-run";
const profile = JSON.parse(
  readFileSync(
    new URL(
      "../../../containers/ngspice/hosted-sky130-profile.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { id: string; simulator: { version: string } };
import { openMenu, downloadBytes } from "./editor-fixtures.js";
import { CircuitProjectSchema } from "@icm/model";
const ota = JSON.parse(
  readFileSync(
    new URL(
      "../src/examples/five-transistor-ota-sky130.icproj.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

test("the qualified OTA setup opens unchanged and preserves all root and hierarchical probes", async ({
  page,
}) => {
  const project = CircuitProjectSchema.parse(ota);
  expect(project.simulation!.input.probes).toHaveLength(4);
  expect(
    project.simulation!.input.probes.filter((p) => p.occurrence.length > 0),
  ).toHaveLength(2);
  let executions = 0;
  await page.route("**/api/simulate", async (route) => {
    if (route.request().postDataJSON().operation !== "capabilities") {
      executions++;
      return route.abort();
    }
    return route.fulfill({
      json: {
        configured: true,
        inputs: ["structured", "raw"],
        analyses: ["op", "ac"],
        parsedAnalyses: ["op", "ac", "tran"],
        profiles: [{ id: profile.id, corners: ["tt"] }],
        maxTimeoutMs: 120000,
        maxInputBytes: 1048576,
        cancel: true,
      },
    });
  });
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "qualified-ota.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page
    .getByRole("button", { name: "Analog simulation", exact: true })
    .click();
  const panel = page.getByRole("region", { name: "Analog simulation" });
  await panel.getByText("Setup", { exact: true }).click();
  await expect(panel.getByLabel("Testbench Cell")).toHaveValue(
    project.simulation!.input.rootDocumentId,
  );
  await expect(panel.getByLabel("Stop (Hz)")).toHaveValue("1000000000");
  await expect(panel.getByLabel("Environment profile")).toHaveValue(profile.id);
  await expect(panel.getByRole("button", { name: "Remove probe" })).toHaveCount(
    4,
  );
  await expect(
    panel.locator("li").filter({ hasText: "XDUT · ota_5t · tail" }),
  ).toBeVisible();
  await panel
    .getByLabel("Add voltage probe")
    .selectOption({ label: "XDUT · ota_5t · vinp" });
  await panel
    .getByLabel("Add source-current probe")
    .selectOption({ label: "Testbench · VINP current" });
  await expect(panel.getByRole("button", { name: "Remove probe" })).toHaveCount(
    6,
  );
  await panel.getByRole("button", { name: "Apply setup" }).click();
  await panel.getByRole("button", { name: "Prepare deck" }).click();
  const deckDownload = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: "prepared.cir", exact: true })
    .click();
  const stream = await (await deckDownload).createReadStream();
  let deck = "";
  for await (const chunk of stream!) deck += chunk.toString();
  for (const vector of [
    "v(vout)",
    "v(ibias)",
    "v(xdut.tail)",
    "v(xdut.nleft)",
    "v(xdut.vinp)",
    "i(vinp)",
  ])
    expect(deck).toContain(vector);
  expect(deck).toMatch(/ac dec 10 1 (?:1000000000|1e\+?9)/i);
  expect(executions).toBe(0);
  await panel.getByRole("button", { name: "Close simulation" }).click();
  const saved = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(),
  );
  const { probes: savedProbes, ...savedInput } = saved.simulation.input;
  const { probes: originalProbes, ...originalInput } =
    project.simulation!.input;
  expect(savedInput).toEqual(originalInput);
  expect(savedProbes.slice(0, 4)).toEqual(originalProbes);
  expect(savedProbes.slice(4)).toMatchObject([
    {
      kind: "net-voltage",
      documentId: "document-ota-5t",
      netId: "net-cell-pin-pvinp",
      occurrence: ["XDUT"],
    },
    {
      kind: "source-current",
      documentId: "document-ota-5t-testbench",
      instanceId: "VINP",
      occurrence: [],
    },
  ]);
  await page.reload();
  await page.getByTestId("project-file").setInputFiles({
    name: "reopened.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(saved)),
  });
  await page
    .getByRole("button", { name: "Analog simulation", exact: true })
    .click();
  await panel.getByText("Setup", { exact: true }).click();
  await expect(panel.getByRole("button", { name: "Remove probe" })).toHaveCount(
    6,
  );
  await expect(panel.getByLabel("Stop (Hz)")).toHaveValue("1000000000");
});

test("human simulation uses saved setup, survives closing, recovers a bad input and exports results", async ({
  page,
}) => {
  const project = CircuitProjectSchema.parse(ota);
  project.simulation = {
    version: 1,
    input: {
      kind: "structured",
      rootDocumentId: project.topDocumentId,
      analyses: [
        { kind: "op" },
        { kind: "ac", sweep: "dec", points: 10, startHz: 1, stopHz: 1e6 },
      ],
      probes: [
        {
          id: "out",
          kind: "net-voltage",
          documentId: project.topDocumentId,
          netId: "missing-net",
          occurrence: [],
        },
      ],
      environment: { profileId: profile.id },
    },
  };
  let calls = 0,
    executions = 0,
    cancellations = 0;
  let release = () => {};
  let pending = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/api/simulate", async (route) => {
    calls++;
    const body = route.request().postDataJSON();
    if (body.operation === "capabilities")
      return route.fulfill({
        json: {
          configured: true,
          inputs: ["structured", "raw"],
          analyses: ["op", "ac"],
          parsedAnalyses: ["op", "ac", "tran"],
          profiles: [{ id: profile.id, corners: ["tt"] }],
          maxTimeoutMs: 120000,
          maxInputBytes: 1048576,
          cancel: true,
        },
      });
    if (body.operation === "cancel") {
      cancellations++;
      release();
      return route.fulfill({ json: { ok: true } });
    }
    executions++;
    await pending;
    const rawfile = readFileSync(
      new URL(
        "../../../fixtures/ngspice-rawfile/divider-op.raw",
        import.meta.url,
      ),
      "utf8",
    );
    const reading = readSimulationData(rawfile);
    if (reading.status !== "read") throw Error("raw fixture");
    await route.fulfill({
      json: {
        outcome: { status: "completed" },
        diagnostics: [],
        log: "ngspice OP",
        durationMs: 1,
        data: {
          ...reading.data,
          analyses: [
            ...reading.data.analyses,
            {
              analysis: "ac",
              plotName: "AC response",
              frequencyHz: [1, 10, 100],
              probes: [
                {
                  name: "v(out)",
                  quantity: "voltage",
                  unit: "V",
                  real: [10, 7, 1],
                  imag: [0, -3, -1],
                },
              ],
            },
          ],
        },
        rawfile,
        executedDeck: body.preparedDeck,
        cancelled: cancellations > 0,
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
  await page.getByTestId("project-file").setInputFiles({
    name: "simulation.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(page.getByTestId("schematic-canvas")).toBeVisible();
  expect(calls).toBe(0);
  await page
    .getByRole("button", { name: "Analog simulation", exact: true })
    .click();
  const panel = page.getByRole("region", { name: "Analog simulation" });
  await panel.getByRole("button", { name: "Run", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText(/PROBE|probe/);
  expect(executions).toBe(0);
  await panel.getByText("Setup", { exact: true }).click();
  await panel.getByRole("button", { name: "Remove probe" }).click();
  await panel
    .getByLabel("Add voltage probe")
    .selectOption({ label: "Testbench · vout" });
  await panel.getByRole("button", { name: "Apply setup" }).click();
  await panel.getByRole("button", { name: "Run", exact: true }).click();
  await expect.poll(() => executions).toBe(1);
  await panel.getByRole("button", { name: "Close simulation" }).click();
  expect(cancellations).toBe(0);
  release();
  await page.getByTestId("open-analog-simulation").click();
  await expect(panel.getByRole("status")).toHaveText("finished · completed");
  await expect(panel.getByRole("region", { name: "OP results" })).toContainText(
    "0.500000",
  );
  await expect(panel.locator(".spice-ac-plot svg")).toHaveCount(1);
  const download = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: /\.csv$/ })
    .first()
    .click();
  expect((await download).suggestedFilename()).toMatch(/\.csv$/);
  const oldRunIdentity = await panel
    .getByLabel("Run evidence")
    .locator("small")
    .innerText();
  await panel.getByRole("button", { name: "Prepare deck" }).click();
  await expect(
    panel.getByLabel("Prepared input").locator("small"),
  ).not.toHaveText(oldRunIdentity.split(" / prepared ")[1]!);
  await expect(panel.getByLabel("Run evidence").locator("small")).toHaveText(
    oldRunIdentity,
  );
  expect(executions).toBe(1);
  await panel.getByText("Setup", { exact: true }).click();
  await panel.getByLabel("Temperature (°C)").fill("30");
  await panel.getByRole("button", { name: "Apply setup" }).click();
  await expect(panel.getByRole("alert")).toContainText(
    "earlier Project revision",
  );
  pending = new Promise<void>((r) => {
    release = r;
  });
  await panel.getByRole("button", { name: "Run", exact: true }).click();
  await expect.poll(() => executions).toBe(2);
  await panel.getByRole("button", { name: "Cancel run" }).click();
  await expect(panel.getByRole("status")).toContainText("cancelled");
  expect(cancellations).toBe(1);
  await panel.getByRole("button", { name: "Close simulation" }).click();
  const saved = await downloadBytes(page, "File", "Export Project File…");
  expect(
    JSON.parse(saved.toString()).simulation.input.environment.temperatureC,
  ).toBe(30);
  await page.reload();
  // Explicit import is the persistence contract, not browser recovery heuristics.
  await page.getByTestId("project-file").setInputFiles({
    name: "saved.icproj.json",
    mimeType: "application/json",
    buffer: saved,
  });
  await page.getByTestId("open-analog-simulation").click();
  await panel.getByText("Setup", { exact: true }).click();
  await expect(panel.getByLabel("Temperature (°C)")).toHaveValue("30");
  await expect(panel.getByRole("status")).toHaveText("No run yet");
});

test("Simulation creates an ordinary testbench and offers the current Cell at the cursor", async ({
  page,
}) => {
  await page.goto("/editor");
  await page.getByTestId("open-analog-simulation").click();
  await page
    .getByRole("button", { name: "New testbench from current Cell" })
    .click();
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 320, y: 180 } });
  await page.keyboard.press("Escape");
  const saved = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(),
  );
  const tb = saved.documents.find(
    (d: { name: string }) => d.name === "Main_tb",
  );
  expect(tb.instances[0].netlist.binding).toEqual({
    kind: "subcircuit",
    childDocumentId: "document-main",
  });
  expect(saved.topDocumentId).toBe("document-main");
  expect(saved.simulation).toBeUndefined();
  await page.getByTestId("open-analog-simulation").click();
  await expect(page.getByLabel("Testbench Cell")).toHaveValue(tb.id);
});

test("Agent raw simulation recovers input errors, returns a run receipt and exports through Files", async ({
  page,
}) => {
  const id = "simulation-e2e",
    secret = "simulation-editor-secret";
  let socket: WebSocketRoute | undefined;
  const replies: Array<{ kind: string; requestId: string; payload: any }> = [];
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
      expect(route.request().postDataJSON().scopes).toContain("simulation.run");
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
  const rawfile = readFileSync(
    new URL(
      "../../../fixtures/ngspice-rawfile/divider-op.raw",
      import.meta.url,
    ),
    "utf8",
  );
  await page.route("**/api/simulate", async (route) => {
    const body = route.request().postDataJSON();
    if (body.operation === "capabilities")
      return route.fulfill({
        json: {
          configured: true,
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
  await (
    await openMenu(page, "Agent")
  )
    .getByRole("button", { name: "Connect Agent" })
    .click();
  await page.getByTestId("agent-preset-full").click();
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
        payload: { apiVersion: "2.0", requestId, ...payload },
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
      .filter((r) => r.requestId === requestId && r.kind === `${kind}-response`)
      .at(-1)!.payload;
  };
  expect(
    await send("simulation", {
      operation: "prepare",
      source: { kind: "structured" },
    }),
  ).toMatchObject({ ok: false, error: { code: "SIMULATION_SETUP_MISSING" } });
  const workspace = (
    await send("file", {
      operation: "simulation-input",
      input: { action: "create" },
    })
  ).result.workspace;
  await send("file", {
    operation: "simulation-input",
    input: {
      action: "update",
      workspaceId: workspace.id,
      expectedRevision: 0,
      entry: "main.cir",
      writes: [
        {
          path: "main.cir",
          text: "divider\nV1 in 0 1\nR1 in mid 1k\nR2 mid 0 1k\n.op\n.end",
        },
      ],
    },
  });
  const prepared = (
    await send("simulation", {
      operation: "prepare",
      source: {
        kind: "raw",
        workspaceId: workspace.id,
        expectedRevision: 1,
        environment: { profileId: profile.id },
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
});
