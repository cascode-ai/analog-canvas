#!/usr/bin/env node
/**
 * Pick the version a failed deploy should roll back to.
 *
 * Reads `wrangler deployments list --json` on stdin and prints the id of the
 * version that was serving BEFORE the deployment at the head of the list —
 * the one a rollback restores.
 *
 * This exists as a separate script, tested offline, because it runs in the
 * one place where being wrong is expensive: the recovery path of a broken
 * deploy. A rollback that picks the wrong version, or that silently picks
 * nothing, leaves production broken while reporting that it acted.
 */

function fail(message) {
  process.stderr.write(`deploy-rollback-target: ${message}\n`);
  process.exit(1);
}

/**
 * Deployments come newest-first. The head is the deploy just made; the next
 * distinct version behind it is what was live before, and is the target.
 *
 * A deployment can carry several versions during a gradual rollout, so the
 * comparison is by version id rather than by position: taking "the second
 * entry" would pick a second slice of the SAME broken deploy when one is in
 * progress.
 */
export function rollbackTargetFrom(deployments) {
  if (!Array.isArray(deployments) || deployments.length === 0) {
    return { ok: false, reason: "no deployments reported" };
  }
  const idsOf = (deployment) =>
    (deployment?.versions ?? [])
      .map((entry) => entry?.version_id ?? entry?.id)
      .filter((id) => typeof id === "string" && id.length > 0);

  const current = new Set(idsOf(deployments[0]));
  if (current.size === 0) {
    return { ok: false, reason: "current deployment reports no version id" };
  }
  for (const deployment of deployments.slice(1)) {
    const candidate = idsOf(deployment).find((id) => !current.has(id));
    if (candidate) return { ok: true, versionId: candidate };
  }
  // A first-ever deploy has nothing behind it. Rolling back is impossible and
  // saying so is the honest outcome; the caller must not treat it as success.
  return { ok: false, reason: "no earlier version to roll back to" };
}

if (import.meta.filename === process.argv[1]) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    fail(`could not parse deployments JSON: ${String(error)}`);
  }
  const result = rollbackTargetFrom(
    Array.isArray(parsed) ? parsed : (parsed?.deployments ?? []),
  );
  if (!result.ok) fail(result.reason);
  process.stdout.write(`${result.versionId}\n`);
}
