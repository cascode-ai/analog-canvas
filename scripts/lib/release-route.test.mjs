import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { main } from "../release-route.mjs";
import {
  PREVIEW_LABEL,
  mergedPullRequestFor,
  pullRequestsForCommit,
  releaseRoute,
} from "./release-route.mjs";

const sha = "0f8ec008b05254338e3ad2f8a318756647ebf210";
const other = "c58a0ddb0000000000000000000000000000beef";

function pull(number, { merged = true, mergeSha = sha, labels = [] } = {}) {
  return {
    number,
    merged_at: merged ? "2026-09-16T21:52:00Z" : null,
    merge_commit_sha: mergeSha,
    labels: labels.map((name) => ({ name })),
  };
}

function answer(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe("release route", () => {
  it("ships an unlabeled merge straight to Production", () => {
    expect(releaseRoute({ sha, pullRequests: [pull(851)] })).toMatchObject({
      target: "production",
      pullRequest: 851,
    });
  });

  it("keeps a merge labeled preview on Preview", () => {
    const route = releaseRoute({
      sha,
      pullRequests: [pull(852, { labels: ["docs", PREVIEW_LABEL] })],
    });
    expect(route).toMatchObject({ target: "preview", pullRequest: 852 });
    expect(route.reason).toContain('"preview" label');
  });

  it("ignores similar labels", () => {
    for (const label of ["Preview", "preview-first", "previews"]) {
      expect(
        releaseRoute({ sha, pullRequests: [pull(853, { labels: [label] })] })
          .target,
      ).toBe("production");
    }
  });

  it("ships a direct push that no merged pull request produced", () => {
    expect(releaseRoute({ sha, pullRequests: [] })).toMatchObject({
      target: "production",
      pullRequest: null,
    });
    expect(
      releaseRoute({
        sha,
        pullRequests: [pull(854, { merged: false, labels: [PREVIEW_LABEL] })],
      }).target,
    ).toBe("production");
  });

  it("uses the pull request whose merge commit is the pushed commit", () => {
    const pullRequests = [
      pull(840, { mergeSha: other, labels: [PREVIEW_LABEL] }),
      pull(855, { mergeSha: sha }),
    ];
    expect(mergedPullRequestFor(sha, pullRequests)?.number).toBe(855);
    expect(releaseRoute({ sha, pullRequests }).target).toBe("production");
  });

  it("accepts plain string labels", () => {
    expect(
      releaseRoute({
        sha,
        pullRequests: [{ ...pull(856), labels: [PREVIEW_LABEL] }],
      }).target,
    ).toBe("preview");
  });
});

describe("pull request lookup", () => {
  it("asks GitHub for the commit's pull requests with the token", async () => {
    const calls = [];
    const pulls = await pullRequestsForCommit({
      repository: "cascode-ai/analog-canvas",
      sha,
      token: "secret-token",
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return answer(200, [pull(851)]);
      },
    });
    expect(pulls).toHaveLength(1);
    expect(calls[0].url).toBe(
      `https://api.github.com/repos/cascode-ai/analog-canvas/commits/${sha}/pulls?per_page=100`,
    );
    expect(calls[0].init.headers.authorization).toBe("Bearer secret-token");
  });

  it("retries transient failures", async () => {
    let calls = 0;
    const pulls = await pullRequestsForCommit({
      repository: "cascode-ai/analog-canvas",
      sha,
      delayMs: 0,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) throw new Error("socket hang up");
        if (calls === 2) return answer(502, {});
        return answer(200, []);
      },
    });
    expect(calls).toBe(3);
    expect(pulls).toEqual([]);
  });

  it("refuses to guess when the lookup keeps failing", async () => {
    await expect(
      pullRequestsForCommit({
        repository: "cascode-ai/analog-canvas",
        sha,
        delayMs: 0,
        fetchImpl: async () => answer(500, {}),
      }),
    ).rejects.toThrow("GitHub answered 500");
  });

  it("rejects malformed inputs before calling GitHub", async () => {
    const fetchImpl = async () => {
      throw new Error("must not be called");
    };
    await expect(
      pullRequestsForCommit({ repository: "x", sha, fetchImpl }),
    ).rejects.toThrow("Unexpected repository name");
    await expect(
      pullRequestsForCommit({
        repository: "cascode-ai/analog-canvas",
        sha: "main",
        fetchImpl,
      }),
    ).rejects.toThrow("full SHA");
  });
});

describe("release-route command", () => {
  let directory;
  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it("writes the target and pull request for the workflow", async () => {
    directory = await mkdtemp(join(tmpdir(), "release-route-"));
    const output = join(directory, "github-output");
    const route = await main(["--sha", sha, "--github-output"], {
      environment: {
        GITHUB_REPOSITORY: "cascode-ai/analog-canvas",
        GH_TOKEN: "t",
        GITHUB_OUTPUT: output,
      },
      fetchImpl: async () =>
        answer(200, [pull(857, { labels: [PREVIEW_LABEL] })]),
    });
    expect(route.target).toBe("preview");
    expect(await readFile(output, "utf8")).toBe(
      "target=preview\npull_request=857\n",
    );
  });

  it("fails instead of choosing a target when GitHub cannot answer", async () => {
    await expect(
      main(["--sha", sha], {
        environment: { GITHUB_REPOSITORY: "cascode-ai/analog-canvas" },
        fetchImpl: async () => answer(503, {}),
        delayMs: 0,
      }),
    ).rejects.toThrow("GitHub answered 503");
  });
});
