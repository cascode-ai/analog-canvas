/** Validate a visual audit by default; --apply explicitly writes metadata only. */
import { readFile, mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
const args = process.argv.slice(2);
const value = (key) => {
  const index = args.indexOf(key);
  if (index < 0) return undefined;
  const next = args[index + 1];
  if (!next || next.startsWith("--"))
    throw new Error(`Missing value for ${key}.`);
  return next;
};
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
  const hasTags = Array.isArray(item.tags);
  const hasAddTags = Array.isArray(item.addTags);
  if (hasTags === hasAddTags)
    throw new Error(`Specify either tags or addTags: ${item.id}`);
  const checkedTags = hasTags ? item.tags : item.addTags;
  if (
    checkedTags.length > 12 ||
    (hasAddTags && checkedTags.length === 0) ||
    new Set(checkedTags).size !== checkedTags.length ||
    checkedTags.some((tag) => !knownTags.has(tag))
  )
    throw new Error(`Invalid tags: ${item.id}`);
  if (item.preserveAttention === true) {
    if (
      item.issues !== undefined &&
      (!Array.isArray(item.issues) || item.issues.length > 0)
    )
      throw new Error(`Invalid findings: ${item.id}`);
  } else if (
    !Array.isArray(item.issues) ||
    item.issues.some(
      (issue) =>
        !taxonomy.issueKinds.includes(issue.kind) ||
        !issue.detail?.trim() ||
        issue.detail.length > 500,
    )
  ) {
    throw new Error(`Invalid findings: ${item.id}`);
  }
}
if (ids.size !== report.total)
  throw new Error(`Incomplete review: ${ids.size}/${report.total}`);
console.log(
  JSON.stringify({
    reviewed: ids.size,
    needsAttention: report.entries.filter(
      (e) => e.preserveAttention !== true && (e.issues?.length ?? 0) > 0,
    ).length,
    mode: args.includes("--apply") ? "apply" : "validate-only",
  }),
);
if (args.includes("--apply")) {
  const cookieFile = args.includes("--cookie-file")
    ? value("--cookie-file")
    : null;
  const tokenFile = args.includes("--token-file")
    ? value("--token-file")
    : null;
  const inlineToken = args.includes("--token") ? value("--token") : null;
  if (cookieFile && (tokenFile || inlineToken))
    throw new Error(
      "Use either --cookie-file or --token/--token-file, not both.",
    );
  const explicitToken = inlineToken
    ? inlineToken.trim()
    : tokenFile
      ? (await readFile(tokenFile, "utf8")).trim()
      : null;
  const envToken =
    !cookieFile && !explicitToken
      ? process.env.ANALOG_CANVAS_OWNER_TOKEN?.trim() || null
      : null;
  const token = explicitToken || envToken;
  const originArg = args.includes("--origin") ? value("--origin") : null;
  const receipt = args.includes("--receipt") ? value("--receipt") : null;
  if (!originArg || (!cookieFile && !token) || !receipt)
    throw new Error(
      "Apply requires --origin, --receipt, and either --cookie-file or --token / --token-file / ANALOG_CANVAS_OWNER_TOKEN. Keep the receipt as a before/after backup.",
    );
  const origin = new URL(originArg).origin;
  if (!origin.startsWith("https://") && !origin.startsWith("http://127.0.0.1:"))
    throw new Error("Use HTTPS or loopback.");
  const cookie = cookieFile
    ? (await readFile(cookieFile, "utf8")).trim()
    : null;
  const authHeaders = token
    ? { Authorization: `Bearer ${token}` }
    : { Cookie: cookie, Origin: origin };
  const concurrencyRaw = args.includes("--concurrency")
    ? Number(value("--concurrency"))
    : 1;
  const concurrency = Math.max(
    1,
    Math.min(
      10,
      Number.isFinite(concurrencyRaw) ? Math.floor(concurrencyRaw) : 1,
    ),
  );
  await mkdir(path.dirname(receipt), { recursive: true });
  let receiptChain = Promise.resolve();
  const logReceipt = (record) => {
    receiptChain = receiptChain.then(() =>
      appendFile(receipt, JSON.stringify(record) + "\n"),
    );
    return receiptChain;
  };
  let applied = 0,
    skipped = 0,
    conflicts = 0;
  let cursor = 0;
  let failure = null;
  const worker = async () => {
    while (!failure && cursor < report.entries.length) {
      const item = report.entries[cursor++];
      try {
        const response = await fetch(
          `${origin}/api/gallery/${item.id}?summary=1`,
          {
            headers: cookie ? { Cookie: cookie } : {},
          },
        );
        if (!response.ok)
          throw new Error(`Read failed ${item.id}: ${response.status}`);
        const { entry } = await response.json();
        const existingTags = Array.isArray(entry.tags) ? entry.tags : [];
        let nextTags;
        if (Array.isArray(item.addTags)) {
          const toAdd = item.addTags.filter(
            (tag) => !existingTags.includes(tag),
          );
          if (existingTags.length + toAdd.length > 12) {
            await logReceipt({
              id: item.id,
              status: "tags-full",
              existingCount: existingTags.length,
              addCount: toAdd.length,
            });
            conflicts++;
            continue;
          }
          nextTags =
            toAdd.length === 0 ? existingTags : [...existingTags, ...toAdd];
        } else {
          nextTags = item.tags;
        }
        const preserveAttention = item.preserveAttention === true;
        const attention = preserveAttention
          ? undefined
          : item.issues.length
            ? { status: "needs-attention", issues: item.issues }
            : null;
        const tagsMatch =
          JSON.stringify(existingTags) === JSON.stringify(nextTags);
        const attentionMatch =
          preserveAttention ||
          JSON.stringify(entry.attention ?? null) === JSON.stringify(attention);
        if (
          tagsMatch &&
          attentionMatch &&
          entry.previewRevision === item.previewRevision
        ) {
          skipped++;
          continue;
        }
        const additiveTagOnly =
          Array.isArray(item.addTags) && preserveAttention;
        const expectedRevision = additiveTagOnly
          ? (item.curationRevision ?? entry.curationRevision ?? 0)
          : (item.curationRevision ?? 0);
        if (
          entry.previewRevision !== item.previewRevision ||
          (entry.curationRevision ?? 0) !== expectedRevision
        ) {
          await logReceipt({ id: item.id, status: "changed-since-review" });
          conflicts++;
          continue;
        }
        const update = {
          tags: nextTags,
          ...(preserveAttention ? {} : { attention }),
          expectedPreviewRevision: item.previewRevision,
          expectedCurationRevision: expectedRevision,
          source: "visual-audit",
        };
        // Save the original metadata before attempting the write, so interrupted runs remain recoverable.
        await logReceipt({
          id: item.id,
          status: "before-write",
          before: entry,
          update,
        });
        const written = await fetch(
          `${origin}/api/gallery/${item.id}/curation`,
          {
            method: "PATCH",
            headers: {
              ...authHeaders,
              "content-type": "application/json",
            },
            body: JSON.stringify(update),
          },
        );
        if (written.status === 409) {
          conflicts++;
          await logReceipt({ id: item.id, status: "conflict" });
          continue;
        }
        if (!written.ok)
          throw new Error(`Write failed ${item.id}: ${written.status}`);
        await logReceipt({
          id: item.id,
          status: "applied",
          after: await written.json(),
        });
        applied++;
      } catch (error) {
        failure ??= error;
        break;
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  await receiptChain;
  if (failure) throw failure;
  console.log(JSON.stringify({ applied, skipped, conflicts }));
}
