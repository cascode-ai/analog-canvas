/**
 * Where a merge to main is released (ADR 0057).
 *
 * The route is an explicit, visible choice on the pull request, never the
 * identity of whoever merged it: a merged pull request carrying the
 * `preview` label deploys only to Preview, and every other merge to main
 * deploys straight to Production. A direct push with no pull request behind
 * it (the production-incident route in AGENTS.md) ships to Production too.
 */
export const PREVIEW_LABEL = "preview";

function labelNames(pullRequest) {
  return (pullRequest.labels ?? []).map((label) =>
    typeof label === "string" ? label : label?.name,
  );
}

/**
 * The merged pull request that produced `sha`. A squash or merge commit is
 * matched by `merge_commit_sha`; any other merged pull request containing the
 * commit is the fallback, and an open or closed-unmerged one never counts.
 */
export function mergedPullRequestFor(sha, pullRequests) {
  const merged = pullRequests.filter((pullRequest) => pullRequest.merged_at);
  return (
    merged.find((pullRequest) => pullRequest.merge_commit_sha === sha) ??
    merged[0] ??
    null
  );
}

export function releaseRoute({ sha, pullRequests }) {
  const pullRequest = mergedPullRequestFor(sha, pullRequests);
  if (!pullRequest) {
    return {
      target: "production",
      pullRequest: null,
      reason: `no merged pull request produced ${sha.slice(0, 8)}; a direct push to main ships`,
    };
  }
  if (labelNames(pullRequest).includes(PREVIEW_LABEL)) {
    return {
      target: "preview",
      pullRequest: pullRequest.number,
      reason: `#${pullRequest.number} carries the "${PREVIEW_LABEL}" label`,
    };
  }
  return {
    target: "production",
    pullRequest: pullRequest.number,
    reason: `#${pullRequest.number} has no "${PREVIEW_LABEL}" label`,
  };
}

/**
 * The pull requests GitHub associates with `sha`. Transient failures are
 * retried; a lookup that keeps failing throws, because guessing a release
 * target would either skip a release silently or ship one that was meant to
 * stay on Preview.
 */
export async function pullRequestsForCommit({
  repository,
  sha,
  token,
  fetchImpl = fetch,
  attempts = 3,
  delayMs = 2000,
}) {
  if (!/^[\w.-]+\/[\w.-]+$/u.test(repository ?? "")) {
    throw new Error(`Unexpected repository name: ${repository}`);
  }
  if (!/^[0-9a-f]{40}$/u.test(sha ?? "")) {
    throw new Error(`The release commit must be a full SHA, got ${sha}`);
  }
  const url = `https://api.github.com/repos/${repository}/commits/${sha}/pulls?per_page=100`;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: {
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      });
      if (response.ok) {
        const body = await response.json();
        if (!Array.isArray(body)) {
          throw new Error(`GitHub returned a non-list for ${url}`);
        }
        return body;
      }
      lastError = new Error(`GitHub answered ${response.status} for ${url}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
