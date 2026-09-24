import { describe, expect, it } from "vitest";

import { resolveSimulationTransport } from "./deployment-transport";

describe("simulation deployment transport", () => {
  it("uses managed transport when a hosted build explicitly requests it", () => {
    expect(resolveSimulationTransport("managed")).toBe("managed");
  });

  it("preserves direct execution for local and portable builds", () => {
    expect(resolveSimulationTransport()).toBe("direct");
    expect(resolveSimulationTransport("direct")).toBe("direct");
    expect(resolveSimulationTransport("unknown")).toBe("direct");
  });
});
