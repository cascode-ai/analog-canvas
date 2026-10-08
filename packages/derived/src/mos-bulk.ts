import { deviceDescriptor } from "@icm/devices";
import type {
  Instance,
  Net,
  RouteBranch,
  RouteEndpoint,
  SchematicDocument,
} from "@icm/model";
import { foldNetName, routeEnd } from "@icm/model";
import {
  resolveDocumentLogicalNets,
  type ResolvedDocumentLogicalNets,
  type ResolvedLogicalNet,
} from "./logical-net.js";
import { supplyMarkerForSymbol, type SupplyDomain } from "./supply-marker.js";

export type MosBulkKind = "nmos" | "pmos";
export type MosBulkResolution =
  | {
      status:
        "explicit" | "cell-default" | "instance-override" | "supply-default";
      instance: Instance;
      net: Net;
      materialized: boolean;
    }
  | {
      status: "no-connect" | "unresolved";
      instance: Instance;
      net: undefined;
      materialized: false;
    };

export function mosBulkKind(instance: Instance): MosBulkKind | undefined {
  return deviceDescriptor(instance.symbolId)?.mosBulkClass;
}

/**
 * The letter `B` is overloaded by SPICE symbols: it is MOS bulk but BJT base.
 * Keep that distinction at the semantic boundary so presentation and editing
 * code never turn an ordinary BJT base wire into a MOS bulk route.
 */
export function isMosBulkTerminal(
  document: SchematicDocument,
  endpoint: RouteEndpoint,
): boolean {
  if (endpoint.kind !== "terminal" || endpoint.pinName !== "B") return false;
  const instance = document.instances.find(
    (candidate) => candidate.id === endpoint.instanceId,
  );
  return Boolean(instance && mosBulkKind(instance));
}

export interface MosBulkRouteFamily {
  routeIds: string[];
  instanceIds: string[];
}

function bulkFamilyContactKeys(
  document: SchematicDocument,
  route: RouteBranch,
): string[] {
  return [route.start, routeEnd(route)].flatMap((endpoint) => {
    if (endpoint.kind === "junction")
      return [`junction:${endpoint.junctionId}`];
    return isMosBulkTerminal(document, endpoint)
      ? [`terminal:${endpoint.instanceId}:B`]
      : [];
  });
}

/**
 * Resolve every dashed segment in the connected visual path that originates
 * at one or more MOS B terminals. Route splitting can move the B terminal off
 * the selected segment, so direct terminal incidence is not a sufficient
 * family test.
 */
export function deriveMosBulkRouteFamily(
  document: SchematicDocument,
  seedRoute: RouteBranch,
): MosBulkRouteFamily | undefined {
  if (seedRoute.presentation !== "bulk-dashed") return undefined;
  const routeIds = new Set([seedRoute.id]);
  const contactKeys = new Set(bulkFamilyContactKeys(document, seedRoute));
  let changed = true;
  while (changed) {
    changed = false;
    for (const route of document.routes) {
      if (route.presentation !== "bulk-dashed" || routeIds.has(route.id)) {
        continue;
      }
      const routeKeys = bulkFamilyContactKeys(document, route);
      if (!routeKeys.some((key) => contactKeys.has(key))) continue;
      routeIds.add(route.id);
      routeKeys.forEach((key) => contactKeys.add(key));
      changed = true;
    }
  }
  const familyRoutes = document.routes.filter((route) =>
    routeIds.has(route.id),
  );
  const instanceIds = new Set(
    familyRoutes.flatMap((route) =>
      [route.start, routeEnd(route)].flatMap((endpoint) =>
        isMosBulkTerminal(document, endpoint) && endpoint.kind === "terminal"
          ? [endpoint.instanceId]
          : [],
      ),
    ),
  );
  if (instanceIds.size === 0) return undefined;
  return {
    routeIds: [...routeIds].sort((left, right) =>
      left.localeCompare(right, "en"),
    ),
    instanceIds: [...instanceIds].sort((left, right) =>
      left.localeCompare(right, "en"),
    ),
  };
}

