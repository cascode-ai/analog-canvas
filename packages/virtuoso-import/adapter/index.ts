import { readFile, writeFile, mkdtemp, rm, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { CircuitProjectSchema } from "@icm/model";
import { parseProject } from "@icm/project-protocol";
import {
  builtInSymbols,
  razaviSymbolCatalogEntries,
  razaviSymbolCatalogIdentity,
  razaviSemanticPrimitives,
  expandedDeviceCatalogEntries,
} from "@icm/symbols";
import { createGenericBoxes } from "./generic-box.js";
import {
  scanDesign,
  resolveMappings,
  validateSnapshot,
  projectMappings,
  stable,
  BackendError,
  type Catalog,
  type MappingPackage,
  type OperationOptions,
  type Snapshot,
} from "../core/index.js";

export interface Runtime {
  root: string;
  python?: string;
  timeoutMs?: number;
}
export interface ConversionResult {
  status: "success" | "success_with_warnings";
  filteredSnapshot: Snapshot;
  project: ReturnType<typeof CircuitProjectSchema.parse>;
  report: Record<string, unknown>;
  validation: Record<string, unknown>;
  refinement: unknown;
  svg: string;
}
const supported = [
  { id: "nmos", parameters: ["w", "l", "m", "nf"] },
  { id: "pmos", parameters: ["w", "l", "m", "nf"] },
  { id: "npn", parameters: [] },
  { id: "pnp", parameters: [] },
  { id: "resistor", parameters: ["r", "m"], deviceClass: "resistor" },
  { id: "capacitor", parameters: ["c", "m"], deviceClass: "capacitor" },
  { id: "current-source", parameters: ["dc"], deviceClass: "current-source" },
  { id: "voltage-source", parameters: ["dc"] },
  { id: "pulse-voltage-source", parameters: [] },
  { id: "ground", parameters: [] },
  { id: "voltage-controlled-switch", parameters: [] },
  { id: "port", parameters: [] },
];
export async function loadCatalog(runtime: Runtime): Promise<Catalog> {
  void runtime;
  const entries = [];
  for (const spec of supported) {
    const asset = builtInSymbols.find((symbol) => symbol.id === spec.id);
    if (!asset)
      throw new BackendError(
        "UPSTREAM_SYMBOL_MISSING",
        `Analog Canvas symbol missing: ${spec.id}`,
      );
    entries.push({
      ...spec,
      pins: asset.pins.map((p: { name: string }) => p.name) as string[],
    });
  }
  return entries;
}
export async function loadFullCatalog(runtime: Runtime) {
  void runtime;
  const convertible = await loadCatalog(runtime);
  const symbols = [];
  const entries = [
    ...razaviSymbolCatalogEntries,
    ...expandedDeviceCatalogEntries.map((entry) => ({
      ...entry,
      name:
        builtInSymbols.find((symbol) => symbol.id === entry.symbolId)?.name ??
        entry.symbolId,
      palette: true,
      manualOnlyReason:
        "Extended device; explicit converter mapping is not implemented.",
    })),
  ];
  for (const entry of entries) {
    const asset = builtInSymbols.find((symbol) => symbol.id === entry.symbolId);
    if (!asset)
      throw new BackendError(
        "UPSTREAM_SYMBOL_MISSING",
        `Analog Canvas symbol missing: ${entry.symbolId}`,
      );
    const mapping = convertible.find((s) => s.id === entry.symbolId);
    symbols.push({
      id: entry.symbolId,
      name: entry.name,
      category: entry.category,
      pins: asset.pins.map((p: { name: string }) => p.name),
      conversion: mapping
        ? "supported"
        : ["ground", "vdd-port"].includes(entry.symbolId)
          ? "automatic-marker-only"
          : "not-implemented",
      mappingParameters: mapping?.parameters ?? [],
      palette: entry.palette,
      manualOnlyReason: entry.manualOnlyReason ?? null,
    });
  }
  return {
    library: {
      id: razaviSymbolCatalogIdentity.id,
      version: razaviSymbolCatalogIdentity.version,
    },
    symbols,
    semanticPrimitives: razaviSemanticPrimitives,
    genericBox: { supported: true },
  };
}

export function catalogMarkdown(
  catalog: Awaited<ReturnType<typeof loadFullCatalog>>,
) {
  const status: Record<string, string> = {
    supported: "可直接映射",
    "automatic-marker-only": "仅自动电源/地标记",
    "not-implemented": "转换器尚未适配",
  };
  return (
    "# Analog Canvas 完整符号表\n\n基于 upstream-lock.json 锁定的 Analog Canvas 符号库，包含 Razavi 和 Extended Devices。上游存在符号不等于转换器已经支持。参数列只列转换器支持的映射参数。\n\n" +
    "| symbol | 名称 | 分类 | 引脚 | 转换支持 | 映射参数 |\n| --- | --- | --- | --- | --- | --- |\n" +
    catalog.symbols
      .map(
        (s) =>
          `| ${s.id} | ${s.name} | ${s.category} | ${s.pins.join(", ")} | ${status[s.conversion]} | ${s.mappingParameters.join(", ") || "-"} |`,
      )
      .join("\n") +
    "\n\n## 连接语义元素\n\n" +
    catalog.semanticPrimitives
      .map((s: { id: string }) => `- ${s.id}：连接语义元素，不是器件映射目标。`)
      .join("\n") +
    "\n"
  );
}
export async function defaultPresentation(runtime: Runtime): Promise<unknown> {
  return JSON.parse(
    await readFile(
      path.join(
        runtime.root,
        "packages/virtuoso-import/engine/presentation_config.json",
      ),
      "utf8",
    ),
  );
}
async function run(
  command: string,
  args: string[],
  runtime: Runtime,
  options: OperationOptions,
): Promise<{ stdout: string; stderr: string }> {
  if (options.signal?.aborted)
    throw new BackendError("CANCELLED", "Conversion cancelled");
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: runtime.root,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH:
          path.dirname(process.execPath) +
          path.delimiter +
          (process.env.PATH ?? ""),
      },
    });
    let stdout = "",
      stderr = "",
      failure: BackendError | undefined;
    const stop = () => {
      try {
        if (child.pid && process.platform !== "win32")
          process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        /* Process may already have exited. */
      }
    };
    const abort = () => {
      failure = new BackendError("CANCELLED", "Conversion cancelled");
      stop();
    };
    const timer = setTimeout(() => {
      failure = new BackendError("TIMEOUT", "Conversion exceeded timeout");
      stop();
    }, runtime.timeoutMs ?? 120000);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    };
    child.stdout.on("data", (c) => {
      stdout += String(c);
      if (stdout.length > 2_000_000) {
        failure = new BackendError(
          "OUTPUT_LIMIT",
          "Converter output exceeded limit",
        );
        stop();
      }
    });
    child.stderr.on("data", (c) => {
      stderr += String(c);
      if (stderr.length > 2_000_000) {
        failure = new BackendError(
          "OUTPUT_LIMIT",
          "Converter output exceeded limit",
        );
        stop();
      }
    });
    child.on("error", (e) => {
      cleanup();
      reject(new BackendError("RUNTIME_ERROR", e.message));
    });
    child.on("close", (code) => {
      cleanup();
      if (failure) {
        failure.details = { code, stdout, stderr };
        reject(failure);
      } else if (code !== 0)
        reject(
          new BackendError(
            "CONVERSION_FAILED",
            "Native conversion or validation failed",
            { code, stdout, stderr },
          ),
        );
      else resolve({ stdout, stderr });
    });
  });
}

