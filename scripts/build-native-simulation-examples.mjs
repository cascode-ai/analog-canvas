import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import {
  parseProject,
  serializeProject,
} from "../packages/project-protocol/dist/index.js";
import {
  builtInSymbols,
  createProjectSymbolResolver,
} from "../packages/symbols/dist/index.js";
import { renderDocumentSvg } from "../packages/render-svg/dist/index.js";
import { createFormalExportSource } from "../packages/exporters/dist/index.js";
import { exportFormalArtifacts } from "../packages/exporters/dist/node.js";
import { buildAgentSessionSnapshot } from "../packages/agent-adapter/dist/index.js";
import { compileSourceSimulation } from "../packages/netlist/dist/index.js";

// Export the reviewed, bundled Projects. Do not reconstruct their Canvas or
// maintain a second set of experiment programs inside this command.
const catalog = [
  { id: "rc", slug: "01-rc-filters" },
  { id: "rlc", slug: "02-rlc-filter" },
  { id: "common-source", slug: "03-common-source" },
  { id: "ota", slug: "04-sky130-ota" },
  { id: "ota-library", slug: "05-sky130-ota-library" },
];
const args = process.argv.slice(2);
const output = resolve(
  args[0] && !args[0].startsWith("--")
    ? args.shift()
    : "output/native-simulation-examples",
);
const selected = new Set();
while (args.length) {
  const flag = args.shift(),
    id = args.shift();
  if (flag !== "--project" || !catalog.some((p) => p.id === id)) {
    throw Error(
      "Usage: node scripts/build-native-simulation-examples.mjs [empty-output-directory] [--project rc|rlc|common-source|ota|ota-library]...",
    );
  }
  selected.add(id);
}
const entries = catalog.filter(
  (item) => !selected.size || selected.has(item.id),
);
const projects = [];
// Compile all selected folders before writing anything. An unfinished native
// conversion must not produce a successful manifest or silently disappear.
for (const entry of entries) {
  const sourcePath =
    entry.id === "ota-library"
      ? "apps/editor/src/examples/five-transistor-ota-sky130.icproj.json"
      : `apps/editor/src/examples/simulation-${entry.id}.icproj.json`;
  const project = parseProject(await readFile(sourcePath, "utf8"));
  const folders = [];
  for (const folder of project.simulationFolders) {
    const compiled = compileSourceSimulation(project, folder);
    if (!compiled.ok) {
      throw Error(
        JSON.stringify({
          sourcePath,
          folderId: folder.id,
          folderName: folder.name,
          diagnostics: compiled.diagnostics,
        }),
      );
    }
    folders.push({ folder, compiled });
  }
  projects.push({ ...entry, sourcePath, project, folders });
}
await mkdir(output, { recursive: true });
if ((await readdir(output)).length) {
  throw Error(
    `Output directory must be empty; existing evidence was not overwritten: ${output}`,
  );
}
const write = async (path, content) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, { flag: "wx" });
};
const manifest = [];
for (const { id, slug, sourcePath, project, folders } of projects) {
  const file = join(output, `${slug}.icproj.json`);
  await write(file, serializeProject(project));
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  for (const doc of project.documents) {
    await write(
      join(output, `${slug}-${doc.id}.svg`),
      renderDocumentSvg(doc, resolver),
    );
    const artifacts = await exportFormalArtifacts(
      createFormalExportSource(doc, resolver, { title: doc.name }),
      2,
    );
    await write(join(output, `${slug}-${doc.id}.png`), artifacts.png.bytes);
    const snapshot = buildAgentSessionSnapshot({
      project,
      document: doc,
      resolver,
    });
    await write(
      join(output, `${slug}-${doc.id}-inspection.json`),
      JSON.stringify(snapshot, null, 2),
    );
  }
  for (const { folder, compiled } of folders) {
    for (const source of folder.input.files) {
      await write(
        join(output, "source", slug, folder.id, source.path),
        source.text,
      );
    }
    for (const source of compiled.files) {
      await write(
        join(output, "prepared", slug, folder.id, source.path),
        source.text,
      );
    }
  }
  manifest.push({
    id,
    slug,
    file,
    sourcePath,
    name: project.name,
    projectId: project.id,
    folders: folders.map(({ folder, compiled }) => ({
      id: folder.id,
      name: folder.name,
      profileId: compiled.config.environment.profileId,
    })),
    documents: project.documents.map((doc) => ({ id: doc.id, name: doc.name })),
  });
}
// Written last: this records compilation/export, not numerical or cloud acceptance.
await write(
  join(output, "manifest.json"),
  JSON.stringify(
    {
      status: "compiled-not-executed",
      projects: manifest,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    manifest.map((p) => ({ file: p.file, experiments: p.folders.length })),
    null,
    2,
  ),
);
