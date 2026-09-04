import { describe, expect, it } from "vitest";

import { createSimulationEnvironmentMetadata } from "@icm/spice-run";

import { routeSimulationRequest, type SimulationEnv } from "./simulation";

function post(body: unknown, path = "/api/simulate"): Request {
  return new Request(`https://example.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const HOSTED_ENVIRONMENT = await createSimulationEnvironmentMetadata({
  executor: "hosted-container",
  reproducibility: "observed",
  platform: "linux/x64",
  simulator: {
    name: "ngspice",
    version: "ngspice-47",
    binarySha256:
      "22d5cae2bd32b2e39157a8d27bf457122f68285b72a9ebefdf41551b628233ab",
  },
  models: {
    id: "sky130A",
    contentSha256:
      "17c208a699228f5acb87bf59c09c22a4c4d3937b6766b4957737d34e8e075f64",
  },
});

/** Stands in for the container, recording the deck it was handed. */
function stubRunner(
  reply: Record<string, unknown>,
  seen: { deck?: string; timeoutMs?: number } = {},
): SimulationEnv {
  return {
    NGSPICE: {
      getByName: () => ({
        fetch: async (_input: string, init?: RequestInit) => {
          const sent = JSON.parse(String(init?.body)) as {
            deck: string;
            timeoutMs: number;
          };
          seen.deck = sent.deck;
          seen.timeoutMs = sent.timeoutMs;
          return Response.json({ environment: HOSTED_ENVIRONMENT, ...reply });
        },
      }),
    },
  };
}

const NETLIST = ".subckt amp in out\nM1 out in 0 0 nfet\n.ends\nXA in out amp";
const TESTBENCH = "V1 in 0 DC 1\n.control\nop\nprint v(out)\n.endc";

describe("simulation route", () => {
  it("ignores paths that are not its own", async () => {
    expect(
      await routeSimulationRequest(post({}, "/api/gallery"), {}),
    ).toBeNull();
  });

  it("says a missing container is a deployment fact, not a circuit fault", async () => {
    // The message an author sees must not read as a verdict on their design.
    const response = await routeSimulationRequest(
      post({ netlist: NETLIST, testbench: TESTBENCH }),
      {},
    );
    expect(response?.status).toBe(503);
    const payload = (await response!.json()) as {
      error: string;
      message: string;
    };
    expect(payload.error).toBe("simulation-not-configured");
    expect(payload.message).toContain("deployment");
  });

  it("requires the author's testbench and never invents one", async () => {
    const response = await routeSimulationRequest(
      post({ netlist: NETLIST }),
      stubRunner({}),
    );
    expect(response?.status).toBe(400);
    const payload = (await response!.json()) as { error: string };
    expect(payload.error).toBe("invalid-request");
  });

  it("hands the container the author's testbench verbatim", async () => {
    const seen: { deck?: string; timeoutMs?: number } = {};
    await routeSimulationRequest(
      post({ netlist: NETLIST, testbench: TESTBENCH }),
      stubRunner(
        { log: "", exitCode: 0, timedOut: false, durationMs: 5 },
        seen,
      ),
    );
    expect(seen.deck).toContain(TESTBENCH);
    expect(seen.deck).toContain(NETLIST);
    // Our own contribution is the model selection and nothing analysis-shaped.
    const ours = seen.deck!.replace(TESTBENCH, "").replace(NETLIST, "");
    expect(ours).toContain('.lib "/opt/sky130/continuous/sky130.lib.spice" tt');
    expect(ours).not.toMatch(/^\s*\.include\b/mu);
    expect(ours).not.toMatch(/\.ac\b|\.dc\b|\.tran\b|\.control/iu);
  });

  it("leaves the model library out of a deck that needs no model", async () => {
    // A resistor divider has nothing to look up; the Sky130 corner costs
    // about 16 s of CPU to parse, so it is added only for device cards.
    const seen: { deck?: string; timeoutMs?: number } = {};
    const response = await routeSimulationRequest(
      post({
        netlist: ".subckt divider in out\nR1 in out 1k\nR2 out 0 1k\n.ends",
        testbench: "V1 in 0 DC 1\nX1 in out divider\n.op",
      }),
      stubRunner(
        { log: "", exitCode: 0, timedOut: false, durationMs: 5 },
        seen,
      ),
    );
    expect(seen.deck).not.toMatch(/^\s*\.lib\b/mu);
    expect((await response!.json()) as unknown).toMatchObject({
      metadata: { configuration: { modelLibrary: null } },
    });
  });

  it("never reports a silent or signal-killed run as completed", async () => {
    // Measured 2026-09-04: the kernel killed ngspice mid-corner-load on a
    // 1 GiB instance; the harness reported exit 0 and an empty log, and the
    // route said "completed". A run with no output has no result.
    const silent = await routeSimulationRequest(
      post({ netlist: NETLIST, testbench: TESTBENCH }),
      stubRunner({ log: "", exitCode: 0, timedOut: false, durationMs: 45295 }),
    );
    const silentBody = (await silent!.json()) as {
      outcome: { status: string };
      diagnostics: { severity: string; text: string }[];
    };
    expect(silentBody.outcome.status).toBe("failed");
    expect(silentBody.diagnostics[0]?.text).toContain("no output");

    const killed = await routeSimulationRequest(
      post({ netlist: NETLIST, testbench: TESTBENCH }),
      stubRunner({
        log: "",
        exitCode: 128,
        signal: "SIGKILL",
        timedOut: false,
        durationMs: 45295,
      }),
    );
    const killedBody = (await killed!.json()) as {
      outcome: { status: string };
      diagnostics: { severity: string; text: string }[];
    };
    expect(killedBody.outcome.status).toBe("failed");
    expect(killedBody.diagnostics[0]?.text).toContain("SIGKILL");

    // A timeout stays a timeout, whatever the log holds.
    const late = await routeSimulationRequest(
      post({ netlist: NETLIST, testbench: TESTBENCH, timeoutMs: 5000 }),
      stubRunner({ log: "", exitCode: null, timedOut: true, durationMs: 5010 }),
    );
    expect(
      ((await late!.json()) as { outcome: { status: string } }).outcome.status,
    ).toBe("timed-out");
  });

  it("uses the deployment's explicit Sky130 path and section", async () => {
    const seen: { deck?: string; timeoutMs?: number } = {};
    const env = stubRunner(
      { log: "", exitCode: 0, timedOut: false, durationMs: 5 },
      seen,
    );
    env.SKY130_LIB_PATH = "/models/sky130.lib.spice";
    env.SKY130_LIB_SECTION = "ff";
    await routeSimulationRequest(
      post({ netlist: NETLIST, testbench: TESTBENCH }),
      env,
    );
    expect(seen.deck).toContain('.lib "/models/sky130.lib.spice" ff');
  });

  it("returns input, configuration and environment identity with a result", async () => {
    const response = await routeSimulationRequest(
      post({
        netlist: NETLIST,
        testbench: TESTBENCH,
        inputRevision: "revision-42",
      }),
      stubRunner({ log: "", exitCode: 0, timedOut: false, durationMs: 5 }),
    );
    expect((await response!.json()) as unknown).toMatchObject({
      metadata: {
        schemaVersion: 1,
        input: {
          inputRevision: "revision-42",
          netlistSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
          testbenchSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
          deckSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
        },
        configuration: {
          modelLibrary: { directive: "lib", section: "tt" },
        },
        environment: HOSTED_ENVIRONMENT,
      },
    });
  });

  it("rejects a container response without environment identity", async () => {
    const response = await routeSimulationRequest(
      post({ netlist: NETLIST, testbench: TESTBENCH }),
      stubRunner({
        log: "",
        exitCode: 0,
        timedOut: false,
        durationMs: 5,
        environment: null,
      }),
    );
    expect(response?.status).toBe(502);
    expect((await response!.json()) as unknown).toMatchObject({
      error: "simulator-protocol-invalid",
    });
  });

  it("reports an invalid deployed section as environment configuration", async () => {
    const env = stubRunner({});
    env.SKY130_LIB_SECTION = "tt\n.end";
    const response = await routeSimulationRequest(
      post({ netlist: NETLIST, testbench: TESTBENCH }),
      env,
    );
    expect(response?.status).toBe(503);
    expect((await response!.json()) as unknown).toMatchObject({
      error: "simulation-environment-invalid",
    });
  });

  it("reports a dropped device rather than a clean run", async () => {
    // Measured ngspice behaviour: exit status 0 with a device discarded.
    const response = await routeSimulationRequest(
      post({ netlist: NETLIST, testbench: TESTBENCH }),
      stubRunner({
        log: "Warning: 'r1 in out' is not a valid resistor instance line, ignored!\nNo. of Data Rows : 1\n",
        exitCode: 0,
        timedOut: false,
        durationMs: 12,
      }),
    );
    const payload = (await response!.json()) as {
      outcome: { status: string };
      diagnostics: { text: string; droppedInput?: boolean }[];
    };
    expect(payload.outcome.status).toBe("completed-with-dropped-input");
    expect(payload.diagnostics[0]!.droppedInput).toBe(true);
    expect(payload.diagnostics[0]!.text).toContain("ignored!");
  });

  it("passes a timeout through as a timeout, carrying the ceiling", async () => {
    const response = await routeSimulationRequest(
      post({ netlist: NETLIST, testbench: TESTBENCH, timeoutMs: 1_000 }),
      stubRunner({
        log: "",
        exitCode: null,
        timedOut: true,
        durationMs: 1_004,
      }),
    );
    expect((await response!.json()) as unknown).toMatchObject({
      outcome: { status: "timed-out", timeoutMs: 1_000 },
    });
  });

  it("distinguishes an unreachable simulator from a failing circuit", async () => {
    const env: SimulationEnv = {
      NGSPICE: {
        getByName: () => ({
          fetch: async () => {
            throw new Error("container did not start");
          },
        }),
      },
    };
    const response = await routeSimulationRequest(
      post({ netlist: NETLIST, testbench: TESTBENCH }),
      env,
    );
    expect(response?.status).toBe(502);
    expect((await response!.json()) as unknown).toMatchObject({
      error: "simulator-unreachable",
    });
  });
});
