import type {
  Capabilities,
  ExecutionInput,
  ExecutionOutput,
} from "@icm/simulation-service";

export const agentNativeSource: string;
export const agentNativeProfile: string;
export function createAgentNativeExecutor(): Promise<{
  capabilities: Capabilities;
  execute(input: ExecutionInput): Promise<
    ExecutionOutput["result"] & {
      rawfiles: ExecutionOutput["rawfiles"];
      executedFiles: ExecutionOutput["executedFiles"];
      cancelled: boolean;
    }
  >;
  close(): Promise<void>;
}>;
