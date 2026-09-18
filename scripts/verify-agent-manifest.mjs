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
  "usage: node scripts/verify-agent-manifest.mjs <baseUrl> [--manifest-only] [--config <path>] | --asset-only [--config <path>]\n";

function sleep(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

/**
 * Deploy-time verification for the served Agent MCP bootstrap manifest.
 *
 * The manifest answering 200 proves nothing about what it advertises. It
 * pins an immutable GitHub Release asset that only exists after Publish MCP
 * ran, so a distribution bump merged before that release serves installers a
 * 404, and a domain takeover can serve a manifest this checkout never wrote.
 * Require the pinned asset to answer with bytes, and require the served
 * version and digest to be the ones this checkout declares.
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
      lastError = new Error(`${url} answered ${response.status}`);
      await response.body?.cancel();
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
}) {
  const manifestResponse = await fetchWithRetry(
    new URL(MANIFEST_PATH, baseUrl),
    {},
    transient,
    fetchImpl,
    retryDelayMs,
  );
  if (manifestResponse.status !== 200)
    throw new Error(`${MANIFEST_PATH} answered ${manifestResponse.status}`);
  const declaration = publishedMcpDeclaration(await manifestResponse.json());

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

  if (verifyAsset)
    return verifyMcpAsset({ distribution, fetchImpl, retryDelayMs });
  return { version: declaration.version, assetUrl: declaration.url };
}

export async function verifyMcpAsset({
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
  const assetResponse = await fetchWithRetry(
    declaration.url,
    {},
    transient,
    fetchImpl,
    retryDelayMs,
  );
  if (assetResponse.status !== 200)
    throw new Error(
      `The declared asset ${declaration.url} answered ` +
        `${assetResponse.status}; installers would fail. Create the GitHub ` +
        `Release for ${distribution.release.tag} before deploying this commit.`,
    );
  verifyPublishedMcpBytes(
    Buffer.from(await assetResponse.arrayBuffer()),
    declaration,
  );
  return {
    version: declaration.version,
    assetUrl: declaration.url,
    assetStatus: assetResponse.status,
  };
}

async function main(argv) {
  const base = argv[0];
  const assetOnly = base === "--asset-only";
  if (!base || (base.startsWith("--") && !assetOnly)) throw new Error(usage);
  let manifestOnly = false;
  let configPath = resolve(
    import.meta.dirname,
    "../config/agent-mcp-distribution.json",
  );
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === "--config" && argv[index + 1])
      configPath = resolve(argv[++index]);
    else if (argv[index] === "--manifest-only" && !assetOnly)
      manifestOnly = true;
    else throw new Error(`${usage}unknown argument: ${argv[index]}`);
  }
  const distribution = JSON.parse(await readFile(configPath, "utf8"));
  const result = assetOnly
    ? await verifyMcpAsset({ distribution })
    : await verifyAgentManifest({
        baseUrl: base,
        distribution,
        verifyAsset: !manifestOnly,
      });
  process.stdout.write(
    `Agent MCP ${result.version}: ${manifestOnly ? "served manifest matches the declaration" : "published asset SHA-256 verified"}.\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main(process.argv.slice(2));
}
