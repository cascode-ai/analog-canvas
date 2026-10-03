#!/usr/bin/env node
import {
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  rename,
  rm,
  lstat,
  open,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  scanDesign,
  recommendMappings,
  confirmMappings,
  decisionTemplate,
  previewProposal,
  BackendError,
  z,
  type OperationOptions,
  prepareMappings,
  saveMappings,
  MappingTableSchema,
  validateSnapshot,
  resolveUserConfig,
  presentationFromUserConfig,
  PresentationConfigSchema,
  type ResolvedUserConfig,
} from "@icm/virtuoso-import/core";
import {
  loadCatalog,
  loadFullCatalog,
  catalogMarkdown,
  convertDesign,
  defaultPresentation,
} from "@icm/virtuoso-import/canvas-adapter";

// The compiled CLI is dist/cli/main.js; installed resources live at root.
const runtimeRoot = fileURLToPath(new URL("../../", import.meta.url));
const toolRoot = process.env.VC_ROOT ?? runtimeRoot;
const canvasRoot = path.resolve(toolRoot, "../..");
const personalRoot =
  process.env.VC_PERSONAL_DIR ??
  path.join(os.homedir(), ".config", "virtuoso-canvas");
const json = async (file: string) => JSON.parse(await readFile(file, "utf8"));
const encode = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const emptyTable = { version: 1, devices: {} };
let failureContext:
  | {
      out: string;
      stage: string;
      input?: string;
      debug: boolean;
      files: Record<string, string>;
    }
  | undefined;