export async function convertDesign(
  input: unknown,
  packageInput: MappingPackage | unknown,
  options: OperationOptions & {
    runtime: Runtime;
    presentation?: unknown;
    allowLabelOverlap?: boolean;
    allowSymbolOverlap?: boolean;
    scale?: number;
    busMode?: "reject" | "bundled";
    disabledInstances?: "keep" | "omit";
    isolatedPorts?: "keep" | "omit";
    unmappedDevices?: "generic-box" | "error";
  },
): Promise<ConversionResult> {
  const scale = options.scale ?? 160;
  const busMode = options.busMode ?? "reject";
  const disabledInstances = options.disabledInstances ?? "keep";
  const isolatedPorts = options.isolatedPorts ?? "omit";
  const unmappedDevices = options.unmappedDevices ?? "generic-box";
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
  if (!Number.isFinite(scale) || scale <= 0)
    throw new BackendError(
      "INVALID_SCALE",
      "Scale must be a finite positive number",
    );
  const source = validateSnapshot(input),
    inventory = scanDesign(source, options),
    catalog = await loadCatalog(options.runtime);
  const projection =
    packageInput &&
    typeof packageInput === "object" &&
    "devices" in packageInput
      ? projectMappings(source, packageInput, catalog, {
          disabledInstances,
          isolatedPorts,
          unmappedDevices,
        })
      : undefined;
  const snapshot = projection?.snapshot ?? source;
  if (!projection && disabledInstances === "omit")
    throw new BackendError(
      "LEGACY_OPTION_UNSUPPORTED",
      "disabledInstances=omit requires the current mappings.json format",
    );
  const mappings =
    projection?.mappings ?? resolveMappings(inventory, packageInput, catalog);
  const boxes = createGenericBoxes(snapshot, mappings, scale);
  for (const net of snapshot.nets)
    if (
      busMode === "reject" &&
      typeof net.numBits === "number" &&
      net.numBits > 1
    )
      throw new BackendError(
        "BUS_UNSUPPORTED",
        `Bus ${net.name} must be expanded explicitly`,
      );
  for (const i of snapshot.instances)
    if (typeof i.arrayCount === "number" && i.arrayCount > 1)
      throw new BackendError(
        "UNSUPPORTED_INSTANCE_ARRAY",
        `Array ${i.name} must be expanded explicitly`,
        { instanceId: i.id, name: i.name, arrayCount: i.arrayCount },
      );
  const filtered = structuredClone(snapshot);
  const rules = filtered.instances.map((i) => {
    const mapping = mappings.get(i.id)!;
    const spec = catalog.find((s) => s.id === mapping.symbol);
    const keep = new Set(Object.keys(mapping.parameters));
    i.properties = i.properties.filter((p) => keep.has(p.name));
    i.effectiveCdfParameters = i.effectiveCdfParameters.filter((p) =>
      keep.has(p.name),
    );
    return {
      instanceId: i.id,
      library: i.library,
      cell: i.cell,
      symbol: mapping.symbol,
      pins: mapping.pins,
      parameters: Object.fromEntries(
        Object.entries(mapping.parameters).map(([from, to]) => [
          from.toLowerCase(),
          to,
        ]),
      ),
      ...(spec?.deviceClass ? { deviceClass: spec.deviceClass } : {}),
      ...(boxes.instances[i.id]
        ? {
            externalDefinitionId: boxes.instances[i.id]!.definitionId,
            masterLabel: boxes.instances[i.id]!.label,
          }
        : {}),
    };
  });
  const dir = await mkdtemp(path.join(os.tmpdir(), "virtuoso-canvas-"));
  try {
    if (options.signal?.aborted)
      throw new BackendError("CANCELLED", "Conversion cancelled");
    options.onProgress?.({ stage: "convert", completed: 0, total: 1 });
    const inputFile = path.join(dir, "snapshot.json"),
      mappingFile = path.join(dir, "mapping.json"),
      styleFile = path.join(dir, "presentation.json");
    await writeFile(inputFile, JSON.stringify(filtered));
    await writeFile(
      mappingFile,
      JSON.stringify({
        version: 1,
        grid: 10,
        scale,
        rules,
        customSymbols: boxes.symbols,
        externalDefinitions: boxes.definitions,
        symbolDefinitions: Object.fromEntries(
          [...new Set(rules.map((rule) => rule.symbol))]
            .map((id) => [
              id,
              builtInSymbols.find((symbol) => symbol.id === id),
            ])
            .filter(
              (entry): entry is [string, NonNullable<(typeof entry)[1]>] =>
                entry[1] !== undefined,
            ),
        ),
        portPinAt: (() => {
          const pin = builtInSymbols
            .find((symbol) => symbol.id === "port")
            ?.pins.find((pin) => pin.name === "P");
          if (!pin)
            throw new BackendError(
              "UPSTREAM_SYMBOL_MISSING",
              "Analog Canvas port pin missing",
            );
          return [pin.at.x, pin.at.y];
        })(),
      }),
    );
    await writeFile(
      styleFile,
      JSON.stringify(
        options.presentation ?? (await defaultPresentation(options.runtime)),
      ),
    );
    const output = path.join(dir, "result.icproj.json");
    const args = [
      path.join(
        options.runtime.root,
        "packages/virtuoso-import/engine/convert_canvas.py",
      ),
      inputFile,
      "--mapping",
      mappingFile,
      "--presentation",
      styleFile,
      "--output",
      output,
    ];
    if (options.allowLabelOverlap) args.push("--allow-label-overlap");
    if (options.allowSymbolOverlap) args.push("--allow-symbol-overlap");
    try {
      await run(
        options.runtime.python ?? "python3",
        args,
        options.runtime,
        options,
      );
    } catch (error) {
      // Return failure diagnostics as data before cleaning private scratch files.
      if (error instanceof BackendError) {
        const diagnostics: Record<string, unknown> = {};
        for (const name of await readdir(dir))
          if (name.includes(".failed-")) {
            for (const file of await readdir(path.join(dir, name))) {
              if (file.endsWith(".json"))
                diagnostics[file] = JSON.parse(
                  await readFile(path.join(dir, name, file), "utf8"),
                );
            }
          }
        if (diagnostics["result.validation.json"]) {
          error.code = "VALIDATION_FAILED";
          error.message = "Generated project did not pass validation";
        }
        error.details = { process: error.details, diagnostics };
      }
      throw error;
    }
    const readJson = async (name: string) =>
      JSON.parse(await readFile(path.join(dir, name), "utf8"));
    let project: ReturnType<typeof CircuitProjectSchema.parse>;
    try {
      project = parseProject(
        await readFile(path.join(dir, "result.icproj.json"), "utf8"),
      );
    } catch (error) {
      throw new BackendError(
        "VALIDATION_FAILED",
        "Generated project does not match the Analog Canvas schema",
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
    const rawReport = await readJson("result.icproj.report.json");
    const validation = await readJson("result.validation.json");
    const warnings = [
      ...(Array.isArray(rawReport.warnings) ? rawReport.warnings : []),
      ...(snapshot.nets.some((n) => Number(n.numBits) > 1)
        ? [
            "Bundled buses are drawing abstractions; bit connectivity and simulation equivalence are not verified. See bundledBuses.",
          ]
        : []),
      ...(source.instances.some((i) =>
        i.properties.some((p) => p.name === "nlAction" && p.value === "ignore"),
      )
        ? [
            `Disabled instances mode: ${disabledInstances}; retained instances use ordinary symbols. See disabledInstances.`,
          ]
        : []),
    ];
    const warningSummary = {
      messages: warnings.length,
      visual: Array.isArray(validation.visualWarnings)
        ? validation.visualWarnings.length
        : Array.isArray(validation.visual)
          ? validation.visual.length
          : 0,
      erc: Array.isArray(validation.erc) ? validation.erc.length : 0,
    };
    const status: ConversionResult["status"] = Object.values(
      warningSummary,
    ).some((count) => count > 0)
      ? "success_with_warnings"
      : "success";
    const report = {
      ...rawReport,
      warnings,
      resultStatus: status,
      warningSummary,
      backendVersion: "0.1.0",
      upstreamLocalExtensions: [],
      engine: "isolated-python-compatibility",
      snapshotDigest: inventory.snapshotDigest,
      mappingPackage: packageInput,
      sourceConnectivityVerified:
        !projection?.report.simplified &&
        !snapshot.nets.some((n) => Number(n.numBits) > 1),
      busMode,
      bundledBuses: snapshot.nets
        .filter((n) => Number(n.numBits) > 1)
        .map((n) => ({
          name: n.name,
          width: n.numBits,
          terminals: n.terminals,
        })),
      bitConnectivityVerified: !snapshot.nets.some(
        (n) => Number(n.numBits) > 1,
      ),
      disabledInstances: {
        mode: disabledInstances,
        ids: source.instances
          .filter((i) =>
            i.properties.some(
              (p) => p.name === "nlAction" && p.value === "ignore",
            ),
          )
          .map((i) => i.id),
      },
      isolatedPorts: {
        mode: isolatedPorts,
        ids: projection?.report.isolatedPorts ?? [],
      },
      unmappedDevices,
      retainedConnectivityVerified: true,
      genericBoxes: Object.keys(boxes.instances),
      simplification: projection?.report ?? { simplified: false },
    };
    validateConversion(snapshot, project, report, mappings);
    if (options.signal?.aborted)
      throw new BackendError("CANCELLED", "Conversion cancelled");
    options.onProgress?.({ stage: "convert", completed: 1, total: 1 });
    return {
      status,
      filteredSnapshot: filtered,
      project,
      report,
      validation,
      refinement: await readJson("result.refinement.json"),
      svg: await readFile(path.join(dir, "result.svg"), "utf8"),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function validateConversion(
  snapshot: Snapshot,
  project: ReturnType<typeof CircuitProjectSchema.parse>,
  report: {
    placements: Array<{ sourceId: string; targetId: string }>;
    endpointMarkers?: Array<{ id: string; kind: string; name?: string }>;
  },
  mappings: ReturnType<typeof resolveMappings>,
): void {
  const targetToSource = new Map(
    report.placements.map((p) => [p.targetId, p.sourceId]),
  );
  if (targetToSource.size !== snapshot.instances.length)
    throw new BackendError("LOST_INSTANCE", "Instance mapping incomplete");
  const expected = snapshot.nets
    .map((n) => {
      const members = n.terminals.map((t) => [
        t.instanceId,
        mappings.get(t.instanceId)!.pins[t.pinName],
      ]);
      for (const t of snapshot.terminals)
        if (t.netId === n.id)
          for (const pin of t.pins)
            if (pin.instanceId) members.push([pin.instanceId, "P"]);
      return stable(members.map(stable).sort());
    })
    .sort();
  const doc = project.documents[0]!;
  const actual = doc.nets
    .map((n) =>
      stable(
        n.terminals
          .filter((t) => targetToSource.has(t.instanceId))
          .map((t) => stable([targetToSource.get(t.instanceId), t.pinName]))
          .sort(),
      ),
    )
    .sort();
  if (stable(expected) !== stable(actual))
    throw new BackendError(
      "CONNECTIVITY_MISMATCH",
      "Source net partition changed after native normalization",
    );
  const generatedPorts = (report.endpointMarkers ?? []).filter(
    (marker) => marker.kind === "port",
  );
  const expectedInterface = [
    ...snapshot.terminals.map((terminal) => terminal.name),
    ...generatedPorts.map((marker) => marker.name),
  ].sort();
  const actualInterface = doc.netlist?.terminals ?? [];
  if (
    generatedPorts.some(
      (marker) =>
        !marker.name ||
        !doc.instances.some(
          (instance) =>
            instance.id === marker.id && instance.symbolId === "port",
        ) ||
        !actualInterface.some(
          (terminal) =>
            terminal.name === marker.name &&
            terminal.interfaceInstanceIds[0] === marker.id,
        ),
    ) ||
    stable(expectedInterface) !==
      stable(actualInterface.map((terminal) => terminal.name).sort())
  )
    throw new BackendError("INTERFACE_CHANGED", "Formal interface changed");
}
