#!/usr/bin/env node
import {
  readFile,
  writeFile,
  mkdir,
  open,
  mkdtemp,
  rename,
  rm,
  access,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  prepareMappings,
  validateSnapshot,
  saveMappings,
  scanDesign,
  MappingTableSchema,
  DeviceRuleSchema,
  resolveUserConfig,
  z,
} from "@icm/virtuoso-import/core";
import {
  loadCatalog,
  loadFullCatalog,
} from "@icm/virtuoso-import/canvas-adapter";
import {
  protocolEvent,
  renderScanResult,
  renderMappingApplied,
  renderConfigResult,
  renderExportComplete,
  renderExportFailure,
} from "./skill-protocol.js";

const runtimeRoot = fileURLToPath(new URL("../../", import.meta.url));
const toolRoot = process.env.VC_ROOT ?? runtimeRoot;
const canvasRoot = path.resolve(toolRoot, "../..");
const personalRoot =
  process.env.VC_PERSONAL_DIR ??
  path.join(os.homedir(), ".config", "virtuoso-canvas");
const readJson = async (file: string) =>
  JSON.parse(await readFile(file, "utf8"));
const emptyTable = { version: 1, devices: {} };
const EditSchema = z.strictObject({
  version: z.literal(1),
  device: z.string().regex(/^[^/]+\/[^/]+$/),
  rule: DeviceRuleSchema.nullable(),
});
const ExportOptionsSchema = z.strictObject({
  scale: z.number().finite().positive(),
  busMode: z.enum(["reject", "bundled"]),
  disabledInstances: z.enum(["keep", "omit"]),
  isolatedPorts: z.enum(["keep", "omit"]),
  showInstanceNames: z.boolean(),
});

