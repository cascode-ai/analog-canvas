import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  verifyAgentManifest,
  verifyMcpAsset,
} from "./verify-agent-manifest.mjs";

/**
 * The manifest answering 200 is the check that existed before; these tests
 * pin the part that actually protects installers: the pinned asset must
 * serve bytes, and the served declaration must be this checkout's own.
 */
const MANIFEST_PATH = "/api/agent/mcp-manifest.json";
const VERSION = "0.15.7";
const DIGEST = createHash("sha256").update("asset-bytes").digest("hex");
const PINNED_URL = `https://github.com/cascode-ai/analog-canvas/releases/download/mcp-v${VERSION}/analog-canvas-mcp-server-${VERSION}.tgz`;

const distribution = {
  schemaVersion: 1,
  name: "analog-canvas",
  version: VERSION,
  release: {
    buildPlatform: "linux",
    repository: "cascode-ai/analog-canvas",
    tag: `mcp-v${VERSION}`,
    asset: `analog-canvas-mcp-server-${VERSION}.tgz`,
    sha256: DIGEST,
  },
};

const manifest = (overrides = {}) => ({
  format: "analog-canvas-mcp-bootstrap-v1",
  name: "analog-canvas",
  version: VERSION,
  distribution: { downloadUrl: PINNED_URL, sha256: DIGEST },
  ...overrides,
});

/** A self-consistent declaration for `version` that pins its own release. */
const manifestFor = (version) => ({
  format: "analog-canvas-mcp-bootstrap-v1",
  name: "analog-canvas",
  version,
  distribution: {
    downloadUrl: `https://github.com/cascode-ai/analog-canvas/releases/download/mcp-v${version}/analog-canvas-mcp-server-${version}.tgz`,
    sha256: DIGEST,
  },
});

describe("verify-agent-manifest", () => {
  let server;
  let baseUrl;
  let state;

  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url === MANIFEST_PATH) {
        response.statusCode = state.manifestStatus;
        response.setHeader("content-type", "application/json");
        response.end(
          state.manifestStatus === 200 ? JSON.stringify(state.manifest) : "no",
        );
        return;
      }
      if (request.url === "/asset.tgz") {
        response.statusCode = state.assetStatus;
        response.end(state.assetBytes);
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  /** Route the pinned GitHub URL to the local asset so tests stay hermetic. */
  function fetchImpl(url, init) {
    const href = String(url);
    return fetch(href === PINNED_URL ? `${baseUrl}/asset.tgz` : href, init);
  }

  function freshState() {
    return {
      manifestStatus: 200,
      manifest: manifest(),
      assetStatus: 200,
      assetBytes: "asset-bytes",
    };
  }

  it("passes when the pinned asset answers and the declaration matches", async () => {
    state = freshState();
    await expect(
      verifyAgentManifest({ baseUrl, distribution, fetchImpl }),
    ).resolves.toMatchObject({
      version: VERSION,
      assetUrl: PINNED_URL,
      assetStatus: 200,
    });
  });

  it("rejects wrong archive bytes even when the server answers 200", async () => {
    state = freshState();
    state.assetBytes = "wrong archive bytes";
    await expect(
      verifyAgentManifest({ baseUrl, distribution, fetchImpl }),
    ).rejects.toThrow(/bytes do not match/su);
  });

  it("rejects a partial response instead of treating it as a complete archive", async () => {
    state = freshState();
    state.assetStatus = 206;
    await expect(verifyMcpAsset({ distribution, fetchImpl })).rejects.toThrow(
      /answered 206/su,
    );
  });

  it("checks the candidate asset before the new manifest is deployed", async () => {
    state = freshState();
    state.manifestStatus = 503;
    await expect(
      verifyMcpAsset({ distribution, fetchImpl }),
    ).resolves.toMatchObject({ version: VERSION, assetStatus: 200 });
  });

  it("checks the serving declaration without a second GitHub dependency", async () => {
    state = freshState();
    state.assetStatus = 503;
    await expect(
      verifyAgentManifest({
        baseUrl,
        distribution,
        fetchImpl,
        verifyAsset: false,
      }),
    ).resolves.toMatchObject({ version: VERSION, assetUrl: PINNED_URL });
  });

  it("fails with the release-ordering remedy when the pinned asset is missing", async () => {
    state = freshState();
    state.assetStatus = 404;
    await expect(
      verifyAgentManifest({ baseUrl, distribution, fetchImpl }),
    ).rejects.toThrow(
      new RegExp(
        `answered 404.*Create the GitHub Release for mcp-v${VERSION}`,
        "su",
      ),
    );
  });

  it("refuses a manifest advertising another version", async () => {
    state = freshState();
    state.manifest = manifestFor("0.15.6");
    await expect(
      verifyAgentManifest({ baseUrl, distribution, fetchImpl }),
    ).rejects.toThrow(/serving another release/su);
  });

  it("refuses a manifest pinning another digest", async () => {
    state = freshState();
    state.manifest = manifest();
    state.manifest.distribution.sha256 = "b".repeat(64);
    await expect(
      verifyAgentManifest({ baseUrl, distribution, fetchImpl }),
    ).rejects.toThrow(/manifest is stale/su);
  });

  it("retries a transient manifest failure and succeeds", async () => {
    state = freshState();
    let manifestAttempts = 0;
    const flakyFetch = async (url, init) => {
      if (String(url).endsWith(MANIFEST_PATH) && manifestAttempts === 0) {
        manifestAttempts += 1;
        return new Response("no", { status: 503 });
      }
      return fetchImpl(url, init);
    };
    await expect(
      verifyAgentManifest({
        baseUrl,
        distribution,
        fetchImpl: flakyFetch,
        retryDelayMs: 1,
      }),
    ).resolves.toMatchObject({ version: VERSION });
    expect(manifestAttempts).toBe(1);
  });

  it("does not retry a deterministic manifest 404", async () => {
    state = freshState();
    state.manifestStatus = 404;
    let manifestAttempts = 0;
    const countingFetch = async (url, init) => {
      if (String(url).endsWith(MANIFEST_PATH)) manifestAttempts += 1;
      return fetchImpl(url, init);
    };
    await expect(
      verifyAgentManifest({
        baseUrl,
        distribution,
        fetchImpl: countingFetch,
        retryDelayMs: 1,
      }),
    ).rejects.toThrow(/answered 404/su);
    expect(manifestAttempts).toBe(1);
  });
});
