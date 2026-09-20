import {
  SimulationResultSchema,
  SIMULATION_EXECUTOR_STREAM_MAX_BYTES,
} from "@icm/spice-run";
import { z } from "zod";

/** Internal metadata on the existing HTTP response, not another execution API.
 * The digest binds the streamed JSON body to the state used by the queue. */
export const EXECUTION_RECEIPT_HEADER = "x-analog-simulation-receipt";
export const EXECUTION_RECEIPT_MAX_CHARS = 8192;
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
export const ExecutionReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runToken: z.string().regex(/^[0-9a-f-]{36}$/u),
  byteLength: z
    .number()
    .int()
    .positive()
    .max(SIMULATION_EXECUTOR_STREAM_MAX_BYTES),
  sha256: digest,
  executedFilesSha256: digest,
  outcome: SimulationResultSchema.shape.outcome,
  metadata: SimulationResultSchema.shape.metadata,
  execution: SimulationResultSchema.shape.execution,
  cancelled: z.boolean(),
  collectionStatus: z.enum(["complete", "partial"]),
});
export type ExecutionReceipt = z.infer<typeof ExecutionReceiptSchema>;

export function encodeExecutionReceipt(value: unknown): string {
  const encoded = encodeURIComponent(
    JSON.stringify(ExecutionReceiptSchema.parse(value)),
  );
  if (encoded.length > EXECUTION_RECEIPT_MAX_CHARS)
    throw new Error("Execution receipt exceeds header budget");
  return encoded;
}

export function readExecutionReceipt(
  value: string | null,
): ExecutionReceipt | null {
  if (value === null) return null;
  if (value.length > EXECUTION_RECEIPT_MAX_CHARS)
    throw new Error("Execution receipt exceeds header budget");
  return ExecutionReceiptSchema.parse(JSON.parse(decodeURIComponent(value)));
}

/** Bound transport memory independently of file size, and reject short bodies. */
export function boundExecutionStream(
  body: ReadableStream<Uint8Array>,
  byteLength: number,
): ReadableStream<Uint8Array> {
  let bytes = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        if (bytes > byteLength)
          throw new Error("Execution body exceeds receipt length");
        controller.enqueue(chunk);
      },
      flush() {
        if (bytes !== byteLength)
          throw new Error("Execution body is incomplete");
      },
    }),
  );
}
