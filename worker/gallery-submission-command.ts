import type { DurableObjectStateLike } from "./gallery-store";
import { publicationResultText } from "./gallery-publication-command";

export type SubmissionReceipt = {
  userId: string;
  scope: string;
  commandId: string;
  binding: string;
};

/** New objects and their immutable retry results commit together. */
export function submissionCommand(
  state: DurableObjectStateLike,
  receipt: SubmissionReceipt,
  apply: () => Response,
): Response {
  const sql = state.storage.sql;
  sql.exec(`CREATE TABLE IF NOT EXISTS gallery_submission_commands (
    user_id TEXT NOT NULL, scope TEXT NOT NULL, command_id TEXT NOT NULL, binding TEXT NOT NULL,
    status INTEGER NOT NULL, result TEXT NOT NULL,
    PRIMARY KEY(user_id, scope, command_id))`);
  return state.storage.transactionSync(() => {
    const previous = sql
      .exec<{ binding: string; status: number; result: string }>(
        "SELECT binding,status,result FROM gallery_submission_commands WHERE user_id=? AND scope=? AND command_id=?",
        receipt.userId,
        receipt.scope,
        receipt.commandId,
      )
      .toArray()[0];
    if (previous) {
      if (previous.binding !== receipt.binding)
        return Response.json({ error: "command-reused" }, { status: 409 });
      return new Response(previous.result, {
        status: previous.status,
        headers: { "content-type": "application/json" },
      });
    }
    const response = apply();
    if (!response.ok) return response;
    const result = publicationResultText(response);
    if (result === undefined)
      throw new Error("Submission result must be recorded before commit");
    sql.exec(
      "INSERT INTO gallery_submission_commands VALUES (?,?,?,?,?,?)",
      receipt.userId,
      receipt.scope,
      receipt.commandId,
      receipt.binding,
      response.status,
      result,
    );
    return response;
  });
}
