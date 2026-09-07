import type { Run } from "./contract.js";

export const RUN_RECEIPT_MAX_BYTES = 96_000;
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;
/** Full arrays live in artifacts. Never clone them just to discard them. */
export function runReceipt(view: Run): Run {
  if (bytes(view) <= RUN_RECEIPT_MAX_BYTES) return structuredClone(view);
  const { outputData: _outputs, result, ...summary } = view;
  const resultSummary = result
    ? (() => {
        const { data: _data, ...rest } = result;
        return {
          ...rest,
          log: result.log.slice(0, 4096),
          diagnostics: result.diagnostics
            .slice(0, 16)
            .map((d) => ({ ...d, text: d.text.slice(0, 512) })),
        };
      })()
    : undefined;
  return structuredClone({
    ...summary,
    ...(resultSummary ? { result: resultSummary } : {}),
    resultPreview: true,
  });
}