export function hasExplicitMosBulkRoute(
  document: SchematicDocument,
  instanceId: string,
): boolean {
  return document.routes.some(
    (route) =>
      route.presentation === "bulk-dashed" &&
      [route.start, routeEnd(route)].some(
        (endpoint) =>
          endpoint.kind === "terminal" &&
          endpoint.instanceId === instanceId &&
          endpoint.pinName === "B" &&
          isMosBulkTerminal(document, endpoint),
      ),
  );
}

/** A dashed Route is meaningful only when it belongs to a MOS bulk family. */
export function isMosBulkRoute(
  document: SchematicDocument,
  route: RouteBranch,
): boolean {
  return deriveMosBulkRouteFamily(document, route) !== undefined;
}

/**
 * The Cell's one Net in a supply domain, or nothing.
 *
 * "The supply the author drew" is an explicit classification, never a guess:
 * a placed `ground` or `vdd-port` marker, a name claim that says which power
 * domain a Net belongs to, or a unique formal VSS/VDD Cell Port. The formal
 * interface is an authored supply declaration; an ordinary Net name hint is
 * not. Nothing here guesses from an internal Net's spelling or nearby wire.
 *
 * Several candidates (AVDD beside DVDD, AGND beside DGND) is a question for
 * the author rather than a vote, so the answer is then nothing and whoever
 * asked has to be told to name one. A marker nobody wired yet names no Net,
 * so it neither answers nor competes.
 */
export function drawnSupplyNet(
  document: SchematicDocument,
  domain: SupplyDomain,
  logicalNets?: ResolvedDocumentLogicalNets,
): Net | undefined {
  const drawn = drawnSupplyNets(document, domain, logicalNets);
  return drawn.nets.length === 1 && !drawn.contradictory
    ? drawn.nets[0]
    : undefined;
}

/**
 * Whether the author drew anything in a supply domain at all: one supply,
 * several competing, or a marker on a Net of the other domain. A Cell that
 * drew none takes the conventional default; one that drew several is asked.
 */
export function drawsSupply(
  document: SchematicDocument,
  domain: SupplyDomain,
  logicalNets?: ResolvedDocumentLogicalNets,
): boolean {
  const drawn = drawnSupplyNets(document, domain, logicalNets);
  return drawn.nets.length > 0 || drawn.contradictory;
}

/**
 * Every supply the author drew in a domain, by Logical-Net ID: the candidates
 * {@link drawnSupplyNet} weighs, under the same classification. Where that
 * asks for the one supply, this answers whether a Net is a supply at all, so
 * a Cell with two positive supplies has both here.
 */
export function drawnSupplyLogicalNetIds(
  document: SchematicDocument,
  domain: SupplyDomain,
  logicalNets?: ResolvedDocumentLogicalNets,
): ReadonlySet<string> {
  return new Set(drawnSupplyNets(document, domain, logicalNets).logicalNetIds);
}

/** A supply named as a negative rail: VEE, VSS or VNEG, any case and suffix. */
const NEGATIVE_SUPPLY_NAME = /^[ad]?(?:vee|vss|vneg)[a-z0-9_]*$/iu;

/**
 * Whether a Net name reads as a negative rail (VEE, VSS, VNEG; an a/d
 * prefix, any suffix). The one rule {@link drawnNegativeSupplyNet} and the
 * export's lowest-supply check share, so a substrate the Process puts on that
 * rail is never also reported off the lowest supply (#1530).
 */
export function namesNegativeSupply(name: string): boolean {
  return NEGATIVE_SUPPLY_NAME.test(name);
}

/**
 * The Cell's one drawn negative supply, or nothing (#1530). A negative rail
 * is drawn with the same supply marker as VDD, so its domain says only that
 * it is a supply; which one sits below ground is a voltage the drawing does
 * not hold. The name the author gave that drawn supply does: VEE, or VSS
 * and VNEG on a supply marker rather than ground. An internal Net's name
 * still decides nothing, and two such supplies are a question, not a vote.
 */
export function drawnNegativeSupplyNet(
  document: SchematicDocument,
  logicalNets?: ResolvedDocumentLogicalNets,
): Net | undefined {
  const resolved = logicalNets ?? resolveDocumentLogicalNets(document);
  const drawn = drawnSupplyNets(document, "vdd", resolved);
  const negative = drawn.nets.filter((_net, index) =>
    namesNegativeSupply(
      resolved.byId.get(drawn.logicalNetIds[index]!)?.name ?? "",
    ),
  );
  return negative.length === 1 ? negative[0] : undefined;
}

