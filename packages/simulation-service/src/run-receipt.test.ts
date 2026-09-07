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
