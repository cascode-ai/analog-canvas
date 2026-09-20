import type {
  Capabilities,
  ExecutionInput,
  ExecutionOutput,
} from "@icm/simulation-service";
import type { SimulationEnvironmentMetadata } from "@icm/spice-run";

export const agentNativeSource: string;
export const agentNativeProfile: string;
export function createAgentNativeExecutor(options?: {
  largeTransient?: boolean;
}): Promise<{
  capabilities: Capabilities;
  environment: SimulationEnvironmentMetadata;
  execute(input: ExecutionInput): Promise<
    ExecutionOutput["result"] & {
      rawfiles: ExecutionOutput["rawfiles"];
      executedFiles: ExecutionOutput["executedFiles"];
      cancelled: boolean;
      collectionStatus: ExecutionOutput["collectionStatus"];
    }
  >;
  close(): Promise<void>;
}>;
