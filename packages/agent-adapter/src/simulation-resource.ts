import { z } from "zod";
import {
  SimulationOperationSchema,
  SimulationReplySchema,
} from "@icm/simulation-service/contract";
import { AGENT_API_VERSION } from "./schema.js";
export const AGENT_SIMULATION_MAX_TIMEOUT_MS = 120_000;
const envelope = {
  apiVersion: z.literal(AGENT_API_VERSION),
  requestId: z.string().min(1).max(256),
};
export const AgentSimulationResourceRequestSchema = z.union(
  SimulationOperationSchema.options.map((schema) => schema.extend(envelope)),
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
export type AgentSimulationResourceRequest = z.infer<
  typeof AgentSimulationResourceRequestSchema
>;
export type AgentSimulationResourceResponse = z.infer<
  typeof AgentSimulationResourceResponseSchema
>;
export function parseAgentSimulationResourceRequest(input: unknown) {
  const parsed = AgentSimulationResourceRequestSchema.safeParse(input);
  return parsed.success
    ? { success: true as const, data: parsed.data }
    : { success: false as const };
}
