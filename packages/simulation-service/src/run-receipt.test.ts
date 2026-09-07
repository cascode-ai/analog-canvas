import { expect, it } from "vitest";
import type { Run } from "./contract.js";
import { runReceipt, RUN_RECEIPT_MAX_BYTES } from "./run-receipt.js";

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

it("bounds a run when raw and derived results only exceed the budget together", () => {
  const values = Array(2000).fill(1.234567890123456);
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
              { name: "v(out)", quantity: "voltage", unit: "V", value: values },
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

  const encoder = new TextEncoder();
  expect(encoder.encode(JSON.stringify(run.result)).byteLength).toBeLessThan(
    RUN_RECEIPT_MAX_BYTES,
  );
  expect(
    encoder.encode(JSON.stringify(run.outputData)).byteLength,
  ).toBeLessThan(RUN_RECEIPT_MAX_BYTES);
  expect(encoder.encode(JSON.stringify(run)).byteLength).toBeGreaterThan(
    RUN_RECEIPT_MAX_BYTES,
  );
  const receipt = runReceipt(run);
  expect(receipt).toMatchObject({
    resultPreview: true,
    result: { outcome: { status: "completed" } },
  });
  expect(receipt.outputData).toBeUndefined();
  expect(receipt.result?.data).toBeUndefined();
});
