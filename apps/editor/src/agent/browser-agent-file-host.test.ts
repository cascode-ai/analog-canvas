import { describe, expect, it, vi } from "vitest";

import { AGENT_API_VERSION, base64EncodeBytes } from "@icm/agent-adapter";
import { createEmptyProject, type ProjectSimulationFolder } from "@icm/model";
import { resolveDocumentLogicalNets } from "@icm/derived";
import { serializeProject } from "@icm/project-protocol";
import type { SymbolResolver } from "@icm/symbols";

import { BrowserAgentFileHost } from "./browser-agent-file-host";
import { BrowserSimulationSession } from "../features/simulation/browser-simulation-session";
import { createSimulationProjectFileHost } from "../features/simulation/project-file-host";

it.each(["ngspice", "vacask"] as const)(
  "generates the same %s source through Agent and GUI files",
  async (engine) => {
    const project = createEmptyProject("engine-test", "Engine test");
    const document = project.documents[0]!;
    document.nets.push(
      { id: "n", terminals: [{ instanceId: "R1", pinName: "1" }] },
      { id: "g", terminals: [{ instanceId: "R1", pinName: "2" }] },
    );
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: null,
      reference: "R1",
      netlist: {
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: { value: "1k" },
      },
    });
    const folder: ProjectSimulationFolder = {
      id: "test",
      name: "Test",
      version: 4,
      input: {
        kind: "source",
        entry: "run.cir",
        configPath: "experiment.json",
        circuitBindings: [
          {
            id: "dut",
            path: "dut.spice",
            documentId: document.id,
            emission: "top-level",
          },
        ],
        dependencies: [],
        files: [
          { path: "run.cir", text: "Test\n" },
          {
            path: "experiment.json",
            text: JSON.stringify({
              version: 2,
              environment: { profileId: "test" },
            }),
          },
        ],
      },
    };
    project.simulationFolders.push(folder);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          configured: true,
          inputs: ["source"],
          analyses: ["op"],
          parsedAnalyses: ["op"],
          profiles: [{ id: "test", engine, corners: [] }],
          maxTimeoutMs: 1000,
          maxInputBytes: 10000,
          cancel: true,
        }),
      ),
    );
    const dispatch = vi.fn(() => {
      throw new Error("Reading must not edit the project");
    });
    const common = {
      getProject: () => project,
      getProjectSessionId: () => "session",
      fetch: fetcher,
    };
    const agent = new BrowserAgentFileHost({
      ...common,
      getDocument: () => document,
      getResolver: () => ({}) as SymbolResolver,
      onApprovalRequested: () => {},
      dispatchProjectTransaction: dispatch,
    });
    const human = new BrowserSimulationSession({
      ...common,
      projectFiles: createSimulationProjectFileHost({
        ...common,
        dispatch,
        actor: { kind: "human", id: "test" },
      }),
    });
    const request = {
      action: "read" as const,
      owner: { kind: "project-folder" as const, folderId: folder.id },
      path: "dut.spice",
    };
    const a = await agent.simulationFiles.handle(request);
    // A fresh Response is needed for the second capability read.
    fetcher.mockResolvedValue(
      new Response(
        JSON.stringify({
          configured: true,
          inputs: ["source"],
          analyses: ["op"],
          parsedAnalyses: ["op"],
          profiles: [{ id: "test", engine, corners: [] }],
          maxTimeoutMs: 1000,
          maxInputBytes: 10000,
          cancel: true,
        }),
      ),
    );
    const h = await human.files.handle(request);
    expect(a).toMatchObject({ ok: true });
    expect(h).toEqual(a);
    if (!a.ok || !("text" in a)) throw new Error(JSON.stringify(a));
    expect(a.text).toContain(
      engine === "ngspice" ? "R1 net1 net0 1k" : "__icm_resistor",
    );
    expect(dispatch).not.toHaveBeenCalled();
  },
);

