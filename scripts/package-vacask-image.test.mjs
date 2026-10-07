import { it, expect } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  packageVacaskImage,
  readModelBuildSource,
  replaceVacaskSimulator,
} from "./package-vacask-image.mjs";

it("refuses an unrelated model source before trusting a build receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "native-source-package-"));
  try {
    await writeFile(join(root, "bsim4v8.va"), "unrelated source");
    await expect(readModelBuildSource(root, "absent-release")).rejects.toThrow(
      "Repaired source identity mismatch",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("replaces only the simulator and preserves accepted models, capabilities and limits", async () => {
  const root = await mkdtemp(join(tmpdir(), "native-simulator-package-"));
  try {
    const context = join(root, "context");
    const build = join(root, "build");
    await mkdir(join(context, "vacask/bin"), { recursive: true });
    await mkdir(join(context, "model-source"));
    await mkdir(build);
    const digest = (value) => createHash("sha256").update(value).digest("hex");
    const before = {
      runtime: {
        expectedEnvironment: JSON.parse(
          await readFile(
            new URL(
              "../config/vacask-preview-environment.json",
              import.meta.url,
            ),
            "utf8",
          ),
        ),
        dependencies: [
          { id: "original-model", runtimePath: "/opt/models/models.inc" },
        ],
        python: {
          binary: "/usr/bin/python3",
          libraries: ["/usr/lib/python3.12"],
        },
      },
      capabilities: { inputs: ["source"], cancel: true },
      limits: { maxInputBytes: 65536, maxOutputBytes: 8388608 },
    };
    before.runtime.expectedEnvironment.simulator.binarySha256 =
      digest("baseline");
    const baseline = join(root, "baseline.json");
    const output = join(root, "new.json");
    await writeFile(baseline, JSON.stringify(before));
    await writeFile(join(context, "vacask/bin/vacask"), "baseline");
    await writeFile(
      join(context, "SHA256SUMS"),
      `${digest("baseline")}  vacask/bin/vacask\n${digest("unchanged")}  models/models.inc\n`,
    );
    await writeFile(join(build, "vacask"), "replacement");
    await writeFile(
      join(build, "SHA256SUMS"),
      `${digest("wrong")}  /artifact/vacask\n`,
    );
    await writeFile(
      join(build, "upstream-revision.txt"),
      "c1a1c84f1b2b9aa71c0cddf06e555441434db7b7\n",
    );
    await writeFile(
      join(build, "hard-switch.patch"),
      JSON.parse(
        await readFile(
          new URL(
            "../containers/vacask/patches/hard-switch.patch.json",
            import.meta.url,
          ),
          "utf8",
        ),
      ).join("\n") + "\n",
    );
    await writeFile(
      join(build, "upstream-source.tar.gz"),
      "corresponding-source",
    );
    await expect(
      replaceVacaskSimulator(context, build, baseline, output),
    ).rejects.toThrow();
    expect(await readFile(join(context, "vacask/bin/vacask"), "utf8")).toBe(
      "baseline",
    );
    await expect(access(output)).rejects.toThrow();
    await writeFile(
      join(build, "SHA256SUMS"),
      `${digest("replacement")}  /artifact/vacask\n`,
    );
    const environment = await replaceVacaskSimulator(
      context,
      build,
      baseline,
      output,
    );
    const after = JSON.parse(await readFile(output, "utf8"));
    const expected = structuredClone(before);
    expected.runtime.expectedEnvironment = environment;
    expect(after).toEqual(expected);
    expect(environment.models).toEqual(
      before.runtime.expectedEnvironment.models,
    );
    expect(environment.startupSha256).toBe(
      before.runtime.expectedEnvironment.startupSha256,
    );
    expect(environment.simulator).toMatchObject({
      version: "0.3.4-icm-hard-switch2",
      binarySha256: digest("replacement"),
    });
    expect(environment.fingerprint).not.toBe(
      before.runtime.expectedEnvironment.fingerprint,
    );
    expect(await readFile(baseline, "utf8")).toBe(JSON.stringify(before));
    expect(await readFile(join(context, "SHA256SUMS"), "utf8")).toContain(
      `${digest("unchanged")}  models/models.inc`,
    );
    expect(
      await readFile(
        join(context, "model-source/vacask/upstream-source.tar.gz"),
        "utf8",
      ),
    ).toBe("corresponding-source");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("refuses an unexpected simulator before creating an image context or touching inputs", async () => {
  const root = await mkdtemp(join(tmpdir(), "native-image-package-"));
  try {
    await mkdir(join(root, "bin"));
    await writeFile(join(root, "bin/vacask"), "not the accepted binary");
    const output = join(root, "output");
    await expect(
      packageVacaskImage(
        output,
        root,
        "absent-modules",
        "absent-models",
        "absent-harness",
      ),
    ).rejects.toThrow("Unexpected VACASK Linux binary");
    await expect(access(output)).rejects.toThrow();
    expect(await readFile(join(root, "bin/vacask"), "utf8")).toBe(
      "not the accepted binary",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("requires all explicit package inputs rather than guessing local runtime paths", () => {
  let failure;
  try {
    execFileSync(process.execPath, ["scripts/package-vacask-image.mjs"], {
      stdio: "pipe",
      timeout: 10000,
    });
  } catch (error) {
    failure = error;
  }
  expect(failure?.status).toBe(1);
  expect(String(failure?.stderr)).toContain("Usage: package-vacask-image.mjs");
});
