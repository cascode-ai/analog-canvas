import { isolatedPortInstances } from "./isolated-ports.js";
import {
  z,
  type Catalog,
  type InventoryItem,
  type Mapping,
  type Snapshot,
  BackendError,
} from "./contracts.js";
import {
  scanDesign,
  validateSnapshot,
  validateMapping,
  recommendMappings,
  stable,
} from "./index.js";

export const DeviceRuleSchema = z.union([
  z.strictObject({ omit: z.literal(true) }),
  z.strictObject({
    symbol: z.string().min(1),
    pins: z.record(z.string().min(1), z.string().min(1)).default({}),
    parameters: z.record(z.string().min(1), z.string().min(1)).default({}),
    omitPins: z.array(z.string().min(1)).default([]),
  }),
]);
export const MappingTableSchema = z.strictObject({
  version: z.literal(1),
  devices: z.record(
    z.string().regex(/^[^/]+\/[^/]+$/),
    DeviceRuleSchema.nullable(),
  ),
});
export type DeviceRule = z.infer<typeof DeviceRuleSchema>;
export type MappingTable = z.infer<typeof MappingTableSchema>;
export const deviceKey = (m: { library: string; cell: string }) =>
  `${m.library}/${m.cell}`;

export function mergeMappingTables(
  base: unknown,
  edits: unknown,
): MappingTable {
  const a = MappingTableSchema.parse(base),
    b = MappingTableSchema.parse(edits);
  // A null override explicitly selects the automatic box, not the builtin.
  return MappingTableSchema.parse({
    version: 1,
    devices: { ...a.devices, ...b.devices },
  });
}

function checkRule(item: InventoryItem, rule: DeviceRule, catalog: Catalog) {
  if ("omit" in rule) return;
  if (rule.symbol === "generic-box") {
    if (
      Object.keys(rule.pins).length ||
      Object.keys(rule.parameters).length ||
      rule.omitPins.length
    )
      throw new BackendError(
        "INVALID_BOX_MAPPING",
        "Automatic boxes retain all original pins; omit and parameter maps are not supported",
      );
    if (item.pinNames.length > 128)
      throw new BackendError("BOX_PIN_LIMIT", deviceKey(item.master));
    return;
  }
  const omitted = new Set(rule.omitPins);
  if (
    omitted.size !== rule.omitPins.length ||
    rule.omitPins.some(
      (p) => !item.pinNames.includes(p) || Object.hasOwn(rule.pins, p),
    )
  )
    throw new BackendError("INVALID_OMIT_PINS", deviceKey(item.master));
  const mapping = {
    symbol: rule.symbol,
    pins: rule.pins,
    parameters: rule.parameters,
  };
  validateMapping(
    { ...item, pinNames: item.pinNames.filter((p) => !omitted.has(p)) },
    mapping,
    catalog,
  );
  for (const inst of item.instances) {
    try {
      validateMapping(
        {
          ...item,
          pinNames: (inst.pinNames ?? item.pinNames).filter(
            (p) => !omitted.has(p),
          ),
          parameterNames: [...new Set(inst.parameters.map((p) => p.name))],
        },
        mapping,
        catalog,
      );
    } catch (error) {
      throw new BackendError(
        "INSTANCE_MAPPING_MISMATCH",
        `Mapping does not fit ${inst.id}`,
        {
          device: deviceKey(item.master),
          instanceId: inst.id,
          cause: String(error),
        },
      );
    }
  }
}

