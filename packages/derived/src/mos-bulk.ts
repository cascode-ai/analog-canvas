import { deviceDescriptor } from "@icm/devices";
import type {
  Instance,
  Net,
  RouteBranch,
  RouteEndpoint,
  SchematicDocument,
} from "@icm/model";
import { routeEnd } from "@icm/model";
import { resolveDocumentLogicalNets } from "./logical-net.js";
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
 * a placed `ground` or `vdd-port` marker, or a name claim that says which
 * power domain a Net belongs to (a rail, a formal Cell Pin declared as a
 * supply). Nothing here reads a Net's spelling, a device's polarity, or what
 * a wire happens to pass near.
 *
 * Several candidates (AVDD beside DVDD, AGND beside DGND) is a question for
 * the author rather than a vote, so the answer is then nothing and whoever
 * asked has to be told to name one. A marker nobody wired yet names no Net,
 * so it neither answers nor competes.
 */
export function drawnSupplyNet(
  document: SchematicDocument,
  domain: SupplyDomain,
): Net | undefined {
  const netIds = new Set<string>();
  for (const group of resolveDocumentLogicalNets(document).groups) {
    if (group.powerDomain !== domain) continue;
    // Any Base Net of the group is the same node; take a stable one so the
    // answer does not depend on document order.
    const [first] = [...group.baseNetIds].sort((left, right) =>
      left.localeCompare(right, "en"),
    );
    if (first) netIds.add(first);
  }
  if (netIds.size === 0) {
    // Logical identity needs a name claim. A marker that was placed and wired
    // without one still says which supply it is.
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
      if (net) netIds.add(net.id);
    }
  }
  if (netIds.size !== 1) return undefined;
  const [netId] = [...netIds];
  return document.nets.find((net) => net.id === netId);
}

/**
 * The Net a MOS body follows when nobody has said otherwise: the supply the
 * author already drew — ground under an NMOS body, VDD under a PMOS body,
 * because that is what those symbols mean. The answer needs no per-Cell
 * setting, survives copy/paste into any Cell that has the supply, and holds
 * for drawings made before the policy existed.
 */
export function supplyDefaultMosBulkNet(
  document: SchematicDocument,
  kind: MosBulkKind,
): Net | undefined {
  return drawnSupplyNet(document, kind === "nmos" ? "ground" : "vdd");
}

/**
 * Single authority for MOS body intent. Net membership remains the electrical
 * truth; this function only explains where that truth came from: explicit B
 * wiring, a configured Cell default, or — when the Cell configures nothing —
 * the supply marker the author drew. MOS polarity never creates or selects a
 * named supply Net; the supply fallback reads a placed marker, and stays
 * silent when the drawing offers more than one.
 */
export function resolveMosBulkConnection(
  document: SchematicDocument,
  instanceOrId: Instance | string,
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

  const supply = supplyDefaultMosBulkNet(document, kind);
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
    document.junctions.some((junction) => junction.netId === connectedNet.id)
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
): boolean {
  const resolution = resolveMosBulkConnection(document, instanceOrId);
  if (resolution?.status !== "explicit") return false;
  // Imported fourth-node membership is electrical evidence, not a request to
  // draw a body-bias lead. The configured Cell default stays implicit unless
  // a bulk Route was authored. B and S membership are never rewritten here.
  if (hasExplicitMosBulkRoute(document, resolution.instance.id)) return true;
  const defaultNetId =
    mosBulkKind(resolution.instance) === "nmos"
      ? document.mosBulkDefaults?.nmosNetId
      : document.mosBulkDefaults?.pmosNetId;
  if (defaultNetId === resolution.net.id) return false;
  return true;
}
