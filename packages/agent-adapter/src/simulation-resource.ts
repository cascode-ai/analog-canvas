import { z } from "zod";
import {
  SimulationOperationSchema,
  SimulationReplySchema,
  type SimulationOperation,
} from "@icm/simulation-service/contract";
import { AGENT_API_VERSION } from "./schema.js";
export const AGENT_SIMULATION_MAX_TIMEOUT_MS = 120_000;
export const AGENT_SIMULATION_READ_WAIT_MAX_MS = 20_000;
const envelope = {
  apiVersion: z.literal(AGENT_API_VERSION),
  requestId: z.string().min(1).max(256),
};
export const AgentSimulationResourceRequestSchema = z.union(
  SimulationOperationSchema.options.map((schema) =>
    ["read", "run", "start"].includes(schema.shape.operation.value)
      ? schema.extend({
          ...envelope,
          waitMs: z
            .number()
            .int()
            .min(0)
            .max(AGENT_SIMULATION_READ_WAIT_MAX_MS)
            .optional(),
        })
      : schema.extend(envelope),
  ),
);
export const AgentSimulationResourceResponseSchema = z.union(
  SimulationReplySchema.options.map((schema) =>
    schema.extend({ ...envelope, operation: z.string() }),
  ),
);
export const AgentSimulationResourceRequestJsonSchema = z.toJSONSchema(
  AgentSimulationResourceRequestSchema,
  { target: "draft-2020-12", reused: "ref" },
);
export const AgentSimulationResourceResponseJsonSchema = z.toJSONSchema(
  AgentSimulationResourceResponseSchema,
  { target: "draft-2020-12", reused: "ref" },
);
type AgentSimulationRequestEnvelope = {
  apiVersion: typeof AGENT_API_VERSION;
  requestId: string;
};
type SimulationWaitableOperation = Extract<
  SimulationOperation,
  { operation: "read" | "run" | "start" }
>;
export type AgentSimulationResourceRequest =
  | (Exclude<SimulationOperation, SimulationWaitableOperation> &
      AgentSimulationRequestEnvelope)
  | (SimulationWaitableOperation &
      AgentSimulationRequestEnvelope & { waitMs?: number });
export type AgentSimulationResourceResponse = z.infer<
  typeof AgentSimulationResourceResponseSchema
>;
export function parseAgentSimulationResourceRequest(input: unknown) {
  const parsed = AgentSimulationResourceRequestSchema.safeParse(input);
  return parsed.success
    ? {
        success: true as const,
        data: parsed.data as AgentSimulationResourceRequest,
      }
    : { success: false as const };
}
