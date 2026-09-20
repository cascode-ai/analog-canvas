import {
  MAX_ARTIFACT_BYTES,
  MAX_ARTIFACT_FILES,
  MAX_ARTIFACT_STORE_BYTES,
  type SimulationArtifactStore,
} from "@icm/simulation-service/files";
import type { ArtifactRef } from "@icm/simulation-service/contract";

// Immutable Project evidence bodies, not another Run or Dataset registry.
// Disconnect releases authorization/cache; it never deletes these records.
const DATABASE = "analog-canvas-simulation-files";
const BODY = "bodies";
const DIRECTORY = "files";
function value<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Storage aborted"));
    transaction.onerror = () => reject(transaction.error);
  });
}
export function createBrowserSimulationArtifactStore(
  projectId: string,
  factory: IDBFactory | undefined = globalThis.indexedDB,
): SimulationArtifactStore | undefined {
  // Non-browser hosts retain bounded in-memory evidence. Real storage failures
  // are surfaced by put/get, never silently treated as durable success.
  if (!factory) return undefined;
  async function open() {
    const request = factory!.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(BODY);
      request.result
        .createObjectStore(DIRECTORY)
        .createIndex("projectId", "projectId");
    };
    return value(request);
  }
  return {
    async put(ref, text) {
      const body = new Blob([text], { type: ref.mediaType });
      if (body.size !== ref.byteLength || body.size > MAX_ARTIFACT_BYTES)
        throw new Error("ARTIFACT_CAPACITY");
      const db = await open();
      try {
        const tx = db.transaction([BODY, DIRECTORY], "readwrite");
        // Attach both handlers before requests, including failure paths.
        let failure: unknown;
        const done = completed(tx).catch((error: unknown) => {
          failure = error;
        });
        try {
          const directory = tx.objectStore(DIRECTORY);
          const entries: Array<{ projectId: string; ref: ArtifactRef }> =
            await value(directory.index("projectId").getAll(projectId));
          const existing = entries.find((item) => item.ref.id === ref.id);
          if (existing) {
            if (JSON.stringify(existing.ref) !== JSON.stringify(ref))
              throw new Error("ARTIFACT_ID_CONFLICT");
          } else {
            if (
              entries.length >= MAX_ARTIFACT_FILES ||
              entries.reduce(
                (sum, item) => sum + item.ref.byteLength,
                body.size,
              ) > MAX_ARTIFACT_STORE_BYTES
            )
              throw new Error("ARTIFACT_CAPACITY");
            const key = [projectId, ref.id];
            tx.objectStore(BODY).put(body, key);
            directory.put({ projectId, ref }, key);
          }
        } catch (error) {
          tx.abort();
          await done;
          throw error;
        }
        await done;
        if (failure) throw failure;
      } finally {
        db.close();
      }
    },
    async get(id) {
      const db = await open();
      try {
        const tx = db.transaction([BODY, DIRECTORY], "readonly");
        const key = [projectId, id];
        const [entry, body] = await Promise.all([
          value(tx.objectStore(DIRECTORY).get(key)) as Promise<
            { ref: ArtifactRef } | undefined
          >,
          value(tx.objectStore(BODY).get(key)) as Promise<Blob | undefined>,
          completed(tx),
        ]);
        if (!entry || !body) return null;
        return { ref: entry.ref, text: await body.text() };
      } finally {
        db.close();
      }
    },
  };
}