function drawnSupplyNets(
  document: SchematicDocument,
  domain: SupplyDomain,
  logicalNets?: ResolvedDocumentLogicalNets,
): { nets: Net[]; logicalNetIds: string[]; contradictory: boolean } {
  const resolved = logicalNets ?? resolveDocumentLogicalNets(document);
  const candidates = new Map<string, Net>();
  let contradictory = false;
  const addCandidate = (netId: string) => {
    const group = resolved.byBaseNetId.get(netId);
    if (group && group.powerDomain !== "none" && group.powerDomain !== domain) {
      contradictory = true;
      return;
    }
    const [first] = [...(group?.baseNetIds ?? [netId])].sort((left, right) =>
      left.localeCompare(right, "en"),
    );
    const net = document.nets.find((item) => item.id === first);
    if (net) candidates.set(group?.id ?? net.id, net);
  };
  // A caller that already holds this Document's Logical Nets passes them: the
  // fallback below runs once per MOS instance without one, and resolved the
  // whole Document every time.
  for (const group of resolved.groups) {
    if (group.powerDomain !== domain) continue;
    if (group.baseNetIds[0]) addCandidate(group.baseNetIds[0]);
  }
  const formalName = domain === "ground" ? "vss" : "vdd";
  for (const terminal of document.netlist?.terminals ?? [])
    if (foldNetName(terminal.name) === formalName) addCandidate(terminal.netId);
  // A wired marker remains an independent declaration when another Port or
  // claim exists; a disagreement must not silently select either supply.
  for (const instance of document.instances) {
    const marker = supplyMarkerForSymbol(instance.symbolId);
    if (marker?.domain !== domain) continue;
    const net = document.nets.find((candidate) =>
      candidate.terminals.some(
        (terminal) =>
          terminal.instanceId === instance.id &&
          terminal.pinName === marker.pinName,
      ),
    );
    if (net) addCandidate(net.id);
  }
  return {
    nets: [...candidates.values()],
    logicalNetIds: [...candidates.keys()],
    contradictory,
  };
}

/**
 * The Net a MOS body follows when nobody has said otherwise: an unambiguous
 * drawn supply or formal VSS/VDD Cell Port. The answer needs no per-Cell
 * setting and survives copy/paste into a Cell with the same supply authority.
 */
export function supplyDefaultMosBulkNet(
  document: SchematicDocument,
  kind: MosBulkKind,
  logicalNets?: ResolvedDocumentLogicalNets,
): Net | undefined {
  return drawnSupplyNet(
    document,
    kind === "nmos" ? "ground" : "vdd",
    logicalNets,
  );
}

/**
 * Single authority for MOS body intent. Net membership remains the electrical
 * truth; this function only explains where that truth came from: explicit B
 * wiring, a configured Cell default, or — when the Cell configures nothing —
 * an authored supply marker or formal VSS/VDD Port. MOS polarity never creates
 * a supply Net, and the fallback stays silent when those authorities disagree.
 */
