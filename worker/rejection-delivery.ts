import type { SqlStorage } from "./gallery-store";

export type RejectionProviderBody = {
  from: string;
  to: string[];
  subject: string;
  text: string;
  reply_to?: string;
};
/** Durable send receipt plus a frozen provider payload; never retry beyond its 24h dedupe window. */
export async function deliverRejection(
  sql: SqlStorage,
  id: string,
  notice: RejectionProviderBody,
  now: number,
  send: (notice: RejectionProviderBody, key: string) => Promise<boolean>,
): Promise<boolean> {
  sql.exec(`CREATE TABLE IF NOT EXISTS gallery_rejection_deliveries (
    id TEXT PRIMARY KEY, payload TEXT NOT NULL, first_attempt INTEGER NOT NULL, sent INTEGER NOT NULL DEFAULT 0)`);
  sql.exec(
    "UPDATE gallery_rejection_deliveries SET payload='' WHERE first_attempt<=?",
    now - 23 * 60 * 60 * 1000,
  );
  sql.exec(
    "INSERT OR IGNORE INTO gallery_rejection_deliveries (id,payload,first_attempt) VALUES (?,?,?)",
    id,
    JSON.stringify(notice),
    now,
  );
  const row = sql
    .exec<{ payload: string; first_attempt: number; sent: number }>(
      "SELECT * FROM gallery_rejection_deliveries WHERE id=?",
      id,
    )
    .one();
  if (row.sent === 1) return true;
  if (now - row.first_attempt >= 23 * 60 * 60 * 1000) return false;
  const payload = JSON.parse(row.payload) as RejectionProviderBody;
  // An older incomplete receipt cannot safely reconstruct its provider body.
  // Keep that send unconfirmed rather than retrying the key with changed bytes.
  if (typeof payload.from !== "string" || !Array.isArray(payload.to))
    return false;
  const sent = await send(payload, "gallery-rejection/" + id);
  if (sent)
    sql.exec(
      "UPDATE gallery_rejection_deliveries SET sent=1,payload='' WHERE id=?",
      id,
    );
  return sent;
}
