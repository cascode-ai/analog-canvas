import { createHash } from "node:crypto";
import {
  BackendError,
  SnapshotSchema,
  InventorySchema,
  MappingSchema,
  MappingPackageSchema,
  ProposalSchema,
  DecisionsSchema,
  BuiltinRulesSchema,
  type Snapshot,
  type Inventory,
  type InventoryItem,
  type Mapping,
  type MappingPackage,
  type Proposal,
  type Decisions,
  type Catalog,
  type OperationOptions,
} from "./contracts.js";
export * from "./contracts.js";
export * from "./mapping-table.js";
export * from "./user-config.js";

export function stable(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b, "en"))
        .map(([k, v]) => JSON.stringify(k) + ":" + stable(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "null";
}
export const digest = (v: unknown) =>
  createHash("sha256").update(stable(v)).digest("hex");
export const masterKey = (m: { library: string; cell: string; view: string }) =>
  stable([m.library, m.cell]);
const unique = (values: string[]) => [...new Set(values)].sort();
function checkUnique(values: string[], kind: string) {
  if (values.length !== new Set(values).size)
    throw new BackendError("DUPLICATE_ID", `Duplicate ${kind}`);
}
function progress(
  options: OperationOptions,
  stage: string,
  completed: number,
  total: number,
) {
  if (options.signal?.aborted)
    throw new BackendError("CANCELLED", "Operation cancelled");
  options.onProgress?.({ stage, completed, total });
  if (options.signal?.aborted)
    throw new BackendError("CANCELLED", "Operation cancelled");
}
export function validateSnapshot(input: unknown): Snapshot {
  const snapshot = SnapshotSchema.parse(input);
  checkUnique(
    snapshot.instances.map((i) => i.id),
    "instance",
  );
  checkUnique(
    snapshot.nets.map((n) => n.id),
    "net",
  );
  checkUnique(
    snapshot.symbols.map((s) => s.id),
    "symbol",
  );
  checkUnique(
    snapshot.terminals.map((t) => t.id),
    "formal terminal",
  );
  const nets = new Set(snapshot.nets.map((n) => n.id)),
    symbols = new Set(snapshot.symbols.map((s) => s.id));
  const expected: string[] = [];
  for (const i of snapshot.instances) {
    if (!symbols.has(i.symbolId))
      throw new BackendError(
        "MASTER_MISSING",
        `Cannot find symbol data for instance ${i.id}`,
        {
          instanceId: i.id,
          master: { library: i.library, cell: i.cell, view: i.view },
          symbolId: i.symbolId,
        },
      );
    checkUnique(
      i.terminals.map((t) => t.name),
      `terminal on ${i.id}`,
    );
    for (const t of i.terminals)
      if (t.netId !== null) {
        if (!nets.has(t.netId)) throw new BackendError("MISSING_NET", t.netId);
        expected.push(stable([t.netId, i.id, t.name]));
      }
  }
  const actual = snapshot.nets.flatMap((n) =>
    n.terminals.map((t) => stable([n.id, t.instanceId, t.pinName])),
  );
  checkUnique(actual, "net member");
  if (stable(actual.sort()) !== stable(expected.sort()))
    throw new BackendError(
      "CONNECTIVITY_MISMATCH",
      "Instance and net memberships disagree",
    );
  for (const s of [...snapshot.shapes, ...snapshot.terminals])
    if (s.netId !== null && !nets.has(s.netId))
      throw new BackendError("MISSING_NET", s.netId);
  return snapshot;
}

export function scanDesign(
  input: unknown,
  options: OperationOptions = {},
): Inventory {
  const s = validateSnapshot(input),
    groups = new Map<string, InventoryItem>();
  const warnings: Inventory["warnings"] = [];
  for (const [index, i] of s.instances.entries()) {
    progress(options, "scan", index, s.instances.length);
    const symbol = s.symbols.find((sym) => sym.id === i.symbolId)!;
    const master = { library: i.library, cell: i.cell, view: i.view };
    // Master pins expose unconnected/extra terminals absent from instTerms.
    const pinNames = unique([
      ...symbol.terminals.map((t) => t.name),
      ...i.terminals.map((t) => t.name),
    ]);
    const params = [...i.effectiveCdfParameters, ...i.properties];
    const parameterNames = unique(params.map((p) => p.name));
    const simulators = i.simulationInfo?.simulators ?? [];
    const componentNames = unique(
      simulators
        .map((x) => x.componentName)
        .filter((x): x is string => Boolean(x)),
    );
    const modelNames = unique([
      ...simulators
        .map((x) => x.modelName)
        .filter((x): x is string => Boolean(x)),
      ...params
        .filter(
          (p) =>
            /^(model|modelname)$/i.test(p.name) && typeof p.value === "string",
        )
        .map((p) => String(p.value)),
    ]);
    const termOrders = simulators
      .filter((x) => x.termOrder !== null)
      .map((x) => ({
        simulator: x.name,
        pins: Array.isArray(x.termOrder)
          ? x.termOrder
          : x.termOrder!.trim().split(/\s+/),
      }))
      .sort((a, b) => a.simulator.localeCompare(b.simulator));
    const evidenceStatus = i.simulationInfo?.status ?? "unavailable";
    // Retain the legacy field, but identity is now library/cell only.
    const signature = digest(masterKey(master));
    const id = signature;
    let item = groups.get(id);
    if (!item) {
      item = {
        id,
        master,
        signature,
        pinNames,
        parameterNames,
        componentNames,
        modelNames,
        termOrders,
        evidenceStatus,
        instances: [],
        warnings: [],
      };
      if (evidenceStatus === "unavailable")
        item.warnings.push({
          code: "MODEL_INFO_UNAVAILABLE",
          message:
            "No exported simulator metadata; no model semantics are assumed.",
        });
      for (const order of termOrders)
        if (order.pins.some((p) => !pinNames.includes(p)))
          item.warnings.push({
            code: "TERM_ORDER_MISMATCH",
            message: `${order.simulator} termOrder includes terminals absent from symbol`,
          });
      if (i.arrayCount && i.arrayCount !== 1)
        item.warnings.push({
          code: "UNSUPPORTED_INSTANCE_ARRAY",
          message: "Instance array requires expansion before conversion",
        });
      groups.set(id, item);
    }
    item.pinNames = unique([...item.pinNames, ...pinNames]);
    item.parameterNames = unique([...item.parameterNames, ...parameterNames]);
    item.componentNames = unique([...item.componentNames, ...componentNames]);
    item.modelNames = unique([...item.modelNames, ...modelNames]);
    item.termOrders = [
      ...new Map(
        [...item.termOrders, ...termOrders].map((o) => [stable(o), o]),
      ).values(),
    ];
    if (evidenceStatus === "available") item.evidenceStatus = "available";
    item.instances.push({
      id: i.id,
      parameters: params,
      symbolId: i.symbolId,
      pinNames,
      view: i.view,
    });
  }
  const items = [...groups.values()].sort((a, b) => a.id.localeCompare(b.id));
  progress(options, "scan", s.instances.length, s.instances.length);
  return InventorySchema.parse({
    format: "virtuoso-canvas.inventory",
    version: 1,
    snapshotDigest: digest(s),
    source: {
      library: s.source.library,
      cell: s.source.cell,
      view: s.source.view,
    },
    items,
    warnings,
  });
}

export function validateMapping(
  item: InventoryItem,
  input: unknown,
  catalog: Catalog,
): Mapping {
  const mapping = MappingSchema.parse(input),
    target = catalog.find((c) => c.id === mapping.symbol);
  if (!target) throw new BackendError("UNSUPPORTED_SYMBOL", mapping.symbol);
  const sources = Object.keys(mapping.pins),
    targets = Object.values(mapping.pins);
  if (stable(sources.sort()) !== stable([...item.pinNames].sort()))
    throw new BackendError(
      "PIN_COVERAGE",
      `Every source pin must be mapped exactly once for ${masterKey(item.master)}`,
      { source: item.pinNames, mapped: sources },
    );
  checkUnique(targets, "target pin");
  if (targets.some((p) => !target.pins.includes(p)))
    throw new BackendError("UNKNOWN_TARGET_PIN", mapping.symbol);
  const isPort = mapping.symbol === "port";
  if (
    !isPort &&
    stable([...targets].sort()) !== stable([...target.pins].sort())
  )
    throw new BackendError(
      "TARGET_PIN_COVERAGE",
      "Target pins must all be accounted for; no implicit bulk ties",
    );
  for (const [source, to] of Object.entries(mapping.parameters)) {
    if (!item.parameterNames.includes(source))
      throw new BackendError("UNKNOWN_PARAMETER", source);
    if (!target.parameters.includes(to))
      throw new BackendError("UNKNOWN_TARGET_PARAMETER", to);
  }
  checkUnique(Object.values(mapping.parameters), "target parameter");
  checkUnique(
    Object.keys(mapping.parameters).map((s) => s.toLowerCase()),
    "case-folded parameter",
  );
  return mapping;
}
export function validatePackage(input: unknown): MappingPackage {
  const pkg = MappingPackageSchema.parse(input);
  checkUnique(
    pkg.entries.map((e) => masterKey(e.master)),
    "mapping package entry",
  );
  return pkg;
}
function parametersFor(
  item: InventoryItem,
  target: string,
  catalog: Catalog,
): Record<string, string> {
  const allowed = catalog.find((c) => c.id === target)?.parameters ?? [];
  const result: Record<string, string> = {};
  for (const to of allowed) {
    const aliases =
      to === "dc"
        ? ["idc", "dc"]
        : to === "w"
          ? ["w", "width"]
          : to === "l"
            ? ["l", "length"]
            : [to];
    const source = item.parameterNames.find((p) =>
      aliases.includes(p.toLowerCase()),
    );
    if (source) result[source] = to;
  }
  return result;
}
export function recommendMappings(
  input: unknown,
  rules: unknown,
  catalog: Catalog,
  personalInput?: unknown,
  options: OperationOptions = {},
): Proposal {
  const inventory = InventorySchema.parse(input),
    builtin = BuiltinRulesSchema.parse(rules);
  const personal =
    personalInput === undefined ? undefined : validatePackage(personalInput);
  checkUnique(
    builtin.rules.map((r) => stable(r.master)),
    "builtin master rule",
  );
  const items: Proposal["items"] = [];
  for (const [index, item] of inventory.items.entries()) {
    progress(options, "recommend", index, inventory.items.length);
    const candidates: Proposal["items"][number]["candidates"] = [],
      warnings = [...item.warnings];
    const add = (
      mapping: Mapping,
      origin: "personal" | "builtin" | "heuristic",
      reasons: string[],
    ) => {
      try {
        validateMapping(item, mapping, catalog);
      } catch (e) {
        warnings.push({
          code: "CANDIDATE_REJECTED",
          message: e instanceof Error ? e.message : String(e),
        });
        return;
      }
      const candidate = {
        mapping,
        origin,
        confidence:
          origin === "personal"
            ? ("reviewed" as const)
            : origin === "builtin"
              ? ("exact-rule" as const)
              : ("structural-hint" as const),
        reasons,
      };
      candidates.push({
        ...candidate,
        id: digest({ itemId: item.id, ...candidate }),
      });
    };
    const matches =
      personal?.entries.filter(
        (e) => masterKey(e.master) === masterKey(item.master),
      ) ?? [];
    const exact = matches[0];
    if (exact)
      add(exact.mapping, "personal", [
        `Previously reviewed by ${exact.reviewedBy}; library/cell matched`,
      ]);
    else {
      const built = builtin.rules.find(
        (r) => masterKey(r.master) === masterKey(item.master),
      );
      if (built)
        add(
          {
            ...built.mapping,
            parameters: parametersFor(item, built.mapping.symbol, catalog),
          },
          "builtin",
          [`Exact built-in rule ${built.id}; requires explicit confirmation`],
        );
      if (!candidates.length) {
        const canonical: Record<string, string> = {
          d: "D",
          drain: "D",
          g: "G",
          gate: "G",
          s: "S",
          source: "S",
          b: "B",
          bulk: "B",
          body: "B",
        };
        const pins = Object.fromEntries(
          item.pinNames.map((p) => [p, canonical[p.toLowerCase()] ?? p]),
        );
        if (
          stable(Object.values(pins).sort()) === stable(["B", "D", "G", "S"])
        ) {
          const evidence = item.componentNames.map((n) => n.toLowerCase());
          const n = evidence.some((n) => ["nmos", "nfet"].includes(n)),
            p = evidence.some((n) => ["pmos", "pfet"].includes(n));
          const preferred =
            n && !p ? ["nmos"] : p && !n ? ["pmos"] : ["nmos", "pmos"];
          for (const target of preferred)
            add(
              {
                symbol: target,
                pins,
                parameters: parametersFor(item, target, catalog),
              },
              "heuristic",
              [
                "Four explicit D/G/S/B roles match; pin count alone does not establish device physics",
                evidence.length
                  ? `CDF component names: ${evidence.join(", ")}`
                  : "Polarity cannot be established: choose NMOS or PMOS manually",
                `Cell name ${item.master.cell} is descriptive only, not authoritative`,
              ],
            );
        }
        if (item.pinNames.length === 2) {
          const classes: Record<string, string> = {
            resistor: "resistor",
            capacitor: "capacitor",
            isource: "current-source",
          };
          for (const target of unique(
            item.componentNames
              .map((n) => classes[n.toLowerCase()])
              .filter((v): v is string => Boolean(v)),
          )) {
            const polarity: Record<string, string> = {
              plus: "+",
              p: "+",
              pos: "+",
              positive: "+",
              minus: "-",
              n: "-",
              neg: "-",
              negative: "-",
            };
            const roles = item.pinNames.map(
              (p) => polarity[p.toLowerCase()] ?? p,
            );
            if (stable([...roles].sort()) === stable(["+", "-"])) {
              const pins = Object.fromEntries(
                item.pinNames.map((p, index) => [
                  p,
                  target === "current-source"
                    ? roles[index]!
                    : roles[index] === "+"
                      ? "1"
                      : "2",
                ]),
              );
              add(
                {
                  symbol: target,
                  pins,
                  parameters: parametersFor(item, target, catalog),
                },
                "heuristic",
                [
                  `CDF componentName suggests ${target}; explicit positive/negative pin names match`,
                  "No PDK callbacks or model files were executed; manual review required",
                ],
              );
            }
          }
        }
      }
    }
    items.push({
      itemId: item.id,
      status:
        candidates[0]?.origin === "personal"
          ? "confirmed"
          : candidates.length
            ? "needs-review"
            : "unknown",
      candidates,
      warnings,
    });
  }
  const body = {
    format: "virtuoso-canvas.mapping-proposal" as const,
    version: 1 as const,
    inventory,
    items,
  };
  progress(
    options,
    "recommend",
    inventory.items.length,
    inventory.items.length,
  );
  return { ...body, id: digest(body) };
}
export function decisionTemplate(proposal: Proposal): Decisions {
  return {
    format: "virtuoso-canvas.mapping-decisions",
    version: 1,
    proposalId: proposal.id,
    reviewedBy: "REPLACE_WITH_YOUR_NAME",
    decisions: proposal.items.map((i) => ({
      itemId: i.itemId,
      action: "pending",
      ...(i.candidates.length === 1
        ? { candidateId: i.candidates[0]!.id }
        : {}),
    })),
  };
}
export function confirmMappings(
  proposalInput: unknown,
  decisionsInput: unknown,
  catalog: Catalog,
  options: {
    name: string;
    existing?: unknown;
    now?: string;
  } & OperationOptions,
): { package: MappingPackage; unresolved: string[] } {
  const proposal = ProposalSchema.parse(proposalInput),
    decisions = DecisionsSchema.parse(decisionsInput);
  const { id, ...body } = proposal;
  if (digest(body) !== id || decisions.proposalId !== id)
    throw new BackendError(
      "STALE_PROPOSAL",
      "Proposal or decision digest does not match",
    );
  if (decisions.reviewedBy === "REPLACE_WITH_YOUR_NAME")
    throw new BackendError(
      "REVIEWER_REQUIRED",
      "Set reviewedBy to the actual reviewer",
    );
  checkUnique(
    decisions.decisions.map((d) => d.itemId),
    "decision",
  );
  if (
    decisions.decisions.some(
      (d) => !proposal.items.some((i) => i.itemId === d.itemId),
    )
  )
    throw new BackendError(
      "UNKNOWN_DECISION",
      "Decision refers to an unknown inventory item",
    );
  const entries =
      options.existing === undefined
        ? []
        : [...validatePackage(options.existing).entries],
    unresolved: string[] = [];
  for (const [index, p] of proposal.items.entries()) {
    progress(options, "confirm", index, proposal.items.length);
    const item = proposal.inventory.items.find((i) => i.id === p.itemId)!;
    const decision = decisions.decisions.find((d) => d.itemId === p.itemId);
    if (decision?.action === "reject") {
      const old = entries.findIndex(
        (e) => masterKey(e.master) === masterKey(item.master),
      );
      if (old >= 0) entries.splice(old, 1);
    }
    if (decision?.action !== "approve") {
      unresolved.push(p.itemId);
      continue;
    }
    if (Boolean(decision.mapping) === Boolean(decision.candidateId))
      throw new BackendError(
        "AMBIGUOUS_DECISION",
        "Specify exactly one candidateId or custom mapping",
      );
    const mapping =
      decision.mapping ??
      p.candidates.find((c) => c.id === decision.candidateId)?.mapping;
    if (!mapping)
      throw new BackendError(
        "UNKNOWN_CANDIDATE",
        "Candidate does not belong to this item",
      );
    validateMapping(item, mapping, catalog);
    const entry = {
      master: item.master,
      signature: item.signature,
      mapping,
      evidence: {
        pinNames: item.pinNames,
        parameterNames: item.parameterNames,
        componentNames: item.componentNames,
        modelNames: item.modelNames,
        termOrders: item.termOrders,
        evidenceStatus: item.evidenceStatus,
      },
      reviewedBy: decisions.reviewedBy,
      reviewedAt: options.now ?? new Date().toISOString(),
    };
    const old = entries.findIndex(
      (e) => masterKey(e.master) === masterKey(item.master),
    );
    if (old >= 0) entries[old] = entry;
    else entries.push(entry);
  }
  progress(options, "confirm", proposal.items.length, proposal.items.length);
  return {
    package: validatePackage({
      format: "virtuoso-canvas.mapping-package",
      version: 1,
      name: options.name,
      entries,
    }),
    unresolved,
  };
}

export function resolveMappings(
  inventory: Inventory,
  packageInput: unknown,
  catalog: Catalog,
): Map<string, Mapping> {
  const pkg = validatePackage(packageInput),
    mappings = new Map<string, Mapping>();
  for (const item of inventory.items) {
    const match = pkg.entries.find(
      (e) => masterKey(e.master) === masterKey(item.master),
    );
    if (!match)
      throw new BackendError(
        "UNCONFIRMED_MASTER",
        `No confirmed mapping for ${masterKey(item.master)}`,
        { itemId: item.id },
      );
    const mapping = validateMapping(item, match.mapping, catalog);
    for (const inst of item.instances) {
      try {
        validateMapping(
          {
            ...item,
            pinNames: inst.pinNames ?? item.pinNames,
            parameterNames: unique(inst.parameters.map((p) => p.name)),
          },
          mapping,
          catalog,
        );
      } catch (error) {
        throw new BackendError(
          "INSTANCE_MAPPING_MISMATCH",
          `Mapping does not fit instance ${inst.id}`,
          { instanceId: inst.id, cause: String(error) },
        );
      }
      mappings.set(inst.id, mapping);
    }
  }
  return mappings;
}

export function previewProposal(proposal: Proposal): string {
  return proposal.items
    .map((p) => {
      const item = proposal.inventory.items.find((i) => i.id === p.itemId)!;
      return [
        `${item.master.library}/${item.master.cell}/${item.master.view} [${p.status}]`,
        `itemId: ${item.id}`,
        `instances: ${item.instances.map((i) => i.id).join(", ")}`,
        `pins: ${item.pinNames.join(", ")}`,
        `models: ${item.modelNames.join(", ") || "(unavailable)"}`,
        `parameters: ${item.parameterNames.join(", ")}`,
        ...p.candidates.flatMap((c) => [
          `  ${c.id}: ${c.mapping.symbol} (${c.origin})`,
          `  pins ${JSON.stringify(c.mapping.pins)}; parameters ${JSON.stringify(c.mapping.parameters)}`,
          ...c.reasons.map((r) => "  - " + r),
        ]),
        ...p.warnings.map((w) => `WARNING ${w.code}: ${w.message}`),
        "",
      ].join("\n");
    })
    .join("\n");
}
