import { expect, it } from "vitest";
import type { Run } from "./contract.js";
import { runReceipt, releaseRunData } from "./run-receipt.js";
const RUN_RECEIPT_MAX_BYTES = 96_000;

it("bounds derived arrays even when there is no large raw result", () => {
  const run: Run = {
    id: "r",
    preparedId: "p",
    inputRevision: "i",
    state: "finished",
    artifacts: [],
    outputData: {
      schemaVersion: 1,
      analyses: [
        {
          analysis: "tran",
          plotName: "Transient",
          outputs: [
            {
              id: "o",
              label: "Output",
              unit: "V",
              values: Array(100000).fill(1),
            },
          ],
        },
      ],
      diagnostics: [],
      measurements: [],
    },
  };
  const receipt = runReceipt(run);
  expect(receipt.resultPreview).toBe(true);
  expect(receipt.outputData).toBeUndefined();
  expect(new TextEncoder().encode(JSON.stringify(receipt)).length).toBeLessThan(
    RUN_RECEIPT_MAX_BYTES,
  );
  expect(run.outputData!.analyses[0]!.outputs[0]!.values).toHaveLength(100000);
});

it.each([181, 2000, 100000])(
  "does not inline samples at %i points and keeps internal data until explicitly released",
  (count) => {
    const values = Array(count).fill(1.234567890123456);
    const run = {
      id: "r-combined",
      preparedId: "p",
      inputRevision: "i",
      state: "finished",
      artifacts: [],
      result: {
        outcome: { status: "completed" },
        log: "",
        diagnostics: [],
        durationMs: 1,
        metadata: {
          schemaVersion: 1,
          input: {
            inputRevision: "i",
            netlistSha256: "0".repeat(64),
            testbenchSha256: "1".repeat(64),
            deckSha256: "2".repeat(64),
          },
          configuration: { modelLibrary: null },
          environment: {
            executor: "local-host",
            reproducibility: "observed",
            profileId: "p",
            platform: "test",
            simulator: {
              name: "ngspice",
              version: "test",
              binarySha256: null,
            },
            models: null,
            startupSha256: null,
            fingerprint: "test",
          },
        },
        data: {
          schemaVersion: 1,
          analyses: [
            {
              analysis: "tran",
              plotName: "Transient",
              timeSeconds: values,
              probes: [
                {
                  name: "v(out)",
                  quantity: "voltage",
                  unit: "V",
                  value: values,
                },
              ],
            },
          ],
        },
      },
      outputData: {
        schemaVersion: 1,
        analyses: [
          {
            analysis: "tran",
            plotName: "Transient",
            outputs: [{ id: "o", label: "Output", unit: "V", values }],
          },
        ],
        diagnostics: [],
        measurements: [],
      },
    } satisfies Run;

    const receipt = runReceipt(run);
    expect(receipt).toMatchObject({
      resultPreview: true,
      result: { outcome: { status: "completed" } },
    });
    expect(receipt.outputData).toBeUndefined();
    expect(receipt.result?.data).toBeUndefined();
    expect(run.result.data.analyses[0]!.timeSeconds).toHaveLength(count);
    const released = releaseRunData(run);
    expect(released.result?.data).toBeUndefined();
    expect(runReceipt(released)).toEqual(receipt);
    expect(JSON.stringify(receipt).length).toBeLessThan(2000);
  },
);
