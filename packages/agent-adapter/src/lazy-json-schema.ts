import { z } from "zod";

/**
 * The JSON Schema of a published contract, built on first use and kept.
 *
 * Built at import, these conversions ran inside the Cloudflare Worker's
 * startup, which has a CPU limit: the 2026-09-30 Production deploy failed
 * with "Script startup exceeded CPU time limit" (10021). Only the OpenAPI
 * document and the published artifacts read them.
 */
export function lazyJsonSchema(
  schema: z.ZodType,
): () => Record<string, unknown> {
  let built: Record<string, unknown> | undefined;
  return () =>
    (built ??= z.toJSONSchema(schema, {
      target: "draft-2020-12",
      reused: "ref",
    }) as Record<string, unknown>);
}
