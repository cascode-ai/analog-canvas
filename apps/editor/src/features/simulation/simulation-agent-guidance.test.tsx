import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  SimulationAgentGuidance,
  SimulationAgentStart,
  type SimulationAgentGuidanceProps,
} from "./simulation-agent-guidance";

describe("Simulation Agent guidance", () => {
  it.each<[SimulationAgentGuidanceProps["status"], string]>([
    ["idle", "Connect Agent"],
    ["creating", "Connecting…"],
    ["waiting-for-agent", "View connection info"],
    ["connected", "Connection details"],
    ["working", "Connection details"],
    ["paused", "Connection details"],
    ["reconnecting", "Connection details"],
    ["offline", "Connection details"],
    ["revoked", "Reconnect Agent"],
    ["expired", "Reconnect Agent"],
  ])("offers the next action for %s without side effects", (status, action) => {
    const unexpected = () => {
      throw new Error("Unrequested action");
    };
    const markup = renderToStaticMarkup(
      <SimulationAgentStart
        status={status}
        onOpen={unexpected}
        onManualSetup={unexpected}
      />,
    );
    expect(markup).toContain(`>${action}</button>`);
    expect(markup).toContain("Set up manually");
    expect(markup.match(/<li>/g)).toHaveLength(3);
    expect(markup).toContain("Describe your goal");
    expect(markup).toContain("Review the results");
    expect(markup.match(/role="status"/g)).toHaveLength(1);
    expect(markup.includes('disabled=""')).toBe(status === "creating");
    expect(markup).not.toContain("autofocus");
  });
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
