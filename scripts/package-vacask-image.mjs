import assert from "node:assert/strict";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  BSIM4_CHAINRULE_PATCHED_SHA256,
  BSIM4_CHAINRULE_SOURCE_SHA256,
} from "./lib/vacask-bsim4-chainrule.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function readModelBuildSource(buildDirectory, release) {
  const source = await readFile(join(buildDirectory, "bsim4v8.va"));
  assert.equal(
    sha(source),
    BSIM4_CHAINRULE_PATCHED_SHA256,
    "Repaired source identity mismatch",
  );
  const record = JSON.parse(
    await readFile(join(buildDirectory, "build.json"), "utf8"),
  );
  assert.equal(record.succeeded, true, "Model build did not succeed");
  assert.equal(record.patchedSourceSha256, sha(source));
  assert.equal(record.sourceSha256, BSIM4_CHAINRULE_SOURCE_SHA256);
  assert.equal(
    sha(await readFile(join(release, "src/vacask/devices/spice/bsim4v8.va"))),
    record.sourceSha256,
  );
  assert.equal(
    sha(await readFile(join(release, "bin/openvaf-r"))),
    record.compilerSha256,
  );
  assert.equal(
    sha(await readFile(join(buildDirectory, "modules/spice/bsim4v8.osdi"))),
    record.moduleSha256,
  );
  return {
    source,
    // Portable rebuild recipe, not the developer's absolute paths or logs.
    provenance: {
      scope: "Native candidate source provenance; not hosted qualification",
      source: "model-source/bsim4v8.va",
      sourceSha256: record.patchedSourceSha256,
      upstreamSourceSha256: record.sourceSha256,
      compiler: "vacask/bin/openvaf-r",
      compilerSha256: record.compilerSha256,
      module: "modules/spice/bsim4v8.osdi",
      moduleSha256: record.moduleSha256,
      rebuildArgs: [
        "model-source/bsim4v8.va",
        "-o",
        "/tmp/bsim4v8-rebuilt.osdi",
      ],
    },
  };
}

// Compose existing artifacts, not another runtime/Profile. Every copied asset
// gets a standard checksum; simulator and repaired module identities are fixed.
export async function packageVacaskImage(
  output,
  release,
  modelBuild,
  models,
  harness,
) {
  const root = resolve(output);
  const modules = join(modelBuild, "modules");
  const binary = await readFile(join(release, "bin/vacask"));
  assert.equal(
    sha(binary),
    "bb606780f55d0b4f4b0e50503381d991cd2fd12298f85563bb4438b33c1abb13",
    "Unexpected VACASK Linux binary",
  );
  assert.equal(
    sha(await readFile(join(modules, "spice/bsim4v8.osdi"))),
    "5c06ffb2aec8d96c2bbfdbde854e788ac704cbdf2f8d60ae90146aa22e3659a9",
    "Expected repaired BSIM4 module",
  );
  const modelSource = await readModelBuildSource(modelBuild, release);
  const modelManifest = JSON.parse(
    await readFile(join(models, "package-manifest.json"), "utf8"),
  );
  assert.equal(modelManifest.library, "models.inc");
  assert.equal(
    sha(await readFile(join(models, "models.inc"))),
    modelManifest.dependency.sha256,
    "Model artifact hash mismatch",
  );
  const harnessManifest = JSON.parse(
    await readFile(join(harness, "manifest.json"), "utf8"),
  );
  assert.equal(harnessManifest.entry, "vacask-harness.mjs");
  assert.equal(
    sha(await readFile(join(harness, harnessManifest.entry))),
    harnessManifest.sha256,
    "Harness artifact hash mismatch",
  );
  await mkdir(root); // Never overwrite previous evidence or copy the whole repo.
  for (const [source, target] of [
    [release, "vacask"],
    [modules, "modules"],
    [harness, "harness"],
  ])
    await cp(source, join(root, target), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
  await mkdir(join(root, "models"));
  await mkdir(join(root, "model-source"));
  await writeFile(join(root, "model-source/bsim4v8.va"), modelSource.source, {
    flag: "wx",
  });
  await writeFile(
    join(root, "model-source/provenance.json"),
    JSON.stringify(modelSource.provenance, null, 2) + "\n",
    { flag: "wx" },
  );
  for (const name of ["models.inc", "package-manifest.json"])
    await cp(join(models, name), join(root, "models", name));
  const sums = [];
  async function visit(directory, prefix) {
    for (const entry of (
      await readdir(directory, { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const path = `${prefix}${entry.name}`;
      assert(!/[\r\n\\]/u.test(path), "Nonportable image asset path");
      if (entry.isDirectory())
        await visit(join(directory, entry.name), path + "/");
      else {
        assert(
          entry.isFile(),
          "Image assets must be regular files, not aliases",
        );
        sums.push(
          `${sha(await readFile(join(directory, entry.name)))}  ${path}`,
        );
      }
    }
  }
  await visit(root, "");
  for (const name of ["Dockerfile", "ubuntu.sources", "startup.toml"])
    await cp(
      new URL(`../containers/vacask/${name}`, import.meta.url),
      join(root, name),
    );
  sums.push(`${sha(await readFile(join(root, "startup.toml")))}  startup.toml`);
  await writeFile(join(root, "SHA256SUMS"), sums.sort().join("\n") + "\n", {
    flag: "wx",
  });
  return { directory: root, status: "packaged-not-built", files: sums.length };
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  assert.equal(
    process.argv.length,
    7,
    "Usage: package-vacask-image.mjs <new-context> <linux-release> <repaired-build> <model-package> <harness-package>",
  );
  console.log(
    JSON.stringify(
      await packageVacaskImage(...process.argv.slice(2).map((p) => resolve(p))),
    ),
  );
}
