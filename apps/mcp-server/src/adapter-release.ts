/**
 * Whether this adapter is the latest release its origin's MCP manifest
 * names (#1844). A manifest read is kept for the session; an unreadable one
 * leaves the release unknown, is retried by the next network read and
 * never fails the call that asked.
 */

const MCP_MANIFEST_PATH = "/api/agent/mcp-manifest.json";

export interface AdapterRelease {
  latestVersion: string;
  outdated: boolean;
  /** Present only when outdated: the manifest's own upgrade step. */
  upgrade?: {
    manifestUrl: string;
    /** The manifest's per-host installation commands, verbatim. */
    hosts?: { codex: string; claudeCode: string };
    note?: string;
  };
  message?: string;
}

interface ManifestSource {
  readonly apiBaseUrl: string;
  mcpManifest(): Promise<unknown>;
}

interface ManifestRead {
  read: Promise<unknown>;
  settled?: { value: unknown };
}

const reads = new WeakMap<ManifestSource, ManifestRead>();

/**
 * The session's MCP manifest, or null when unreadable. `network: false`
 * starts no read and answers only what an earlier read already returned.
 */
export function sessionMcpManifest(
  client: ManifestSource,
  network: boolean,
): Promise<unknown> {
  let entry = reads.get(client);
  if (!entry) {
    // A local workspace has no origin to publish a release.
    if (!network || !/^https?:/u.test(client.apiBaseUrl))
      return Promise.resolve(null);
    const created: ManifestRead = {
      read: client.mcpManifest().then(
        (value) => {
          created.settled = { value };
          return value;
        },
        () => {
          // Unreadable this time: the next network read tries again.
          if (reads.get(client) === created) reads.delete(client);
          return null;
        },
      ),
    };
    reads.set(client, created);
    entry = created;
  }
  return network ? entry.read : Promise.resolve(entry.settled?.value ?? null);
}

export function mcpManifestUrl(apiBaseUrl: string): string {
  return `${apiBaseUrl.replace(/\/+$/u, "")}${MCP_MANIFEST_PATH}`;
}

function semver(value: unknown): [number, number, number] | null {
  const match =
    typeof value === "string" ? /^(\d+)\.(\d+)\.(\d+)$/u.exec(value) : null;
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function olderThan(
  local: [number, number, number],
  latest: [number, number, number],
): boolean {
  for (let part = 0; part < 3; part += 1)
    if (local[part] !== latest[part]) return local[part]! < latest[part]!;
  return false;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * How `localVersion` stands against the manifest's release, compared as
 * semantic versions; null when either version is unreadable.
 */
export function adapterRelease(
  localVersion: string,
  manifest: unknown,
  manifestUrl: string,
): AdapterRelease | null {
  const declared = manifest as {
    version?: unknown;
    installation?: { note?: unknown };
    hosts?: {
      codex?: { command?: unknown };
      claudeCode?: { command?: unknown };
    };
  } | null;
  const local = semver(localVersion);
  const latest = semver(declared?.version);
  if (!local || !latest) return null;
  const latestVersion = declared!.version as string;
  if (!olderThan(local, latest)) return { latestVersion, outdated: false };
  const codex = text(declared?.hosts?.codex?.command);
  const claudeCode = text(declared?.hosts?.claudeCode?.command);
  const note = text(declared?.installation?.note);
  return {
    latestVersion,
    outdated: true,
    upgrade: {
      manifestUrl,
      ...(codex && claudeCode ? { hosts: { codex, claudeCode } } : {}),
      ...(note ? { note } : {}),
    },
    message: `This adapter (${localVersion}) is older than the latest release (${latestVersion}). Upgrade with ${codex && claudeCode ? "upgrade.hosts (codex for Codex, claudeCode for any other host)" : "the installation in upgrade.manifestUrl"}; the host then reloads the adapter, which may need the user's restart or a new conversation. Supported operations remain available.`,
  };
}
