import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { inspectVacaskModelArtifact } from "../containers/vacask/model-symbols.mjs";

export const nativeCorners = ["tt", "ff", "ss", "fs", "sf"];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const maximum = 16 * 1024 * 1024;

/** Wrap existing flattened conversion outputs in native sections. Never change
 * coefficients or convert source syntax here. The manifest is packaging evidence,
 * not a Profile, environment lock or electrical-equivalence certificate. */
export async function packageVacaskModelLibrary({
  conversion,
  output,
  dependencyId,
  masters,
}) {
  if (
    !conversion ||
    !output ||
    !dependencyId ||
    !masters?.length ||
    masters.length > 256 ||
    masters.some((name) => typeof name !== "string" || !name) ||
    new Set(masters).size !== masters.length
  )
    throw Error(
      "Specify conversion.json, a fresh output directory, dependency ID and distinct master names.",
    );
  const source = resolve(conversion);
  const info = await stat(source);
  if (!info.isFile() || info.size > 1048576)
    throw Error("Conversion manifest must be a bounded regular file.");
  const conversionBytes = await readFile(source);
  const report = JSON.parse(conversionBytes.toString("utf8"));
  if (
    report.status !== "converted-not-qualified" ||
    report.modelSemantics?.targetVersion !== "4.8.3"
  )
    throw Error(
      "Require a completed conversion with the approved BSIM4 4.8.3 semantics.",
    );
  const chunks = [],
    inputs = {};
  let size = 0;
  for (const corner of nativeCorners) {
    const expected = report.corners?.[corner]?.nativeSha256;
    if (typeof expected !== "string" || !/^[a-f0-9]{64}$/u.test(expected))
      throw Error(`Conversion manifest does not cover ${corner}.`);
    const path = join(dirname(source), `${corner}.sim`);
    const file = await stat(path);
    if (!file.isFile() || file.size > maximum)
      throw Error(`Invalid native artifact: ${corner}.`);
    const bytes = await readFile(path);
    if (hash(bytes) !== expected)
      throw Error(`Native artifact hash mismatch: ${corner}.`);
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const section = [
      Buffer.from(`section ${corner}\n`),
      bytes,
      Buffer.from("\nendsection\n"),
    ];
    size += section.reduce((n, b) => n + b.length, 0);
    if (size > maximum)
      throw Error(
        "Sectioned library exceeds the existing 16 MiB model inspection limit.",
      );
    chunks.push(...section);
    inputs[corner] = { sha256: expected, bytes: bytes.length };
  }
  const destination = resolve(output);
  // Exclusive directory ownership; a partial failed attempt is not overwritten.
  await mkdir(destination);
  const libraryPath = join(destination, "models.inc");
  await writeFile(libraryPath, Buffer.concat(chunks), { flag: "wx" });
  const modelSymbols = [],
    unresolved = {};
  for (const section of nativeCorners) {
    const inspected = await inspectVacaskModelArtifact(
      libraryPath,
      masters,
      section,
    );
    modelSymbols.push({ dependencyId, section, ...inspected });
    unresolved[section] = masters.filter(
      (name) =>
        !inspected.masters.some((m) => m.name === name && m.primitives.length),
    );
  }
  const manifest = {
    status: "packaged-not-executed",
    conversionSha256: hash(conversionBytes),
    inputs,
    library: "models.inc",
    dependency: { id: dependencyId, sha256: modelSymbols[0].sha256 },
    sections: nativeCorners,
    modelSymbols,
    unresolved,
  };
  // Written last. No runtime registration, capability claim or publication.
  await writeFile(
    join(destination, "package-manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    { flag: "wx" },
  );
  return manifest;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { values } = parseArgs({
    options: {
      conversion: { type: "string" },
      output: { type: "string" },
      "dependency-id": { type: "string" },
      master: { type: "string", multiple: true },
    },
  });
  packageVacaskModelLibrary({
    conversion: values.conversion,
    output: values.output,
    dependencyId: values["dependency-id"],
    masters: values.master,
  }).then(
    (manifest) =>
      console.log(
        JSON.stringify({
          output: resolve(values.output),
          status: manifest.status,
          dependency: manifest.dependency,
          unresolved: manifest.unresolved,
        }),
      ),
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}
