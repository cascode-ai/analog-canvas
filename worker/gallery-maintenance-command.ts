import type { DurableObjectStateLike, SqlStorage } from "./gallery-store";
import {
  publicationFingerprint,
  publicationResultText,
} from "./gallery-publication-command";
import { recycleDuplicates } from "./gallery-store-moderation";
import { queueSimulationChecks } from "./gallery-store-simulation-checks";
import { sha256Hex } from "@icm/derived";

export function maintenanceState(sql: SqlStorage, command: any): string {
  return command.kind === "duplicates"
    ? sha256Hex(
        JSON.stringify(
          [command.body.keep, ...command.body.remove].map(
            (ref: { id: string }) => publicationFingerprint(sql, ref.id),
          ),
        ),
      )
    : "accepted";
}

/** A queued check is an accepted intent, never a simulation replay on HTTP retry. */
export function maintenanceCommand(
  state: DurableObjectStateLike,
  body: Record<string, any>,
): Response {
  const sql = state.storage.sql;
  sql.exec(`CREATE TABLE IF NOT EXISTS gallery_maintenance_commands (
    user_id TEXT NOT NULL, command_id TEXT NOT NULL, binding TEXT NOT NULL,
    state TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(user_id,command_id))`);
  const command = body.command;
  const fingerprint = () => maintenanceState(sql, command);
  return state.storage.transactionSync(() => {
    const previous = sql
      .exec<{ binding: string; state: string; result: string }>(
        "SELECT binding,state,result FROM gallery_maintenance_commands WHERE user_id=? AND command_id=?",
        body.actor.id,
        command.commandId,
      )
      .toArray()[0];
    const response = (result: string, witness: string) =>
      new Response(result, {
        headers: {
          "content-type": "application/json",
          "x-canvas-maintenance-state": witness,
        },
      });
    if (previous) {
      if (previous.binding !== body.binding)
        return Response.json({ error: "command-reused" }, { status: 409 });
      if (previous.state !== fingerprint())
        return Response.json({ error: "action-superseded" }, { status: 409 });
      return response(previous.result, previous.state);
    }
    if (
      sql
        .exec<{ n: number }>(
          "SELECT COUNT(*) AS n FROM gallery_maintenance_commands WHERE user_id=?",
          body.actor.id,
        )
        .one().n >= 10000
    )
      return Response.json({ error: "command-receipts-full" }, { status: 503 });
    const input = {
      ...command.body,
      at: body.at,
      reviewerId: body.actor.id,
      requestedBy: body.actor.id,
    };
    const result =
      command.kind === "duplicates"
        ? recycleDuplicates(state, input)
        : queueSimulationChecks(state, input);
    if (!result.ok) return result;
    const text = publicationResultText(result);
    if (text === undefined) throw new Error("Unrecordable maintenance result");
    const witness = fingerprint();
    sql.exec(
      "INSERT INTO gallery_maintenance_commands VALUES (?,?,?,?,?)",
      body.actor.id,
      command.commandId,
      body.binding,
      witness,
      text,
    );
    return response(text, witness);
  });
}
