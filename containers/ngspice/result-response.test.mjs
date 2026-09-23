import { describe, it, expect } from "vitest";
import {
  createSimulationEnvironmentMetadata,
  NGSPICE_MAX_RAWFILE_BYTES,
  NGSPICE_MAX_LOG_BYTES,
} from "@icm/spice-run";
import {
  readExecutionReceipt,
  EXECUTION_RECEIPT_HEADER,
  decodeHostedExecutionPayload,
} from "@icm/simulation-service";
import { ngspiceResultResponse } from "./result-response.mjs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDeclaredRawfile } from "./rawfile-collector.mjs";
import { routeNgspiceSimulationRequest } from "../../worker/simulation-ngspice.ts";
import profile from "./hosted-sky130-profile.json" with { type: "json" };

const environment = await createSimulationEnvironmentMetadata({
  executor: "hosted-container",
  reproducibility: "pinned",
  profileId: profile.id,
  platform: "linux/x64",
  simulator: profile.simulator,
  models: {
    id: profile.models.id,
    contentSha256: profile.models.contentSha256,
  },
  startupSha256: profile.startup.contentSha256,
});
export const outputInput = {
  deck: "* protocol test\n.end\n",
  collection: { rawfile: "out.raw" },
  runToken: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  outputContext: {
    netlist: "",
    testbench: "* protocol test\n.end\n",
    inputRevision: "revision-large",
    modelLibrary: null,
    execution: { target: "cloudflare-container" },
  },
};
const raw = (text) => ({
  log: "",
  stdout: "",
  stderr: "",
  exitCode: 0,
  durationMs: 1,
  rawfile: text,
  rawfileFormat: "ascii",
  rawfileName: "out.raw",
  rawfileRequested: true,
  collection: { rawfile: "out.raw" },
  truncatedOutputs: [],
  environment,
  limits: { timeoutMs: 30000 },
});

async function throughWorker(response, patch = {}) {
  return routeNgspiceSimulationRequest(
    new Request("https://canvas.test/api/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "raw",
        netlist: "",
        testbench: outputInput.deck,
        inputRevision: "revision-large",
        collection: outputInput.collection,
        runToken: outputInput.runToken,
        ...patch,
      }),
    }),
    {
      NGSPICE: {
        getByName: () => ({
          fetch: async (url) => {
            expect(new URL(url).pathname).toBe("/run");
            return response;
          },
        }),
      },
    },
  );
}

