import distribution from "../../../config/agent-mcp-distribution.json" with { type: "json" };
import { agentMcpServerName } from "./agent-site.js";
import { agentSkills } from "./agent-skills.generated.js";
import { verifiedArchiveLaunchArgs } from "./mcp-bootstrap-command.js";

/** The review Skill the archive carries; its name is the installer's `--skill`. */
export const AGENT_REVIEW_SKILL = agentSkills[0];

function releaseAtLeast(version: string, first: string) {
  const have = version.split(".").map(Number);
  const need = first.split(".").map(Number);
  for (let part = 0; part < 3; part++)
    if (have[part] !== need[part]) return (have[part] ?? 0) > (need[part] ?? 0);
  return true;
}

const withReviewSkill = (command: string) =>
  `${command} --skill ${AGENT_REVIEW_SKILL.name}`;

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
    codex: { command: string; reviewCommand?: string };
    claudeCode: {
      command: string;
      windowsCommand: string;
      reviewCommand?: string;
    };
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

function verifiedArchiveInstaller(downloadUrl: string, sha256: string) {
  return [
    "node",
    ...verifiedArchiveLaunchArgs(downloadUrl, sha256).map((argument) =>
      JSON.stringify(argument),
    ),
  ].join(" ");
}

function installCommand(
  installer: string,
  origin: string,
  host: "config" | "codex",
) {
  return `${installer} --install --origin ${JSON.stringify(origin)} --host ${host}`;
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
    ? verifiedArchiveInstaller(downloadUrl, distribution.release.sha256)
    : launchText;
  const configCommand = installCommand(installer, origin, "config");
  const codexCommand = installCommand(installer, origin, "codex");
  // Immutable <=0.15.1 packages do not contain --install. Publishing a newer
  // package enables its entry point; never advertise unsupported old binaries.
  const localInstallation = releaseAtLeast(distribution.version, "0.15.2");
  const skillFor = (host: keyof typeof AGENT_REVIEW_SKILL.hosts) =>
    serveReleaseArchive &&
    releaseAtLeast(distribution.version, AGENT_REVIEW_SKILL.hosts[host]);

  return {
    format: AGENT_MCP_BOOTSTRAP_FORMAT,
    name: serverName,
    version: distribution.version,
    transport: "stdio",
    requirements: { node: distribution.node },
    installation: {
      mode: "verified-local-bundle",
      available: localInstallation,
      command: configCommand,
      note: "Install only with evidence of this conversation's actual stdio host and effective configuration. Check the launching Node first and verify the archive SHA-256 before executing. Generic installation returns a local launch object, its per-origin serverName and the exact Claude Code registration command; use hosts.codex only for a confirmed Codex host. Use the returned local launch in Cursor for a regional installation. Installation does not prove callable tools. When the user's handoff authorizes fallback, bootstrap/environment failures can use the raw HTTP Kit without Node; integrity/identity failures stop. Keep any completed installation if host loading needs another conversation.",
    },
    launch,
    hosts: {
      codex: {
        command: localInstallation
          ? codexCommand
          : `codex mcp add ${serverName} --env ANALOG_CANVAS_API_URL=${origin} -- ${launchText}`,
        ...(skillFor("codex")
          ? { reviewCommand: withReviewSkill(codexCommand) }
          : {}),
      },
      // The verified installer returns the exact `claude mcp add` command
      // for its local launch under the same name.
      claudeCode: {
        command: localInstallation
          ? configCommand
          : `claude mcp add ${serverName} --scope user --env ANALOG_CANVAS_API_URL=${origin} -- ${launchText}`,
        windowsCommand: localInstallation
          ? configCommand
          : `claude mcp add ${serverName} --scope user --env ANALOG_CANVAS_API_URL=${origin} -- cmd /c ${launchText}`,
        ...(skillFor("claudeCode")
          ? { reviewCommand: withReviewSkill(configCommand) }
          : {}),
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
