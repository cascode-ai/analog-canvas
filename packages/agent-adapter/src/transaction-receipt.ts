import { z } from "zod";
import {
  AgentDiagnosticSchema,
  AgentTransactSuccessResponseSchema,
} from "./schema.js";

type Receipt = z.infer<typeof AgentTransactSuccessResponseSchema>;
export const TRANSACTION_RECEIPT_ENCODING = "diagnostic-pages+gzip";
const expandedLimit = 64_000_000;
// Base64 plus the ordinary request envelope must fit the 16 MB socket budget.
const compressedLimit = 11_900_000;
const pageLimit = 2_000_000;
const encoder = new TextEncoder();
const diagnosticPage = z.array(AgentDiagnosticSchema).max(256);
const idPage = z.array(z.string()).max(256);

function tooLarge(): never {
  throw new Error("MESSAGE_TOO_LARGE");
}

function* diagnosticPages(items: readonly unknown[]) {
  let page: string[] = [];
  let length = 0;
  for (const item of items) {
    const text = JSON.stringify(item);
    if (
      page.length &&
      (page.length === 256 || length + text.length > 128_000)
    ) {
      yield "[" + page.join(",") + "]\n";
      page = [];
      length = 0;
    }
    page.push(text);
    length += text.length;
  }
  if (page.length) yield "[" + page.join(",") + "]\n";
  yield "[]\n";
}

function* receiptLines(result: Receipt) {
  const delta = result.diagnosticDelta;
  const emptyDelta = delta && {
    added: [],
    removed: [],
    ...(delta.removedIds ? { removedIds: [] } : {}),
  };
  yield JSON.stringify({
    ...result,
    diagnostics: [],
    ...(emptyDelta ? { diagnosticDelta: emptyDelta } : {}),
  }) + "\n";
  yield* diagnosticPages(result.diagnostics);
  if (delta) {
    yield* diagnosticPages(delta.added);
    yield* diagnosticPages(delta.removed);
    if (delta.removedIds) yield* diagnosticPages(delta.removedIds);
  }
}

/** Both sides bound the serialized and compressed representations while streaming. */
async function compress(
  parts: AsyncGenerator<string> | Generator<string>,
): Promise<Blob> {
  let expanded = 0;
  const input = new ReadableStream<Uint8Array<ArrayBuffer>>({
    async pull(controller) {
      const part = await parts.next();
      if (part.done) {
        controller.close();
        return;
      }
      const bytes = encoder.encode(part.value);
      expanded += bytes.length;
      if (bytes.length > pageLimit || expanded > expandedLimit) tooLarge();
      controller.enqueue(bytes);
    },
    async cancel() {
      await parts.return(undefined);
    },
  });
  const reader = input.pipeThrough(new CompressionStream("gzip")).getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > compressedLimit) tooLarge();
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return new Blob(chunks);
}

export async function encodeTransactionReceipt(
  result: Receipt,
): Promise<string> {
  const bytes = new Uint8Array(
    await (await compress(receiptLines(result))).arrayBuffer(),
  );
  const pieces: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8192)
    pieces.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  return btoa(pieces.join(""));
}

async function* readLines(blob: Blob) {
  const reader = blob
    .stream()
    .pipeThrough(new DecompressionStream("gzip"))
    .getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let carry = "",
    expanded = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      expanded += value.length;
      if (expanded > expandedLimit) tooLarge();
      const lines = (carry + decoder.decode(value, { stream: true })).split(
        "\n",
      );
      carry = lines.pop()!;
      if (carry.length > pageLimit) tooLarge();
      for (const line of lines) {
        if (line.length > pageLimit) tooLarge();
        yield line;
      }
    }
    if (carry + decoder.decode()) throw new Error("Incomplete receipt page");
  } finally {
    await reader.cancel().catch(() => {});
  }
}

async function* readList(lines: AsyncGenerator<string>, ids = false) {
  yield "[";
  let first = true;
  for (;;) {
    const line = await lines.next();
    if (line.done) throw new Error("Incomplete transaction receipt");
    const raw: unknown = JSON.parse(line.value);
    if (!Array.isArray(raw) || raw.length > 256)
      throw new Error("Invalid receipt page");
    if (raw.length === 0) break;
    const page = ids ? idPage.parse(raw) : diagnosticPage.parse(raw);
    yield (first ? "" : ",") + JSON.stringify(page).slice(1, -1);
    first = false;
  }
  yield "]";
}

// Emit the schema's public fields in order. Only small pages are materialized in the relay.
async function* publicJson(header: Receipt, lines: AsyncGenerator<string>) {
  yield "{";
  let comma = "";
  for (const [key, value] of Object.entries(header)) {
    yield comma + JSON.stringify(key) + ":";
    comma = ",";
    if (key === "diagnostics") yield* readList(lines);
    else if (key === "diagnosticDelta") {
      yield '{"added":';
      yield* readList(lines);
      yield ',"removed":';
      yield* readList(lines);
      if (header.diagnosticDelta?.removedIds) {
        yield ',"removedIds":';
        yield* readList(lines, true);
      }
      yield "}";
    } else yield JSON.stringify(value);
  }
  if (!(await lines.next()).done)
    throw new Error("Unexpected transaction receipt data");
  yield "}";
}

const completionSchema = AgentTransactSuccessResponseSchema.pick({
  apiVersion: true,
  requestId: true,
  operation: true,
  ok: true,
  applied: true,
  revision: true,
}).strict();

export class ValidatedTransactionReceipt {
  constructor(
    readonly header: z.infer<typeof completionSchema>,
    private readonly gzip?: Blob,
  ) {}
  body() {
    return this.gzip?.stream().pipeThrough(new DecompressionStream("gzip"));
  }
}

export async function openTransactionReceipt(
  payload: object,
  requestId: string,
) {
  if ("completed" in payload) {
    const header = completionSchema.parse(payload.completed);
    if (header.requestId !== requestId || "data" in payload)
      throw new Error("Invalid receipt completion");
    return new ValidatedTransactionReceipt(header);
  }
  if (!("data" in payload) || typeof payload.data !== "string")
    throw new Error("Invalid receipt data");
  const data = payload.data;
  if (data.length > 4 * Math.ceil(compressedLimit / 3)) tooLarge();
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const lines = readLines(new Blob([bytes]));
  try {
    const first = await lines.next();
    if (first.done) throw new Error("Missing receipt");
    const header = AgentTransactSuccessResponseSchema.parse(
      JSON.parse(first.value),
    );
    const delta = header.diagnosticDelta;
    if (
      header.requestId !== requestId ||
      header.diagnostics.length ||
      delta?.added.length ||
      delta?.removed.length ||
      delta?.removedIds?.length
    )
      throw new Error("Invalid receipt header");
    return new ValidatedTransactionReceipt(
      header,
      await compress(publicJson(header, lines)),
    );
  } finally {
    await lines.return(undefined);
  }
}
