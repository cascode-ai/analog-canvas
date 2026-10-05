import { describe, expect, it, vi } from "vitest";

// Count every JSON Schema conversion made through zod in this module graph.
const conversions = vi.hoisted(() => ({ count: 0 }));
vi.mock("zod", async (importOriginal) => {
  const actual = await importOriginal<typeof import("zod")>();
  return {
    ...actual,
    z: {
      ...actual.z,
      toJSONSchema: (...args: Parameters<typeof actual.z.toJSONSchema>) => {
        conversions.count++;
        return actual.z.toJSONSchema(...args);
      },
    },
  };
});

describe("published JSON Schemas", () => {
  // The Cloudflare Worker imports both packages at startup, which has a CPU
  // limit. Converting the schemas there failed the 2026-09-30 deploy (10021).
  // Both packages load cold here, which beside a busy run outlasts 5 s.
  it(
    "are converted when the OpenAPI document is read, not when the packages load",
    { timeout: 30_000 },
    async () => {
      const adapter = await import("./index.js");
      const model = await import("@icm/model");
      expect(conversions.count).toBe(0);

      const schemas = adapter.agentCircuitOpenApi.components.schemas;
      expect(Object.keys(schemas)).toHaveLength(13);
      const converted = conversions.count;
      expect(converted).toBeGreaterThan(0);
      // Built once, then kept.
      expect(adapter.agentCircuitOpenApi.components.schemas).toBe(schemas);
      expect(adapter.agentCircuitRequestJsonSchema()).toBe(
        adapter.agentCircuitRequestJsonSchema(),
      );
      expect(conversions.count).toBe(converted);

      expect(model.circuitProjectJsonSchema()).toBe(
        model.circuitProjectJsonSchema(),
      );
      expect(conversions.count).toBe(converted + 1);
    },
  );
});
