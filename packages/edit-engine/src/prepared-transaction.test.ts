import { describe, expect, it } from "vitest";
import { createEmptyDocument, freezeSnapshot } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { executeTransaction, prepareTransaction } from "./index.js";

describe("prepared atomic transactions", () => {
  it("detaches rejected owned snapshots at the public engine and preparation boundaries", () => {
    const document = freezeSnapshot(createEmptyDocument("owned", "Owned"));
    const request = {
      transactionId: "stale-owned",
      documentId: document.id,
      expectedRevision: 1,
      actor: { kind: "human" as const, id: "editor" },
      edits: [{ kind: "noop" as const }],
    };
    for (const result of [
      executeTransaction(document, request),
      prepareTransaction(document, request).result,
    ]) {
      expect(!result.ok && result.error.code).toBe("STALE_REVISION");
      result.document.name = "Caller changes its result";
      expect(result.document.name).toBe("Caller changes its result");
      expect(document.name).toBe("Owned");
    }
  });

  it("rechecks symbols used only by intermediate edits", () => {
    const document = createEmptyDocument("transient", "Transient");
    let catalog = new InMemorySymbolResolver(builtInSymbols);
    const context = {
      symbolResolver: {
        resolve: (id: string, variant?: string) => catalog.resolve(id, variant),
      },
    };
    const request = {
      transactionId: "transient",
      documentId: document.id,
      expectedRevision: 0,
      actor: { kind: "human" as const, id: "editor" },
      edits: [
        {
          kind: "add_instance" as const,
          instance: { id: "R1", symbolId: "resistor", placement: null },
        },
        { kind: "remove_instance" as const, instanceId: "R1" },
      ],
    };
    const preparation = prepareTransaction(document, request, context);
    expect(preparation.result.ok).toBe(true);
    catalog = new InMemorySymbolResolver([]);
    const result = executeTransaction(document, request, {
      ...context,
      preparedTransactions: [preparation.prepared!],
    });
    expect(result.ok).toBe(false);
    expect(result.document.instances).toEqual([]);
  });

  it("uses current edits and source content after preparation and ignores public preview mutations", () => {
    const document = createEmptyDocument("changed", "Before");
    const context = {
      symbolResolver: new InMemorySymbolResolver(builtInSymbols),
    };
    const request = {
      transactionId: "changed",
      documentId: document.id,
      expectedRevision: 0,
      actor: { kind: "human" as const, id: "editor" },
      edits: [
        {
          kind: "add_instance" as const,
          instance: { id: "R1", symbolId: "resistor", placement: null },
        },
      ],
    };
    const preparation = prepareTransaction(document, request, context);
    expect(preparation.result.ok).toBe(true);
    preparation.result.document.instances.length = 0;
    const adopted = executeTransaction(document, request, context);
    expect(adopted.document.instances.map((instance) => instance.id)).toEqual([
      "R1",
    ]);
    document.name = "Changed in place";
    const changedSource = executeTransaction(document, request, {
      ...context,
      preparedTransactions: [preparation.prepared!],
    });
    expect(changedSource.document.name).toBe("Changed in place");
    const changed = executeTransaction(
      document,
      {
        ...request,
        edits: [
          {
            ...request.edits[0]!,
            instance: { ...request.edits[0]!.instance, id: "R2" },
          },
        ],
      },
      { ...context, preparedTransactions: [preparation.prepared!] },
    );
    expect(changed.document.name).toBe("Changed in place");
    expect(changed.document.instances.map((instance) => instance.id)).toEqual([
      "R2",
    ]);
  });

  it("rechecks a changed symbol context even when the resolver object stays the same", () => {
    const document = createEmptyDocument("context", "Context");
    let catalog = new InMemorySymbolResolver(builtInSymbols);
    const context = {
      symbolResolver: {
        resolve: (id: string, variant?: string) => catalog.resolve(id, variant),
      },
    };
    const request = {
      transactionId: "context",
      documentId: document.id,
      expectedRevision: 0,
      actor: { kind: "human" as const, id: "editor" },
      edits: [
        {
          kind: "add_instance" as const,
          instance: { id: "R1", symbolId: "resistor", placement: null },
        },
      ],
    };
    const preparation = prepareTransaction(document, request, context);
    expect(preparation.result.ok).toBe(true);
    catalog = new InMemorySymbolResolver([]);
    const result = executeTransaction(document, request, {
      ...context,
      preparedTransactions: [preparation.prepared!],
    });
    expect(result.ok).toBe(false);
    expect(result.document.instances).toEqual([]);
  });

  it("cannot adopt a forged candidate and still rejects a stale envelope", () => {
    const document = createEmptyDocument("fence", "Fence");
    const forged = executeTransaction(
      document,
      {
        transactionId: "forged",
        documentId: document.id,
        expectedRevision: 0,
        actor: { kind: "agent", id: "agent" },
        edits: [
          {
            kind: "add_instance",
            instance: { id: "R1", symbolId: "resistor", placement: null },
          },
        ],
      },
      { preparedTransactions: [{ documentId: document.id, revision: 0 }] },
    );
    expect(forged.ok).toBe(false);
    expect(forged.document.instances).toEqual([]);
    const result = executeTransaction(
      document,
      {
        transactionId: "stale",
        documentId: document.id,
        expectedRevision: 1,
        actor: { kind: "agent", id: "agent" },
        edits: [{ kind: "noop" }],
      },
      { preparedTransactions: [{ documentId: document.id, revision: 0 }] },
    );
    expect(!result.ok && result.error.code).toBe("STALE_REVISION");
    expect(result.document).toBe(document);
  });

  it("keeps a dry-run candidate isolated and applies it through the real transaction envelope", () => {
    const document = createEmptyDocument("prepared", "Prepared");
    const request = {
      transactionId: "preview",
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "human" as const, id: "editor" },
      dryRun: true,
      edits: [
        {
          kind: "add_instance" as const,
          instance: { id: "R1", symbolId: "resistor", placement: null },
        },
      ],
    };
    const context = {
      symbolResolver: new InMemorySymbolResolver(builtInSymbols),
    };
    const preparation = prepareTransaction(document, request, context);
    expect(preparation.result.ok).toBe(true);
    expect(document.instances).toEqual([]);
    const result = executeTransaction(
      document,
      { ...request, dryRun: false, actor: { kind: "agent", id: "agent" } },
      {
        ...context,
        preparedTransactions: [preparation.prepared!],
      },
    );
    expect(result.ok && result.applied).toBe(true);
    expect(result.document.instances.map((instance) => instance.id)).toEqual([
      "R1",
    ]);
    expect(result.document.revision).toBe(1);
    expect(document.instances).toEqual([]);
  });
});
