#!/usr/bin/env node
/**
 * Pick the version a failed deploy should roll back to.
 *
 * Reads `wrangler deployments list --json` on stdin, captured BEFORE the
 * deploy, and prints the id of the version serving at that moment — the one
 * a rollback restores.
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
 * The newest deployment is what is serving, and within it the version that
 * carries most traffic. Wrangler lists deployments oldest first, so they are
 * ordered here by `created_on` rather than by position: on 2026-10-08 taking
 * the list's head restored a version from a deploy two releases back.
 */
export function rollbackTargetFrom(deployments) {
  if (!Array.isArray(deployments) || deployments.length === 0) {
    return { ok: false, reason: "no deployments reported" };
  }
  // Parsed, not compared as text: wrangler's fractional seconds vary.
  const created = (deployment) => Date.parse(deployment?.created_on ?? "");
  if (deployments.some((deployment) => Number.isNaN(created(deployment)))) {
    return { ok: false, reason: "deployments carry no creation time" };
  }
  const newest = [...deployments].sort((a, b) => created(b) - created(a))[0];
  const serving = (newest?.versions ?? [])
    .map((entry) => ({
      id: entry?.version_id ?? entry?.id,
      percentage: Number(entry?.percentage ?? 0),
    }))
    .filter(({ id }) => typeof id === "string" && id.length > 0)
    .sort((a, b) => b.percentage - a.percentage)[0];
  if (!serving) {
    return { ok: false, reason: "current deployment reports no version id" };
  }
  return { ok: true, versionId: serving.id };
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
