import distribution from "../../../config/agent-mcp-distribution.json" with { type: "json" };
import { agentMcpServerName } from "./agent-site.js";
import { verifiedArchiveLaunchArgs } from "./mcp-bootstrap-command.js";

export const AGENT_MCP_BOOTSTRAP_FORMAT = "analog-canvas-mcp-bootstrap-v1";
// Packaging injects only the version. Embedding the full distribution object
// would embed this archive's own SHA-256 and make release hashing circular.
declare const __ANALOG_CANVAS_MCP_VERSION__: string | undefined;
export const AGENT_MCP_VERSION =
  typeof __ANALOG_CANVAS_MCP_VERSION__ !== "undefined"
    ? __ANALOG_CANVAS_MCP_VERSION__
    : distribution.version;

export interface AgentMcpBootstrapManifest {
  format: typeof AGENT_MCP_BOOTSTRAP_FORMAT;
  name: string;
  version: string;
  transport: "stdio";
  requirements: { node: string };
  installation: {
    mode: "verified-local-bundle";
    available: boolean;
    command: string;
    note: string;
  };
  launch: {
    command: "npx";
    args: readonly string[];
    env: { ANALOG_CANVAS_API_URL: string };
  };
  hosts: {
    codex: { command: string };
    claudeCode: { command: string; windowsCommand: string };
    cursor: {
      config: {
        mcpServers: Record<
          string,
          {
            command: string;
            args: readonly string[];
            env: { ANALOG_CANVAS_API_URL: string };
          }
        >;
      };
    };
  };
  distribution: {
    packageName: string;
    npmPublished: boolean;
    downloadUrl: string;
    sha256: string;
  };
  documentationUrl: string;
  fallback: {
    kitUrl: string;
    openApiUrl: string;
  };
}

export function agentMcpBootstrapManifest(
  publicOrigin: string,
  serveReleaseArchive = false,
): AgentMcpBootstrapManifest {
  const origin = publicOrigin.replace(/\/$/u, "");
  // Every host registers each site under its own name, as the installer does.
  const serverName = agentMcpServerName(origin);
  const releaseBase = `https://github.com/${distribution.release.repository}/releases/download/${distribution.release.tag}`;
  const githubUrl = `${releaseBase}/${distribution.release.asset}`;
  const downloadUrl = serveReleaseArchive
    ? `${origin}/downloads/mcp/${distribution.release.asset}`
    : githubUrl;
  // Legacy persistent launch entries must still resolve their pinned versions
  // after the regional site installs a newer release.
  const launchArgs = distribution.npmPublished
    ? ["--yes", `${distribution.packageName}@${distribution.version}`]
    : ["--yes", `--package=${githubUrl}`, distribution.binaryName];
  const launchText = ["npx", ...launchArgs].join(" ");
  const launch = {
    command: "npx",
    args: launchArgs,
    env: { ANALOG_CANVAS_API_URL: origin },
  } as const;
  const installer = serveReleaseArchive
    ? [
        "node",
        ...verifiedArchiveLaunchArgs(
          downloadUrl,
          distribution.release.sha256,
        ).map((argument) => JSON.stringify(argument)),
      ].join(" ")
    : launchText;
  const installCommand = (host: "config" | "codex") =>
    `${installer} --install --origin ${JSON.stringify(origin)} --host ${host}`;
  // Immutable <=0.15.1 packages do not contain --install. Publishing a newer
  // package enables its entry point; never advertise unsupported old binaries.
  const [major = 0, minor = 0, patch = 0] = distribution.version
    .split(".")
    .map(Number);
  const localInstallation =
    major > 0 || minor > 15 || (minor === 15 && patch >= 2);

  return {
    format: AGENT_MCP_BOOTSTRAP_FORMAT,
    name: serverName,
    version: distribution.version,
    transport: "stdio",
    requirements: { node: distribution.node },
    installation: {
      mode: "verified-local-bundle",
      available: localInstallation,
      command: installCommand("config"),
      note: "Install only with evidence of this conversation's actual stdio host and effective configuration. Check the launching Node first and verify the archive SHA-256 before executing. Generic installation returns a local launch object, its per-origin serverName and the exact Claude Code registration command; use hosts.codex only for a confirmed Codex host. Use the returned local launch in Cursor for a regional installation. Installation does not prove callable tools. When the user's handoff authorizes fallback, bootstrap/environment failures can use the raw HTTP Kit without Node; integrity/identity failures stop. Keep any completed installation if host loading needs another conversation.",
    },
    launch,
    hosts: {
      codex: {
        command: localInstallation
          ? installCommand("codex")
          : `codex mcp add ${serverName} --env ANALOG_CANVAS_API_URL=${origin} -- ${launchText}`,
      },
      // The verified installer returns the exact `claude mcp add` command
      // for its local launch under the same name.
      claudeCode: {
        command: localInstallation
          ? installCommand("config")
          : `claude mcp add ${serverName} --scope user --env ANALOG_CANVAS_API_URL=${origin} -- ${launchText}`,
        windowsCommand: localInstallation
          ? installCommand("config")
          : `claude mcp add ${serverName} --scope user --env ANALOG_CANVAS_API_URL=${origin} -- cmd /c ${launchText}`,
      },
      cursor: {
        config: {
          mcpServers: {
            [serverName]: launch,
          },
        },
      },
    },
    distribution: {
      packageName: distribution.packageName,
      npmPublished: distribution.npmPublished,
      downloadUrl,
      sha256: distribution.release.sha256,
    },
    documentationUrl: `https://github.com/${distribution.release.repository}/blob/main/docs/agent/mcp-install.md`,
    fallback: {
      kitUrl: `${origin}/api/agent/kit`,
      openApiUrl: `${origin}/api/agent/openapi.json`,
    },
  };
}
