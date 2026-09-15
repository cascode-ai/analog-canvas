import type {
  CircuitProject,
  ProjectSimulationFolder,
  SimulationRunVariant,
} from "@icm/model";
import {
  compileSourceSimulation,
  insertSimulationText,
  replaceSimulationText,
  inspectVacaskSource,
  inspectVacaskSourceGraph,
  locateSimulationText,
  isVacaskStatement,
  type VacaskSourceStatement,
  type SimulationSourceDiagnostic,
} from "@icm/netlist";
import { problem, type Capabilities } from "./contract.js";
import type { ExecutionInput } from "./executor.js";

function compilationProblem(diagnostics: SimulationSourceDiagnostic[]) {
  return { ok: false as const, diagnostics };
}

/** Pure projection shared by authoring helpers and Prepare. Never writes source,
 * mounts files, qualifies models or starts a runtime. Projected source is derived. */
export function resolveSourceSimulationContext(
  project: CircuitProject,
  folder: ProjectSimulationFolder,
  profiles: Capabilities["profiles"],
  variant?: SimulationRunVariant,
) {
  const compiled = compileSourceSimulation(project, folder, variant);
  if (!compiled.ok) return compiled;
  const profile = profiles.find(
    (p) => p.id === compiled.config.environment.profileId,
  );
  if (!profile)
    return problem(
      "SIMULATION_PROFILE_UNKNOWN",
      "Select a Profile advertised by capabilities",
      "prepare",
    );
  const environment: ExecutionInput["environment"] = {
    ...structuredClone(compiled.config.environment),
    ...(variant?.environment?.temperatureC === undefined
      ? {}
      : { temperatureC: variant.environment.temperatureC }),
  };
  const dependencies = structuredClone(folder.input.dependencies);
  const available = new Map(
    (profile.dependencies ?? []).map((d) => [d.id, d.sha256]),
  );
  const unavailable = dependencies.filter(
    (d) => available.get(d.id) !== d.sha256,
  );
  if (unavailable.length)
    return compilationProblem(
      unavailable.map((d) => ({
        code: "SIMULATION_DEPENDENCY_UNAVAILABLE",
        severity: "error",
        message: `Dependency ${d.id} (${d.mountPath}) is not available in the selected Profile`,
        path: d.mountPath,
      })),
    );
  const files = structuredClone(compiled.files);
  const sourceMaps = structuredClone(compiled.sourceMaps);
  const entryIndex = files.findIndex((f) => f.path === compiled.entry);
  const policy = profile.modelLibrary;
  // A code-only TB can explicitly load the same Profile library. Its section
  // has the same electrical meaning as a Canvas-generated model requirement.
  const authoredProfileLoad =
    policy &&
    dependencies.some(
      (dependency) =>
        dependency.id === policy.dependencyId &&
        compiled.includes.some((load) => load.target === dependency.mountPath),
    );
  const requestedCorner = compiled.config.environment.corner;
  if (
    requestedCorner !== undefined &&
    (!policy || (!compiled.requiredModels.length && !authoredProfileLoad))
  )
    return problem(
      "SIMULATION_CORNER_UNAVAILABLE",
      "A corner point requires a used model library declared by the selected Profile; no unrelated include will be changed.",
      "prepare",
    );
  if (policy && (compiled.requiredModels.length || authoredProfileLoad)) {
    const library = (profile.dependencies ?? []).find(
      (d) => d.id === policy.dependencyId,
    );
    if (!library)
      return problem(
        "SIMULATION_MODEL_LIBRARY_UNAVAILABLE",
        "The Profile model library is not an advertised dependency",
        "prepare",
        "retry-after",
      );
    let dependency = dependencies.find((d) => d.id === library.id);
    if (!dependency) {
      const occupied = [
        ...files.map((f) => f.path),
        ...dependencies.map((d) => d.mountPath),
        folder.input.configPath,
      ];
      let mountPath = "icm-models.inc";
      for (
        let i = 1;
        occupied.some(
          (p) =>
            p === mountPath ||
            p.startsWith(`${mountPath}/`) ||
            mountPath.startsWith(`${p}/`),
        );
        i++
      )
        mountPath = `icm-models-${i}.inc`;
      dependency = { ...library, mountPath };
      dependencies.push(dependency);
    }
    const loads = compiled.includes.filter(
      (i) => i.target === dependency.mountPath,
    );
    const nominalSection = loads.length
      ? loads[0]!.section
      : policy.defaultSection;
    const section = requestedCorner ?? nominalSection;
    if (
      loads.length &&
      policy.defaultSection !== undefined &&
      section === undefined
    )
      return problem(
        "SIMULATION_CORNER_UNSUPPORTED",
        "This Profile uses a sectioned model library; select its section in the authored include",
        "prepare",
      );
    if (
      section !== undefined &&
      (!/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(section) ||
        !profile.corners.includes(section))
    )
      return problem(
        "SIMULATION_CORNER_UNSUPPORTED",
        "The native model section is outside this Profile's qualified sections",
        "prepare",
      );
    if (loads.some((load) => load.section !== nominalSection))
      return compilationProblem(
        // Diagnostics navigate nominal Code, not the length-shifted run copy.
        inspectVacaskSourceGraph(folder.input)
          .includes.filter((load) => load.target === dependency.mountPath)
          .map((load) => ({
            code: "SIMULATION_MODEL_CORNER_CONFLICT",
            severity: "error",
            message:
              "The same native model dependency is included with conflicting sections",
            path: load.path,
            sourceRef: load.sourceRef,
          })),
      );
    if (requestedCorner !== undefined) {
      // Graph expansion can visit one authored include more than once. Patch
      // each physical span once, right-to-left, retaining all untouched bytes.
      const unique = new Map(
        loads.map((load) => [
          JSON.stringify([load.path, load.sourceRef.start.offset]),
          load,
        ]),
      );
      const statementsByPath = new Map<
        string,
        Map<number, VacaskSourceStatement>
      >();
      for (const load of [...unique.values()].sort(
        (a, b) => b.sourceRef.start.offset - a.sourceRef.start.offset,
      )) {
        const index = files.findIndex((file) => file.path === load.path);
        const file = files[index]!;
        let statements = statementsByPath.get(file.path);
        if (!statements) {
          statements = new Map(
            inspectVacaskSource(
              file.path,
              file.text,
              file.path === compiled.entry,
            ).statements.map((s) => [s.sourceRef.start.offset, s]),
          );
          statementsByPath.set(file.path, statements);
        }
        const statement = statements.get(load.sourceRef.start.offset);
        const last = statement?.tokens.at(-1);
        if (!last)
          return problem(
            "SIMULATION_CORNER_SOURCE_RANGE",
            "Refresh the source and prepare the corner again",
            "prepare",
            "reprepare",
          );
        const start = load.section === undefined ? last.end : last.start;
        const origin = locateSimulationText(sourceMaps[index]!, last.start);
        const nominalStart =
          origin?.kind === "authored"
            ? origin.startOffset + start - last.start
            : start;
        const mapped = replaceSimulationText(
          { ...file, ...sourceMaps[index]! },
          start,
          last.end,
          load.section === undefined
            ? ` section=${requestedCorner}`
            : requestedCorner,
          {
            kind: "generated",
            purpose: "run-variant",
            nominal: {
              path: file.path,
              startOffset: nominalStart,
              endOffset: nominalStart + last.end - start,
            },
          },
        );
        files[index] = { path: mapped.path, text: mapped.text };
        sourceMaps[index] = { path: mapped.path, segments: mapped.segments };
      }
    }
    if (!loads.length) {
      const entry = files[entryIndex]!;
      const relative =
        "../".repeat(compiled.entry.split("/").length - 1) +
        dependency.mountPath;
      const end = entry.text.indexOf("\n");
      const preamble = `// Profile models (generated)\ninclude ${JSON.stringify(relative)}${section === undefined ? "" : ` section=${section}`}\n`;
      const mapped = insertSimulationText(
        { ...entry, ...sourceMaps[entryIndex]! },
        end < 0 ? entry.text.length : end + 1,
        (end < 0 ? "\n" : "") + preamble,
        { kind: "generated", purpose: "environment" },
      );
      files[entryIndex] = { path: mapped.path, text: mapped.text };
      sourceMaps[entryIndex] = { path: mapped.path, segments: mapped.segments };
    }
    if (section !== undefined) environment.corner = section;
    if (policy.defaultScale !== undefined) {
      // This is a visible initial default, not an enforced option or a rewrite
      // of dimensions. Later authored options (including clear) retain authority.
      const control = inspectVacaskSourceGraph({
        ...folder.input,
        files,
        dependencies,
      }).statements.find(({ statement }) =>
        isVacaskStatement(statement, "control"),
      );
      if (control) {
        const index = files.findIndex((file) => file.path === control.path);
        const file = files[index]!;
        const mapped = insertSimulationText(
          { ...file, ...sourceMaps[index]! },
          control.statement.tokens[0]!.end,
          `\n// Profile model scale (initial default)\noptions scale=${policy.defaultScale}\n`,
          { kind: "generated", purpose: "environment" },
        );
        files[index] = { path: mapped.path, text: mapped.text };
        sourceMaps[index] = { path: mapped.path, segments: mapped.segments };
      }
    }
  }
  return {
    ok: true as const,
    compiled,
    profile,
    environment,
    dependencies,
    files,
    sourceMaps,
    entryIndex,
  };
}
