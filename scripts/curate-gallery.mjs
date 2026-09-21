/** Validate a visual audit by default; --apply explicitly writes metadata only. */
import { readFile, mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
const args = process.argv.slice(2);
const value = (key) => args[args.indexOf(key) + 1];
const reportPath = args.includes("--report") ? value("--report") : null;
if (!reportPath)
  throw new Error("Use --report <review.json>. Default is validation only.");
const report = JSON.parse(await readFile(reportPath, "utf8"));
const taxonomy = JSON.parse(
  await readFile(
    new URL("../config/gallery-taxonomy.json", import.meta.url),
    "utf8",
  ),
);
const knownTags = new Set(Object.values(taxonomy.tagsByGroup).flat());
const ids = new Set();
for (const item of report.entries) {
  if (
    ids.has(item.id) ||
    !item.id ||
    item.imageReviewed !== true ||
    !item.previewRevision
  )
    throw new Error(`Invalid/duplicate/unreviewed entry: ${item.id}`);
  ids.add(item.id);
  if (
    !Array.isArray(item.tags) ||
    item.tags.length > 12 ||
    item.tags.some((tag) => !knownTags.has(tag))
  )
    throw new Error(`Invalid tags: ${item.id}`);
  if (
    !Array.isArray(item.issues) ||
    item.issues.some(
      (issue) =>
        !taxonomy.issueKinds.includes(issue.kind) ||
        !issue.detail?.trim() ||
        issue.detail.length > 500,
    )
  )
    throw new Error(`Invalid findings: ${item.id}`);
}
if (ids.size !== report.total)
  throw new Error(`Incomplete review: ${ids.size}/${report.total}`);
console.log(
  JSON.stringify({
    reviewed: ids.size,
    needsAttention: report.entries.filter((e) => e.issues.length).length,
    mode: args.includes("--apply") ? "apply" : "validate-only",
  }),
);
if (args.includes("--apply")) {
  if (
    !args.includes("--origin") ||
    !args.includes("--cookie-file") ||
    !args.includes("--receipt")
  )
    throw new Error(
      "Apply requires --origin, --cookie-file and --receipt. Keep the receipt as a before/after backup.",
    );
  const origin = new URL(value("--origin")).origin;
  if (!origin.startsWith("https://") && !origin.startsWith("http://127.0.0.1:"))
    throw new Error("Use HTTPS or loopback.");
  const cookie = (await readFile(value("--cookie-file"), "utf8")).trim();
  const receipt = value("--receipt");
  await mkdir(path.dirname(receipt), { recursive: true });
  let applied = 0,
    conflicts = 0;
  for (const item of report.entries) {
    const response = await fetch(`${origin}/api/gallery/${item.id}`, {
      headers: { Cookie: cookie },
    });
    if (!response.ok)
      throw new Error(`Read failed ${item.id}: ${response.status}`);
    const { entry } = await response.json();
    const attention = item.issues.length
      ? { status: "needs-attention", issues: item.issues }
      : null;
    const matching =
      JSON.stringify(entry.tags ?? []) === JSON.stringify(item.tags) &&
      JSON.stringify(entry.attention ?? null) === JSON.stringify(attention);
    if (matching && entry.previewRevision === item.previewRevision) continue;
    if (
      entry.previewRevision !== item.previewRevision ||
      (entry.curationRevision ?? 0) !== (item.curationRevision ?? 0)
    ) {
      await appendFile(
        receipt,
        JSON.stringify({ id: item.id, status: "changed-since-review" }) + "\n",
      );
      conflicts++;
      continue;
    }
    const update = {
      tags: item.tags,
      attention,
      expectedPreviewRevision: item.previewRevision,
      expectedCurationRevision: item.curationRevision ?? 0,
      source: "visual-audit",
    };
    // Save the original metadata before attempting the write, so interrupted runs remain recoverable.
    await appendFile(
      receipt,
      JSON.stringify({
        id: item.id,
        status: "before-write",
        before: entry,
        update,
      }) + "\n",
    );
    const written = await fetch(`${origin}/api/gallery/${item.id}/curation`, {
      method: "PATCH",
      headers: {
        Cookie: cookie,
        Origin: origin,
        "content-type": "application/json",
      },
      body: JSON.stringify(update),
    });
    if (written.status === 409) {
      conflicts++;
      await appendFile(
        receipt,
        JSON.stringify({ id: item.id, status: "conflict" }) + "\n",
      );
      continue;
    }
    if (!written.ok)
      throw new Error(`Write failed ${item.id}: ${written.status}`);
    await appendFile(
      receipt,
      JSON.stringify({
        id: item.id,
        status: "applied",
        after: await written.json(),
      }) + "\n",
    );
    applied++;
  }
  console.log(JSON.stringify({ applied, conflicts }));
}
