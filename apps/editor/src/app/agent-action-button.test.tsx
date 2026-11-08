import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentActionButton } from "./agent-action-button";

function render(presence: "connected" | "lost" | null): string {
  return renderToStaticMarkup(
    <AgentActionButton
      action={{ label: "Manage Agent", presence, execute: () => {} }}
    />,
  );
}

describe("the Agent button", () => {
  it("carries no mark for an Agent never connected", () => {
    const markup = render(null);
    expect(markup).toContain('aria-label="Agent"');
    expect(markup).toContain('title="Manage Agent"');
    expect(markup).not.toContain("app-action-agent-presence");
  });

  it("marks a connected Agent green and says so", () => {
    const markup = render("connected");
    expect(markup).toContain('aria-label="Agent connected"');
    expect(markup).toContain('title="Manage Agent · Agent connected"');
    expect(markup).toMatch(
      /class="app-action-agent-presence connected" aria-hidden="true"/u,
    );
  });

  it("marks a lost Agent yellow and says so", () => {
    const markup = render("lost");
    expect(markup).toContain('aria-label="Agent disconnected"');
    expect(markup).toMatch(
      /class="app-action-agent-presence lost" aria-hidden="true"/u,
    );
  });
});
