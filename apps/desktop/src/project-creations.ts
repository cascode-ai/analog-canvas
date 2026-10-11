import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { readLimited, writeDurable } from "./durable-files.js";

const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
interface Creation {
  path: string;
  before: string | null;
  after: string;
}
export class CreationCancelled extends Error {}
export type CreationRecovery = (
  path: string,
  canRetry: boolean,
) => Promise<"retry" | "new" | "cancel">;

/** A native destination decision survives a lost response. Record it after
 * overwrite protection, before replacing the file; retries never choose anew. */
export function projectCreations(directory?: string) {
  const memory = new Map<string, Creation>();
  const recordPath = (key: string) =>
    join(directory!, `${digest(Buffer.from(key))}.json`);
  async function load(key: string): Promise<Creation | null> {
    if (!directory) return memory.get(key) ?? null;
    try {
      const record = JSON.parse(
        (await readLimited(recordPath(key), 32768)).toString("utf8"),
      ) as Creation;
      if (
        typeof record.path !== "string" ||
        !isAbsolute(record.path) ||
        !/^[a-f0-9]{64}$/u.test(record.after) ||
        (record.before !== null && !/^[a-f0-9]{64}$/u.test(record.before))
      )
        throw new Error(
          "Creation receipt is damaged; retained files were not changed",
        );
      return record;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  return {
    async lookup(key: string, bytes: Buffer, recover?: CreationRecovery) {
      const record = await load(key);
      if (!record) return null;
      let expected: Buffer | null = null;
      let unreadable = false;
      try {
        expected = await readLimited(record.path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          unreadable = true;
      }
      const current = expected ? digest(expected) : null;
      const matches = record.after === digest(bytes);
      const changed =
        unreadable || (current !== record.after && current !== record.before);
      const committed = !unreadable && current === record.after;
      if (!committed) {
        const choice =
          (await recover?.(record.path, matches && !changed)) ?? "retry";
        if (choice === "cancel") throw new CreationCancelled();
        if (choice === "new") return { newDestination: true } as const;
      }
      if (changed)
        throw new Error(
          "The creation destination changed or cannot be read; no file was overwritten",
        );
      if (!matches)
        throw new Error(
          "This creation already has retained content. Open the saved Project before making another copy.",
        );
      // Carry the verified bytes through to the commit check, including across
      // the recovery prompt. A later disk read cannot become new authority.
      return {
        newDestination: false,
        path: record.path,
        committed,
        expected,
      } as const;
    },
    async reserve(
      key: string,
      path: string,
      before: Buffer | null,
      after: Buffer,
      replace = false,
    ) {
      if (await load(key)) {
        if (!replace) return;
        // Retain the abandoned decision and every file it references.
        if (directory)
          await copyFile(
            recordPath(key),
            `${recordPath(key)}.${randomUUID()}.abandoned`,
          );
      }
      const record = {
        path,
        before: before ? digest(before) : null,
        after: digest(after),
      };
      if (directory) {
        await mkdir(directory, { recursive: true });
        await writeDurable(recordPath(key), JSON.stringify(record));
      } else memory.set(key, record);
    },
  };
}
