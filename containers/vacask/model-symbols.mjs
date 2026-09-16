import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { inspectNativeModelLibrarySymbols } from "@icm/netlist";

/** Provisioning and boot use the same bounded inspector. These are flattened
 * native library files; directory dependencies need a packaging entry first. */
export async function inspectVacaskModelArtifact(path, names, section) {
  const info = await stat(path);
  const limit = 16 * 1024 * 1024;
  if (!info.isFile() || info.size > limit)
    throw Error(
      "Model symbols require a regular native artifact no larger than 16 MiB",
    );
  const bytes = await readFile(path);
  if (bytes.length > limit)
    throw Error("Model artifact grew beyond inspection limit");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (section !== undefined && !/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(section))
    throw Error("Invalid native model section");
  const inspected = inspectNativeModelLibrarySymbols(
    {
      kind: "source",
      entry: "inspect.sim",
      configPath: "experiment.json",
      circuitBindings: [],
      dependencies: [],
      files: [
        {
          path: "inspect.sim",
          text: `Model symbol inspection\ninclude "library.inc"${section === undefined ? "" : ` section=${section}`}\n`,
        },
        { path: "library.inc", text },
      ],
    },
    names,
  );
  if (inspected.diagnostics.some((d) => d.severity === "error"))
    throw Error(
      "Native library symbol inspection failed: " +
        JSON.stringify(inspected.diagnostics),
    );
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    masters: inspected.masters,
  };
}

/** An unchanged model hash does not prove that someone copied the right
 * private paths into capabilities. Verify advertised names against the bytes. */
export async function verifyVacaskModelSymbols(libraries, dependencies) {
  for (const library of libraries ?? []) {
    const dependency = (dependencies ?? []).find(
      (d) => d.id === library.dependencyId && d.sha256 === library.sha256,
    );
    if (!dependency)
      throw Error("Model symbols have no matching runtime dependency");
    const inspected = await inspectVacaskModelArtifact(
      dependency.runtimePath,
      library.masters.map((m) => m.name),
      library.section,
    );
    if (
      inspected.sha256 !== library.sha256 ||
      JSON.stringify(inspected.masters) !== JSON.stringify(library.masters)
    )
      throw Error("Model symbols differ from the runtime artifact");
  }
}
