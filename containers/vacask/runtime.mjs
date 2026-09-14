import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath, readdir, mkdtemp, rm } from "node:fs/promises";
import { delimiter, isAbsolute, join, relative } from "node:path";
import { promisify } from "node:util";
import {
  createSimulationEnvironmentMetadata,
  verifySimulationEnvironmentMetadata,
} from "@icm/spice-run";
import { vacaskRunEnvironment } from "./run-process.mjs";

const executeFile = promisify(execFile);
const digest = (text) => createHash("sha256").update(text).digest("hex");

/** Stream trusted runtime assets rather than retaining a PDK or module bundle
 * in memory. A directory uses the repository's relative-name/size/bytes framing.
 * File aliases must resolve inside that tree; directory links/cycles are refused.
 * This measures bytes, not their licensing or electrical qualification. */
export async function hashVacaskAsset(path) {
  const root = await realpath(path);
  const info = await lstat(root);
  const hash = createHash("sha256");
  const readIntoHash = async (file) => {
    for await (const bytes of createReadStream(file)) hash.update(bytes);
  };
  if (info.isFile()) {
    await readIntoHash(root);
    return hash.digest("hex");
  }
  if (!info.isDirectory())
    throw new Error("Runtime asset is not a regular file or directory.");
  const visit = async (directory) => {
    const names = await readdir(directory);
    names.sort();
    for (const name of names) {
      const file = join(directory, name);
      let meta = await lstat(file);
      if (meta.isDirectory()) {
        await visit(file);
        continue;
      }
      if (meta.isSymbolicLink()) {
        const target = await realpath(file);
        const rel = relative(root, target);
        if (
          isAbsolute(rel) ||
          rel === ".." ||
          rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
        )
          throw new Error("Runtime asset link escapes its declared tree.");
        meta = await lstat(target);
      }
      if (!meta.isFile())
        throw new Error(
          "Runtime asset tree contains a non-regular file or directory link.",
        );
      hash.update(JSON.stringify(relative(root, file).replaceAll("\\", "/")));
      hash.update("\0" + String(meta.size) + "\0");
      await readIntoHash(file);
      hash.update("\0");
    }
  };
  await visit(root);
  return hash.digest("hex");
}

/** Boot-time runtime measurement. Paths and expectedEnvironment are operator
 * configuration, never request fields. A hosted runtime requires a previously
 * accepted environment lock; observing a working binary does not qualify it.
 * Reuse the existing environment metadata/fingerprint contract, not a second
 * Profile protocol. The environment registry still owns qualified capabilities.
 * The enclosing deployment must keep these assets read-only after measurement
 * and pin the image/system libraries; this is not a filesystem sandbox or a
 * claim that undeclared loader dependencies have been measured. */
export async function initializeVacaskRuntime(configuration) {
  const config = {
    ...configuration,
    dependencies: (configuration.dependencies ?? []).map((d) => ({ ...d })),
  };
  if (
    ![config.binary, config.modules, config.startupPath, config.runRoot].every(
      (path) => typeof path === "string" && isAbsolute(path),
    ) ||
    !["local-host", "hosted-container"].includes(config.executor) ||
    typeof config.profileId !== "string" ||
    !config.profileId
  )
    throw new Error(
      "Native runtime requires explicit absolute paths, executor and Profile ID.",
    );
  const expected = config.expectedEnvironment
    ? await verifySimulationEnvironmentMetadata(config.expectedEnvironment)
    : null;
  if (
    config.expectedEnvironment &&
    (!expected ||
      expected.reproducibility !== "pinned" ||
      expected.simulator.name !== "vacask")
  )
    throw new Error("The native expected environment lock is invalid.");
  if (config.executor === "hosted-container" && !expected)
    throw new Error(
      "Hosted VACASK requires an accepted pinned environment lock.",
    );
  if (
    new Set(config.dependencies.map((d) => d.id)).size !==
      config.dependencies.length ||
    config.dependencies.some(
      (d) =>
        typeof d.id !== "string" ||
        !d.id ||
        !/^[a-f0-9]{64}$/u.test(d.sha256) ||
        typeof d.runtimePath !== "string" ||
        !isAbsolute(d.runtimePath),
    )
  )
    throw new Error("Runtime dependency registry is invalid.");
  const libraries = config.libraryPath
    ? config.libraryPath.split(delimiter)
    : [];
  if (!libraries.every(isAbsolute))
    throw new Error("Runtime library roots must be absolute.");
  const binarySha256 = await hashVacaskAsset(config.binary);
  // Do not execute an unexpected replacement binary even just to ask its version.
  if (expected && binarySha256 !== expected.simulator.binarySha256)
    throw new Error("VACASK binary differs from the expected environment.");
  const startupSha256 = await hashVacaskAsset(config.startupPath);
  const moduleSha256 = await hashVacaskAsset(config.modules);
  const dependencies = [];
  for (const dependency of config.dependencies) {
    const sha256 = await hashVacaskAsset(dependency.runtimePath);
    if (sha256 !== dependency.sha256)
      throw new Error(`Runtime dependency ${dependency.id} has changed.`);
    dependencies.push({ ...dependency });
  }
  dependencies.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const libraryTrees = [];
  for (const library of libraries)
    libraryTrees.push(await hashVacaskAsset(library));
  const assetsSha256 = digest(
    JSON.stringify({
      modules: moduleSha256,
      dependencies: dependencies.map(({ id, sha256 }) => ({ id, sha256 })),
      libraries: libraryTrees,
    }),
  );
  if (
    expected &&
    (expected.startupSha256 !== startupSha256 ||
      expected.models?.id !== "vacask-runtime-assets" ||
      expected.models.contentSha256 !== assetsSha256 ||
      expected.platform !== `${process.platform}/${process.arch}` ||
      expected.profileId !== config.profileId ||
      expected.executor !== config.executor)
  )
    throw new Error(
      "Native runtime assets, startup or deployment identity differs from the accepted lock.",
    );
  const probe = await mkdtemp(join(config.runRoot, "probe-"));
  let version;
  try {
    // The selected release uses -h; --version is an error, despite printing a banner.
    const output = await executeFile(
      config.binary,
      ["--tomlfile", config.startupPath, "-h"],
      {
        cwd: probe,
        env: vacaskRunEnvironment(config, probe),
        windowsHide: true,
        timeout: 5_000,
        maxBuffer: 65_536,
      },
    );
    version =
      /^This is vacask ([0-9]+\.[0-9]+\.[0-9]+(?:[-+][\w.-]+)?)\./mu.exec(
        output.stdout,
      )?.[1];
    if (!version)
      throw new Error("Unrecognized native simulator identity response.");
  } finally {
    await rm(probe, { recursive: true, force: true });
  }
  const environment = await createSimulationEnvironmentMetadata({
    executor: config.executor,
    reproducibility: expected ? "pinned" : "observed",
    profileId: config.profileId,
    platform: `${process.platform}/${process.arch}`,
    simulator: { name: "vacask", version, binarySha256 },
    models: { id: "vacask-runtime-assets", contentSha256: assetsSha256 },
    startupSha256,
  });
  if (expected && expected.fingerprint !== environment.fingerprint)
    throw new Error(
      "Measured VACASK runtime does not match the accepted environment lock.",
    );
  return Object.freeze({
    binary: config.binary,
    modules: config.modules,
    startupPath: config.startupPath,
    runRoot: config.runRoot,
    ...(config.libraryPath ? { libraryPath: config.libraryPath } : {}),
    environment: Object.freeze(environment),
    dependencies: Object.freeze(dependencies.map(Object.freeze)),
  });
}
