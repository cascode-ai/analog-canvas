import { describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  publicationOperations,
  rememberPublication,
} from "./component-publication-journal";
import {
  componentLibraryHarness,
  nativePackage,
} from "../../../../../worker/component-library.test-support";
import { executeComponentPublication } from "./component-publication-operation";
import {
  componentLibraryCapture,
  componentLibraryAssociation,
} from "./component-library-origin";
import { publicationFromOrigin } from "./component-publication";
import { createEmptyProject } from "@icm/model";
import {
  executeProjectTransaction,
  createCircuitComponentPackageProject,
  buildCircuitComponentPackage,
} from "@icm/edit-engine";
import { externalSubcircuitSymbolId } from "@icm/symbols";
import { prepareComponentCapture } from "./component-placement";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { analyzeDesignNetlist } from "@icm/netlist";

describe("shared GUI and Agent publication operations", () => {
  it("persists fixed requests in browser storage, scopes keys by account, and rejects damaged target data", async () => {
    const factory = new IDBFactory();
    vi.stubGlobal("indexedDB", factory);
    try {
      const operation = {
        version: 1 as const,
        accountId: "alice",
        componentId: "journal-component",
        revision: 0,
        idempotencyKey: "journal-key",
        pending: true,
        payload: nativePackage(),
      };
      await rememberPublication(operation);
      await rememberPublication({
        ...operation,
        accountId: "bob",
        componentId: "journal-variant",
      });
      expect(await publicationOperations(operation.componentId)).toEqual([
        operation,
      ]);
      expect(
        (await publicationOperations("journal-variant"))[0]!.accountId,
      ).toBe("bob");
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = factory.open("analog-canvas-component-publication", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = db.transaction("operations", "readwrite");
      const done = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      transaction
        .objectStore("operations")
        .put({ ...operation, payload: { definition: {} } }, "damaged");
      await done;
      db.close();
      await expect(
        publicationOperations(operation.componentId),
      ).rejects.toThrow();
      expect(await publicationOperations("journal-variant")).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("retries the original snapshot after a lost reply and an edit, and refuses recovery from another account", async () => {
    const route = componentLibraryHarness();
    let user = "alice";
    let lose = true;
    const fetchLike: typeof fetch = async (input, init) => {
      if (input === "/api/auth/me")
        return Response.json({ user: { id: user } });
      const response = await route(
        "PUT",
        String(input).slice("/api/components".length),
        JSON.parse(String(init!.body)),
        user,
      );
      if (lose) {
        lose = false;
        throw Error("Lost response");
      }
      return response;
    };
    const input = {
      componentId: "operation-recovery",
      revision: 0,
      idempotencyKey: "fixed-snapshot-recovery",
      payload: nativePackage(),
      fetch: fetchLike,
    };
    await expect(executeComponentPublication(input)).rejects.toMatchObject({
      outcomeUnknown: true,
    });
    const edited = structuredClone(input.payload);
    edited.definition.symbol.name = "Edited after timeout";
    user = "bob";
    await expect(
      executeComponentPublication({ ...input, payload: edited }),
    ).rejects.toThrow("original account");
    user = "alice";
    const recovered = await executeComponentPublication({
      ...input,
      payload: edited,
    });
    await expect(
      executeComponentPublication({
        ...input,
        componentId: "wrong-destination",
      }),
    ).rejects.toThrow("original account and destination");
    expect(recovered).toMatchObject({
      recovered: true,
      entry: {
        revision: 1,
        definition: { symbol: { name: "Packaged resistor" } },
      },
    });
    expect((await (await route()).json()).entries).toHaveLength(1);
    const origin = await componentLibraryCapture(recovered.entry);
    const changedProject = createCircuitComponentPackageProject(
      edited,
      "changed-project",
    );
    expect(() =>
      componentLibraryAssociation(
        changedProject,
        edited.definition.symbol.id,
        origin,
      ),
    ).toThrow("local definition changed");
  });
  it("captures and round-trips provenance without changing electrical analysis, and keeps explicit new intent", async () => {
    const route = componentLibraryHarness();
    const packaged = nativePackage();
    const entry = (
      await (
        await route(
          "PUT",
          "/origin-roundtrip",
          { ...packaged, revision: 0 },
          "alice",
        )
      ).json()
    ).entry;
    const payload = await componentLibraryCapture(entry);
    const original = prepareComponentCapture(
      createEmptyProject("capture", "Capture"),
      { definition: entry.definition, circuit: entry.circuit },
      "capture-old",
    );
    const captured = prepareComponentCapture(
      createEmptyProject("capture", "Capture"),
      payload,
      "capture-old",
    );
    expect(analyzeDesignNetlist(captured.project)).toEqual(
      analyzeDesignNetlist(original.project),
    );
    const reopened = parseProject(serializeProject(captured.project));
    expect(reopened.componentDefinitions![0]!.libraryOrigin).toEqual(
      payload.definition.libraryOrigin,
    );
    const olderEnvelope = JSON.parse(serializeProject(captured.project));
    olderEnvelope.schemaVersion = 68;
    expect(() => parseProject(JSON.stringify(olderEnvelope))).toThrow(
      "schema 69",
    );
    const origin = payload.definition.libraryOrigin!;
    expect(
      publicationFromOrigin(origin, entry, { id: "alice", isAdmin: false }),
    ).toEqual({
      kind: "update",
      componentId: entry.id,
      expectedLibraryRevision: 1,
    });
    const explicit = { kind: "new" as const, componentId: "explicit-variant" };
    expect(
      publicationFromOrigin(
        origin,
        entry,
        { id: "alice", isAdmin: false },
        explicit,
      ),
    ).toBe(explicit);
    expect(
      publicationFromOrigin(origin, entry, { id: "bob", isAdmin: false }).kind,
    ).toBe("new");
    const local = createCircuitComponentPackageProject(
      packaged,
      "local-association",
    );
    const result = executeProjectTransaction(local, {
      transactionId: "associate",
      projectId: local.id,
      expectedStructureRevision: local.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: componentLibraryAssociation(
        local,
        packaged.definition.symbol.id,
        payload,
      ),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error(result.error.message);
    expect(analyzeDesignNetlist(result.project)).toEqual(
      analyzeDesignNetlist(local),
    );
    const owner = result.project.externalSubcircuitDefinitions[0]!;
    const switched = executeProjectTransaction(result.project, {
      transactionId: "automatic-artwork",
      projectId: result.project.id,
      expectedStructureRevision: result.project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: [
        {
          kind: "apply_model_source",
          source: result.project.modelSources![0]!,
          definitions: [
            {
              definitionId: owner.id,
              entry: owner.name,
              authoring: { symbolMode: "automatic" },
            },
          ],
        },
      ],
    });
    if (!switched.ok) throw Error(switched.error.message);
    expect(
      switched.project.externalSubcircuitDefinitions[0]!.libraryOrigin,
    ).toEqual(origin);
    const automaticId = externalSubcircuitSymbolId(owner.id);
    const automaticPackage = buildCircuitComponentPackage(
      switched.project,
      owner.id,
      automaticId,
    );
    expect(automaticPackage.definition.libraryOrigin).toEqual(origin);
    const autoEntry = (
      await (
        await route(
          "PUT",
          "/automatic-artwork-origin",
          { ...automaticPackage, revision: 0 },
          "alice",
        )
      ).json()
    ).entry;
    const autoResult = executeProjectTransaction(switched.project, {
      transactionId: "associate-automatic",
      projectId: switched.project.id,
      expectedStructureRevision: switched.project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: componentLibraryAssociation(
        switched.project,
        automaticId,
        await componentLibraryCapture(autoEntry),
      ),
    });
    if (!autoResult.ok) throw Error(autoResult.error.message);
    expect(
      parseProject(serializeProject(autoResult.project))
        .externalSubcircuitDefinitions[0]!.libraryOrigin?.componentId,
    ).toBe(autoEntry.id);
    expect(analyzeDesignNetlist(autoResult.project)).toEqual(
      analyzeDesignNetlist(switched.project),
    );
    const artwork = { definition: { symbol: packaged.definition.symbol } };
    const artworkEntry = (
      await (
        await route(
          "PUT",
          "/legacy-artwork-origin",
          { ...artwork, revision: 0 },
          "alice",
        )
      ).json()
    ).entry;
    const legacyCapture = prepareComponentCapture(
      createEmptyProject("legacy-artwork", "Legacy artwork"),
      { definition: artworkEntry.definition },
      "old-artwork",
    );
    const associatedCapture = prepareComponentCapture(
      legacyCapture.project,
      await componentLibraryCapture(artworkEntry),
      "new-artwork",
    );
    expect(associatedCapture.project.componentDefinitions).toHaveLength(1);
    expect(
      associatedCapture.project.componentDefinitions![0]!.libraryOrigin,
    ).toMatchObject({ componentId: artworkEntry.id });
  });
  it("recovers the fixed destination after server receipt expiry without creating another record", async () => {
    const route = componentLibraryHarness();
    const realNow = Date.now();
    let lose = true;
    const fetchLike: typeof fetch = async (input, init) => {
      if (input === "/api/auth/me")
        return Response.json({ user: { id: "alice" } });
      const response = await route(
        init?.method ?? "GET",
        String(input).slice("/api/components".length),
        init?.body ? JSON.parse(String(init.body)) : undefined,
        "alice",
      );
      if (init?.method === "PUT" && lose) {
        lose = false;
        throw Error("Lost response");
      }
      return response;
    };
    const input = {
      componentId: "expired-recovery",
      revision: 0,
      idempotencyKey: "expired-fixed-request",
      payload: nativePackage(),
      fetch: fetchLike,
    };
    await expect(executeComponentPublication(input)).rejects.toMatchObject({
      outcomeUnknown: true,
    });
    vi.spyOn(Date, "now").mockReturnValue(realNow + 8 * 24 * 60 * 60 * 1000);
    try {
      expect(await executeComponentPublication(input)).toMatchObject({
        recovered: true,
        outcome: "created",
        entry: { revision: 1 },
      });
      expect((await (await route()).json()).entries).toHaveLength(1);
    } finally {
      vi.restoreAllMocks();
    }
  });
  it("associates a reused legacy native capture without treating origin as artwork or consuming its draft", async () => {
    const route = componentLibraryHarness();
    const entry = (
      await (
        await route(
          "PUT",
          "/native-legacy-reuse",
          {
            revision: 0,
            ...nativePackage(),
          },
          "alice",
        )
      ).json()
    ).entry;
    const payload = await componentLibraryCapture(entry);
    const original = prepareComponentCapture(
      createEmptyProject("legacy-native-reuse", "Legacy native reuse"),
      {
        ...payload,
        definition: { ...payload.definition, libraryOrigin: undefined },
      },
      "legacy-native-capture",
    );
    const project = structuredClone(original.project);
    const source = project.modelSources![0]!;
    source.draft = {
      entry: source.entry,
      baseRevision: source.revision,
      files: source.files.map((file) => ({
        ...file,
        text: file.text + "\n* Pending edit.\n",
      })),
    };
    const prepared = prepareComponentCapture(
      project,
      payload,
      "reuse-native-capture",
    );
    expect(prepared.symbolId).toBe(payload.definition.symbol.id);
    expect(prepared.project.componentDefinitions).toHaveLength(1);
    expect(prepared.project.componentDefinitions![0]!.libraryOrigin).toEqual(
      payload.definition.libraryOrigin,
    );
    expect(prepared.project.modelSources).toEqual(project.modelSources);
  });
  it("reports recovered cloud success when saving its local receipt fails", async () => {
    const factory = new IDBFactory();
    vi.stubGlobal("indexedDB", factory);
    const route = componentLibraryHarness();
    let lose = true;
    let recovering = false;
    const fetchLike: typeof fetch = async (input, init) => {
      if (input === "/api/auth/me")
        return Response.json({ user: { id: "alice" } });
      const response = await route(
        init?.method ?? "GET",
        String(input).slice("/api/components".length),
        init?.body ? JSON.parse(String(init.body)) : undefined,
        "alice",
      );
      if (init?.method === "PUT" && lose) {
        lose = false;
        throw Error("Lost response");
      }
      if (recovering && init?.method !== "PUT") {
        vi.stubGlobal("window", {});
        vi.stubGlobal("indexedDB", undefined);
      }
      return response;
    };
    const input = {
      componentId: "recovery-receipt-failure",
      revision: 0,
      idempotencyKey: "recovery-storage-failure",
      payload: nativePackage(),
      fetch: fetchLike,
    };
    try {
      await expect(executeComponentPublication(input)).rejects.toMatchObject({
        outcomeUnknown: true,
      });
      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now + 8 * 24 * 60 * 60 * 1000);
      recovering = true;
      expect(await executeComponentPublication(input)).toMatchObject({
        recovered: true,
        outcome: "created",
        entry: { revision: 1 },
      });
      vi.stubGlobal("indexedDB", factory);
      expect((await publicationOperations(input.componentId))[0]!.pending).toBe(
        true,
      );
      expect((await (await route()).json()).entries).toHaveLength(1);
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });
});
