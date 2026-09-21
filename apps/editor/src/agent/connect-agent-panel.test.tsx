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
  it("provides one complete golden-path lifecycle without a bearer value", () => {
    const instructions = agentConnectionInstructions(
      "https://editor.example",
      "claim-once",
    );
    expect(instructions).toContain(
      "Connect to Analog Canvas at https://editor.example",
    );
    expect(instructions).toContain("reports this exact server");
    expect(instructions).toContain(
      "No plugin installation or restart is needed",
    );
    expect(instructions).toContain('Claim: {"claimCode":"claim-once"}');
    expect(instructions).toContain(
      "https://editor.example/api/agent/mcp-manifest.json",
    );
    expect(instructions).toContain("analog-canvas://reference/quickstart");
    expect(instructions).toContain("connector resumes automatically");
    expect(instructions).toContain("https://editor.example/api/agent/kit");
    expect(instructions).toContain("do not silently switch to HTTP");
    expect(instructions).toContain("it is not MCP acceptance");
    expect(instructions).toContain("install or update using");
    expect(instructions).toContain("version-pinned package");
    expect(instructions).toContain("tools are actually callable");
    expect(instructions).toContain("tell the user once");
    expect(instructions).toContain("Do not restart it yourself");
    expect(instructions).toContain("installation is declined, blocked");
    expect(instructions).toContain("If the Claim expires during setup");
    expect(instructions).not.toMatch(/Bearer [A-Za-z0-9_-]{20,}/u);
  });

  it("renders nothing when closed", () => {
    const markup = renderToStaticMarkup(
      <ConnectAgentPanel {...baseProps({ open: false })} />,
    );
    expect(markup).toBe("");
  });

  it("offers one connection action without permission tiers in the idle state", () => {
    const markup = renderToStaticMarkup(
      <ConnectAgentPanel {...baseProps({ status: "idle" })} />,
    );
    expect(markup).toContain("Connect Agent");
    expect(markup).toContain("Not connected");
    expect(markup).toContain('data-testid="agent-connect"');
    expect(markup).not.toContain("agent-preset");
    expect(markup).not.toContain("Choose what the Agent");
  });

  it("shows an expiring connection hand-off while waiting for the Agent", () => {
    const markup = renderToStaticMarkup(
      <ConnectAgentPanel
        {...baseProps({
          status: "waiting-for-agent",
          claimCode: "CLAIM-12345",
          claimExpiresAt: 30_000,
          scopes: ["circuit.snapshot", "circuit.render"],
          expiresAt: 60_000,
          now: 0,
        })}
      />,
    );
    expect(markup).not.toContain('data-testid="agent-claim-code"');
    expect(markup).toContain('data-testid="agent-copy-instructions"');
    expect(markup).toContain('data-testid="agent-copy-text"');
    expect(markup).toContain('class="agent-connection-toolbar"');
    expect(markup).toContain("Copy message");
    expect(markup).toContain(
      "Paste this message into your Agent chat to connect.",
    );
    expect(markup).not.toContain("<details");
    expect(markup).not.toContain("technical details");
    expect(markup).not.toContain("session 1:00 remaining");
    expect(markup).toContain("Connect to Analog Canvas at http://localhost.");
    expect(markup).toContain("<textarea");
    expect(markup).toContain(
      "Claim: {&quot;claimCode&quot;:&quot;CLAIM-12345&quot;}",
    );
    expect(markup).toContain("/api/agent/mcp-manifest.json");
    expect(markup).not.toContain("MCP bootstrap manifest");
    expect(markup).toContain("CLAIM-12345");
    expect(markup).toContain("Connection code expires in 0:30");
    expect(markup).toContain(
      "Expires after 30 minutes without Agent operations or manual edits.",
    );
    expect(markup).toContain("Activity keeps the connection alive.");
    expect(markup).not.toContain("Scopes:");
    expect(markup).toContain('data-testid="agent-pause"');
    expect(markup).toContain('data-testid="agent-revoke"');
    expect(markup).toContain('aria-label="Copy connection setup"');
    // No grant presets after connecting.
    expect(markup).not.toContain('data-testid="agent-grant"');
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

  it("uses one set of actions without technical disclosures in expanded Properties", () => {
    const markup = renderToStaticMarkup(
      <AgentPropertiesSection
        {...baseProps({
          status: "connected",
          claimCode: "current-claim",
          claimExpiresAt: Date.now() + 30_000,
        })}
        expanded
        onToggleDetails={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    for (const action of [
      "copy-instructions",
      "pause",
      "new-connection",
      "revoke",
    ]) {
      expect(
        markup.match(new RegExp(`data-testid="agent-${action}"`, "gu")),
      ).toHaveLength(1);
    }
    expect(markup).not.toContain("<details");
    expect(markup).not.toContain("Scopes:");
  });
});
