import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  publishedMcpDeclaration,
  verifyPublishedMcpBytes,
} from "./lib/published-mcp.mjs";

const MANIFEST_PATH = "/api/agent/mcp-manifest.json";
const RETRIES = 5;
const RETRY_DELAY_MS = 2000;
const REQUEST_TIMEOUT_MS = 30_000;

const usage =
  "usage: node scripts/verify-agent-manifest.mjs <baseUrl> [--manifest-only | --require-site-archive] [--config <path>] | --asset-only [--config <path>]\n";

function sleep(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

/**
 * Deploy-time verification for the served Agent MCP bootstrap manifest.
 *
 * The manifest answering 200 proves nothing about what it advertises. It
 * pins an immutable GitHub Release asset or the serving site's exact copy.
 * Verify the release before deployment, then verify the served version,
 * digest and the actual download URL users will receive.
 */

// A missing release is a deterministic answer, not a propagation delay;
// retry only transient statuses and network errors.
const transient = (status) => status >= 500 || status === 429;

export async function fetchWithRetry(
  url,
  init,
  retryOnStatus,
  fetchImpl = fetch,
  retryDelayMs = RETRY_DELAY_MS,
) {
  let lastError;
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        ...init,
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok || !retryOnStatus(response.status)) return response;
      lastError = Object.assign(
        new Error(`${url} answered ${response.status}`),
        {
          status: response.status,
        },
      );
      try {
        await response.body?.cancel();
      } catch {
        // Cleanup must not replace the status that controls retry and fallback.
      }
    } catch (error) {
      lastError = error;
    }
    if (attempt < RETRIES) await sleep(retryDelayMs);
  }
  throw lastError;
}

export async function verifyAgentManifest({
  baseUrl,
  distribution,
  fetchImpl = fetch,
  retryDelayMs = RETRY_DELAY_MS,
  verifyAsset = true,
  requireSiteArchive = false,
}) {
  const manifestResponse = await fetchWithRetry(
    new URL(MANIFEST_PATH, baseUrl),
    { redirect: "manual" },
    transient,
    fetchImpl,
    retryDelayMs,
  );
  if (manifestResponse.status !== 200)
    throw new Error(`${MANIFEST_PATH} answered ${manifestResponse.status}`);
  const declaration = publishedMcpDeclaration(
    await manifestResponse.json(),
    new URL(baseUrl).origin,
  );
  if (requireSiteArchive && !declaration.siteArchive)
    throw new Error("Production must advertise its own pinned MCP archive");

  if (declaration.version !== distribution.version)
    throw new Error(
      `The served manifest advertises ${declaration.version} but this checkout ` +
        `declares ${distribution.version}; the domain is serving another release.`,
    );
  if (declaration.sha256 !== distribution.release.sha256)
    throw new Error(
      `The served manifest pins SHA-256 ${declaration.sha256} but this checkout ` +
        `declares ${distribution.release.sha256}; the manifest is stale.`,
    );

  if (!verifyAsset)
    return { version: declaration.version, assetUrl: declaration.url };
  const response = await fetchWithRetry(
    declaration.url,
    declaration.siteArchive ? { redirect: "manual" } : {},
    transient,
    fetchImpl,
    retryDelayMs,
  );
  return (
    await readVerifiedMcpResponse(
      response,
      declaration,
      distribution.release.tag,
      declaration.siteArchive ? "site-archive" : "download-url",
    )
  ).verification;
}

