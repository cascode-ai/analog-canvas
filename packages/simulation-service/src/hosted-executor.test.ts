import { describe, it, expect } from "vitest";
import { createHostedExecutor } from "./hosted-executor.js";
import type { ExecutionInput } from "./service.js";
const input: ExecutionInput = {
  mode: "raw",
  netlist: "",
  testbench: "* test",
  files: [],
  inputRevision: "rev",
  environment: { profileId: "p" },
};
describe("hosted executor recovery", () => {
  it("reports unavailable capability transport as retryable, not an internal/session failure", async () => {
    const executor = createHostedExecutor(async () => {
      throw Error("offline");
    });
    await expect(executor.capabilities()).rejects.toMatchObject({
      problem: {
        code: "SIMULATION_CAPABILITIES_UNAVAILABLE",
        recovery: "retry-after",
      },
    });
  });
  it.each([
    ["simulation-not-configured", "retry-after"],
    ["prepared-environment-changed", "reprepare"],
    ["simulator-busy", "retry-after"],
  ])("classifies %s without blaming circuit input", async (code, recovery) => {
    const executor = createHostedExecutor(async () =>
      Response.json({ error: code }, { status: 503 }),
    );
    await expect(executor.execute(input, "token")).rejects.toMatchObject({
      acceptedUnknown: false,
      problem: { code, recovery },
    });
  });
});
