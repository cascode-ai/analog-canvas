import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";

import {
  clickNetlistWorkflowCommand,
  awaitEditorReady,
  openProjectFile,
  readAgentClaim,
} from "./editor-fixtures.js";
import {
  completedNgspiceRun,
  dividerOpRawfile as rawfile,
  ngspiceCapabilities,
} from "./simulation-e2e-fixtures.js";
import { placedInstance } from "./canvas-fixtures.js";

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
  await page.route("**/api/simulate", async (route) => {
    const body = route.request().postDataJSON();
    if (body.operation === "capabilities")
      return route.fulfill({ json: ngspiceCapabilities() });
    executions++;
    expect(body.preparedDeck).toContain('.include "circuit.spice"');
    expect(body.preparedDeck).toContain("* HTTP divider online edit");
    const generatedCircuit = body.files.find(
      (file: { path: string }) => file.path === "circuit.spice",
    ).text;
    expect(generatedCircuit).toContain("R1");
    expect(generatedCircuit).toContain("R2");
    return route.fulfill({ json: await completedNgspiceRun(body) });
  });
  await page.goto("/editor");
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  const panel = page.getByTestId("connect-agent-panel");
  const claim = await readAgentClaim(panel);
  const handoff = await panel.getByTestId("agent-copy-text").inputValue();
  const kitUrl = `${baseURL}/api/agent/kit`;
  expect(handoff).toContain(kitUrl);
  const kit = await (await request.get(kitUrl)).json();
  // The Kit's references and the OpenAPI document are agent-kit.test.ts and
  // the local relay's handoff test; here the Agent uses the Kit's catalog.
  const catalog = JSON.parse(
    kit.files.find(
      (file: { path: string }) =>
        file.path === "references/razavi-authoring-catalog.json",
    ).content,
  );
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
        headers: {
          Authorization: `Bearer ${session.agentToken}`,
          "x-agent-context": session.contextRevision,
        },
        data: { apiVersion: "3.0", requestId: crypto.randomUUID(), ...payload },
      },
    );
    const result = await response.json();
    if (payload.operation === "snapshot" && result.ok)
      session.contextRevision = response.headers()["x-agent-context"];
    // Never log the claim or credentials, even on failure.
    expect(response.ok(), JSON.stringify(result.error)).toBe(true);
    expect(result.ok, JSON.stringify(result.error ?? result.diagnostics)).toBe(
      true,
    );
    return result;
  };
  await send("circuit", { operation: "capabilities" });
  /** A Project-folder simulation input or artifact request. */
  const simulationInput = (input: Record<string, unknown>) =>
    send("files", { operation: "simulation-input", input });
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
            ...placedInstance(id, symbolId, 200 + index * 140, 200),
            ...(reference ? { reference } : {}),
            ...(parameters ? { netlist: { parameters } } : {}),
          };
        },
      ),
      // A placed part shows its name alone unless its value is asked for.
      displays: { "http-r1": { showValue: true } },
    },
  });
  const placed = await snapshot();
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
    await simulationInput({
      action: "read",
      owner: sourceOwner,
      path: "run.cir",
    })
  ).result;
  const edited = (
    await simulationInput({
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
    })
  ).result;
  expect(edited.update).toMatchObject({
    changed: true,
    files: [{ path: "run.cir", action: "updated" }],
  });
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
      waitMs: 20_000,
    })
  ).run;
  expect(run.state).toBe("finished");
  const runState = async () =>
    (await send("simulation", { operation: "read", runId: run.id })).run.state;
  // No Agent read is needed for the browser observer to finish the handoff.
  await panel.getByRole("button", { name: "Close Agent dialog" }).click();
  await clickNetlistWorkflowCommand(page, "open-analog-simulation");
  await page.locator(".simulation-run-history > summary").click();
  const openResult = page
    .getByRole("region", { name: "Project runs", exact: true })
    .getByRole("button", { name: "Open result" });
  await expect(openResult).toBeEnabled();
  await openResult.click();
  // The folder status follows the newest run, so it does not say when the
  // opened result is restored; the button, busy meanwhile, does. A menu
  // opened during the restore would keep its download disabled.
  await expect(openResult).toBeEnabled();
  await expect(
    page.getByRole("region", { name: "Analog simulation" }).getByRole("status"),
  ).toHaveText("completed");
  await page
    .getByRole("treeitem", { name: "Folder HTTP divider", exact: true })
    .click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Download project + results…" }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  expect(executions).toBe(1);
  expect(await runState()).toBe("finished");
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
        await simulationInput({ action: "download", artifactId: raw.id })
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
  // A tab switch must retain the originating host's in-memory files and runs.
  await page
    .getByRole("button", { name: "New project tab", exact: true })
    .click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.getByRole("tab").first().click();
  await expect
    .poll(async () => {
      try {
        return (await snapshot()).ok;
      } catch {
        return false;
      }
    })
    .toBe(true);
  const retained = await simulationInput({
    action: "artifact",
    artifactId: raw.id,
  });
  expect(retained.result.text).toBe(rawfile);
  expect(await runState()).toBe("finished");
  await page.reload();
  await awaitEditorReady(page);
  await expect
    .poll(async () => {
      try {
        await snapshot(); // Refresh the new page's context, preserving the session.
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
  const recoveredBody = await simulationInput({
    action: "artifact",
    artifactId: raw.id,
  });
  expect(recoveredBody.result.text).toBe(rawfile);
  await expect
    .poll(async () => {
      const response = await simulationInput({
        action: "download",
        artifactId: raw.id,
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
  // Test portable import into a New Circuit tab. The reload above restored
  // the original dirty Project beside it, which a file would need approval
  // to replace.
  await page.goto("/editor?new=1");
  await openProjectFile(page, bytes, "http.icproj.json");
  await clickNetlistWorkflowCommand(page, "open-analog-simulation");
  await page.locator(".simulation-run-history > summary").click();
  await expect(
    page.getByRole("region", { name: "Saved folder results" }),
  ).toContainText("Agent");
  expect(executions).toBe(1);
});