describe("large ngspice output handoff", () => {
  it("rejects self-consistent but unapproved runtime facts without a follow-up health request", async () => {
    const { fingerprint: _fingerprint, ...facts } = environment;
    const changed = await createSimulationEnvironmentMetadata({
      ...facts,
      simulator: { ...environment.simulator, binarySha256: "a".repeat(64) },
    });
    const reply = await ngspiceResultResponse(
      outputInput,
      { ...raw(""), environment: changed },
      true,
    );
    const response = await throughWorker(
      new Response(reply.body, { headers: reply.headers }),
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: "simulator-protocol-invalid",
    });
  });
  it("advertises the running collector budget rather than an old Worker declaration", async () => {
    const caps = await routeNgspiceSimulationRequest(
      new Request("https://canvas.test/api/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "capabilities" }),
      }),
      {
        SIMULATION_MAX_OUTPUT_BYTES: "1048576",
        NGSPICE: {
          getByName: () => ({
            fetch: async () =>
              Response.json({
                limits: { outputBytes: NGSPICE_MAX_RAWFILE_BYTES },
              }),
          }),
        },
      },
    );
    expect((await caps.json()).maxOutputBytes).toBe(64 * 1024 * 1024);
  });
  it("collects and delivers >4 MiB with every AC variable and the last point intact", async () => {
    const count = 30000;
    let text = `Title: protocol-only\nPlotname: AC Analysis\nFlags: complex\nNo. Variables: 4\nNo. Points: ${count}\nVariables:\n0 frequency frequency\n1 v(out) voltage\n2 v(inp) voltage\n3 v(inn) voltage\nValues:\n`;
    for (let i = 0; i < count; i++)
      text += `${i}\t${i + 1}.000000000000000e+00,0.000000000000000e+00\n\t2.000000000000000e+00,-1.000000000000000e+00\n\t1.000000000000000e+00,0.000000000000000e+00\n\t0.000000000000000e+00,0.000000000000000e+00\n\n`;
    expect(Buffer.byteLength(text)).toBeGreaterThan(4 * 1024 * 1024);
    const directory = await mkdtemp(join(tmpdir(), "ngspice-large-"));
    try {
      await writeFile(join(directory, "out.raw"), text);
      const collected = await readDeclaredRawfile(
        directory,
        outputInput.collection,
        NGSPICE_MAX_RAWFILE_BYTES,
      );
      expect(collected.truncated).toBe(false);
      expect(collected.rawfile).toBe(text);
      const response = await ngspiceResultResponse(
        outputInput,
        raw(collected.rawfile),
        true,
      );
      expect(response.status).toBe(200);
      const receipt = readExecutionReceipt(
        response.headers[EXECUTION_RECEIPT_HEADER],
      );
      expect(JSON.parse(response.body).diagnostics).toEqual([]);
      expect(receipt.collectionStatus).toBe("complete");
      expect(receipt.byteLength).toBe(Buffer.byteLength(response.body));
      const result = JSON.parse(response.body);
      expect(
        decodeHostedExecutionPayload(
          {
            mode: "raw",
            netlist: "",
            testbench: outputInput.deck,
            preparedDeck: outputInput.deck,
            inputRevision: "revision-large",
            environment: { profileId: profile.id, corner: "tt" },
            files: [],
            dependencies: [],
            collection: outputInput.collection,
          },
          result,
        ).result.outcome.status,
      ).toBe("completed");
      expect(result.outcome.status).toBe("completed");
      expect(result.rawfile).toBe(text);
      const ac = result.data.analyses[0];
      expect(ac.analysis).toBe("ac");
      expect(ac.frequencyHz).toHaveLength(count);
      expect(ac.frequencyHz.at(-1)).toBe(count);
      expect(ac.probes.map((p) => p.name)).toEqual([
        "v(out)",
        "v(inp)",
        "v(inn)",
      ]);
      expect(ac.probes[0].real).toHaveLength(count);
      expect(ac.probes[0].real.at(-1)).toBe(2);
      expect(ac.probes[0].imag.at(-1)).toBe(-1);
      const upstream = new Response(response.body, {
        headers: response.headers,
      });
      upstream.json = () => {
        throw new Error("Worker must not buffer numerical output");
      };
      const forwarded = await throughWorker(upstream);
      expect(forwarded.status).toBe(200);
      expect(await forwarded.text()).toBe(response.body);
      expect(NGSPICE_MAX_LOG_BYTES).toBe(1048576);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("does not certify a truncated waveform or a changed input context", async () => {
    const reply = await ngspiceResultResponse(
      outputInput,
      { ...raw("incomplete"), truncatedOutputs: ["rawfile"] },
      true,
    );
    expect(JSON.parse(reply.body).outcome.status).toBe("failed");
    expect(
      readExecutionReceipt(reply.headers[EXECUTION_RECEIPT_HEADER])
        .collectionStatus,
    ).toBe("partial");
    await expect(
      ngspiceResultResponse(
        { ...outputInput, deck: "different" },
        raw(""),
        true,
      ),
    ).rejects.toThrow("context");
  });
  it("withholds oversized legacy replies instead of delivering shortened files", async () => {
    const response = await ngspiceResultResponse(
      outputInput,
      raw("x".repeat(9 * 1024 * 1024)),
      false,
    );
    expect(response.status).toBe(502);
    expect(JSON.parse(response.body).error).toBe("executor-response-too-large");
  });
  it("rejects wrong admission identity and interrupted bodies without retrying execution", async () => {
    const reply = await ngspiceResultResponse(
      outputInput,
      { ...raw("bad"), truncatedOutputs: ["rawfile"] },
      true,
    );
    const wrong = await throughWorker(
      new Response(reply.body, { headers: reply.headers }),
      { inputRevision: "changed" },
    );
    expect(wrong.status).toBe(502);
    const short = await throughWorker(
      new Response(reply.body.slice(0, -1), { headers: reply.headers }),
    );
    await expect(short.text()).rejects.toThrow("incomplete");
  });
});
