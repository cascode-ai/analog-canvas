import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  encodeTransactionReceipt,
  openTransactionReceipt,
} from "./transaction-receipt.js";

describe("large Agent transaction receipts", () => {
  const warning = {
    code: "ERC_DANGLING_WIRE",
    severity: "warning" as const,
    message: "屏外导线",
    objectIds: ["wire-1"],
  };
  const result = {
    apiVersion: "3.0" as const,
    requestId: "undo-1",
    operation: "transact" as const,
    ok: true as const,
    revision: 2,
    proposedRevision: 2,
    applied: true,
    diff: {
      documentId: "doc",
      fromRevision: 1,
      toRevision: 2,
      editKinds: ["undo"],
      changedObjectIds: ["wire-1"],
    },
    diagnostics: Array.from({ length: 2400 }, (_, i) => ({
      ...warning,
      message: "junction " + i + " " + warning.message,
    })),
    diagnosticDelta: { added: [warning], removed: [], removedIds: ["old"] },
  };
  it("delivers every ordered diagnostic, including the delta, through a bounded frame", async () => {
    const encoded = await encodeTransactionReceipt(result);
    expect(encoded.length).toBeLessThan(JSON.stringify(result).length / 3);
    const receipt = await openTransactionReceipt({ data: encoded }, "undo-1");
    expect(await new Response(receipt.body()).json()).toEqual(result);
    await expect(
      openTransactionReceipt({ data: encoded }, "other-undo"),
    ).rejects.toThrow();
  });
  it("refuses individual records that exceed its memory budget", async () => {
    await expect(
      encodeTransactionReceipt({
        ...result,
        diagnostics: [{ ...warning, message: "x".repeat(2_000_000) }],
      }),
    ).rejects.toThrow("MESSAGE_TOO_LARGE");
  });
  it("refuses incompressible multi-page data at the compressed budget", async () => {
    const diagnostics = Array.from({ length: 130 }, () => ({
      ...warning,
      message: randomBytes(96_000).toString("base64"),
    }));
    await expect(
      encodeTransactionReceipt({ ...result, diagnostics }),
    ).rejects.toThrow("MESSAGE_TOO_LARGE");
  });
  it("validates every diagnostic, including later pages", async () => {
    const invalid = {
      ...result,
      diagnostics: [
        ...result.diagnostics,
        { ...warning, severity: "unknown" as typeof warning.severity },
      ],
    };
    const encoded = await encodeTransactionReceipt(invalid);
    await expect(
      openTransactionReceipt({ data: encoded }, result.requestId),
    ).rejects.toThrow();
  });
  it("rejects a truncated frame before acknowledging the write", async () => {
    const frame = await encodeTransactionReceipt(result);
    await expect(
      openTransactionReceipt({ data: frame.slice(0, -12) }, "undo-1"),
    ).rejects.toThrow();
  });
});
