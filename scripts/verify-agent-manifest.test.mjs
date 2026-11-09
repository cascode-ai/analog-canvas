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
const MIRROR_PATH = `/downloads/mcp/analog-canvas-mcp-server-${VERSION}.tgz`;

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
      const moved = request.url === "/moved-manifest";
      if (request.url === MANIFEST_PATH || moved) {
        response.statusCode = moved ? 200 : state.manifestStatus;
        if (response.statusCode === 302)
          response.setHeader("location", "/moved-manifest");
        response.setHeader("content-type", "application/json");
        response.end(
          response.statusCode === 200 ? JSON.stringify(state.manifest) : "no",
        );
        return;
      }
      if (request.url === "/asset.tgz" || request.url === MIRROR_PATH) {
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
    if (href === PINNED_URL) return fetch(`${baseUrl}/asset.tgz`, init);
    if (new URL(href).origin !== baseUrl)
      throw new Error(`Unexpected test request: ${href}`);
    return fetch(href, init);
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

  it.each([
    { kind: "pinned bytes", bytes: "asset-bytes", metadata: {}, error: null },
    {
      kind: "wrong bytes",
      bytes: "other-bytes",
      metadata: {},
      error: /bytes do not match/su,
    },
    {
      kind: "another tag",
      bytes: "asset-bytes",
      metadata: { tag_name: "mcp-v0.15.6" },
      error: /Could not download the pinned MCP archive/su,
    },
    {
      kind: "a draft",
      bytes: "asset-bytes",
      metadata: { draft: true },
      error: /Could not download the pinned MCP archive/su,
    },
    {
      kind: "no matching asset",
      bytes: "asset-bytes",
      metadata: { assets: [] },
      error: /Could not download the pinned MCP archive/su,
    },
  ])(
    "checks $kind from the GitHub release API after a download timeout",
    async ({ bytes, metadata, error }) => {
      const releaseApi = `https://api.github.com/repos/cascode-ai/analog-canvas/releases/tags/mcp-v${VERSION}`;
      const assetApi =
        "https://api.github.com/repos/cascode-ai/analog-canvas/releases/assets/42";
      let assetReads = 0;
      const fetchImpl = async (url, init) => {
        if (String(url) === PINNED_URL)
          return new Response("gateway timeout", { status: 504 });
        if (String(url) === releaseApi)
          return Response.json({
            tag_name: distribution.release.tag,
            draft: false,
            assets: [
              { id: 17, name: "another-file", state: "uploaded" },
              { id: 42, name: distribution.release.asset, state: "uploaded" },
            ],
            ...metadata,
          });
        expect(String(url)).toBe(assetApi);
        assetReads += 1;
        expect(new Headers(init.headers).get("accept")).toBe(
          "application/octet-stream",
        );
        return new Response(bytes);
      };
      const result = verifyMcpAsset({
        distribution,
        fetchImpl,
        retryDelayMs: 0,
      });
      if (!error)
        await expect(result).resolves.toMatchObject({
          version: VERSION,
          assetUrl: PINNED_URL,
          assetStatus: 200,
          assetSource: "github-api",
        });
      else await expect(result).rejects.toThrow(error);
      expect(assetReads).toBe(Object.keys(metadata).length ? 0 : 1);
    },
  );

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

  it("verifies bytes from the archive the serving site advertises", async () => {
    state = freshState();
    state.manifest.distribution.downloadUrl = baseUrl + MIRROR_PATH;
    const requests = [];
    const observed = (url, init) => {
      requests.push(String(url));
      return fetchImpl(url, init);
    };
    await expect(
      verifyAgentManifest({
        baseUrl,
        distribution,
        fetchImpl: observed,
        requireSiteArchive: true,
      }),
    ).resolves.toMatchObject({
      assetUrl: baseUrl + MIRROR_PATH,
      assetStatus: 200,
    });
    expect(requests).toEqual([baseUrl + MANIFEST_PATH, baseUrl + MIRROR_PATH]);
    state.assetBytes = "wrong archive";
    await expect(
      verifyAgentManifest({ baseUrl, distribution, fetchImpl: observed }),
    ).rejects.toThrow(/bytes do not match/su);
  });

  it("rejects the old download route when a site archive is required", async () => {
    state = freshState();
    await expect(
      verifyAgentManifest({
        baseUrl,
        distribution,
        fetchImpl,
        requireSiteArchive: true,
      }),
    ).rejects.toThrow(/must advertise its own pinned MCP archive/su);
  });

  it("refuses a redirected installation manifest", async () => {
    state = freshState();
    state.manifestStatus = 302;
    await expect(
      verifyAgentManifest({ baseUrl, distribution, fetchImpl }),
    ).rejects.toThrow(/answered 302/su);
  });

  it("keeps explicit throttling even when discarding the response fails", async () => {
    const fetchImpl = async (url) => {
      expect(String(url)).toBe(PINNED_URL);
      const response = new Response("rate limited", { status: 429 });
      response.body.getReader(); // Canceling a locked response body rejects.
      return response;
    };
    await expect(
      verifyMcpAsset({ distribution, fetchImpl, retryDelayMs: 0 }),
    ).rejects.toThrow(/answered 429/su);
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
