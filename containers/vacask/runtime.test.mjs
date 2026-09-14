import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSimulationEnvironmentMetadata,
  verifySimulationEnvironmentMetadata,
} from "@icm/spice-run";
import { hashVacaskAsset, initializeVacaskRuntime } from "./runtime.mjs";
vi.mock("node:child_process", () => ({ execFile: vi.fn() }));
let root, config;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "icm-runtime-"));
  config = {
    executor: "local-host",
    profileId: "observed-native",
    binary: join(root, "vacask"),
    modules: join(root, "modules"),
    startupPath: join(root, "startup.toml"),
    runRoot: join(root, "jobs"),
  };
  await mkdir(config.modules);
  await mkdir(config.runRoot);
  await writeFile(config.binary, "native executable");
  await writeFile(config.startupPath, "# controlled\n");
  await writeFile(join(config.modules, "resistor.osdi"), "compiled model");
  vi.mocked(execFile).mockImplementation((_binary, _args, _options, callback) =>
    callback(null, {
      stdout: "This is vacask 0.3.4.\nHelp text\n",
      stderr: "",
    }),
  );
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  vi.clearAllMocks();
});

async function locked() {
  const observed = await initializeVacaskRuntime(config);
  return createSimulationEnvironmentMetadata({
    ...observed.environment,
    reproducibility: "pinned",
  });
}
describe("native measured environment", () => {
  it("accepts the declared hosted identity only when every measured field matches", async () => {
    const observed = await initializeVacaskRuntime(config);
    const expectedEnvironment = await createSimulationEnvironmentMetadata({
      ...observed.environment,
      executor: "hosted-container",
      reproducibility: "pinned",
    });
    const loaded = await initializeVacaskRuntime({
      ...config,
      executor: "hosted-container",
      expectedEnvironment,
    });
    expect(loaded.environment).toEqual(expectedEnvironment);
    await expect(
      initializeVacaskRuntime({ ...config, expectedEnvironment }),
    ).rejects.toThrow("deployment identity");
  });
  it("rejects directory aliases and escaping runtime assets", async () => {
    const outside = join(root, "outside");
    await mkdir(outside);
    await symlink(
      outside,
      join(config.modules, "escape"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(hashVacaskAsset(config.modules)).rejects.toThrow("escapes");
    await rm(join(config.modules, "escape"));
    const inside = join(config.modules, "inside");
    await mkdir(inside);
    await symlink(
      inside,
      join(config.modules, "alias"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(hashVacaskAsset(config.modules)).rejects.toThrow(
      "directory link",
    );
  });
  it("uses shared metadata, fixed help invocation and no accidental qualification claim", async () => {
    const loaded = await initializeVacaskRuntime(config);
    expect(loaded.environment).toMatchObject({
      reproducibility: "observed",
      profileId: "observed-native",
      simulator: { name: "vacask", version: "0.3.4" },
    });
    expect(
      await verifySimulationEnvironmentMetadata(loaded.environment),
    ).toEqual(loaded.environment);
    expect(execFile).toHaveBeenCalledWith(
      config.binary,
      ["--tomlfile", config.startupPath, "-h"],
      expect.objectContaining({
        timeout: 5000,
        maxBuffer: 65536,
        windowsHide: true,
      }),
      expect.any(Function),
    );
    expect(await readdir(config.runRoot)).toEqual([]);
    expect(loaded).not.toHaveProperty("qualifiedScope");
  });
  it("requires a lock for hosting and refuses malformed or legacy identity", async () => {
    await expect(
      initializeVacaskRuntime({ ...config, executor: "hosted-container" }),
    ).rejects.toThrow("accepted pinned");
    await expect(
      initializeVacaskRuntime({
        ...config,
        expectedEnvironment: { simulator: { name: "ngspice" } },
      }),
    ).rejects.toThrow("invalid");
    expect(execFile).not.toHaveBeenCalled();
  });
  it("accepts an exact verified environment and never downgrades a mismatch to observed", async () => {
    const expectedEnvironment = await locked();
    const verified = await initializeVacaskRuntime({
      ...config,
      expectedEnvironment,
    });
    expect(verified.environment).toEqual(expectedEnvironment);
    await expect(
      initializeVacaskRuntime({
        ...config,
        expectedEnvironment: {
          ...expectedEnvironment,
          fingerprint: "0".repeat(64),
        },
      }),
    ).rejects.toThrow("invalid");
  });
  it.each(["binary", "startup", "modules"])(
    "refuses changed %s bytes before executing a probe",
    async (field) => {
      const expectedEnvironment = await locked();
      vi.mocked(execFile).mockClear();
      await writeFile(
        field === "binary"
          ? config.binary
          : field === "startup"
            ? config.startupPath
            : join(config.modules, "resistor.osdi"),
        "changed",
      );
      await expect(
        initializeVacaskRuntime({ ...config, expectedEnvironment }),
      ).rejects.toThrow(/differs/);
      expect(execFile).not.toHaveBeenCalled();
    },
  );
  it("hashes dependency contents and rejects stale declarations", async () => {
    const path = join(root, "models.sim");
    await writeFile(path, "model r resistor");
    const sha256 = await hashVacaskAsset(path);
    config.dependencies = [{ id: "models", runtimePath: path, sha256 }];
    const first = await initializeVacaskRuntime(config);
    expect(first.dependencies).toEqual(config.dependencies);
    await writeFile(path, "model r capacitor");
    await expect(initializeVacaskRuntime(config)).rejects.toThrow(
      "has changed",
    );
    config.dependencies[0].sha256 = await hashVacaskAsset(path);
    const second = await initializeVacaskRuntime(config);
    expect(second.environment.fingerprint).not.toBe(
      first.environment.fingerprint,
    );
  });
  it("accounts for explicitly configured dynamic-library bytes", async () => {
    const libraries = join(root, "libraries");
    await mkdir(libraries);
    await writeFile(join(libraries, "libsolver.so"), "solver-v1");
    config.libraryPath = libraries;
    const expectedEnvironment = await locked();
    await writeFile(join(libraries, "libsolver.so"), "solver-v2");
    await expect(
      initializeVacaskRuntime({ ...config, expectedEnvironment }),
    ).rejects.toThrow("differs");
  });
  it("checks exit status as well as the version banner and always removes the probe directory", async () => {
    vi.mocked(execFile).mockImplementationOnce(
      (_binary, _args, _options, callback) =>
        callback(
          Object.assign(new Error("probe failed"), {
            code: 1,
            stdout: "This is vacask 0.3.4.",
          }),
        ),
    );
    await expect(initializeVacaskRuntime(config)).rejects.toThrow(
      "probe failed",
    );
    expect(await readdir(config.runRoot)).toEqual([]);
    vi.mocked(execFile).mockImplementationOnce(
      (_binary, _args, _options, callback) =>
        callback(null, { stdout: "not a simulator", stderr: "" }),
    );
    await expect(initializeVacaskRuntime(config)).rejects.toThrow(
      "Unrecognized",
    );
  });
  it("uses stable relative-path and byte-length framing for module trees", async () => {
    const text = "compiled model";
    const expected = createHash("sha256")
      .update(JSON.stringify("resistor.osdi"))
      .update("\0" + Buffer.byteLength(text) + "\0")
      .update(text)
      .update("\0")
      .digest("hex");
    expect(await hashVacaskAsset(config.modules)).toBe(expected);
    await writeFile(join(config.modules, "other.osdi"), text);
    expect(await hashVacaskAsset(config.modules)).not.toBe(expected);
  });
});