/** Data-only settings for CLI, a future menu dialog, or an agent tool. */
export function prepareMappings(
  snapshot: unknown,
  builtinRules: unknown,
  catalog: Catalog,
  personal: unknown = { version: 1, devices: {} },
) {
  const inventory = scanDesign(snapshot),
    table = MappingTableSchema.parse(personal);
  const defaultTable =
    builtinRules &&
    typeof builtinRules === "object" &&
    "devices" in builtinRules
      ? MappingTableSchema.parse(builtinRules)
      : undefined;
  const rules =
    builtinRules &&
    typeof builtinRules === "object" &&
    "devices" in builtinRules
      ? {
          version: 1,
          rules: Object.entries(
            MappingTableSchema.parse(builtinRules).devices,
          ).flatMap(([key, rule]) => {
            if (!rule || "omit" in rule) return [];
            const [library, cell] = key.split("/");
            return [
              {
                id: key,
                master: { library, cell, view: "symbol" },
                mapping: {
                  symbol: rule.symbol,
                  pins: rule.pins,
                  parameters: rule.parameters,
                },
              },
            ];
          }),
        }
      : builtinRules;
  const proposal = recommendMappings(inventory, rules, catalog);
  const items = inventory.items
    .map((item) => {
      const key = deviceKey(item.master);
      const candidates = proposal.items.find(
        (p) => p.itemId === item.id,
      )!.candidates;
      const builtin = candidates.find((c) => c.origin === "builtin");
      const hasPersonal = Object.hasOwn(table.devices, key);
      const hasDefault = defaultTable
        ? Object.hasOwn(defaultTable.devices, key)
        : Boolean(builtin);
      const rule = hasPersonal
        ? table.devices[key]!
        : defaultTable && hasDefault
          ? defaultTable.devices[key]!
          : !defaultTable && builtin
            ? DeviceRuleSchema.parse(builtin.mapping)
            : null;
      let error: string | null = null;
      {
        try {
          checkRule(
            item,
            rule ?? DeviceRuleSchema.parse({ symbol: "generic-box" }),
            catalog,
          );
        } catch (e) {
          error = String(e);
        }
      }
      return {
        device: key,
        instances: item.instances.map((i) => i.id),
        pins: item.pinNames,
        parameters: item.parameterNames,
        models: item.modelNames,
        status: error ? "invalid" : "ready",
        automaticBox:
          rule === null || ("symbol" in rule && rule.symbol === "generic-box"),
        origin: hasPersonal ? "personal" : hasDefault ? "builtin" : "unmapped",
        mapping: rule,
        error,
        suggestions: candidates
          .filter((c) => c.origin !== "personal")
          .map((c) => ({ ...c.mapping, reasons: c.reasons })),
      };
    })
    .sort(
      (a, b) =>
        Number(a.status === "ready") - Number(b.status === "ready") ||
        Number(b.automaticBox) - Number(a.automaticBox) ||
        a.device.localeCompare(b.device),
    );
  return {
    settings: MappingTableSchema.parse({
      version: 1,
      devices: Object.fromEntries(items.map((i) => [i.device, i.mapping])),
    }),
    items,
    catalog,
    capabilities: {
      standard: true,
      omitPins: true,
      omitDevice: true,
      genericBox: true,
    },
  };
}

export function saveMappings(
  snapshot: unknown,
  edits: unknown,
  catalog: Catalog,
  existing: unknown = { version: 1, devices: {} },
) {
  const table = MappingTableSchema.parse(edits),
    inventory = scanDesign(snapshot);
  for (const item of inventory.items) {
    const rule = table.devices[deviceKey(item.master)];
    if (rule) checkRule(item, rule, catalog);
  }
  // Validate unused entries too, so a misspelled target cannot enter a reusable table.
  for (const [key, rule] of Object.entries(table.devices)) {
    if (!rule || "omit" in rule) continue;
    if (
      rule.symbol !== "generic-box" &&
      !catalog.some((s) => s.id === rule.symbol)
    )
      throw new BackendError("UNSUPPORTED_SYMBOL", `${key}: ${rule.symbol}`);
    const [library, cell] = key.split("/");
    checkRule(
      {
        master: { library: library!, cell: cell!, view: "" },
        pinNames: [...Object.keys(rule.pins), ...rule.omitPins],
        parameterNames: Object.keys(rule.parameters),
        instances: [],
      } as unknown as InventoryItem,
      rule,
      catalog,
    );
  }
  const merged = mergeMappingTables(existing, table);
  return {
    table: merged,
    changed: Object.keys(table.devices).filter(
      (key) =>
        stable(MappingTableSchema.parse(existing).devices[key]) !==
        stable(table.devices[key]),
    ),
    unresolved: [],
  };
}

