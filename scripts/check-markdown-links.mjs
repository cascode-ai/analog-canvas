import { access, readdir, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const markdownRoots = [resolve(root, "README.md"), resolve(root, "docs")];
const adrRoot = resolve(root, "docs", "adr");
const markdownLink = /\]\(([^)]+)\)/gu;

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function collectMarkdown(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) files.push(...(await collectMarkdown(child)));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(child);
  }
  return files;
}

function localTarget(value) {
  const target = value
    .trim()
    .replace(/^<|>$/gu, "")
    .split(/[\s?#]/u, 1)[0];
  if (
    !target ||
    target.startsWith("#") ||
    /^[a-z][a-z0-9+.-]*:/iu.test(target)
  ) {
    return undefined;
  }
  return target;
}

const files = [markdownRoots[0], ...(await collectMarkdown(markdownRoots[1]))];
const failures = [];

for (const file of files) {
  const text = await readFile(file, "utf8");
  for (const match of text.matchAll(markdownLink)) {
    const target = localTarget(match[1]);
    if (!target || (await exists(resolve(file, "..", target)))) continue;
    failures.push(`${file.slice(root.length + 1)} -> ${target}`);
  }
}

const adrIndex = await readFile(resolve(adrRoot, "README.md"), "utf8");
const adrFiles = (await collectMarkdown(adrRoot)).filter((file) =>
  /^\d{4}-.+\.md$/u.test(basename(file)),
);
const adrByNumber = new Map();
for (const file of adrFiles) {
  const name = basename(file);
  const number = name.slice(0, 4);
  const prior = adrByNumber.get(number);
  if (prior) failures.push(`duplicate ADR ${number}: ${prior}, ${name}`);
  else adrByNumber.set(number, name);

  const text = await readFile(file, "utf8");
  const titleNumber = /^#\s+(?:ADR\s+)?(\d{4})(?:\s|:|-)/mu.exec(text)?.[1];
  if (titleNumber !== number) {
    failures.push(`${name} title must identify ADR ${number}`);
  }
  const status = /^Status:\s*`?(accepted|proposed)`?\s*$/imu.exec(text)?.[1];
  if (!status) {
    failures.push(`${name} must have Status: accepted or proposed`);
  }
  if (!adrIndex.includes(`(${name})`)) {
    failures.push(`${name} is missing from docs/adr/README.md`);
  }
}

if (failures.length > 0) {
  console.error("Documentation contract failures:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Validated local Markdown links in ${files.length} files`);
}
