import {
  AGENT_REVIEW_SKILL,
  codexSiteArchiveSetup,
  type AgentMcpBootstrapManifest,
} from "@icm/agent-adapter";
import { useRef, useState } from "react";

type CodexSetup = AgentMcpBootstrapManifest["hosts"]["codex"];

export function CodexInstallOptions() {
  const [setup, setSetup] = useState<CodexSetup | "loading" | "failed" | null>(
    null,
  );
  const [withSkill, setWithSkill] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState("");
  const commandField = useRef<HTMLTextAreaElement>(null);
  const commands = setup && typeof setup === "object" ? setup : null;
  const command =
    commands && (withSkill ? commands.reviewCommand : commands.command);

  async function toggleSetup() {
    if (commands) {
      setSetup(null);
      return;
    }
    setSetup("loading");
    setWithSkill(false);
    setCopiedCommand("");
    try {
      const response = await fetch("/api/agent/mcp-manifest.json", {
        redirect: "error",
        cache: "no-store",
      });
      if (!response.ok) throw Error("MCP manifest unavailable");
      const manifest = (await response.json()) as AgentMcpBootstrapManifest;
      setSetup(
        codexSiteArchiveSetup(window.location.origin, manifest) ?? "failed",
      );
    } catch {
      setSetup("failed");
    }
  }

  async function copyCommand() {
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      setCopiedCommand(command);
    } catch {
      commandField.current?.focus();
      commandField.current?.select();
    }
  }

  return (
    <div className="agent-claim">
      <div className="agent-controls">
        <button
          type="button"
          aria-expanded={Boolean(commands)}
          disabled={setup === "loading"}
          onClick={() => void toggleSetup()}
        >
          {setup === "loading" ? "Loading Codex setup…" : "Codex setup"}
        </button>
      </div>
      {setup === "failed" ? (
        <p className="agent-panel-error" role="alert">
          Codex setup is unavailable from this site. Try again.
        </p>
      ) : null}
      {commands ? (
        <>
          <p className="agent-connection-hint">
            Run the command on the computer with Codex. It requires Node.js 24
            or later.
          </p>
          {commands.reviewCommand ? (
            <label>
              <input
                type="checkbox"
                checked={withSkill}
                onChange={(event) => {
                  setWithSkill(event.currentTarget.checked);
                  setCopiedCommand("");
                }}
              />
              Include the Canvas review shortcut (${AGENT_REVIEW_SKILL.name})
            </label>
          ) : null}
          <textarea
            ref={commandField}
            className="agent-message"
            readOnly
            aria-label="Codex installation command"
            value={command ?? ""}
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="agent-controls">
            <button type="button" onClick={() => void copyCommand()}>
              {copiedCommand === command ? "Copied" : "Copy install command"}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
