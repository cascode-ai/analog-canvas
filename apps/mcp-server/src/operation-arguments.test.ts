import { describe, expect, it } from "vitest";
import { simulationArguments } from "./operation-arguments.js";
import { executeOperation, toolInputSchema } from "./operations.js";

const fields = (tool: string) =>
  new Set(Object.keys((toolInputSchema(tool) as any).properties));

describe("shared simulation argument normalization", () => {
  it.each([
    [
      "simulation",
      "operation",
      { operation: "read", runId: "r" },
      { requestId: "exact-id", waitMs: 20_000, detail: "full" },
    ],
    [
      "simulation_files",
      "action",
      { action: "sync", runId: "r" },
      {
        requestId: "exact-id",
        refresh: true,
        basePath: "C:/work",
        outputPath: "C:/out",
        detail: "summary",
      },
    ],
  ] as const)(
    "preserves the %s envelope without copying input",
    (tool, key, request, outer) => {
      const flat = { ...request, ...outer };
      const wrapped = { request, ...outer };
      expect(simulationArguments(flat, fields(tool), key)).toEqual(wrapped);
      expect(simulationArguments(wrapped, fields(tool), key)).toEqual(wrapped);
      expect(flat).not.toHaveProperty("request");
    },
  );

  it("retains independent response and file detail, and the capabilities detail", () => {
    const normalize = (args: unknown) =>
      simulationArguments(args, fields("simulation_files"), "action");
    expect(
      normalize({
        operation: "read",
        path: "tb",
        detail: "mapped",
        refresh: true,
      }),
    ).toEqual({
      request: { action: "read", path: "tb", detail: "mapped" },
      refresh: true,
    });
    expect(
      normalize({
        request: { operation: "read", path: "tb", detail: "text" },
        detail: "full",
      }),
    ).toEqual({
      request: { action: "read", path: "tb", detail: "text" },
      detail: "full",
    });
    expect(
      simulationArguments(
        { request: { operation: "capabilities", detail: "full" } },
        fields("simulation"),
        "operation",
      ),
    ).toEqual({ request: { operation: "capabilities", detail: "full" } });
  });

  it.each([
    [
      "simulation_run",
      { action: "read", operation: "start" },
      ["request", "operation"],
    ],
    [
      "simulation_source",
      { request: { operation: "read", detail: "text" }, detail: "mapped" },
      ["request", "detail"],
    ],
    [
      "simulation_source",
      { request: { operation: "read", detail: "full" }, detail: "summary" },
      ["detail"],
    ],
    [
      "simulation_run",
      { operation: "read", runId: "r", waitMs: 20_001 },
      ["waitMs"],
    ],
    ["simulation_source", { operation: "list", refresh: "yes" }, ["refresh"]],
    [
      "simulation_source",
      { operation: "read", path: "tb", maxChars: 65_537 },
      ["request", "maxChars"],
    ],
  ])(
    "rejects conflicts and boundaries at %s before dispatch",
    async (tool, args, path) => {
      const result = (await executeOperation(
        tool as string,
        args,
        {} as never,
      )) as any;
      expect(result.error.code).toBe("INVALID_TOOL_INPUT");
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({ path }),
      );
    },
  );

  it("retains illegal fields for strict validation rather than dropping them", async () => {
    const result = (await executeOperation(
      "simulation_source",
      { operation: "list", secret: "not-logged", requestId: "id" },
      {} as never,
    )) as any;
    expect(result.error.code).toBe("INVALID_TOOL_INPUT");
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({ path: ["request"], code: "unrecognized_keys" }),
    );
    expect(JSON.stringify(result)).not.toContain("not-logged");
    expect(
      simulationArguments(
        { request: null, operation: "list" },
        fields("simulation_files"),
        "action",
      ),
    ).toEqual({ request: null, operation: "list" });
  });
});
