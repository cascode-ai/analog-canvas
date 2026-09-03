import { deviceDescriptor } from "@icm/devices";
import type {
  Instance,
  Net,
  RouteBranch,
  RouteEndpoint,
  SchematicDocument,
} from "@icm/model";
import { routeEnd } from "@icm/model";

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
 * Single authority for MOS body intent. Net membership remains the electrical
 * truth; this function only explains whether that truth was explicit or was
 * materialized from a configured cell default. MOS polarity never creates or
 * selects a named supply Net.
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
  if (connectedNet) {
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

  return {
    status: "unresolved",
    instance,
    net: undefined,
    materialized: false,
  };
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
