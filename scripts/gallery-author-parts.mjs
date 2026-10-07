#!/usr/bin/env node
// How many parts each of an author's Gallery circuits has, after the already
// counted ones, from the newest downloaded snapshot
// (node scripts/gallery-private-snapshot.mjs). Local only: it reads user data.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  countAuthorParts,
  readAuthorEntries,
} from "./lib/gallery-author-parts.mjs";
import { newestSnapshot } from "./lib/gallery-snapshots.mjs";

const ORIGIN = "https://analog-canvas.tokenzhang.com";
const USAGE =
  "Usage: node scripts/gallery-author-parts.mjs --author NAME [--owner ACCOUNT_ID] " +
  "[--from NUMBER | --after ENTRY_ID] [--backup GALLERY_SQLITE] [--csv FILE]";

export function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || !flag.startsWith("--")) throw new Error(USAGE);
    index += 1;
    if (flag === "--author") options.author = value;
    else if (flag === "--owner") options.owner = value;
    else if (flag === "--after") options.after = value;
    else if (flag === "--backup") options.backup = resolve(value);
    else if (flag === "--csv") options.csv = resolve(value);
    else if (flag === "--from") {
      const from = Number(value);
      if (!Number.isInteger(from) || from < 1)
        throw new Error("--from needs a circuit number, 1 or more");
      options.from = from;
    } else throw new Error(USAGE);
  }
  if (!options.author && !options.owner) throw new Error(USAGE);
  if (options.from && options.after)
    throw new Error("--from and --after name the same boundary; pass one");
  return options;
}

const csvCell = (value) =>
  /[",\n]/u.test(String(value))
    ? `"${String(value).replaceAll('"', '""')}"`
    : String(value);

/** The counts as the operator reads them, and the itemized CSV rows. */
export function formatCounts(counts, { author, snapshot }) {
  const { circuits } = counts;
  const lines = [
    circuits.length
      ? `${author}：第 ${circuits[0].number}–${circuits.at(-1).number} 个，共 ${circuits.length} 个电路，${counts.parts} 个元件`
      : `${author}：没有新的公开电路`,
    `数据：${snapshot}`,
  ];
  if (circuits.length) {
    const byParts = new Map();
    for (const entry of circuits)
      byParts.set(entry.parts, (byParts.get(entry.parts) ?? 0) + 1);
    lines.push("", "元件数  电路数");
    for (const [parts, count] of [...byParts].sort((a, b) => b[0] - a[0]))
      lines.push(`${String(parts).padStart(6)}  ${String(count).padStart(6)}`);
  }
  const note = (entry) =>
    entry.transistors
      ? `名字写 ${entry.transistors.claimed} 个晶体管，图上画了 ${entry.transistors.drawn} 个`
      : "";
  const flagged = circuits.filter((entry) => entry.transistors);
  if (flagged.length || counts.withdrawn.length) lines.push("", "需要留意：");
  for (const entry of flagged)
    lines.push(`- 第 ${entry.number} 个 ${entry.name}：${note(entry)}`);
  for (const entry of counts.withdrawn)
    lines.push(
      `- ${entry.status === "rejected" ? "被拒" : "已撤下"}、不计入：${entry.name}（${entry.id}）`,
    );
  if (counts.nextAfter)
    lines.push("", `下次从这之后开始：--after ${counts.nextAfter}`);
  const rows = [
    ["序号", "上传时间 (UTC)", "电路", "元件数", "备注", "链接"],
    ...circuits.map((entry) => [
      entry.number,
      entry.createdAt.slice(0, 16).replace("T", " "),
      entry.name,
      entry.parts,
      note(entry),
      `${ORIGIN}/g/${entry.id}`,
    ]),
    ["合计", "", `${circuits.length} 个电路`, counts.parts, "", ""],
  ];
  return {
    text: lines.join("\n"),
    csv: rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n",
  };
}

function main() {
  const options = parseOptions(process.argv.slice(2));
  const snapshot = options.backup ?? newestSnapshot();
  if (!snapshot)
    throw new Error(
      "No downloaded Gallery snapshot; run node scripts/gallery-private-snapshot.mjs",
    );
  const { entries } = readAuthorEntries(snapshot, options);
  const { text, csv } = formatCounts(countAuthorParts(entries, options), {
    author: options.author ?? options.owner,
    snapshot,
  });
  console.log(text);
  if (options.csv) {
    // A byte-order mark lets spreadsheet programs read the Chinese headings.
    writeFileSync(options.csv, `﻿${csv}`);
    console.log(`明细：${options.csv}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
