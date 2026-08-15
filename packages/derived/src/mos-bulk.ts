import type {
  Instance,
  Net,
  RouteBranch,
  RouteEndpoint,
  SchematicDocument,
} from "@icm/model";

export type MosBulkKind = "nmos" | "pmos";
export type MosBulkResolution =
  | {
      status: "explicit" | "cell-default" | "supply-default";
      instance: Instance;
      net: Net;
      materialized: boolean;
    }
  | {
      status: "supply-default";
      instance: Instance;
      net: undefined;
      materialized: false;
      defaultName: "0" | "VDD";
    }
  | {
      status: "no-connect" | "unresolved";
      instance: Instance;
      net: undefined;
      materialized: false;
    };

export function mosBulkKind(instance: Instance): MosBulkKind | undefined {
  return instance.symbolId === "nmos" || instance.symbolId === "pmos"
    ? instance.symbolId
    : undefined;
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

/** A dashed Route is meaningful only when it visibly represents MOS bulk. */
export function isMosBulkRoute(
  document: SchematicDocument,
  route: RouteBranch,
): boolean {
  return (
    route.presentation === "bulk-dashed" &&
    [route.from, route.to].some((endpoint) =>
      isMosBulkTerminal(document, endpoint),
    )
  );
}

function supplyDefaultNet(
  document: SchematicDocument,
  kind: MosBulkKind,
): Net | undefined {
  const domain = kind === "nmos" ? "ground" : "vdd";
  const canonicalId = kind === "nmos" ? "net-global-0" : "net-global-vdd";
  return (
    document.nets.find(
      (net) =>
        net.id === canonicalId &&
        net.scope === "global" &&
        (net.powerDomain ?? "none") === domain,
    ) ??
    document.nets.find(
      (net) => net.scope === "global" && (net.powerDomain ?? "none") === domain,
    )
  );
}

/**
 * Single authority for MOS body intent. Net membership remains the electrical
 * truth; this function only explains whether that truth was explicit or was
 * materialized from a cell or canonical supply default.
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
    const origin = instance.mosBulkBinding;
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

  const supply = supplyDefaultNet(document, kind);
  return supply
    ? {
        status: "supply-default",
        instance,
        net: supply,
        materialized: false,
      }
    : {
        status: "supply-default",
        instance,
        net: undefined,
        materialized: false,
        defaultName: kind === "nmos" ? "0" : "VDD",
      };
}

export function mosBulkShouldBeVisible(
  document: SchematicDocument,
  instanceOrId: Instance | string,
): boolean {
  const resolution = resolveMosBulkConnection(document, instanceOrId);
  if (resolution?.status !== "explicit") return false;
  const kind = mosBulkKind(resolution.instance)!;
  const configuredId =
    kind === "nmos"
      ? document.mosBulkDefaults?.nmosNetId
      : document.mosBulkDefaults?.pmosNetId;
  if (configuredId === resolution.net.id) return false;
  const expectedDomain = kind === "nmos" ? "ground" : "vdd";
  return (
    (resolution.net.powerDomain ?? "none") !== expectedDomain &&
    supplyDefaultNet(document, kind)?.id !== resolution.net.id
  );
}