/** Preserve the source; build an explicit, auditable reduced circuit for drawing. */
export function projectMappings(
  input: unknown,
  tableInput: unknown,
  catalog: Catalog,
  options: {
    disabledInstances?: "keep" | "omit";
    isolatedPorts?: "keep" | "omit";
    unmappedDevices?: "generic-box" | "error";
  } = {},
) {
  const source = validateSnapshot(input),
    inventory = scanDesign(source),
    table = MappingTableSchema.parse(tableInput);
  const mappings = new Map<string, Mapping>();
  const omittedInstances = new Set<string>(),
    omittedPins = new Map<string, Set<string>>();
  const disabled = new Set(
    source.instances
      .filter((i) =>
        i.properties.some((p) => p.name === "nlAction" && p.value === "ignore"),
      )
      .map((i) => i.id),
  );
  const isolatedPortMode = options.isolatedPorts ?? "omit";
  const unmappedDeviceMode = options.unmappedDevices ?? "generic-box";
  const isolatedPorts =
    isolatedPortMode === "omit"
      ? isolatedPortInstances(source)
      : new Set<string>();
  const omissions: Array<{
    instanceId: string;
    pinName: string;
    netId: string | null;
    reason: string;
  }> = [];
  const attachments: Array<{ netId: string; point: [number, number] }> = [];
  for (const item of inventory.items) {
    const key = deviceKey(item.master),
      configured = table.devices[key];
    if (
      (configured === undefined || configured === null) &&
      unmappedDeviceMode === "error"
    )
      throw new BackendError(
        "UNMAPPED_DEVICE",
        `No mapping configured for ${key}`,
        { device: key, instances: item.instances.map((i) => i.id) },
      );
    const rule =
      configured ?? DeviceRuleSchema.parse({ symbol: "generic-box" });
    checkRule(item, rule, catalog);
    for (const inst of item.instances) {
      if (
        "omit" in rule ||
        isolatedPorts.has(inst.id) ||
        (options.disabledInstances === "omit" && disabled.has(inst.id))
      )
        omittedInstances.add(inst.id);
      else {
        omittedPins.set(inst.id, new Set(rule.omitPins));
        mappings.set(inst.id, {
          symbol: rule.symbol,
          pins:
            rule.symbol === "generic-box"
              ? Object.fromEntries(
                  (inst.pinNames ?? item.pinNames).map((p) => [p, p]),
                )
              : rule.pins,
          parameters: rule.parameters,
        });
      }
    }
  }
  const snapshot: Snapshot = structuredClone(source);
  for (const inst of snapshot.instances) {
    const omit = omittedPins.get(inst.id) ?? new Set<string>();
    for (const term of inst.terminals) {
      if (!omittedInstances.has(inst.id) && !omit.has(term.name)) continue;
      omissions.push({
        instanceId: inst.id,
        pinName: term.name,
        netId: term.netId,
        reason: omittedInstances.has(inst.id) ? "device" : "pin",
      });
      if (term.netId)
        for (const pin of term.pins)
          attachments.push({ netId: term.netId, point: pin.worldCenter });
    }
    inst.terminals = inst.terminals.filter((t) => !omit.has(t.name));
    // Shared masters require a per-instance projected symbol before removing pins.
    const symbol = structuredClone(
      source.symbols.find((s) => s.id === inst.symbolId)!,
    );
    symbol.id = `projected:${inst.id}`;
    symbol.terminals = symbol.terminals.filter((t) => !omit.has(t.name));
    inst.symbolId = symbol.id;
    snapshot.symbols.push(symbol);
  }
  for (const term of snapshot.terminals) {
    for (const pin of term.pins)
      if (
        pin.instanceId &&
        omittedInstances.has(pin.instanceId) &&
        !isolatedPorts.has(pin.instanceId)
      ) {
        attachments.push({ netId: term.netId, point: pin.worldCenter });
      }
  }
  snapshot.instances = snapshot.instances.filter(
    (i) => !omittedInstances.has(i.id),
  );
  const symbols = new Set(snapshot.instances.map((i) => i.symbolId));
  snapshot.symbols = snapshot.symbols.filter((s) => symbols.has(s.id));
  snapshot.terminals = snapshot.terminals.filter(
    (t) =>
      !t.pins.length ||
      !t.pins.every((p) => p.instanceId && omittedInstances.has(p.instanceId)),
  );
  for (const t of snapshot.terminals)
    t.pins = t.pins.filter(
      (p) => !p.instanceId || !omittedInstances.has(p.instanceId),
    );
  for (const net of snapshot.nets)
    net.terminals = net.terminals.filter(
      (t) =>
        !omittedInstances.has(t.instanceId) &&
        !omittedPins.get(t.instanceId)?.has(t.pinName),
    );
  const affected = new Set([
    ...attachments.map((a) => a.netId),
    ...omissions.map((o) => o.netId).filter((n): n is string => n !== null),
  ]);
  snapshot.nets = snapshot.nets.filter(
    (n) =>
      !affected.has(n.id) ||
      n.terminals.length ||
      snapshot.terminals.some((t) => t.netId === n.id),
  );
  const nets = new Set(snapshot.nets.map((n) => n.id));
  snapshot.shapes = snapshot.shapes.filter(
    (s) =>
      (!s.netId || nets.has(s.netId)) &&
      !omittedInstances.has(String(s.parentInstanceId ?? "")),
  );
  snapshot.omittedAttachments = attachments.filter((a) => nets.has(a.netId));
  snapshot.omittedPortInterfaces = source.terminals
    .filter(
      (t) =>
        t.pins.length > 0 &&
        t.pins.every((p) => p.instanceId && isolatedPorts.has(p.instanceId)),
    )
    .map((t) => ({ name: t.name, netId: t.netId, direction: t.direction }));
  validateSnapshot(snapshot);
  return {
    snapshot,
    mappings,
    report: {
      simplified:
        omittedInstances.size > 0 ||
        [...omittedPins.values()].some((p) => p.size > 0),
      omittedInstances: [...omittedInstances],
      isolatedPortMode,
      isolatedPorts: [...isolatedPorts],
      unmappedDeviceMode,
      omittedPortInterfaces: snapshot.omittedPortInterfaces,
      omittedPins: Object.fromEntries(
        [...omittedPins].filter(([, p]) => p.size).map(([i, p]) => [i, [...p]]),
      ),
      affectedConnections: omissions,
      omittedFormalTerminals: source.terminals
        .filter((t) => !snapshot.terminals.some((p) => p.id === t.id))
        .map((t) => t.name),
    },
  };
}
