import { it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inspectVacaskModelArtifact,
  verifyVacaskModelSymbols,
} from "./model-symbols.mjs";

it("verifies symbols from exact runtime bytes, refusing stale paths, digest or missing sections", async () => {
  const root = await mkdtemp(join(tmpdir(), "vacask-symbol-runtime-"));
  const path = join(root, "library.inc");
  await writeFile(path, "section tt\nmodel core sp_bsim4v8\nendsection\n");
  const inspected = await inspectVacaskModelArtifact(path, ["core"], "tt");
  const library = { dependencyId: "models", section: "tt", ...inspected };
  const dependencies = [
    { id: "models", sha256: inspected.sha256, runtimePath: path },
  ];
  await expect(
    verifyVacaskModelSymbols([library], dependencies),
  ).resolves.toBeUndefined();
  await expect(
    verifyVacaskModelSymbols(
      [
        {
          ...library,
          masters: [
            {
              name: "core",
              primitives: [{ path: ["guessed"], module: "sp_bsim4v8" }],
            },
          ],
        },
      ],
      dependencies,
    ),
  ).rejects.toThrow("differ");
  await expect(
    verifyVacaskModelSymbols([{ ...library, section: "ff" }], dependencies),
  ).rejects.toThrow("inspection failed");
  await expect(verifyVacaskModelSymbols([library], [])).rejects.toThrow(
    "matching runtime dependency",
  );
  await writeFile(path, "section tt\nmodel core resistor\nendsection\n");
  await expect(
    verifyVacaskModelSymbols([library], dependencies),
  ).rejects.toThrow("differ");
});
