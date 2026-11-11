import { sha256Hex } from "@icm/derived";
import type { DurableObjectStateLike, SqlStorage } from "./gallery-store";

const bodies = new WeakMap<Response, string>();

/** A store result whose bytes can be recorded before its SQL transaction commits. */
export function publicationResult(value: unknown, status = 200): Response {
  const text = JSON.stringify(value);
  const response = new Response(text, {
    status,
    headers: { "content-type": "application/json" },
  });
  bodies.set(response, text);
  return response;
}

export type PublicationReceipt = {
  userId: string;
  commandId: string;
  binding: string;
  entryId: string;
};

export function publicationFingerprint(sql: SqlStorage, id: string): string {
  const rows = sql
    .exec<Record<string, unknown>>(
      "SELECT * FROM gallery_entries WHERE id=?",
      id,
    )
    .toArray()
    .map((row) =>
      Object.fromEntries(
        Object.keys(row)
          .sort()
          .filter(
            (key) => !["submitter_email", "submitter_provider"].includes(key),
          )
          .map((key) => [key, row[key]]),
      ),
    );
  return sha256Hex(
    JSON.stringify([
      rows,
      sql.exec("SELECT * FROM entry_references WHERE entry_id=?", id).toArray(),
      sql.exec("SELECT * FROM dataset_comparisons WHERE id=?", id).toArray(),
    ]),
  );
}

/** A mutation and its exact retry result share the writer's transaction. */
export function publicationCommand(
  state: DurableObjectStateLike,
  receipt: PublicationReceipt,
  apply: () => Response,
): Response {
  const sql = state.storage.sql;
  sql.exec(`CREATE TABLE IF NOT EXISTS gallery_publication_commands (
    user_id TEXT NOT NULL, command_id TEXT NOT NULL, binding TEXT NOT NULL,
    entry_id TEXT NOT NULL, state TEXT NOT NULL, status INTEGER NOT NULL,
    result TEXT NOT NULL, PRIMARY KEY(user_id, command_id))`);
  return state.storage.transactionSync(() => {
    const previous = sql
      .exec<{ binding: string; state: string; status: number; result: string }>(
        "SELECT binding,state,status,result FROM gallery_publication_commands WHERE user_id=? AND command_id=?",
        receipt.userId,
        receipt.commandId,
      )
      .toArray()[0];
    if (previous) {
      if (previous.binding !== receipt.binding)
        return Response.json({ error: "command-reused" }, { status: 409 });
      if (previous.state !== publicationFingerprint(sql, receipt.entryId))
        return Response.json({ error: "action-superseded" }, { status: 409 });
      return new Response(previous.result, {
        status: previous.status,
        headers: {
          "content-type": "application/json",
          "x-canvas-publication-state": previous.state,
        },
      });
    }
    if (
      sql
        .exec<{ n: number }>(
          "SELECT COUNT(*) AS n FROM gallery_publication_commands WHERE user_id=?",
          receipt.userId,
        )
        .one().n >= 10000
    )
      return Response.json({ error: "command-receipts-full" }, { status: 503 });
    const response = apply();
    if (!response.ok) return response;
    const text = bodies.get(response);
    if (text === undefined)
      throw new Error("Publication mutation returned an unrecordable result");
    sql.exec(
      "INSERT INTO gallery_publication_commands VALUES (?,?,?,?,?,?,?)",
      receipt.userId,
      receipt.commandId,
      receipt.binding,
      receipt.entryId,
      publicationFingerprint(sql, receipt.entryId),
      response.status,
      text,
    );
    response.headers.set(
      "x-canvas-publication-state",
      publicationFingerprint(sql, receipt.entryId),
    );
    return response;
  });
}