export function resolveMosBulkConnection(
  document: SchematicDocument,
  instanceOrId: Instance | string,
  logicalNets?: ResolvedDocumentLogicalNets,
): MosBulkResolution | undefined {
  const instance =
    typeof instanceOrId === "string"
      ? document.instances.find((candidate) => candidate.id === instanceOrId)
      : instanceOrId;
  if (!instance || !mosBulkKind(instance)) return undefined;

  const connectedNet = document.nets.find((net) =>
    net.terminals.some(
      (terminal) =>
        terminal.instanceId === instance.id && terminal.pinName === "B",
    ),
  );
  // A body alone on the Net its own policy binding named, with no geometry,
  // no name and no Cell terminal, is what a paste or a deleted supply marker
  // left behind — not a connection anybody drew. Reading it as one strands
  // the body on a node nothing else reaches: the netlist writes that node
  // once and a matched pair ends up with one body on ground and the other on
  // nothing. Reclaim it here the way reconciliation does on an edit.
  const residue = strandedMosBulkNet(document, instance);
  if (connectedNet && !residue) {
    const origin = hasExplicitMosBulkRoute(document, instance.id)
      ? undefined
      : instance.mosBulkBinding;
    return {
      status: origin?.netId === connectedNet.id ? origin.origin : "explicit",
      instance,
      net: connectedNet,
      materialized: true,
    };
  }

  if (
    document.noConnects.some(
      (item) =>
        item.endpoint.kind === "terminal" &&
        item.endpoint.instanceId === instance.id &&
        item.endpoint.pinName === "B",
    )
  ) {
    return {
      status: "no-connect",
      instance,
      net: undefined,
      materialized: false,
    };
  }

  // Imported/source-bound MOS instances must already carry the fourth SPICE
  // node. Never repair missing source data by guessing a body connection.
  if (instance.sourceRef || instance.importProvenance) {
    return {
      status: "unresolved",
      instance,
      net: undefined,
      materialized: false,
    };
  }

  const kind = mosBulkKind(instance)!;
  const configuredId =
    kind === "nmos"
      ? document.mosBulkDefaults?.nmosNetId
      : document.mosBulkDefaults?.pmosNetId;
  const configured = configuredId
    ? document.nets.find((net) => net.id === configuredId)
    : undefined;
  if (configured) {
    return {
      status: "cell-default",
      instance,
      net: configured,
      materialized: false,
    };
  }

  const supply = supplyDefaultMosBulkNet(document, kind, logicalNets);
  if (supply) {
    return {
      status: "supply-default",
      instance,
      net: supply,
      materialized: false,
    };
  }

  return {
    status: "unresolved",
    instance,
    net: undefined,
    materialized: false,
  };
}

/**
 * Where a netlist projection put a MOS body that has no Net: on the Cell's
 * MOS body default (an imported part with no fourth node takes it), or, with
 * none set, on the conventional VDD or ground.
 */
export type PlacedMosBody = "cell-default" | "conventional";

/**
 * The bodies a netlist projection of a Document placed, by instance ID. In
 * the projected Document such a body is a member of that Net and reads as
 * wired; this says it was not.
 */
export type PlacedMosBodies = ReadonlyMap<string, PlacedMosBody>;

/** A MOS whose default body is one supply while its source is on another. */
export interface MosBodyOffSourceSupply {
  instance: Instance;
  /**
   * How the body came to its supply: a default, never a drawn wire.
   * `conventional`: it has no Net, and the netlist gave it the conventional
   * VDD or ground.
   */
  status: "instance-override" | "supply-default" | PlacedMosBody;
  /** The supply the body follows. */
  bodyNet: Net;
  /** The other supply of the same domain, which the source is on. */
  sourceNet: Net;
}

/**
 * The MOS whose body follows a default onto one supply while its source is on
 * another supply of the same domain: a PMOS on a Cell's second positive
 * supply, whose body the Cell's PMOS default put on the first. A level
 * shifter's VDDH devices with their bodies on VDDL are forward-biased when
 * VDDH is the higher supply. Which one is higher is a voltage the drawing does
 * not hold, so this names the question rather than a fault; a body wired
 * explicitly has been answered and is not listed. A supply is what
 * {@link drawnSupplyLogicalNetIds} classifies as one, the same reading a body
 * default takes, so a source on an internal node is never compared.
 *
 * Two supplies of a domain are also why a body can have no default at all:
 * the netlist then gives it the conventional VDD or ground, which may be
 * neither of the two, or the one its source is not on. Given the bodies a
 * netlist projection of this Document placed, those are compared too, the
 * body on whatever Net the projection chose.
 */