async function readPersonal(file: string) {
  try {
    return MappingTableSchema.parse(await readJson(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return MappingTableSchema.parse(emptyTable);
    throw error;
  }
}

async function savePersonal(
  file: string,
  snapshot: unknown,
  edit: unknown,
  catalog: Awaited<ReturnType<typeof loadCatalog>>,
) {
  const dest = path.resolve(file);
  await mkdir(path.dirname(dest), { recursive: true });
  const lock = await open(dest + ".lock", "wx", 0o600);
  let temp: string | undefined;
  try {
    const previous = await readPersonal(dest);
    const result = saveMappings(snapshot, edit, catalog, previous);
    temp = await mkdtemp(path.join(path.dirname(dest), ".mapping-stage-"));
    const staged = path.join(temp, "mappings.json");
    await writeFile(staged, JSON.stringify(result.table, null, 2) + "\n", {
      mode: 0o600,
    });
    await rename(staged, dest);
  } finally {
    if (temp) await rm(temp, { recursive: true, force: true });
    await lock.close();
    await rm(dest + ".lock", { force: true });
  }
}

async function readConfig(file: string) {
  try {
    return resolveUserConfig(await readJson(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return resolveUserConfig();
    throw error;
  }
}

function parseNetNames(value: string): string[] {
  if (!value.trim()) return [];
  if (value.includes(","))
    throw Object.assign(
      new Error("Separate network names with spaces, not commas"),
      { code: "INVALID_CONFIG" },
    );
  return value.trim().split(/\s+/u);
}

async function handleConfig(mode: string, flags: Record<string, string>) {
  const file = path.resolve(
    flags["--config"] ?? path.join(personalRoot, "config.json"),
  );
  let config = await readConfig(file);
  if (mode === "save") {
    config = resolveUserConfig({
      ...config,
      presentation: {
        ...config.presentation,
        powerNets: parseNetNames(flags["--power-nets"]!),
        groundNets: parseNetNames(flags["--ground-nets"]!),
      },
    });
    await mkdir(path.dirname(file), { recursive: true });
    const lock = await open(file + ".lock", "wx", 0o600);
    let temp: string | undefined;
    try {
      // Re-read under the lock so unrelated settings saved by another process survive.
      const latest = await readConfig(file);
      const merged = resolveUserConfig({
        ...latest,
        presentation: {
          ...latest.presentation,
          powerNets: config.presentation.powerNets,
          groundNets: config.presentation.groundNets,
        },
      });
      temp = await mkdtemp(path.join(path.dirname(file), ".config-stage-"));
      await writeFile(
        path.join(temp, "config.json"),
        JSON.stringify(merged, null, 2) + "\n",
        { mode: 0o600 },
      );
      await rename(path.join(temp, "config.json"), file);
      config = merged;
    } finally {
      if (temp) await rm(temp, { recursive: true, force: true });
      await lock.close();
      await rm(file + ".lock", { force: true });
    }
  }
  await writeFile(
    flags["--out"]!,
    renderConfigResult(
      mode as "load" | "save",
      config.presentation.powerNets,
      config.presentation.groundNets,
      file,
    ),
    { flag: "wx", mode: 0o600 },
  );
}

async function assertNewProjectFiles(
  output: string,
  projectFile: string,
  replace: boolean,
) {
  if (replace) return;
  const stem = projectFile.endsWith(".icproj.json")
    ? projectFile.slice(0, -".icproj.json".length)
    : projectFile;
  for (const name of [projectFile, `${stem}.report.json`]) {
    const file = path.join(output, name);
    try {
      await access(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    throw Object.assign(
      new Error(
        `File already exists: ${file}. Choose another project filename; existing files were not changed.`,
      ),
      { code: "OUTPUT_EXISTS" },
    );
  }
}

function exportDiagnostics(report: any, project: any) {
  const diagnostics: Array<{ severity: string; message: string }> = [];
  const boxes = report.genericBoxes ?? [];
  if (boxes.length)
    diagnostics.push({
      severity: "warning",
      message: `${boxes.length} device(s) use generic boxes; their internal circuits are not represented. Check report.json for the affected instances.`,
    });
  const buses = report.bundledBuses ?? [];
  if (buses.length)
    diagnostics.push({
      severity: "warning",
      message: `${buses.length} bus net(s) are drawn as bundles; bit-level connectivity is not represented. Check report.json for bus names.`,
    });
  for (const message of report.warnings ?? []) {
    if (
      typeof message !== "string" ||
      message.startsWith("Symbol labels retain raw expressions;") ||
      message.startsWith("Pin centers are geometric centers,") ||
      message.startsWith("Single-level export;") ||
      message.startsWith("Connectivity is read as stored;") ||
      /^Bus .+ is not expanded$/.test(message) ||
      message.includes("generic box preserves external pins only;") ||
      message.startsWith("Bundled buses are drawing abstractions;") ||
      message.startsWith("Disabled instances mode:")
    )
      continue;
    diagnostics.push({ severity: "warning", message });
  }
  const markers = new Map<string, any>(
    (report.endpointMarkers ?? []).map((marker: any) => [marker.id, marker]),
  );
  const netNames = new Map<string, string>();
  const document = project.documents?.[0];
  for (const net of document?.nets ?? []) {
    const marker = net.terminals
      ?.map((terminal: any) => markers.get(terminal.instanceId))
      .find(Boolean);
    if (marker) netNames.set(net.id, marker.name);
  }
  const routeNames = new Map<string, string>(
    (document?.routes ?? []).map((route: any) => [
      route.id,
      netNames.get(route.netId) ?? route.id,
    ]),
  );
  const pairedMarkers = new Set<string>();
  for (const item of report.validation?.visual ?? []) {
    const match =
      item.code === "VISUAL_TERMINAL_ON_FOREIGN_ROUTE" &&
      /^Terminal (end-marker-[^:]+):[^ ]+ lies on unrelated route (route-\S+)$/.exec(
        item.message ?? "",
      );
    if (match) {
      const marker = markers.get(match[1]!);
      if (marker) {
        pairedMarkers.add(match[1]!);
        const other = routeNames.get(match[2]!) ?? match[2]!;
        diagnostics.push({
          severity: "warning",
          message: `Endpoint ${marker.name} at (${marker.at.x}, ${marker.at.y}) touches unrelated ${other} route; move the endpoint or route to avoid a false visual connection.`,
        });
        continue;
      }
    }
    if (
      item.code === "VISUAL_WIRE_THROUGH_SYMBOL" &&
      pairedMarkers.has(
        /instance (end-marker-\S+)$/.exec(item.message ?? "")?.[1] ?? "",
      )
    )
      continue;
    if (
      typeof item.message === "string" &&
      ["warning", "error", "info"].includes(item.severity)
    )
      diagnostics.push({
        severity: item.severity,
        message: `[${item.code ?? "DIAGNOSTIC"}] ${item.message}`,
      });
  }
  for (const item of report.validation?.erc ?? [])
    if (
      typeof item.message === "string" &&
      ["warning", "error", "info"].includes(item.severity)
    )
      diagnostics.push({
        severity: item.severity,
        message: `[${item.code ?? "DIAGNOSTIC"}] ${item.message}`,
      });
  return diagnostics;
}

async function runCli(args: string[]) {
  return await new Promise<{ code: number; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const environment = { ...process.env };
      for (const name of [
        "PYTHONHOME",
        "PYTHONPATH",
        "PYTHONSTARTUP",
        "PYTHONUSERBASE",
        "LD_LIBRARY_PATH",
      ])
        delete environment[name];
      environment.VC_ROOT = process.env.VC_ROOT ?? runtimeRoot;
      const child = spawn(
        process.execPath,
        [path.join(runtimeRoot, "dist/cli/main.js"), ...args],
        {
          cwd: runtimeRoot,
          env: environment,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const stdout: Buffer[] = [],
        stderr: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.once("error", reject);
      child.once("close", (code) =>
        resolve({
          code: code ?? 1,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        }),
      );
    },
  );
}

function conversionFailure(stderr: string) {
  const marker = '{\n  "ok": false';
  const start = stderr.lastIndexOf(marker);
  if (start >= 0) {
    try {
      const parsed = JSON.parse(stderr.slice(start));
      const detail = parsed.error?.details;
      const lines: string[] = [];
      const validation = detail?.diagnostics?.["result.validation.json"];
      if (validation) {
        const counts = new Map<string, number>();
        for (const item of [
          ...(validation.visual ?? []),
          ...(validation.erc ?? []),
        ]) {
          if (
            !["error", "warning"].includes(item?.severity) ||
            typeof item.code !== "string"
          )
            continue;
          counts.set(item.code, (counts.get(item.code) ?? 0) + 1);
        }
        if (counts.size)
          lines.push(
            `Validation findings: ${[...counts].map(([code, count]) => `${code} (${count})`).join(", ")}`,
          );
      }
      if (typeof detail?.process?.stderr === "string") {
        const processLines = detail.process.stderr
          .split(/\r?\n/)
          .map((line: string) => line.trim())
          .filter(Boolean);
        lines.push(
          ...(processLines.length > 10
            ? [...processLines.slice(0, 2), ...processLines.slice(-8)]
            : processLines),
        );
      } else if (Array.isArray(detail))
        lines.push(
          ...detail
            .slice(0, 8)
            .map(
              (issue: any) =>
                `${Array.isArray(issue.path) ? issue.path.join(".") : "input"}: ${issue.message ?? JSON.stringify(issue)}`,
            ),
        );
      else if (detail?.cause) lines.push(String(detail.cause));
      else if (detail && !validation)
        lines.push(JSON.stringify(detail).slice(0, 1200));
      const error = Object.assign(
        new Error(parsed.error?.message ?? "Conversion failed"),
        {
          code: parsed.error?.code ?? "CONVERSION_FAILED",
          diagnosticsDirectory: parsed.diagnosticsDirectory ?? "",
          detailLines: lines
            .slice(0, 12)
            .map((line: string) => line.slice(0, 400)),
        },
      );
      return error;
    } catch {
      /* retain the complete child output below */
    }
  }
  return Object.assign(new Error(stderr.trim() || "Conversion failed"), {
    code: "CONVERSION_FAILED",
  });
}

async function exportDesign(
  source: string,
  flags: Record<string, string>,
  mappingPath: string,
) {
  const output = flags["--out"]!,
    resultPath = flags["--result"]!;
  const requestedName = flags["--project-file"]!;
  const projectFile = requestedName.endsWith(".icproj.json")
    ? requestedName
    : `${requestedName}.icproj.json`;
  const replace = flags["--replace"] === "true";
  if (
    projectFile.length > 255 ||
    !projectFile.endsWith(".icproj.json") ||
    projectFile === ".icproj.json" ||
    /[\\/\x00-\x1f\x7f]/.test(projectFile)
  )
    throw Object.assign(
      new Error("Project filename must be a simple NAME.icproj.json"),
      { code: "ARGUMENT_ERROR" },
    );
  await assertNewProjectFiles(output, projectFile, replace);
  const options = ExportOptionsSchema.parse({
    scale: Number(flags["--scale"]),
    busMode: flags["--bus-mode"],
    disabledInstances: flags["--disabled-instances"],
    isolatedPorts: flags["--isolated-ports"],
    showInstanceNames:
      flags["--show-instance-names"] === "true"
        ? true
        : flags["--show-instance-names"] === "false"
          ? false
          : flags["--show-instance-names"],
  });
  const personal = await readPersonal(mappingPath);
  const session = MappingTableSchema.parse(await readJson(flags["--session"]!));
  const baseConfig = await readConfig(
    flags["--config"] ?? path.join(personalRoot, "config.json"),
  );
  const config = resolveUserConfig({
    version: 1,
    conversion: {
      ...baseConfig.conversion,
      scale: options.scale,
      busMode: options.busMode,
      disabledInstances: options.disabledInstances,
      isolatedPorts: options.isolatedPorts,
    },
    presentation: {
      ...baseConfig.presentation,
      showInstanceNames: options.showInstanceNames,
      ...(flags["--power-nets"] !== undefined
        ? { powerNets: parseNetNames(flags["--power-nets"]) }
        : {}),
      ...(flags["--ground-nets"] !== undefined
        ? { groundNets: parseNetNames(flags["--ground-nets"]) }
        : {}),
    },
  });
  const temp = await mkdtemp(path.join(os.tmpdir(), "vcui-export-"));
  try {
    const mappings = path.join(temp, "mappings.json"),
      configPath = path.join(temp, "config.json");
    await writeFile(
      mappings,
      JSON.stringify(
        { version: 1, devices: { ...personal.devices, ...session.devices } },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", {
      mode: 0o600,
    });
    const run = await runCli([
      "convert",
      source,
      "--out",
      output,
      "--project-file",
      projectFile,
      "--flat",
      ...(replace ? ["--replace"] : []),
      "--mappings",
      mappings,
      "--config",
      configPath,
    ]);
    if (run.code !== 0) throw conversionFailure(run.stderr);
    const response = JSON.parse(run.stdout);
    if (
      !response.ok ||
      !["success", "success_with_warnings"].includes(response.status)
    )
      throw Object.assign(new Error("Unexpected conversion response"), {
        code: "CONVERSION_FAILED",
      });
    const report = await readJson(
      path.join(response.output, response.reportFile),
    );
    const project = await readJson(path.join(response.output, projectFile));
    const diagnostics = exportDiagnostics(report, project);
    const uiStatus = diagnostics.some(
      (item) => item.severity === "warning" || item.severity === "error",
    )
      ? "success_with_warnings"
      : "success";
    await writeFile(
      resultPath,
      renderExportComplete(uiStatus, response.output, projectFile, diagnostics),
      { flag: "wx", mode: 0o600 },
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function main(args: string[]) {
  const command = args[0];
  const source = args[1];
  if (!source || !["scan", "apply", "export", "config"].includes(command ?? ""))
    throw new Error("USAGE");
  const flags: Record<string, string> = {};
  for (let i = 2; i < args.length; i += 2) {
    const key = args[i],
      value = args[i + 1];
    if (
      !key?.startsWith("--") ||
      value === undefined ||
      Object.hasOwn(flags, key)
    )
      throw new Error("USAGE");
    flags[key] = value;
  }
  const allowed =
    command === "config"
      ? ["--out", "--config", "--power-nets", "--ground-nets"]
      : command === "scan"
        ? ["--out", "--mappings"]
        : command === "apply"
          ? ["--out", "--edit", "--mode", "--mappings"]
          : [
              "--out",
              "--result",
              "--project-file",
              "--session",
              "--mappings",
              "--config",
              "--scale",
              "--bus-mode",
              "--disabled-instances",
              "--isolated-ports",
              "--show-instance-names",
              "--power-nets",
              "--ground-nets",
              "--replace",
            ];
  if (
    Object.keys(flags).some((key) => !allowed.includes(key)) ||
    !flags["--out"] ||
    (command === "apply" &&
      (!flags["--edit"] ||
        !["session", "personal"].includes(flags["--mode"] ?? ""))) ||
    (command === "config" &&
      (!["load", "save"].includes(source) ||
        (source === "save" &&
          (flags["--power-nets"] === undefined ||
            flags["--ground-nets"] === undefined))))
  )
    throw new Error("USAGE");
  if (
    command === "export" &&
    [
      "--result",
      "--project-file",
      "--session",
      "--scale",
      "--bus-mode",
      "--disabled-instances",
      "--isolated-ports",
      "--show-instance-names",
    ].some((key) => !flags[key])
  )
    throw new Error("USAGE");
  if (
    command === "export" &&
    flags["--replace"] &&
    !["true", "false"].includes(flags["--replace"])
  )
    throw new Error("USAGE");
  const out = flags["--out"]!;
  if (command === "config") {
    process.stdout.write(protocolEvent("PROGRESS", "config"));
    await handleConfig(source, flags);
    process.stdout.write(protocolEvent("DONE", "config"));
    return;
  }
  const mappingPath =
    flags["--mappings"] ?? path.join(personalRoot, "mappings.json");
  process.stdout.write(protocolEvent("PROGRESS", command!));
  const snapshot = validateSnapshot(await readJson(source));
  const runtime = { root: canvasRoot };
  if (command === "export") {
    await access(path.dirname(flags["--result"]!));
    await exportDesign(source, flags, mappingPath);
    process.stdout.write(protocolEvent("DONE", "export"));
    return;
  }
  const catalog = await loadCatalog(runtime);
  if (command === "apply") {
    const edit = EditSchema.parse(await readJson(flags["--edit"]!));
    const inventory = scanDesign(snapshot);
    if (
      !inventory.items.some(
        (item) => `${item.master.library}/${item.master.cell}` === edit.device,
      )
    )
      throw Object.assign(
        new Error(`Device not present in snapshot: ${edit.device}`),
        { code: "DEVICE_NOT_FOUND" },
      );
    const table = MappingTableSchema.parse({
      version: 1,
      devices: { [edit.device]: edit.rule },
    });
    await access(path.dirname(out));
    const result = await open(out, "wx", 0o600);
    try {
      if (flags["--mode"] === "personal")
        await savePersonal(mappingPath, snapshot, table, catalog);
      else saveMappings(snapshot, table, catalog);
      await result.writeFile(
        renderMappingApplied(
          edit.device,
          flags["--mode"] as "session" | "personal",
          flags["--mode"] === "personal" ? path.resolve(mappingPath) : "",
        ),
      );
    } catch (error) {
      await result.close();
      await rm(out, { force: true });
      throw error;
    }
    await result.close();
    process.stdout.write(protocolEvent("DONE", "apply"));
    return;
  }
  const builtin = await readJson(
    path.join(toolRoot, "rules/builtin/mappings.json"),
  );
  const personal = await readPersonal(mappingPath);
  const prepared = prepareMappings(snapshot, builtin, catalog, personal);
  const fullCatalog = await loadFullCatalog(runtime);
  await writeFile(
    out,
    renderScanResult(snapshot, prepared, catalog, fullCatalog),
    { flag: "wx", mode: 0o600 },
  );
  process.stdout.write(protocolEvent("DONE", "scan"));
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const stage = ["apply", "export", "config"].includes(process.argv[2] ?? "")
    ? process.argv[2]!
    : "scan";
  const code =
    error instanceof Error && error.message === "USAGE"
      ? "USAGE"
      : ((error as NodeJS.ErrnoException)?.code ??
        (stage === "apply"
          ? "MAPPING_INVALID"
          : stage === "export"
            ? "CONVERSION_FAILED"
            : stage === "config"
              ? "INVALID_CONFIG"
              : "SCAN_FAILED"));
  process.stdout.write(protocolEvent("ERROR", stage, code));
  process.stderr.write(String(error) + "\n");
  process.exitCode = 1;
  if (stage === "export") {
    const resultIndex = process.argv.indexOf("--result");
    const resultPath =
      resultIndex >= 0 ? process.argv[resultIndex + 1] : undefined;
    if (resultPath) {
      const details = (error as { detailLines?: string[] }).detailLines ?? [];
      const directory =
        (error as { diagnosticsDirectory?: string }).diagnosticsDirectory ?? "";
      writeFile(
        resultPath,
        renderExportFailure(
          code,
          error instanceof Error ? error.message : String(error),
          directory,
          details,
        ),
        { flag: "wx", mode: 0o600 },
      ).catch((writeError) => {
        process.stderr.write(
          `Cannot write export response: ${String(writeError)}\n`,
        );
      });
    }
  }
});
