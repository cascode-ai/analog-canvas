import distribution from "../../../config/agent-mcp-distribution.json" with { type: "json" };

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
): AgentMcpBootstrapManifest {
  const origin = publicOrigin.replace(/\/$/u, "");
  const releaseBase = `https://github.com/${distribution.release.repository}/releases/download/${distribution.release.tag}`;
  const downloadUrl = `${releaseBase}/${distribution.release.asset}`;
  const packageSpec = distribution.npmPublished
    ? `${distribution.packageName}@${distribution.version}`
    : downloadUrl;
  const launchArgs = distribution.npmPublished
    ? ["--yes", packageSpec]
    : ["--yes", `--package=${packageSpec}`, distribution.binaryName];
  const launchText = ["npx", ...launchArgs].join(" ");
  // Immutable <=0.15.1 packages do not contain --install. Publishing a newer
  // package enables its entry point; never advertise unsupported old binaries.
  const [major = 0, minor = 0, patch = 0] = distribution.version
    .split(".")
    .map(Number);
  const localInstallation =
    major > 0 || minor > 15 || (minor === 15 && patch >= 2);

  return {
    format: AGENT_MCP_BOOTSTRAP_FORMAT,
    name: distribution.name,
    version: distribution.version,
    transport: "stdio",
    requirements: { node: distribution.node },
    installation: {
      mode: "verified-local-bundle",
      available: localInstallation,
      command: `${launchText} --install --origin ${JSON.stringify(origin)} --host codex`,
      note: "One-time installation only. Verify the release SHA-256 before executing its bundle. For other hosts use --host config and copy the returned local launch object. The legacy npx launch is not recommended for steady-state host startup. Installation does not prove tools are loaded in the current conversation.",
    },
    launch: {
      command: "npx",
      args: launchArgs,
      env: { ANALOG_CANVAS_API_URL: origin },
    },
    hosts: {
      codex: {
        command: localInstallation
          ? `${launchText} --install --origin ${JSON.stringify(origin)} --host codex`
          : `codex mcp add ${distribution.name} --env ANALOG_CANVAS_API_URL=${origin} -- ${launchText}`,
      },
      claudeCode: {
        command: localInstallation
          ? `${launchText} --install --origin ${JSON.stringify(origin)} --host config`
          : `claude mcp add ${distribution.name} --scope user --env ANALOG_CANVAS_API_URL=${origin} -- ${launchText}`,
        windowsCommand: localInstallation
          ? `${launchText} --install --origin ${JSON.stringify(origin)} --host config`
          : `claude mcp add ${distribution.name} --scope user --env ANALOG_CANVAS_API_URL=${origin} -- cmd /c ${launchText}`,
      },
      cursor: {
        config: {
          mcpServers: {
            [distribution.name]: {
              command: "npx",
              args: launchArgs,
              env: { ANALOG_CANVAS_API_URL: origin },
            },
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