it("uses the same Cadence bang naming profile as GUI SPICE import", async () => {
  const { host } = setup();
  const bytes = new TextEncoder().encode(
    "Cadence import\n.global vdd!\nR1 vdd! out 1k\nR2 out 0 2k\n.end\n",
  );
  const response = await host.handle({
    apiVersion: AGENT_API_VERSION,
    requestId: "cadence-profile",
    operation: "stage",
    kind: "structural-spice",
    entryPath: "circuit.cir",
    namingProfile: "cadence-bang",
    files: [
      {
        name: "circuit.cir",
        mediaType: "text/plain",
        encoding: "base64",
        data: base64EncodeBytes(bytes),
        byteLength: bytes.byteLength,
        sha256: await sha256(bytes),
      },
    ],
  });
  expect(response.ok).toBe(true);
  if (!response.ok || response.operation !== "stage")
    throw new Error(JSON.stringify(response));
  const project = host.consumeApproved(response.candidate.candidateId)!;
  const names = project.documents.flatMap((document) =>
    resolveDocumentLogicalNets(document).groups.map((net) => net.name),
  );
  expect(names).toContain("vdd");
  expect(names).not.toContain("vdd!");
});

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(bytes).buffer,
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function setup() {
  const live = createEmptyProject("live", "Live Project");
  const approvals: string[] = [];
  const host = new BrowserAgentFileHost({
    getProjectSessionId: () => "live-session",
    getProject: () => live,
    getDocument: (id) =>
      live.documents.find((document) => document.id === id) ?? null,
    getResolver: () => ({}) as SymbolResolver,
    onApprovalRequested: (candidate) => approvals.push(candidate.candidateId),
  });
  return { live, host, approvals };
}

describe("BrowserAgentFileHost", () => {
  it("returns canonical Project bytes without changing the live Project", async () => {
    const { live, host } = setup();
    const response = await host.handle({
      apiVersion: AGENT_API_VERSION,
      requestId: "download-project",
      operation: "download",
      artifact: "project",
    });

    expect(response).toMatchObject({ ok: true, operation: "download" });
    if (!response.ok || response.operation !== "download") return;
    expect(response.artifact.mediaType).toBe("application/json");
    expect(
      new TextDecoder().decode(
        Uint8Array.from(atob(response.artifact.data), (value) =>
          value.charCodeAt(0),
        ),
      ),
    ).toBe(serializeProject(live));
    expect(live.name).toBe("Live Project");
  });

  it("stages a Project in memory and changes it only after explicit approval", async () => {
    const { live, host, approvals } = setup();
    const staged = createEmptyProject("staged", "Staged Project");
    const bytes = new TextEncoder().encode(serializeProject(staged));
    const stage = await host.handle({
      apiVersion: AGENT_API_VERSION,
      requestId: "stage-project",
      operation: "stage",
      kind: "project",
      files: [
        {
          name: "staged.icproj.json",
          mediaType: "application/json",
          encoding: "base64",
          data: base64EncodeBytes(bytes),
          byteLength: bytes.byteLength,
          sha256: await sha256(bytes),
        },
      ],
    });

    expect(stage).toMatchObject({ ok: true, operation: "stage" });
    if (!stage.ok || stage.operation !== "stage") return;
    expect(live.name).toBe("Live Project");

    const approval = await host.handle({
      apiVersion: AGENT_API_VERSION,
      requestId: "request-approval",
      operation: "request-approval",
      candidateId: stage.candidate.candidateId,
    });
    expect(approval).toMatchObject({ ok: true, approval: "pending-human" });
    expect(approvals).toEqual([stage.candidate.candidateId]);
    expect(host.consumeApproved(stage.candidate.candidateId)?.name).toBe(
      "Staged Project",
    );
    expect(host.consumeApproved(stage.candidate.candidateId)).toBeNull();
  });

  it("rejects traversal names and hash mismatches before parsing", async () => {
    const { host } = setup();
    const bytes = new TextEncoder().encode("{}");
    const response = await host.handle({
      apiVersion: AGENT_API_VERSION,
      requestId: "unsafe-file",
      operation: "stage",
      kind: "project",
      files: [
        {
          name: "../project.icproj.json",
          mediaType: "application/json",
          encoding: "base64",
          data: base64EncodeBytes(bytes),
          byteLength: bytes.byteLength,
          sha256: "0".repeat(64),
        },
      ],
    });
    expect(response).toMatchObject({
      ok: false,
      error: { code: "FILE_CONTENT_INVALID" },
    });
  });

  it("refuses a stale browser host after Project replacement", async () => {
    const live = createEmptyProject("live", "Live Project");
    let projectSessionId = "session-live";
    const host = new BrowserAgentFileHost({
      getProjectSessionId: () => projectSessionId,
      getProject: () => live,
      getDocument: () => live.documents[0] ?? null,
      getResolver: () => ({}) as SymbolResolver,
      onApprovalRequested: () => undefined,
    });
    projectSessionId = "session-replaced";
    await expect(
      host.handle({
        apiVersion: AGENT_API_VERSION,
        requestId: "stale-download",
        operation: "download",
        artifact: "project",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "PROJECT_REPLACED" },
    });
  });
});
