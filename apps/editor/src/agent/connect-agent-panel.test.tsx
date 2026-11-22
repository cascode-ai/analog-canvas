import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  AgentPropertiesSection,
  ConnectAgentPanel,
  agentConnectionInstructions,
  type AgentConnectionStatus,
} from "./connect-agent-panel";

function baseProps(
  overrides: Partial<Parameters<typeof ConnectAgentPanel>[0]>,
) {
  return {
    open: true,
    status: "idle" as AgentConnectionStatus,
    claimCode: null,
    claimExpiresAt: null,
    scopes: [],
    expiresAt: null,
    error: null,
    now: 0,
    onPause: vi.fn(),
    onResume: vi.fn(),
    onReconnect: vi.fn(),
    onNewConnection: vi.fn(),
    onRevoke: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

// The dialog and expanded Properties share the hand-off and session controls.
// Secrets remain props-only and are never persisted here.

describe("ConnectAgentPanel", () => {
  it("serializes claims without evaluating replacement tokens", () => {
    const claimCode = 'quote" newline\n {{origin}} $&';
    const instructions = agentConnectionInstructions(
      "https://editor.example",
      claimCode,
    );
    const claimLine = instructions
      .split("\n")
      .find((line) => line.startsWith("Claim: "))!;
    expect(JSON.parse(claimLine.slice(7))).toEqual({ claimCode });
    expect(instructions).toContain("https://editor.example/api/agent/kit");
  });
  it("keeps the handoff compact, without editing advice or a bearer token", () => {
    const instructions = agentConnectionInstructions(
      "https://editor.example",
      "claim-once",
    );
    expect(instructions).not.toMatch(/symbol IDs|pin names|raw API requests/u);
    expect(instructions).not.toMatch(/Bearer [A-Za-z0-9_-]{20,}/u);
    expect(instructions.length).toBeLessThan(1_600);
  });

  it("shows the paired adapter's release once an Agent is paired (#1844)", () => {
    const render = (
      status: AgentConnectionStatus,
      adapterVersion: string | null,
    ) =>
      renderToStaticMarkup(
        <ConnectAgentPanel {...baseProps({ status, adapterVersion })} />,
      );
    for (const status of ["connected", "paused", "reconnecting"] as const)
      expect(render(status, "0.17.83")).toContain("Agent adapter 0.17.83");
    // Nothing paired, or a release the adapter did not name.
    for (const status of ["waiting-for-agent", "revoked"] as const)
      expect(render(status, "0.17.83")).not.toContain("agent-adapter-version");
    expect(render("connected", null)).not.toContain("agent-adapter-version");
  });
  it("offers resume instead of pause while paused", () => {
    const markup = renderToStaticMarkup(
      <ConnectAgentPanel
        {...baseProps({ status: "paused", claimCode: "C1" })}
      />,
    );
    expect(markup).toContain('data-testid="agent-resume"');
    expect(markup).not.toContain('data-testid="agent-pause"');
  });

  it("offers explicit recovery while the relay is reconnecting or offline", () => {
    for (const status of ["reconnecting", "offline"] as const) {
      const markup = renderToStaticMarkup(
        <ConnectAgentPanel {...baseProps({ status })} />,
      );
      expect(markup).toContain('data-testid="agent-reconnect"');
      expect(markup).toContain('data-testid="agent-revoke"');
    }
  });

  it("offers a replacement connection while connected", () => {
    const markup = renderToStaticMarkup(
      <ConnectAgentPanel
        {...baseProps({
          status: "connected",
          claimCode: "still-valid-claim",
          claimExpiresAt: 30_000,
          expiresAt: 60_000,
        })}
      />,
    );
    expect(markup).toContain('data-testid="agent-new-connection"');
    expect(markup).toContain("New connection");
    expect(markup).toContain("still-valid-claim");
  });

  it("offers a new connection in a terminal revoked state", () => {
    const markup = renderToStaticMarkup(
      <ConnectAgentPanel
        {...baseProps({
          status: "revoked",
          claimCode: null,
        })}
      />,
    );
    expect(markup).toContain("Disconnected");
    expect(markup).not.toContain('data-testid="agent-claim"');
    expect(markup).not.toContain('data-testid="agent-revoke"');
    expect(markup).toContain('data-testid="agent-new-connection"');
  });

  it("keeps active connection management inside Properties", () => {
    const markup = renderToStaticMarkup(
      <AgentPropertiesSection
        status="connected"
        claimCode={null}
        claimExpiresAt={null}
        scopes={["circuit.snapshot", "circuit.render"]}
        expiresAt={8 * 60 * 60 * 1_000}
        error={null}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onReconnect={vi.fn()}
        onNewConnection={vi.fn()}
        onRevoke={vi.fn()}
        expanded={false}
        onToggleDetails={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(markup).toContain('data-testid="agent-properties"');
    expect(markup).toContain("Connected");
    expect(markup).toContain("Manage");
    expect(markup).toContain('data-testid="agent-pause"');
    expect(markup).not.toContain('data-testid="agent-revoke"');
  });

  it("does not expose an expired claim code", () => {
    const markup = renderToStaticMarkup(
      <ConnectAgentPanel
        {...baseProps({
          status: "waiting-for-agent",
          claimCode: "expired-claim",
          claimExpiresAt: 1,
          expiresAt: 60_000,
          now: 2,
        })}
      />,
    );
    expect(markup).toContain('data-testid="agent-claim-expired"');
    expect(markup).not.toContain('data-testid="agent-claim-code"');
    expect(markup).toContain("Connection message expired.");
    expect(markup).toContain('data-testid="agent-new-connection"');
    expect(markup).not.toContain('data-testid="agent-copy-instructions"');
  });
  it("names a trusted task and offers to stop trusting its device", () => {
    const trusted = { trustedDevice: true, onUntrustDevice: vi.fn() };
    const dialog = renderToStaticMarkup(
      <ConnectAgentPanel {...baseProps({ status: "connected", ...trusted })} />,
    );
    expect(dialog).toContain("Connected · Trusted device");
    expect(dialog).toContain('data-testid="agent-untrust-device"');
    expect(dialog).toContain("Stop trusting this device");
    // Collapsed Properties show the state; the action waits under Manage.
    const properties = (expanded: boolean) =>
      renderToStaticMarkup(
        <AgentPropertiesSection
          {...baseProps({ status: "connected", ...trusted })}
          expanded={expanded}
          onToggleDetails={vi.fn()}
          onDismiss={vi.fn()}
        />,
      );
    expect(properties(false)).toContain("Connected · Trusted device");
    expect(properties(false)).not.toContain("agent-untrust-device");
    expect(properties(true)).toContain('data-testid="agent-untrust-device"');
    // An ended task, or one approved once, has no device trust to stop.
    const ended = renderToStaticMarkup(
      <ConnectAgentPanel {...baseProps({ status: "expired", ...trusted })} />,
    );
    expect(ended).not.toContain("Trusted device");
    expect(ended).not.toContain("agent-untrust-device");
    expect(
      renderToStaticMarkup(
        <ConnectAgentPanel {...baseProps({ status: "connected" })} />,
      ),
    ).not.toContain("Trusted device");
  });
});