type ResultStatus = "success" | "success_with_warnings" | "error" | "cancelled";
const mappingErrorCodes = new Set([
  "INVALID_BOX_MAPPING",
  "INVALID_MAPPING",
  "INVALID_OMIT_PINS",
  "INSTANCE_MAPPING_MISMATCH",
  "MAPPING_CONFLICT",
  "MAPPING_NOT_FOUND",
  "MAPPING_NOT_READABLE",
  "PIN_COVERAGE",
  "TARGET_PIN_COVERAGE",
  "UNCONFIRMED_MASTER",
  "UNKNOWN_PARAMETER",
  "UNKNOWN_TARGET_PARAMETER",
  "UNKNOWN_TARGET_PIN",
  "UNSUPPORTED_SYMBOL",
  "UNMAPPED_DEVICE",
]);
function errorCategory(code: string): string {
  if (mappingErrorCodes.has(code)) return "INVALID_MAPPING";
  if (
    ["INVALID_CONFIG", "CONFIG_NOT_FOUND", "CONFIG_NOT_READABLE"].includes(code)
  )
    return "INVALID_CONFIG";
  if (
    [
      "VALIDATION_FAILED",
      "CONNECTIVITY_MISMATCH",
      "LOST_INSTANCE",
      "MISSING_NET",
    ].includes(code)
  )
    return "VALIDATION_FAILED";
  if (["OUTPUT_EXISTS", "OUTPUT_NOT_WRITABLE"].includes(code)) return "OUTPUT";
  if (
    [
      "INPUT_NOT_FOUND",
      "INPUT_NOT_READABLE",
      "INVALID_INPUT",
      "MASTER_MISSING",
    ].includes(code)
  )
    return "INVALID_SOURCE";
  if (code === "CANCELLED") return "CANCELLED";
  if (code === "TIMEOUT") return "TIMEOUT";
  if (
    code === "ARGUMENT_ERROR" ||
    code === "INVALID_OPTION" ||
    code === "INVALID_SCALE"
  )
    return "INVALID_ARGUMENT";
  if (code === "INTERNAL_ERROR") return "INTERNAL_ERROR";
  return "CONVERSION_FAILED";
}
async function readPersonal(file: string, allowMissing = true) {
  try {
    return await json(file);
  } catch (e) {
    if (allowMissing && (e as NodeJS.ErrnoException).code === "ENOENT")
      return emptyTable;
    throw e;
  }
}
async function readUserConfig(
  file: string,
  allowMissing = true,
): Promise<ResolvedUserConfig> {
  try {
    return resolveUserConfig(await json(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      if (allowMissing) return resolveUserConfig();
      throw new BackendError(
        "CONFIG_NOT_FOUND",
        `Configuration file not found: ${file}`,
        { path: path.resolve(file) },
      );
    }
    if (error instanceof BackendError || error instanceof SyntaxError) {
      if (error instanceof SyntaxError)
        throw new BackendError(
          "INVALID_CONFIG",
          "Configuration file is not valid JSON",
          { path: path.resolve(file), cause: error.message },
        );
      throw error;
    }
    const code = (error as NodeJS.ErrnoException).code;
    if (["EACCES", "EPERM", "EISDIR", "ENOTDIR"].includes(code ?? ""))
      throw new BackendError(
        "CONFIG_NOT_READABLE",
        `Cannot read configuration file: ${file}`,
        { path: path.resolve(file), systemCode: code },
      );
    throw error;
  }
}
async function persistMappings(
  file: string,
  snapshot: unknown,
  edits: unknown,
  catalog: Parameters<typeof saveMappings>[2],
  replace: boolean,
) {
  const dest = path.resolve(file);
  await mkdir(path.dirname(dest), { recursive: true });
  const lock = await open(dest + ".lock", "wx", 0o600);
  let temp: string | undefined;
  try {
    const previous = MappingTableSchema.parse(await readPersonal(dest));
    const result = saveMappings(snapshot, edits, catalog, previous);
    const conflicts = result.changed.filter((k) =>
      Object.hasOwn(previous.devices, k),
    );
    if (conflicts.length && !replace)
      throw new BackendError(
        "MAPPING_CONFLICT",
        "Existing rules differ; inspect changes and use --replace to update them",
        {
          changes: conflicts.map((device) => ({
            device,
            before: previous.devices[device],
            after: result.table.devices[device],
          })),
        },
      );
    temp = await mkdtemp(path.join(path.dirname(dest), ".mapping-stage-"));
    await writeFile(path.join(temp, "mappings.json"), encode(result.table), {
      mode: 0o600,
    });
    await rename(path.join(temp, "mappings.json"), dest);
    return result;
  } finally {
    if (temp) await rm(temp, { recursive: true, force: true });
    await lock.close();
    await rm(dest + ".lock", { force: true });
  }
}
async function bundle(destination: string, files: Record<string, string>) {
  const dest = path.resolve(destination),
    parent = path.dirname(dest);
  await mkdir(parent, { recursive: true });
  const lock = await open(dest + ".lock", "wx", 0o600);
  let temp: string | undefined;
  try {
    try {
      await lstat(dest);
      throw new BackendError("OUTPUT_EXISTS", dest);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    temp = await mkdtemp(path.join(parent, ".vc-stage-"));
    for (const [name, content] of Object.entries(files))
      await writeFile(path.join(temp, name), content, { mode: 0o600 });
    await rename(temp, dest);
    temp = undefined;
  } finally {
    if (temp) await rm(temp, { recursive: true, force: true });
    await lock.close();
    await rm(dest + ".lock", { force: true });
  }
}
async function publishIntoDirectory(
  destination: string,
  projectFile: string,
  files: Record<string, string>,
  replace: boolean,
) {
  const dest = path.resolve(destination);
  await mkdir(dest, { recursive: true });
  const lock = await open(path.join(dest, projectFile + ".lock"), "wx", 0o600);
  const created: string[] = [];
  let stage: string | undefined,
    preserveStage = false;
  try {
    const names = Object.keys(files).sort((a, b) =>
      a === projectFile ? 1 : b === projectFile ? -1 : a.localeCompare(b),
    );
    if (replace) {
      stage = await mkdtemp(path.join(dest, ".vc-replace-"));
      for (const name of names)
        await writeFile(path.join(stage, name), files[name]!, { mode: 0o600 });
      const published: string[] = [];
      const backups: Array<{ target: string; backup: string }> = [];
      try {
        for (const [index, name] of names.entries()) {
          const target = path.join(dest, name);
          try {
            const previous = await lstat(target);
            if (!previous.isFile())
              throw new BackendError(
                "OUTPUT_NOT_WRITABLE",
                `Cannot replace a non-file path: ${target}`,
              );
            const backup = path.join(stage, `backup-${index}`);
            await rename(target, backup);
            backups.push({ target, backup });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
          await rename(path.join(stage, name), target);
          published.push(target);
        }
      } catch (error) {
        try {
          for (const target of published.reverse())
            await rm(target, { force: true });
          for (const { target, backup } of backups.reverse())
            await rename(backup, target);
        } catch (rollbackError) {
          preserveStage = true;
          throw new BackendError(
            "OUTPUT_NOT_WRITABLE",
            `Replacement failed and rollback was incomplete; backups remain in ${stage}: ${String(rollbackError)}`,
          );
        }
        throw error;
      }
      return;
    }
    for (const name of names) {
      const target = path.join(dest, name);
      try {
        await lstat(target);
        throw new BackendError(
          "OUTPUT_EXISTS",
          `File already exists: ${target}. Choose another project filename; existing files were not changed.`,
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    for (const name of names) {
      const target = path.join(dest, name);
      const file = await open(target, "wx", 0o600);
      created.push(target);
      try {
        await file.writeFile(files[name]!);
      } finally {
        await file.close();
      }
    }
  } catch (error) {
    for (const target of created) await rm(target, { force: true });
    throw error;
  } finally {
    if (stage && !preserveStage)
      await rm(stage, { recursive: true, force: true });
    await lock.close();
    await rm(path.join(dest, projectFile + ".lock"), { force: true });
  }
}
const help = `Offline Virtuoso Canvas backend (no Bridge or LLM)
  prepare SNAPSHOT --out NEW_DIRECTORY [--mappings FILE]
  save-mappings SNAPSHOT --settings FILE [--mappings FILE] [--replace]
  convert SNAPSHOT --out DIRECTORY [--project-file NAME.icproj.json] [--flat] [--replace] [--config FILE] [--mappings FILE] [--scale NUMBER] [--bus-mode reject|bundled] [--disabled-instances keep|omit] [--isolated-ports keep|omit] [--unmapped-devices generic-box|error]
  config [FILE]
Default personal files: ~/.config/virtuoso-canvas/config.json and mappings.json.
Legacy commands (kept for compatibility):
  scan SNAPSHOT --out NEW_DIRECTORY
  recommend INVENTORY --out NEW_DIRECTORY [--personal PACKAGE]
  confirm PROPOSAL --decisions FILE --name NAME --out NEW_DIRECTORY [--personal PACKAGE]
  convert SNAPSHOT --package PACKAGE --out NEW_DIRECTORY [--presentation FILE] [--allow-label-overlap]
  catalog
  defaults
convert output: project.icproj.json + report.json; --flat writes NAME.icproj.json + NAME.report.json into an existing directory.
--flat --replace replaces matching files only after conversion succeeds; unrelated files are retained.
--preview adds SVG; --debug retains full diagnostics and inputs.
Conversion status is success, success_with_warnings, error, or cancelled.
Failed conversions save non-visual diagnostics to OUT.failed (numbered on repeated failures), never a project or preview.
All commands return JSON. Bundle output directories must not already exist; --flat only refuses existing filenames.
Confirm never auto-approves; edit decisions.json first. Partial confirmation returns exit code 2.
VC_ROOT selects tools/virtuoso in the Canvas checkout; VC_PYTHON selects the offline compatibility runtime.
`;
const allowed: Record<string, string[]> = {
  prepare: ["out", "mappings"],
  "save-mappings": ["settings", "mappings", "replace"],
  scan: ["out"],
  recommend: ["out", "personal"],
  confirm: ["out", "personal", "decisions", "name"],
  convert: [
    "out",
    "config",
    "package",
    "mappings",
    "presentation",
    "allow-label-overlap",
    "allow-symbol-overlap",
    "scale",
    "bus-mode",
    "disabled-instances",
    "isolated-ports",
    "unmapped-devices",
    "debug",
    "preview",
    "project-file",
    "flat",
    "replace",
  ],
  catalog: [],
  defaults: [],
  config: [],
};
async function main() {
  const args = process.argv.slice(2),
    command = args.shift();
  if (!command || command === "--help" || command === "help") {
    process.stdout.write(help);
    return;
  }
  if (!Object.hasOwn(allowed, command))
    throw new BackendError("ARGUMENT_ERROR", "Unknown command: " + command);
  let input: string | undefined;
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) {
      if (input)
        throw new BackendError("ARGUMENT_ERROR", "Only one input allowed");
      input = arg;
      continue;
    }
    const key = arg.slice(2);
    if (!allowed[command]!.includes(key) || key in flags)
      throw new BackendError(
        "ARGUMENT_ERROR",
        "Unknown or repeated option " + arg,
      );
    if (
      [
        "allow-label-overlap",
        "allow-symbol-overlap",
        "replace",
        "debug",
        "preview",
        "flat",
      ].includes(key)
    )
      flags[key] = true;
    else {
      const value = args[++i];
      if (!value || value.startsWith("--"))
        throw new BackendError("ARGUMENT_ERROR", "Missing value for " + arg);
      flags[key] = value;
    }
  }
  const required = (name: string) => {
    const value = flags[name];
    if (typeof value !== "string")
      throw new BackendError("ARGUMENT_ERROR", "Missing --" + name);
    return value;
  };
  const runtime = {
    root: canvasRoot,
    ...(process.env.VC_PYTHON ? { python: process.env.VC_PYTHON } : {}),
  };
  if (command === "convert")
    failureContext = {
      out: required("out"),
      ...(input ? { input } : {}),
      debug: flags.debug === true,
      stage: "input",
      files: {},
    };
  if (command === "convert" && flags.replace === true && flags.flat !== true)
    throw new BackendError("ARGUMENT_ERROR", "--replace requires --flat");
  const controller = new AbortController(),
    cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  const options: OperationOptions = {
    signal: controller.signal,
    onProgress: (event) =>
      process.stderr.write(
        JSON.stringify({ type: "progress", ...event }) + "\n",
      ),
  };
  try {
    const catalog = await loadCatalog(runtime);
    if (command === "catalog" || command === "defaults") {
      if (input) throw new BackendError("ARGUMENT_ERROR", "No input expected");
      process.stdout.write(
        encode({
          ok: true,
          status: "success",
          result:
            command === "catalog"
              ? await loadFullCatalog(runtime)
              : await defaultPresentation(runtime),
        }),
      );
      return;
    }
    if (command === "config") {
      const configPath = input ?? path.join(personalRoot, "config.json");
      process.stdout.write(
        encode({
          ok: true,
          status: "success",
          source: path.resolve(configPath),
          result: await readUserConfig(configPath, input === undefined),
        }),
      );
      return;
    }
    if (!input) throw new BackendError("ARGUMENT_ERROR", "Input path required");
    const data = await json(input);
    if (failureContext?.debug)
      failureContext.files["source.snapshot.json"] = encode(data);
    if (failureContext) validateSnapshot(data);
    const mappingPath =
      typeof flags.mappings === "string"
        ? flags.mappings
        : path.join(personalRoot, "mappings.json");
    if (command === "save-mappings") {
      const result = await persistMappings(
        mappingPath,
        data,
        await json(required("settings")),
        catalog,
        flags.replace === true,
      );
      process.stdout.write(
        encode({
          ok: true,
          status: "success",
          output: path.resolve(mappingPath),
          result: { changed: result.changed, unresolved: result.unresolved },
        }),
      );
      return;
    }
    const out = required("out");
    const personal =
      typeof flags.personal === "string"
        ? await json(flags.personal)
        : undefined;
    let files: Record<string, string>,
      summary: unknown,
      projectFileForFlat: string | undefined,
      reportFile: string | undefined;
    let status: ResultStatus = "success";
    if (command === "prepare") {
      const fullCatalog = await loadFullCatalog(runtime);
      const result = prepareMappings(
        data,
        await json(path.join(toolRoot, "rules/builtin/mappings.json")),
        catalog,
        await readPersonal(mappingPath),
      );
      files = {
        "mappings.json": encode(result.settings),
        "devices.json": encode(result),
        "catalog.json": encode(fullCatalog),
        "catalog.md": catalogMarkdown(fullCatalog),
        "preview.txt":
          result.items
            .map(
              (i) =>
                `${i.device} [${i.status}]\ninstances: ${i.instances.join(", ")}\npins: ${i.pins.join(", ")}\nmapping: ${JSON.stringify(i.mapping)}\n${i.error ?? ""}`,
            )
            .join("\n\n") + "\n",
      };
      summary = {
        devices: result.items.length,
        unresolved: result.items
          .filter((i) => i.status !== "ready")
          .map((i) => i.device),
      };
    } else if (command === "scan") {
      const inventory = scanDesign(data, options);
      files = { "inventory.json": encode(inventory) };
      summary = {
        masters: inventory.items.length,
        instances: inventory.items.reduce((n, i) => n + i.instances.length, 0),
        warnings: inventory.warnings,
      };
    } else if (command === "recommend") {
      const rules = await json(
        path.join(toolRoot, "rules/builtin/common.json"),
      );
      const proposal = recommendMappings(
        data,
        rules,
        catalog,
        personal,
        options,
      );
      files = {
        "proposal.json": encode(proposal),
        "decisions.json": encode(decisionTemplate(proposal)),
        "preview.txt": previewProposal(proposal),
      };
      summary = {
        items: proposal.items.map((i) => ({
          id: i.itemId,
          status: i.status,
          candidates: i.candidates.length,
        })),
      };
    } else if (command === "confirm") {
      const result = confirmMappings(
        data,
        await json(required("decisions")),
        catalog,
        { ...options, name: required("name"), existing: personal },
      );
      files = {
        "mapping-package.json": encode(result.package),
        "confirmation.json": encode({ unresolved: result.unresolved }),
      };
      summary = {
        entries: result.package.entries.length,
        unresolved: result.unresolved,
      };
      if (result.unresolved.length) process.exitCode = 2;
    } else {
      if (failureContext) failureContext.stage = "configuration";
      const projectFile =
        typeof flags["project-file"] === "string"
          ? flags["project-file"]
          : "project.icproj.json";
      if (
        projectFile.length > 255 ||
        !projectFile.endsWith(".icproj.json") ||
        projectFile === ".icproj.json" ||
        /[\\/\x00-\x1f\x7f]/.test(projectFile)
      )
        throw new BackendError(
          "ARGUMENT_ERROR",
          "Project filename must be a simple NAME.icproj.json",
        );
      projectFileForFlat = projectFile;
      const projectStem = projectFile.slice(0, -".icproj.json".length);
      reportFile =
        flags.flat === true ? `${projectStem}.report.json` : "report.json";
      if (failureContext && flags.flat === true)
        failureContext.out = path.join(out, projectStem);
      if (flags.package && flags.mappings)
        throw new BackendError(
          "ARGUMENT_ERROR",
          "Use either --mappings or legacy --package",
        );
      const configPath =
        typeof flags.config === "string"
          ? flags.config
          : path.join(personalRoot, "config.json");
      let userConfig = await readUserConfig(
        configPath,
        typeof flags.config !== "string",
      );
      if (typeof flags.presentation === "string") {
        const parsed = PresentationConfigSchema.safeParse(
          await json(flags.presentation),
        );
        if (!parsed.success)
          throw new BackendError(
            "INVALID_CONFIG",
            "Legacy presentation configuration is invalid",
            parsed.error.issues,
          );
        const { version: _version, ...presentationSettings } = parsed.data;
        userConfig = resolveUserConfig({
          version: 1,
          conversion: userConfig.conversion,
          presentation: presentationSettings,
        });
      }
      const scale =
        typeof flags.scale === "string"
          ? Number(flags.scale)
          : userConfig.conversion.scale;
      if (!Number.isFinite(scale) || scale <= 0)
        throw new BackendError(
          "INVALID_SCALE",
          "Scale must be a finite positive number",
        );
      const busMode =
        typeof flags["bus-mode"] === "string"
          ? flags["bus-mode"]
          : userConfig.conversion.busMode;
      const disabledInstances =
        typeof flags["disabled-instances"] === "string"
          ? flags["disabled-instances"]
          : userConfig.conversion.disabledInstances;
      const isolatedPorts =
        typeof flags["isolated-ports"] === "string"
          ? flags["isolated-ports"]
          : userConfig.conversion.isolatedPorts;
      const unmappedDevices =
        typeof flags["unmapped-devices"] === "string"
          ? flags["unmapped-devices"]
          : userConfig.conversion.unmappedDevices;
      if (
        !["reject", "bundled"].includes(busMode) ||
        !["keep", "omit"].includes(disabledInstances) ||
        !["keep", "omit"].includes(isolatedPorts) ||
        !["generic-box", "error"].includes(unmappedDevices)
      )
        throw new BackendError(
          "INVALID_OPTION",
          "Invalid conversion policy option",
        );
      const effectiveConfig = resolveUserConfig({
        version: 1,
        conversion: {
          scale,
          busMode,
          disabledInstances,
          isolatedPorts,
          unmappedDevices,
        },
        presentation: userConfig.presentation,
      });
      const presentation = presentationFromUserConfig(effectiveConfig);
      if (failureContext) {
        failureContext.stage = "mapping";
        if (failureContext.debug)
          Object.assign(failureContext.files, {
            "config.json": encode(effectiveConfig),
            "presentation.json": encode(presentation),
          });
      }
      const mappingInput =
        typeof flags.package === "string"
          ? await json(flags.package)
          : prepareMappings(
              data,
              await json(path.join(toolRoot, "rules/builtin/mappings.json")),
              catalog,
              await readPersonal(
                mappingPath,
                typeof flags.mappings !== "string",
              ),
            ).settings;
      if (failureContext) {
        failureContext.stage = "conversion";
        if (failureContext.debug)
          failureContext.files["mappings.json"] = encode(mappingInput);
      }
      const result = await convertDesign(data, mappingInput, {
        ...options,
        runtime,
        presentation,
        allowLabelOverlap: flags["allow-label-overlap"] === true,
        allowSymbolOverlap: flags["allow-symbol-overlap"] === true,
        scale: effectiveConfig.conversion.scale,
        busMode: effectiveConfig.conversion.busMode,
        disabledInstances: effectiveConfig.conversion.disabledInstances,
        isolatedPorts: effectiveConfig.conversion.isolatedPorts,
        unmappedDevices: effectiveConfig.conversion.unmappedDevices,
      });
      const effectiveOptions = {
        ...effectiveConfig.conversion,
        allowLabelOverlap: flags["allow-label-overlap"] === true,
        allowSymbolOverlap: flags["allow-symbol-overlap"] === true,
      };
      result.report.options = effectiveOptions;
      const fullFiles = {
        "source.snapshot.json": encode(data),
        [projectFile]: encode(result.project),
        "filtered.snapshot.json": encode(result.filteredSnapshot),
        "preview.svg": result.svg,
        "report.json": encode(result.report),
        "validation.json": encode(result.validation),
        "refinement.json": encode(result.refinement),
        "mappings.json": encode(mappingInput),
        "config.json": encode(effectiveConfig),
        "presentation.json": encode(presentation),
      };
      const report = result.report;
      const compactReport = Object.fromEntries(
        Object.entries(report).filter(
          ([key]) =>
            ![
              "mapping",
              "mappingPackage",
              "placements",
              "parameterSources",
              "unconvertedShapes",
              "validation",
              "routeRefinement",
            ].includes(key),
        ),
      );
      compactReport.validation = result.validation;
      compactReport.options = effectiveOptions;
      files =
        flags.debug === true
          ? fullFiles
          : {
              [projectFile]: fullFiles[projectFile]!,
              "report.json": encode(compactReport),
            };
      if (flags.preview === true) files["preview.svg"] = result.svg;
      if (flags.flat === true)
        files = Object.fromEntries(
          Object.entries(files).map(([name, content]) => [
            name === projectFile ? name : `${projectStem}.${name}`,
            content,
          ]),
        );
      status = result.status;
      summary = {
        counts: result.report.counts,
        validation: result.validation,
        warnings: result.report.warningSummary,
        information: Array.isArray(result.report.information)
          ? result.report.information.length
          : 0,
      };
    }
    if (controller.signal.aborted)
      throw new BackendError("CANCELLED", "Conversion cancelled");
    if (failureContext) failureContext.stage = "publish";
    if (flags.flat === true && projectFileForFlat)
      await publishIntoDirectory(
        out,
        projectFileForFlat,
        files,
        flags.replace === true,
      );
    else await bundle(out, files);
    failureContext = undefined;
    process.stdout.write(
      encode({
        ok: true,
        status,
        output: path.resolve(out),
        ...(reportFile ? { reportFile } : {}),
        result: summary,
      }),
    );
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}
main().catch(async (error) => {
  const stage = failureContext?.stage;
  const systemCode = (error as NodeJS.ErrnoException).code;
  let result: {
    code: string;
    category: string;
    message: string;
    details?: unknown;
  };
  if (error instanceof BackendError) {
    result = {
      code: error.code,
      category: errorCategory(error.code),
      message: error.message,
      details: error.details,
    };
  } else if (error instanceof z.ZodError) {
    const code = stage === "mapping" ? "INVALID_MAPPING" : "INVALID_INPUT";
    result = {
      code,
      category: errorCategory(code),
      message:
        stage === "mapping"
          ? "Mapping contract validation failed"
          : "Input contract validation failed",
      details: error.issues,
    };
  } else if (error instanceof SyntaxError) {
    const code = stage === "mapping" ? "INVALID_MAPPING" : "INVALID_INPUT";
    result = {
      code,
      category: errorCategory(code),
      message:
        stage === "mapping"
          ? "Mapping file is not valid JSON"
          : "Input file is not valid JSON",
      details: { cause: error.message },
    };
  } else {
    let code = systemCode ?? "INTERNAL_ERROR";
    if (stage === "input" && systemCode === "ENOENT") code = "INPUT_NOT_FOUND";
    else if (stage === "mapping" && systemCode === "ENOENT")
      code = "MAPPING_NOT_FOUND";
    else if (
      stage === "input" &&
      ["EACCES", "EPERM", "EISDIR", "ENOTDIR"].includes(systemCode ?? "")
    )
      code = "INPUT_NOT_READABLE";
    else if (
      stage === "mapping" &&
      ["EACCES", "EPERM", "EISDIR", "ENOTDIR"].includes(systemCode ?? "")
    )
      code = "MAPPING_NOT_READABLE";
    else if (
      stage === "publish" &&
      ["EACCES", "EPERM", "EROFS", "ENOTDIR", "ENOENT", "EEXIST"].includes(
        systemCode ?? "",
      )
    )
      code = "OUTPUT_NOT_WRITABLE";
    result = {
      code,
      category: errorCategory(code),
      message: error instanceof Error ? error.message : String(error),
      ...(systemCode && systemCode !== code ? { details: { systemCode } } : {}),
    };
  }
  const status: ResultStatus =
    result.code === "CANCELLED" ? "cancelled" : "error";
  process.exitCode = status === "cancelled" ? 130 : 1;
  let diagnosticsDirectory: string | undefined,
    diagnosticsWriteError: string | undefined;
  if (failureContext && status === "error") {
    const context = failureContext;
    const details = (result.details ?? {}) as {
      process?: { stdout?: string; stderr?: string };
      diagnostics?: Record<string, unknown>;
    };
    const savedError = {
      ...result,
      stage: context.stage,
      input: context.input,
      status,
    };
    const files: Record<string, string> = {
      ...context.files,
      "error.json": encode({ ok: false, status, error: savedError }),
    };
    if (details.process)
      files["process.log"] = [
        details.process.stdout ?? "",
        details.process.stderr ?? "",
      ].join("\n");
    const names: Record<string, string> = {
      "result.validation.json": "validation.json",
      "result.refinement.json": "refinement.json",
    };
    for (const [name, value] of Object.entries(details.diagnostics ?? {}))
      if (names[name]) files[names[name]!] = encode(value);
    try {
      for (let n = 0; n < 1000; n++) {
        const dest = path.resolve(context.out) + ".failed" + (n ? "-" + n : "");
        try {
          await bundle(dest, files);
          diagnosticsDirectory = dest;
          break;
        } catch (e) {
          if (
            (e instanceof BackendError && e.code === "OUTPUT_EXISTS") ||
            (e as NodeJS.ErrnoException).code === "EEXIST"
          )
            continue;
          throw e;
        }
      }
      if (!diagnosticsDirectory) throw Error("No free diagnostics directory");
    } catch (e) {
      diagnosticsWriteError = e instanceof Error ? e.message : String(e);
    }
  }
  process.stderr.write(
    encode({
      ok: false,
      status,
      error: result,
      ...(diagnosticsDirectory ? { diagnosticsDirectory } : {}),
      ...(diagnosticsWriteError ? { diagnosticsWriteError } : {}),
    }),
  );
});
