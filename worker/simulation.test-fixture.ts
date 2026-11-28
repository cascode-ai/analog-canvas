import {
  createSimulationEnvironmentMetadata,
  createSimulationInputMetadata,
} from "@icm/spice-run";
import type { ExecutionInput } from "@icm/simulation-service";
import {
  encodeExecutionReceipt,
  EXECUTION_RECEIPT_HEADER,
  sha256,
} from "@icm/simulation-service";
import hostedSky130Profile from "../containers/ngspice/hosted-sky130-profile.json";
import type { SimulationEnv } from "./simulation";
import type { NgspiceRunner } from "./simulation-ngspice";

/** Protocol-only fixture for the hosted SKY130 ngspice Profile. */
export const ngspiceEnvironment = await createSimulationEnvironmentMetadata({
  executor: "hosted-container",
  reproducibility: "pinned",
  profileId: hostedSky130Profile.id,
  platform: hostedSky130Profile.platform,
  simulator: { ...hostedSky130Profile.simulator, name: "ngspice" },
  models: {
    id: hostedSky130Profile.models.id,
    contentSha256: hostedSky130Profile.models.contentSha256,
  },
  startupSha256: hostedSky130Profile.startup.contentSha256,
});

export const ngspiceHealth = {
  status: "ready",
  environment: ngspiceEnvironment,
  limits: { outputBytes: 1024 * 1024 },
  dependencies: [
    {
      id: hostedSky130Profile.models.id,
      sha256: hostedSky130Profile.models.contentSha256,
    },
  ],
};

export function ngspiceInput(): ExecutionInput {
  const text =
    "ngspice protocol proof\nV1 in 0 1\nR1 in 0 1k\n.control\nop\n.endc\n.end\n";
  return {
    mode: "raw",
    netlist: "",
    testbench: text,
    preparedDeck: text,
    entryPath: "run.cir",
    inputRevision: "revision-a",
    environment: { profileId: hostedSky130Profile.id },
    files: [{ path: "run.cir", text }],
    dependencies: [],
    collection: { rawfile: null },
  };
}

async function ngspiceReply(input: {
  deck?: string;
  outputContext?: {
    netlist: string;
    testbench: string;
    inputRevision: string;
    modelLibrary?: null;
    execution?: { target: "cloudflare-container" | "operator-host" };
  };
  inputRevision?: string;
  netlist?: string;
  testbench?: string;
  preparedDeck?: string;
} = ngspiceInput()) {
  const ctx = input.outputContext;
  const deck = input.deck ?? input.preparedDeck ?? ngspiceInput().preparedDeck!;
  return {
    outcome: { status: "completed" as const },
    diagnostics: [],
    log: "protocol fixture",
    durationMs: 1,
    metadata: {
      schemaVersion: 1 as const,
      configuration: { modelLibrary: null },
      environment: ngspiceEnvironment,
      input: await createSimulationInputMetadata({
        inputRevision: ctx?.inputRevision ?? input.inputRevision ?? "revision-a",
        netlist: ctx?.netlist ?? input.netlist ?? "",
        testbench: ctx?.testbench ?? input.testbench ?? deck,
        deck,
      }),
    },
    ...(ctx?.execution ? { execution: ctx.execution } : {}),
    rawfile: "",
    executedDeck: deck,
    cancelled: false,
  };
}

export function ngspiceWorkerEnv(
  run?: NgspiceRunner["fetch"],
): SimulationEnv & { NGSPICE: NonNullable<SimulationEnv["NGSPICE"]> } {
  return {
    NGSPICE: {
      getByName: () => ({
        fetch: async (url, init) => {
          if (new URL(url).pathname === "/health")
            return Response.json(ngspiceHealth);
          if (run) return run(url, init);
          const body = JSON.parse(String(init?.body));
          if (body.runToken) return ngspiceStreamingReply(body, false);
          return Response.json({
            exitCode: 0,
            stdout: "protocol fixture",
            stderr: "",
            timedOut: false,
            durationMs: 1,
            rawfile: "",
            environment: ngspiceEnvironment,
          });
        },
      }),
    },
  };
}

export async function ngspiceStreamingReply(
  body: {
    deck: string;
    files?: { path: string; text: string }[];
    runToken: string;
    outputContext: {
      netlist: string;
      testbench: string;
      inputRevision: string;
      modelLibrary: null;
      execution: { target: "cloudflare-container" | "operator-host" };
    };
  },
  corrupt = false,
) {
  const payload = {
    ...(await ngspiceReply(body)),
    collectionStatus: "complete" as const,
  };
  const text = JSON.stringify(payload);
  return new Response(corrupt ? text.replace("protocol", "tampered") : text, {
    headers: {
      "content-type": "application/json",
      [EXECUTION_RECEIPT_HEADER]: encodeExecutionReceipt({
        schemaVersion: 1,
        runToken: body.runToken,
        byteLength: new TextEncoder().encode(text).length,
        sha256: await sha256(text),
        executedFilesSha256: await sha256(JSON.stringify(body.files ?? [])),
        metadata: payload.metadata,
        outcome: payload.outcome,
        execution: body.outputContext.execution,
        cancelled: false,
        collectionStatus: "complete",
      }),
    },
  });
}
