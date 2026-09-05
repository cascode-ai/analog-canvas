import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { AgentSessionClient, AgentSessionError } from "@icm/agent-client";
import {
  AgentSimulationResourceResponseSchema,
  type AgentSimulationResourceRequest,
} from "@icm/agent-adapter";
import { createEmptyProject } from "@icm/model";
import { SimulationFiles } from "@icm/simulation-service";
import { createSimulationEnvironmentMetadata } from "@icm/spice-run";
import { BrowserAgentSimulationHost } from "../../editor/src/agent/browser-agent-simulation-host.js";
import { FakeAgentHttp } from "../../../packages/agent-client/src/test-support/fake-relay.js";
import { routeSimulationRequest } from "../../../worker/simulation.js";
import profile from "../../../containers/ngspice/hosted-sky130-profile.json";
import { callTool } from "./tools.js";

describe("MCP / browser Simulation Resource parity", () => {
  it("returns the generated start identity after a lost response so the same session can retry safely", async () => {
    const http = new FakeAgentHttp();
    const client = new AgentSessionClient({ http });
    await client.connect("session-1.code");
    const send = vi
      .spyOn(client, "simulationResource")
      .mockRejectedValue(
        new AgentSessionError("NETWORK_FAILURE", "Response lost", "network"),
      );
    const request = {
      operation: "start",
      preparedId: "prepared",
      digest: "a".repeat(64),
    };
    const first = JSON.parse(
      (await callTool("simulation", { request }, { client })).content[0]!.text!,
    );
    expect(first).toMatchObject({
      ok: false,
      error: { recovery: "retry-same-request" },
    });
    expect(first.requestId).toBeTruthy();
    await callTool(
      "simulation",
      { request, requestId: first.requestId },
      { client },
    );
    expect(send.mock.calls[1]![0]).toEqual(send.mock.calls[0]![0]);
    expect(http.claims).toHaveLength(1);
  });
  it("authors a raw workspace, recovers an input error, runs, reads numbers and exports verified CSV using the same session", async () => {
    const directory = await mkdtemp(join(tmpdir(), "icm-agent-simulation-"));
    const files = new SimulationFiles(),
      project = createEmptyProject("p", "test", "doc");
    let executions = 0;
    const environment = await createSimulationEnvironmentMetadata({
      executor: "hosted-container",
      reproducibility: "observed",
      profileId: profile.id,
      platform: "linux/x64",
      simulator: { name: "ngspice", version: "47", binarySha256: null },
      models: null,
      startupSha256: null,
    });
    const rawfile = readFileSync(
      new URL(
        "../../../fixtures/ngspice-rawfile/divider-op.raw",
        import.meta.url,
      ),
      "utf8",
    );
    const host = new BrowserAgentSimulationHost({
      getProjectSessionId: () => "p:1",
      getProject: () => project,
      files,
      fetch: async (url, init) => {
        const response = await routeSimulationRequest(
          new Request(new URL(String(url), "http://localhost"), init),
          {
            NGSPICE: {
              getByName: () => ({
                fetch: async () => {
                  executions++;
                  return Response.json({
                    environment,
                    rawfile,
                    log: "ngspice OP",
                    durationMs: 1,
                    exitCode: 0,
                  });
                },
              }),
            },
          },
        );
        return response!;
      },
    });
    class Relay extends FakeAgentHttp {
      override async simulation(
        _session: string,
        _token: string,
        request: AgentSimulationResourceRequest,
      ) {
        return AgentSimulationResourceResponseSchema.parse(
          await host.handle(request),
        );
      }
    }
    const http = new Relay({
      files: async (request) =>
        request.operation === "simulation-input"
          ? {
              apiVersion: "2.0",
              requestId: request.requestId,
              operation: "simulation-input",
              ok: true,
              result: await files.handle(request.input),
            }
          : {
              apiVersion: "2.0",
              requestId: request.requestId,
              operation: "error",
              ok: false,
              error: { code: "test", message: "test" },
            },
    });
    const client = new AgentSessionClient({ http });
    await client.connect("session-1.code");
    const invoke = async (name: string, args: unknown) => {
      const reply = await callTool(name, args, { client });
      return JSON.parse(reply.content[0]!.text!);
    };
    try {
      const bad = await invoke("simulation", {
        request: {
          operation: "prepare",
          source: {
            kind: "project-setup",
            expectedStructureRevision: project.structureRevision,
          },
        },
      });
      expect(bad).toMatchObject({
        ok: false,
        error: { code: "SIMULATION_SETUP_MISSING" },
      });
      const created = await invoke("simulation_files", {
        request: { action: "create" },
      });
      const workspaceId = created.workspace.id;
      await invoke("simulation_files", {
        request: {
          action: "update",
          workspaceId,
          expectedRevision: 0,
          entry: "main.cir",
          writes: [
            {
              path: "main.cir",
              text: readFileSync(
                new URL(
                  "../../../fixtures/ngspice-rawfile/divider-op.deck.spi",
                  import.meta.url,
                ),
                "utf8",
              ),
            },
          ],
        },
      });
      const prepared = await invoke("simulation", {
        request: {
          operation: "prepare",
          source: {
            kind: "workspace",
            workspaceId,
            expectedRevision: 1,
            environment: { profileId: profile.id },
          },
        },
      });
      expect(executions).toBe(0);
      const args = {
        request: {
          operation: "start",
          preparedId: prepared.prepared.id,
          digest: prepared.prepared.digest,
        },
        requestId: "start-once",
      };
      const started = await invoke("simulation", args);
      expect(started.run.id).toBeDefined();
      expect((await invoke("simulation", args)).run.id).toBe(started.run.id);
      let finished: any;
      await vi.waitFor(async () => {
        finished = await invoke("simulation", {
          request: { operation: "read", runId: started.run.id },
        });
        expect(finished.run.state).toBe("finished");
      });
      expect(executions).toBe(1);
      expect(finished.run.result.data.analyses[0].probes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "v(mid)", value: 0.5 }),
        ]),
      );
      const csv = finished.run.artifacts.find(
        (a: { name: string }) => a.name === "op-0.csv",
      );
      const path = join(directory, "result.csv");
      expect(
        await invoke("simulation_files", {
          request: { action: "artifact", artifactId: csv.id },
          outputPath: path,
        }),
      ).toMatchObject({ ok: true });
      expect(await readFile(path, "utf8")).toContain("0.5");
      expect(http.claims).toHaveLength(1);
    } finally {
      await host.clear();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