export function mosBodiesOffSourceSupply(
  document: SchematicDocument,
  logicalNets?: ResolvedDocumentLogicalNets,
  placedBodies?: PlacedMosBodies,
): MosBodyOffSourceSupply[] {
  const resolved = logicalNets ?? resolveDocumentLogicalNets(document);
  const supplies = new Map<SupplyDomain, ReadonlySet<string>>();
  const suppliesOf = (domain: SupplyDomain) => {
    let found = supplies.get(domain);
    if (!found) {
      found = drawnSupplyLogicalNetIds(document, domain, resolved);
      supplies.set(domain, found);
    }
    return found;
  };
  // A copied or older marker can lack its name claim, and so stand on a Net
  // of its own; it still names its supply, as the netlist writes it. Two
  // ground markers are one ground, never two supplies to choose between.
  const supplyName = (group: ResolvedLogicalNet) => {
    if (group.name) return foldNetName(group.name);
    for (const instance of document.instances) {
      const marker = supplyMarkerForSymbol(instance.symbolId);
      if (
        marker &&
        document.nets.some(
          (net) =>
            group.baseNetIds.includes(net.id) &&
            net.terminals.some(
              (terminal) =>
                terminal.instanceId === instance.id &&
                terminal.pinName === marker.pinName,
            ),
        )
      )
        return foldNetName(marker.name);
    }
    return undefined;
  };
  return document.instances.flatMap((instance) => {
    const kind = mosBulkKind(instance);
    if (!kind) return [];
    // A body and a source on two supplies of one domain need two to be on;
    // most Cells have one, and then no body is looked up at all.
    const domain = suppliesOf(kind === "nmos" ? "ground" : "vdd");
    if (domain.size < 2) return [];
    const resolution = resolveMosBulkConnection(document, instance, resolved);
    if (!resolution?.net) return [];
    const status = placedBodies?.get(instance.id) ?? resolution.status;
    if (status === "explicit") return [];
    const sourceNet = document.nets.find((net) =>
      net.terminals.some(
        (terminal) =>
          terminal.instanceId === instance.id && terminal.pinName === "S",
      ),
    );
    if (!sourceNet) return [];
    const body = resolved.byBaseNetId.get(resolution.net.id);
    const source = resolved.byBaseNetId.get(sourceNet.id);
    if (!body || !source || body.id === source.id) return [];
    // The conventional supply is the netlist's choice: a Net named VDD or
    // VSS, drawn as a supply or only labelled, or one it adds. The source
    // still has to be on a supply the author drew.
    if (!domain.has(source.id)) return [];
    if (status !== "conventional" && !domain.has(body.id)) return [];
    const bodyName = supplyName(body);
    return bodyName === undefined || bodyName !== supplyName(source)
      ? [{ instance, status, bodyNet: resolution.net, sourceNet }]
      : [];
  });
}

/**
 * The Net a MOS body sits on when that membership is only policy residue: a
 * binding points at it, this one body is its only terminal, and it owns no
 * geometry, claims no name and carries no Cell terminal, so it is not a
 * conductor anybody authored. Copy/paste materialized Cell policy into such
 * a Net, and deleting the supply marker that named it leaves the body
 * stranded there, out of reach of the Cell default it should follow.
 * Authored membership (no binding) and a body bias Net shared by several
 * bodies are connections, never residue.
 */
export function strandedMosBulkNet(
  document: SchematicDocument,
  instanceOrId: Instance | string,
): Net | undefined {
  const instance =
    typeof instanceOrId === "string"
      ? document.instances.find((candidate) => candidate.id === instanceOrId)
      : instanceOrId;
  if (!instance?.mosBulkBinding || !mosBulkKind(instance)) return undefined;
  // A legacy `supply-default` binding is the old materialized supply
  // connection, readable compatibility data rather than something a paste or
  // a deleted marker left behind. Residue is what this editor writes for a
  // Cell's policy or for one instance.
  if (instance.mosBulkBinding.origin === "supply-default") return undefined;
  const net = document.nets.find((candidate) =>
    candidate.terminals.some(
      (terminal) =>
        terminal.instanceId === instance.id && terminal.pinName === "B",
    ),
  );
  if (!net || instance.mosBulkBinding.netId !== net.id) return undefined;
  const sole =
    net.terminals.length === 1 &&
    net.terminals[0]!.instanceId === instance.id &&
    net.terminals[0]!.pinName === "B";
  return sole &&
    !document.routes.some((route) => route.netId === net.id) &&
    !document.junctions.some((junction) => junction.netId === net.id) &&
    !document.connectivityEvidence.some(
      (evidence) => evidence.netId === net.id,
    ) &&
    !(document.netlist?.terminals ?? []).some(
      (terminal) => terminal.netId === net.id,
    )
    ? net
    : undefined;
}

