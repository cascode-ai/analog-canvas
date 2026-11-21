import { readFileSync, readdirSync } from "node:fs";
import { posix, resolve } from "node:path";

const editor = "apps/editor";
const browser = editor + "/e2e/";
export const browserSpecPath =
  /^apps\/editor\/e2e\/[A-Za-z0-9._/-]+\.spec\.ts$/u;

// Imports (including literal dynamic imports), file URLs and page-module
// declarations all name local files. Test support uses the same paths when
// compiled imports spell a TypeScript file with its JavaScript extension.
function references(file, root, known) {
  const source = readFileSync(resolve(root, file), "utf8");
  const files = [];
  for (const [, , name] of source.matchAll(
    /(["'`])((?:\.\.?\/|e2e\/)[\w./-]+)\1/gu,
  )) {
    const path = name.startsWith("e2e/")
      ? editor + "/" + name
      : posix.join(posix.dirname(file), name);
    files.push(
      path,
      path.replace(/\.js$/u, ".ts"),
      path.replace(/\.js$/u, ".tsx"),
      path.replace(/\.mjs$/u, ".mts"),
      path.replace(/\.mjs$/u, ".d.mts"),
      path + ".ts",
      path + ".tsx",
      path + "/index.ts",
    );
  }
  return new Set(files.filter((path) => known.has(path)));
}

export function browserFixtureRoutes(root, paths) {
  const byFixture = new Map(
    paths
      .filter((path) => path.startsWith(browser) && !browserSpecPath.test(path))
      .map((path) => [path, []]),
  );
  if (!byFixture.size) return { byFixture, specs: [] };

  const files = readdirSync(resolve(root, browser), { recursive: true })
    .filter((file) => /\.(?:ts|tsx|mts|js|mjs)$/u.test(file))
    .map((file) => browser + file.replaceAll("\\", "/"))
    .sort();
  const specs = files.filter((file) => browserSpecPath.test(file));
  const known = new Set([...files, ...byFixture.keys()]);
  const graph = new Map(
    files.map((file) => [file, references(file, root, known)]),
  );

  for (const spec of specs) {
    const visited = new Set([spec]);
    for (const file of visited) {
      byFixture.get(file)?.push(spec);
      for (const dependency of graph.get(file) ?? []) visited.add(dependency);
    }
  }
  return { byFixture, specs };
}
