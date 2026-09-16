import { beforeEach, afterEach, expect, it } from "vitest";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  nativeCorners,
  packageVacaskModelLibrary,
} from "./package-vacask-model-library.mjs";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
let root, options, report, bodies;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vacask-sections-"));
  options = {
    conversion: join(root, "conversion.json"),
    output: join(root, "package"),
    dependencyId: "native-models",
    masters: ["core", "missing"],
  };
  report = {
    status: "converted-not-qualified",
    modelSemantics: { targetVersion: "4.8.3" },
    corners: {},
  };
  bodies = {};
  for (const [i, corner] of nativeCorners.entries()) {
    bodies[corner] =
      `// preserved ${corner}\r\nmodel core sp_bsim4v8 (vth0=${i + 1})\r\n`;
    await writeFile(join(root, `${corner}.sim`), bodies[corner]);
    report.corners[corner] = { nativeSha256: hash(bodies[corner]) };
  }
  await saveReport();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
const saveReport = () => writeFile(options.conversion, JSON.stringify(report));
it("packages all sections without modifying their bytes and derives existing symbol contracts per section", async () => {
  const manifest = await packageVacaskModelLibrary(options);
  const bytes = await readFile(join(options.output, "models.inc"));
  for (const corner of nativeCorners) {
    expect(
      bytes.includes(
        Buffer.from(`section ${corner}\n${bodies[corner]}\nendsection\n`),
      ),
    ).toBe(true);
    expect(await readFile(join(root, `${corner}.sim`), "utf8")).toBe(
      bodies[corner],
    );
    expect(manifest.unresolved[corner]).toEqual(["missing"]);
  }
  expect(manifest.modelSymbols.map((s) => s.section)).toEqual(nativeCorners);
  expect(manifest.modelSymbols.every((s) => s.sha256 === hash(bytes))).toBe(
    true,
  );
  expect(manifest.status).toBe("packaged-not-executed");
  expect(
    JSON.parse(
      await readFile(join(options.output, "package-manifest.json"), "utf8"),
    ),
  ).toEqual(manifest);
  await expect(packageVacaskModelLibrary(options)).rejects.toMatchObject({
    code: "EEXIST",
  });
  expect(await readFile(join(options.output, "models.inc"))).toEqual(bytes);
});
it("refuses changed corner data before creating output", async () => {
  await writeFile(join(root, "ff.sim"), "model different resistor\n");
  await expect(packageVacaskModelLibrary(options)).rejects.toThrow(
    "hash mismatch: ff",
  );
  await expect(stat(options.output)).rejects.toMatchObject({ code: "ENOENT" });
});
it.each(["missing-corner", "incomplete", "wrong-version"])(
  "refuses %s manifests",
  async (kind) => {
    if (kind === "missing-corner") delete report.corners.sf;
    if (kind === "incomplete") report.status = "conversion-incomplete";
    if (kind === "wrong-version") report.modelSemantics.targetVersion = "4.5";
    await saveReport();
    await expect(packageVacaskModelLibrary(options)).rejects.toThrow();
    await expect(stat(options.output)).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);
it("does not publish a successful manifest when a native section cannot be inspected", async () => {
  const text = 'include "missing.inc"\n';
  await writeFile(join(root, "tt.sim"), text);
  report.corners.tt.nativeSha256 = hash(text);
  await saveReport();
  await expect(packageVacaskModelLibrary(options)).rejects.toThrow(
    "inspection failed",
  );
  await expect(
    stat(join(options.output, "package-manifest.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});