/**
 * Recognize the narrow legacy failure produced when an imported source Net was
 * physically split around hidden body terminals. SPICE source Evidence is
 * provenance, never electrical union; it is used here only as repair evidence
 * when the detached Net contains MOS B terminals and no authored geometry.
 */
export function resolveDetachedMosBulkDefault(
  document: SchematicDocument,
  instanceOrId: Instance | string,
): Net | undefined {
  const instance =
    typeof instanceOrId === "string"
      ? document.instances.find((candidate) => candidate.id === instanceOrId)
      : instanceOrId;
  const kind = instance ? mosBulkKind(instance) : undefined;
  if (!instance || !kind) return undefined;
  const configuredNetId =
    kind === "nmos"
      ? document.mosBulkDefaults?.nmosNetId
      : document.mosBulkDefaults?.pmosNetId;
  const configuredNet = configuredNetId
    ? document.nets.find((net) => net.id === configuredNetId)
    : undefined;
  const connectedNet = document.nets.find((net) =>
    net.terminals.some(
      (terminal) =>
        terminal.instanceId === instance.id && terminal.pinName === "B",
    ),
  );
  if (
    !configuredNet ||
    !connectedNet ||
    connectedNet.id === configuredNet.id ||
    connectedNet.terminals.length === 0 ||
    connectedNet.terminals.some((terminal) => {
      if (terminal.pinName !== "B") return true;
      const peer = document.instances.find(
        (candidate) => candidate.id === terminal.instanceId,
      );
      return !peer || !mosBulkKind(peer);
    }) ||
    document.routes.some((route) => route.netId === connectedNet.id) ||
    document.junctions.some((junction) => junction.netId === connectedNet.id) ||
    document.connectivityEvidence.some(
      (evidence) =>
        evidence.netId === connectedNet.id && evidence.kind === "name-claim",
    ) ||
    document.netlist?.terminals.some(
      (terminal) => terminal.netId === connectedNet.id,
    )
  ) {
    return undefined;
  }
  const sourceIds = (netId: string) =>
    new Set(
      document.connectivityEvidence.flatMap((evidence) =>
        evidence.kind === "spice-source" && evidence.netId === netId
          ? [evidence.sourceNetId]
          : [],
      ),
    );
  const connectedSourceIds = sourceIds(connectedNet.id);
  const configuredSourceIds = sourceIds(configuredNet.id);
  return [...connectedSourceIds].some((sourceId) =>
    configuredSourceIds.has(sourceId),
  )
    ? configuredNet
    : undefined;
}

export function mosBulkShouldBeVisible(
  document: SchematicDocument,
  instanceOrId: Instance | string,
  logicalNets?: ResolvedDocumentLogicalNets,
): boolean {
  const resolution = resolveMosBulkConnection(
    document,
    instanceOrId,
    logicalNets,
  );
  if (resolution?.status !== "explicit") return false;
  // Imported fourth-node membership is electrical evidence, not a request to
  // draw a body-bias lead. A matching Cell or drawn-supply default stays
  // implicit unless a bulk Route was authored. B and S membership are never
  // rewritten here.
  if (hasExplicitMosBulkRoute(document, resolution.instance.id)) return true;
  const kind = mosBulkKind(resolution.instance)!;
  const configuredId =
    kind === "nmos"
      ? document.mosBulkDefaults?.nmosNetId
      : document.mosBulkDefaults?.pmosNetId;
  const configured = configuredId
    ? document.nets.find((net) => net.id === configuredId)
    : undefined;
  const policyNet =
    configured ?? supplyDefaultMosBulkNet(document, kind, logicalNets);
  if (!policyNet) return true;
  if (policyNet.id === resolution.net.id) return false;
  const resolved = logicalNets ?? resolveDocumentLogicalNets(document);
  const policyLogicalId = resolved.byBaseNetId.get(policyNet.id)?.id;
  return (
    !policyLogicalId ||
    policyLogicalId !== resolved.byBaseNetId.get(resolution.net.id)?.id
  );
}