async function readVerifiedMcpResponse(
  response,
  declaration,
  tag,
  assetSource,
) {
  if (response.status !== 200) {
    const remedy = declaration.siteArchive
      ? "Stage the verified archive in the site's deployment."
      : `Create the GitHub Release for ${tag} before deploying this commit.`;
    throw new Error(
      `The declared asset ${declaration.url} answered ${response.status}; installers would fail. ${remedy}`,
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  verifyPublishedMcpBytes(bytes, declaration);
  return {
    bytes,
    verification: {
      version: declaration.version,
      assetUrl: declaration.url,
      assetStatus: response.status,
      assetSource,
    },
  };
}

async function fetchMcpAssetViaGitHubApi(
  { repository, tag, asset },
  fetchImpl,
  retryDelayMs,
) {
  const api = `https://api.github.com/repos/${repository}/releases`;
  const releaseResponse = await fetchWithRetry(
    `${api}/tags/${tag}`,
    { headers: { Accept: "application/vnd.github+json" } },
    transient,
    fetchImpl,
    retryDelayMs,
  );
  if (releaseResponse.status !== 200)
    throw new Error(`GitHub release API answered ${releaseResponse.status}`);
  const release = await releaseResponse.json();
  const matches = Array.isArray(release?.assets)
    ? release.assets.filter(
        (item) => item?.name === asset && item.state === "uploaded",
      )
    : [];
  const id = matches[0]?.id;
  if (
    release?.tag_name !== tag ||
    release.draft !== false ||
    matches.length !== 1 ||
    !Number.isSafeInteger(id) ||
    id <= 0
  )
    throw new Error(`GitHub release API did not identify ${asset} at ${tag}`);
  const response = await fetchWithRetry(
    `${api}/assets/${id}`,
    { headers: { Accept: "application/octet-stream" } },
    transient,
    fetchImpl,
    retryDelayMs,
  );
  if (response.status !== 200)
    throw new Error(`GitHub release asset API answered ${response.status}`);
  return response;
}

export async function downloadVerifiedMcp({
  distribution,
  fetchImpl = fetch,
  retryDelayMs = RETRY_DELAY_MS,
}) {
  const declaration = publishedMcpDeclaration({
    format: "analog-canvas-mcp-bootstrap-v1",
    version: distribution.version,
    distribution: {
      downloadUrl: `https://github.com/${distribution.release.repository}/releases/download/${distribution.release.tag}/${distribution.release.asset}`,
      sha256: distribution.release.sha256,
    },
  });
  let assetResponse;
  let assetSource = "download-url";
  try {
    assetResponse = await fetchWithRetry(
      declaration.url,
      {},
      transient,
      fetchImpl,
      retryDelayMs,
    );
  } catch (error) {
    // The two GitHub routes identify the same published asset. Keep refusals,
    // throttling and integrity failures visible; only a transport fault falls back.
    if (error?.status === 429) throw error;
    try {
      assetResponse = await fetchMcpAssetViaGitHubApi(
        distribution.release,
        fetchImpl,
        retryDelayMs,
      );
      assetSource = "github-api";
    } catch (apiError) {
      throw new AggregateError(
        [error, apiError],
        `Could not download the pinned MCP archive for ${distribution.version}`,
      );
    }
  }
  return readVerifiedMcpResponse(
    assetResponse,
    declaration,
    distribution.release.tag,
    assetSource,
  );
}

export async function verifyMcpAsset(options) {
  return (await downloadVerifiedMcp(options)).verification;
}

async function main(argv) {
  const base = argv[0];
  const assetOnly = base === "--asset-only";
  if (!base || (base.startsWith("--") && !assetOnly)) throw new Error(usage);
  let manifestOnly = false;
  let requireSiteArchive = false;
  let configPath = resolve(
    import.meta.dirname,
    "../config/agent-mcp-distribution.json",
  );
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === "--config" && argv[index + 1])
      configPath = resolve(argv[++index]);
    else if (argv[index] === "--manifest-only" && !assetOnly)
      manifestOnly = true;
    else if (argv[index] === "--require-site-archive" && !assetOnly)
      requireSiteArchive = true;
    else throw new Error(`${usage}unknown argument: ${argv[index]}`);
  }
  if (manifestOnly && requireSiteArchive)
    throw new Error("The site archive check must download the bytes");
  const distribution = JSON.parse(await readFile(configPath, "utf8"));
  const result = assetOnly
    ? await verifyMcpAsset({ distribution })
    : await verifyAgentManifest({
        baseUrl: base,
        distribution,
        verifyAsset: !manifestOnly,
        requireSiteArchive,
      });
  process.stdout.write(
    `Agent MCP ${result.version}: ${manifestOnly ? "served manifest matches the declaration" : `asset SHA-256 verified (${result.assetSource})`}.\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main(process.argv.slice(2));
}
