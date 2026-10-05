import {
  AGENT_SESSION_PROTOCOL_VERSION,
  AgentSessionControlMessageSchema,
  type AgentSessionControlMessage,
} from "@icm/agent-adapter";

export function createHeartbeat(
  sessionId: string,
  nonce: string,
): AgentSessionControlMessage {
  return {
    protocolVersion: AGENT_SESSION_PROTOCOL_VERSION,
    sessionId,
    kind: "heartbeat",
    nonce,
  };
}

export function isHeartbeatAck(value: unknown, sessionId: string): boolean {
  const parsed = AgentSessionControlMessageSchema.safeParse(value);
  return (
    parsed.success &&
    parsed.data.sessionId === sessionId &&
    parsed.data.kind === "heartbeat-ack"
  );
}
