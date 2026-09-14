import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  SimulationAgentGuidance,
  type SimulationAgentGuidanceProps,
} from "./simulation-agent-guidance";

describe("Simulation Agent guidance", () => {
  it.each<[SimulationAgentGuidanceProps["status"], string]>([
    ["idle", "Connect Agent"],
    ["revoked", "Connect Agent"],
    ["expired", "Connect Agent"],
    ["creating", "Connecting Agent"],
    ["waiting-for-agent", "Waiting for Agent"],
    ["connected", "Agent connected"],
    ["working", "Agent working"],
    ["paused", "Agent paused"],
    ["offline", "Agent offline"],
    ["reconnecting", "Agent reconnecting"],
  ])(
    "reflects %s without creating a connection or announcing repeatedly",
    (status, label) => {
      const markup = renderToStaticMarkup(
        <SimulationAgentGuidance
          status={status}
          onOpen={() => {
            throw new Error("Unrequested connection");
          }}
        />,
      );
      expect(markup).toContain(label);
      expect(markup).not.toContain("aria-live");
      expect(markup).not.toContain("autofocus");
      if (status === "working") expect(markup).not.toContain("Tell your Agent");
    },
  );
});
