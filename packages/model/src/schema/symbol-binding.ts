import { z } from "zod";

import { StableIdSchema } from "./common.js";

/**
 * One stable native terminal drawn by one graphical pin of custom artwork,
 * or taken as the `VDD`/`VSS` property supply. Shared by source-backed
 * `circuitBinding` and a Cell's custom block artwork.
 */
export const SymbolTerminalMappingSchema = z.union([
  z.strictObject({
    terminalId: StableIdSchema,
    pinName: z.string().min(1),
  }),
  z.strictObject({
    terminalId: StableIdSchema,
    supply: z.enum(["VDD", "VSS"]),
  }),
]);
export type SymbolTerminalMapping = z.infer<typeof SymbolTerminalMappingSchema>;
