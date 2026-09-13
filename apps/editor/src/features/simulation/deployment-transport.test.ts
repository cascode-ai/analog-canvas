import { describe, expect, it } from "vitest";

import { resolveSimulationTransport } from "./deployment-transport";

describe("simulation deployment transport", () => {
  it("uses the promoted managed service on both hosted channels", () => {
    expect(resolveSimulationTransport("production", "managed")).toBe("managed");
    expect(resolveSimulationTransport("preview", "managed")).toBe("managed");
  });

  it("preserves direct execution for local and portable builds", () => {
    expect(resolveSimulationTransport("production")).toBe("direct");
    expect(resolveSimulationTransport("production", "direct")).toBe("direct");
    expect(resolveSimulationTransport("preview", "direct")).toBe("direct");
  });

  it("retains preview discovery without enabling unconfigured production resources", () => {
    expect(resolveSimulationTransport("preview")).toBe("managed");
    expect(resolveSimulationTransport("production", "unknown")).toBe("direct");
  });
});
