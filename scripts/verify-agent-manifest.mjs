import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { publishedMcpDeclaration } from "./lib/published-mcp.mjs";

const MANIFEST_PATH = "/api/agent/mcp-manifest.json";
const RETRIES = 5;
const RETRY_DELAY_MS = 2000;
const REQUEST_TIMEOUT_MS = 30_000;

const usage =
  "usage: node scripts/verify-agent-manifest.mjs <baseUrl> [--config <path>]\n";

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

  // Range keeps the existence probe cheap when the CDN honors it; a 200 means
  // the range was ignored, and either status proves the asset exists.
  const assetResponse = await fetchWithRetry(
    declaration.url,
    { headers: { Range: "bytes=0-0" } },
    transient,
    fetchImpl,
    retryDelayMs,
  );
  if (assetResponse.status !== 200 && assetResponse.status !== 206)
    throw new Error(
      `The served manifest advertises ${declaration.url}, which answered ` +
        `${assetResponse.status}; installers would fail. Create the GitHub ` +
        `Release for ${distribution.release.tag} before deploying this commit.`,
    );
  await assetResponse.body?.cancel();
  return {
    version: declaration.version,
    assetUrl: declaration.url,
    assetStatus: assetResponse.status,
  };
}

async function main(argv) {
  const base = argv[0];
  if (!base || base.startsWith("--")) throw new Error(usage);
  let configPath = resolve(
    import.meta.dirname,
    "../config/agent-mcp-distribution.json",
  );
  for (let index = 1; index < argv.length; index += 2) {
    if (argv[index] === "--config") configPath = resolve(argv[index + 1]);
    else throw new Error(`${usage}unknown argument: ${argv[index]}`);
  }
  const distribution = JSON.parse(await readFile(configPath, "utf8"));
  const result = await verifyAgentManifest({ baseUrl: base, distribution });
  process.stdout.write(
    `Agent MCP manifest ${result.version} verified: pinned asset answers ` +
      `${result.assetStatus} and matches the declared distribution.\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main(process.argv.slice(2));
}
