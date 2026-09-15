import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  realpath,
  readdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
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
 * File aliases must resolve inside that tree or to an explicitly declared
 * external regular file; directory links/cycles are refused.
 * This measures bytes, not their licensing or electrical qualification. */
export async function hashVacaskAsset(path, { externalFiles = [] } = {}) {
  const permitted = new Set();
  for (const file of externalFiles) {
    const target = await realpath(file);
    if (!(await lstat(target)).isFile())
      throw new Error(
        "External runtime aliases must name explicit regular files.",
      );
    permitted.add(target);
  }
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
          !permitted.has(target) &&
          (isAbsolute(rel) ||
            rel === ".." ||
            rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`))
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
    ...(configuration.python
      ? {
          python: {
            ...configuration.python,
            libraries: [...(configuration.python.libraries ?? [])],
          },
        }
      : {}),
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
  if (expected && !config.python)
    throw new Error(
      "Pinned VACASK requires declared Python binary and library assets.",
    );
  if (
    config.python &&
    (typeof config.python.binary !== "string" ||
      !isAbsolute(config.python.binary) ||
      !Array.isArray(config.python.libraries) ||
      config.python.libraries.length < 1 ||
      config.python.libraries.length > 64 ||
      !config.python.libraries.every(
        (p) => typeof p === "string" && isAbsolute(p),
      ) ||
      new Set(config.python.libraries).size !== config.python.libraries.length)
  )
    throw new Error(
      "Python runtime requires an absolute binary and distinct absolute library roots.",
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
  const pythonExternalFiles = [];
  for (const asset of config.python?.libraries ?? [])
    if ((await lstat(await realpath(asset))).isFile())
      pythonExternalFiles.push(asset);
  const pythonAssets = config.python
    ? {
        binarySha256: await hashVacaskAsset(config.python.binary),
        libraries: await Promise.all(
          config.python.libraries.map(async (path) => ({
            path,
            sha256: await hashVacaskAsset(path, {
              externalFiles: pythonExternalFiles,
            }),
          })),
        ),
      }
    : undefined;
  const assetsSha256 = digest(
    JSON.stringify({
      modules: moduleSha256,
      dependencies: dependencies.map(({ id, sha256 }) => ({ id, sha256 })),
      libraries: libraryTrees,
      ...(pythonAssets ? { python: pythonAssets } : {}),
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
  let version, pythonVersion;
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
    if (config.python) {
      // Ask the same native startup policy what PYTHON resolves to. Do not
      // approximate TOML parsing or silently substitute a different interpreter.
      await writeFile(
        join(probe, "python-identity.sim"),
        // print triggers elaboration, so even this non-solving probe needs an
        // unknown. The built-in voltage source needs no external model module.
        'Native Python identity\nmodel v vsource\nV1 (probe 0) v dc=0\ncontrol\nprint("ICM_RUNTIME_PYTHON", PYTHON)\nendc\n',
      );
      const selection = await executeFile(
        config.binary,
        [
          "--tomlfile",
          config.startupPath,
          "-n",
          "1",
          "-b",
          "1",
          "./python-identity.sim",
        ],
        {
          cwd: probe,
          env: vacaskRunEnvironment(config, probe),
          windowsHide: true,
          timeout: 5000,
          maxBuffer: 65536,
        },
      ).catch((error) => {
        throw new Error(
          `Native Python selection probe failed: ${[error.stdout, error.stderr, error.message].filter(Boolean).join("\n").slice(0, 4096)}`,
          { cause: error },
        );
      });
      const matches = [
        ...selection.stdout.matchAll(/^ICM_RUNTIME_PYTHON (.+)\r?$/gmu),
      ];
      const selected = matches.length === 1 ? matches[0][1].trim() : "";
      if (
        !isAbsolute(selected) ||
        (await realpath(selected)) !== (await realpath(config.python.binary))
      )
        throw new Error(
          "VACASK startup selected a different Python interpreter than the declared runtime.",
        );
      // Expected asset digests were checked above, before executing Python.
      const identity = await executeFile(
        config.python.binary,
        ["-I", "-B", "-S", "-c", "import sys; print(sys.version.split()[0])"],
        {
          cwd: probe,
          env: vacaskRunEnvironment(config, probe),
          windowsHide: true,
          timeout: 5000,
          maxBuffer: 65536,
        },
      );
      pythonVersion = identity.stdout.trim();
      if (!/^3\.\d+\.\d+(?:[a-zA-Z0-9.+-]*)$/u.test(pythonVersion))
        throw new Error("Unrecognized Python 3 runtime identity response.");
    }
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
    ...(pythonAssets
      ? {
          python: Object.freeze({
            binary: config.python.binary,
            version: pythonVersion,
            binarySha256: pythonAssets.binarySha256,
            libraries: Object.freeze(pythonAssets.libraries.map(Object.freeze)),
          }),
        }
      : {}),
  });
}
