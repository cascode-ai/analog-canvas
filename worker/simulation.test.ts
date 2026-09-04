import { readFileSync } from "node:fs";

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

  /** Written by ngspice 46, not by hand. See fixtures/ngspice-rawfile/README.md. */
  const DIVIDER_RAWFILE = readFileSync(
    "fixtures/ngspice-rawfile/divider-op.raw",
    "utf8",
  );

  it("returns the numbers when the harness sends a rawfile back", async () => {
    // The whole point of the route: an author gets values, not a wall of
    // console text they have to read with their eyes.
    const response = await routeSimulationRequest(
      post({ netlist: NETLIST, testbench: TESTBENCH }),
      stubRunner({
        log: "Circuit: * divider\nNo. of Data Rows : 1\n",
        exitCode: 0,
        timedOut: false,
        durationMs: 11,
        rawfile: DIVIDER_RAWFILE,
        rawfileFormat: "ascii",
      }),
    );
    const payload = (await response!.json()) as {
      outcome: { status: string };
      data?: {
        analyses: {
          analysis: string;
          probes: { name: string; value?: number }[];
        }[];
      };
    };
    expect(payload.outcome.status).toBe("completed");
    const analysis = payload.data?.analyses[0];
    expect(analysis?.analysis).toBe("op");
    const mid = analysis?.probes.find((probe) => probe.name === "v(mid)");
    // A resistive divider of two equal resistors. Arithmetic, not a snapshot.
    expect(mid?.value).toBeCloseTo(0.5, 12);
  });

  it("carries no data when the testbench wrote no rawfile", async () => {
    // Not every deck asks for one, and not asking is not a failure.
    const response = await routeSimulationRequest(
      post({ netlist: NETLIST, testbench: TESTBENCH }),
      stubRunner({
        log: "Circuit: * divider\nv(mid) = 5.000000e-01\n",
        exitCode: 0,
        timedOut: false,
        durationMs: 8,
      }),
    );
    const payload = (await response!.json()) as {
      outcome: { status: string };
      data?: unknown;
    };
    expect(payload.outcome.status).toBe("completed");
    expect(payload.data).toBeUndefined();
  });

  it("fails a run that printed a log and wrote no vectors", async () => {
    // The other half of #568. An exit code of zero called this a success, and
    // it reached the author as an empty chart with nothing to explain it.
    const response = await routeSimulationRequest(
      post({ netlist: NETLIST, testbench: TESTBENCH }),
      stubRunner({
        log: "Circuit: * divider\nNo. of Data Rows : 0\n",
        exitCode: 0,
        timedOut: false,
        durationMs: 9,
        rawfile: "Title: nothing\n",
        rawfileFormat: "ascii",
      }),
    );
    const payload = (await response!.json()) as {
      outcome: { status: string };
      diagnostics: { severity: string; text: string }[];
      data?: unknown;
    };
    expect(payload.outcome.status).toBe("failed");
    expect(payload.data).toBeUndefined();
    // A failure always says why.
    expect(payload.diagnostics.some((one) => one.severity === "error")).toBe(
      true,
    );
  });

  it("says what to change when the rawfile is binary", async () => {
    const response = await routeSimulationRequest(
      post({ netlist: NETLIST, testbench: TESTBENCH }),
      stubRunner({
        log: "Circuit: * divider\n",
        exitCode: 0,
        timedOut: false,
        durationMs: 7,
        rawfile: null,
        rawfileFormat: "binary",
      }),
    );
    const payload = (await response!.json()) as {
      outcome: { status: string };
      diagnostics: { text: string }[];
    };
    expect(payload.outcome.status).toBe("failed");
    expect(payload.diagnostics.map((one) => one.text).join(" ")).toContain(
      "set filetype=ascii",
    );
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

  /** Stands in for a container that answered, but refused the run. */
  function refusingRunner(status: number, body: string): SimulationEnv {
    return {
      NGSPICE: {
        getByName: () => ({
          fetch: async () =>
            new Response(body, {
              status,
              headers: { "content-type": "application/json" },
            }),
        }),
      },
    };
  }

  async function refusal(status: number, body: string) {
    const response = await routeSimulationRequest(
      post({ netlist: NETLIST, testbench: TESTBENCH }),
      refusingRunner(status, body),
    );
    expect(response?.status).toBe(502);
    return (await response!.json()) as Record<string, unknown>;
  }

  it("says why the simulator refused, in the container's own words", async () => {
    // The outage of 2026-09-04. A container that could not make a run
    // directory held its only slot, so every later request was refused as
    // busy; from outside, the bare status was indistinguishable from a
    // simulator honestly running someone else's circuit.
    const payload = await refusal(
      503,
      JSON.stringify({
        error: "simulator-busy",
        message:
          "This simulator runs one circuit at a time and is running another one.",
        retryAfterSeconds: 2,
      }),
    );
    expect(payload).toMatchObject({
      error: "simulator-refused",
      status: 503,
      reason: "simulator-busy",
    });
    expect(String(payload.message)).toContain("one circuit at a time");
  });

  it("separates a container that cannot start a run from one that is busy", async () => {
    const payload = await refusal(
      500,
      JSON.stringify({
        error: "run-directory-unavailable",
        message:
          "The simulator could not make a directory for this run: Error: EACCES",
      }),
    );
    expect(payload).toMatchObject({
      error: "simulator-refused",
      status: 500,
      reason: "run-directory-unavailable",
    });
  });

  it("relays a refusal that is not JSON, which is when it is the only clue", async () => {
    const payload = await refusal(502, "upstream connect error");
    expect(payload).toMatchObject({
      error: "simulator-refused",
      status: 502,
      message: "upstream connect error",
    });
    expect(payload.reason).toBeUndefined();
  });

  it("carries a status alone when the refusal said nothing", async () => {
    const payload = await refusal(500, "");
    expect(payload).toEqual({ error: "simulator-refused", status: 500 });
  });

  it("clips a refusal that answers with a payload instead of a sentence", async () => {
    const payload = await refusal(
      500,
      JSON.stringify({ error: "x".repeat(5_000) }),
    );
    // Bounded: another service's output does not get to set the size of this
    // one's response.
    expect(String(payload.reason).length).toBeLessThanOrEqual(401);
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
