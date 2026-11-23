import { sha256Hex } from "@icm/derived";
import type { SqlStorage } from "./gallery-store";

const DAY = 86_400_000;
const REGISTER_WINDOW = 5 * 60_000;
type State = "registered" | "claimed" | "denied" | "committed";

export function validCreateTicket(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

export function projectCreateIntent(body: Record<string, unknown>): string {
  return sha256Hex(
    JSON.stringify([body.name, body.projectText, body.galleryEntryId ?? null]),
  );
}

export function projectCreateBinding(
  body: Record<string, unknown>,
  intent: string,
): string {
  return sha256Hex(JSON.stringify([body.userId, body.id, intent]));
}

/** These records belong to the local dispatch attempt, outside the replication journal. */
export class ProjectCreateReceipts {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(`CREATE TABLE IF NOT EXISTS project_create_receipts (
      ticket_hash TEXT PRIMARY KEY, state TEXT NOT NULL, binding TEXT, issued_at INTEGER NOT NULL
    ) WITHOUT ROWID`);
    sql.exec(
      "CREATE INDEX IF NOT EXISTS project_create_receipt_age ON project_create_receipts(issued_at)",
    );
  }

  control(action: unknown, ticket: unknown): Response {
    if (
      !validCreateTicket(ticket) ||
      (action !== "register" && action !== "settle")
    )
      return Response.json({ error: "invalid-receipt" }, { status: 400 });
    const key = sha256Hex(ticket);
    if (action === "register") {
      const now = Date.now(),
        issued = Number.parseInt(ticket.slice(0, 12), 16);
      this.sql.exec(
        "DELETE FROM project_create_receipts WHERE issued_at < ? AND state <> 'claimed'",
        now - 30 * DAY,
      );
      this.sql.exec(
        "DELETE FROM project_create_receipts WHERE binding IS NULL AND issued_at < ?",
        now - 2 * REGISTER_WINDOW,
      );
      // Old or future registrations cannot resurrect a cancelled attempt after cleanup.
      if (Math.abs(now - issued) <= REGISTER_WINDOW) {
        this.sql.exec(
          "INSERT OR IGNORE INTO project_create_receipts(ticket_hash,state,issued_at) SELECT ?,'registered',? WHERE (SELECT COUNT(*) FROM project_create_receipts) < 100000",
          key,
          issued,
        );
        if (
          !this.sql
            .exec(
              "SELECT 1 FROM project_create_receipts WHERE ticket_hash=?",
              key,
            )
            .toArray().length
        )
          return Response.json(
            { error: "create-receipt-capacity" },
            { status: 503, headers: { "cache-control": "no-store" } },
          );
      }
    } else {
      this.sql.exec(
        "UPDATE project_create_receipts SET state='denied' WHERE ticket_hash=? AND state='registered'",
        key,
      );
    }
    const state =
      this.sql
        .exec<{ state: State }>(
          "SELECT state FROM project_create_receipts WHERE ticket_hash=?",
          key,
        )
        .toArray()[0]?.state ?? "unknown";
    return Response.json(
      { version: 1, ticket, state },
      { headers: { "cache-control": "no-store" } },
    );
  }

  claim(ticket: string, binding: string): boolean {
    return (
      this.sql
        .exec(
          "UPDATE project_create_receipts SET state='claimed',binding=? WHERE ticket_hash=? AND state='registered' RETURNING 1",
          binding,
          sha256Hex(ticket),
        )
        .toArray().length === 1
    );
  }

  finish(
    ticket: string,
    binding: string,
    state: "denied" | "committed",
  ): boolean {
    return (
      this.sql
        .exec(
          "UPDATE project_create_receipts SET state=? WHERE ticket_hash=? AND state='claimed' AND binding=? RETURNING 1",
          state,
          sha256Hex(ticket),
          binding,
        )
        .toArray().length === 1
    );
  }
}
