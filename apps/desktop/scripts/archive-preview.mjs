import { createReadStream } from "node:fs";
import { open, readFile, readdir, stat, unlink } from "node:fs/promises";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Zip, ZipDeflate } from "fflate";
import { inspectDistributionDirectory } from "../../../scripts/lib/distribution-security.mjs";

const root = resolve(import.meta.dirname, "../../..");
const manifest = JSON.parse(
  await readFile(
    process.argv[2] ?? join(root, "plan/preview-package.json"),
    "utf8",
  ),
);
const directory = resolve(manifest.output);
const archive = resolve(manifest.archive);
if (!/^[a-f0-9]{40}$/u.test(manifest.commit))
  throw Error("Missing package source commit");
const archiveRelative = relative(directory, archive);
if (
  archiveRelative !== ".." &&
  !archiveRelative.startsWith(`..${sep}`) &&
  !isAbsolute(archiveRelative)
)
  throw Error("The archive must be outside its application directory");
const build = await readFile(join(directory, "BUILD.txt"), "utf8");
if (!build.includes(`Source commit: ${manifest.commit}\n`))
  throw Error("Package source does not match its manifest");
for (const name of ["ACCEPTANCE.json", "SECURITY.json"]) {
  const record = JSON.parse(await readFile(join(directory, name), "utf8"));
  if (
    record.status !== "passed" ||
    record.source !== manifest.commit ||
    (name === "ACCEPTANCE.json" && record.packaged !== true)
  )
    throw Error(`${name} must pass for the distributed source`);
}
await inspectDistributionDirectory(directory);
if (!(await stat(manifest.executable)).isFile())
  throw Error("Missing executable");

// Exclusive creation preserves previous archives. Stream one file at a time;
// the Electron executable never needs to be held in memory in its entirety.
const handle = await open(archive, "wx");
const destination = handle.createWriteStream();
const completion = finished(destination);
void completion.catch(() => {});
const zip = new Zip((error, bytes, final) => {
  if (error) destination.destroy(error);
  else {
    destination.write(bytes);
    if (final) destination.end();
  }
});
let complete = false;
try {
  async function addDirectory(path = "") {
    const entries = await readdir(join(directory, path), {
      withFileTypes: true,
    });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const child = path ? `${path}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await addDirectory(child);
      else {
        if (!entry.isFile()) throw Error(`Unsupported archive entry: ${child}`);
        const file = new ZipDeflate(`${basename(directory)}/${child}`, {
          level: 9,
          mtime: (await stat(join(directory, child))).mtime,
        });
        zip.add(file);
        for await (const chunk of createReadStream(join(directory, child))) {
          file.push(chunk);
          if (destination.writableNeedDrain) await once(destination, "drain");
        }
        file.push(new Uint8Array(), true);
      }
    }
  }
  await addDirectory();
  zip.end();
  await completion;
  complete = true;
  console.log(archive);
} finally {
  if (!complete) {
    zip.terminate();
    destination.destroy();
    await completion.catch(() => {});
    // This file was exclusively created by this invocation, never a prior ZIP.
    await unlink(archive);
  }
}
