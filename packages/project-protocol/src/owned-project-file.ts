/**
 * Current portable Project File schema. This number is independent of the
 * normalized runtime model schema exported by @icm/model.
 */
import { createProjectSymbolResolver } from "@icm/symbols";
import type { CircuitProject } from "@icm/model";
import { ProjectFormatError } from "./diagnostics.js";
import {
  encodeProjectFile as encodeOwned,
  decodeProjectFile as decodeOwned,
} from "./owned-project-v59.js";
import {
  compactProjectFile,
  expandProjectFile,
} from "./compact-project-file.js";
import {
  captureSourceConnectivity,
  materializeSourceConnectivity,
  type SourceConnectivity,
} from "./source-connectivity.js";
export const CURRENT_PROJECT_FILE_VERSION = 82;
type Value = Record<string, any>;

/** Member-specific No Connect declarations are explicit from schema 77. */
export function rejectMemberNoConnect(raw: Value): void {
  if (!Array.isArray(raw.documents)) return;
  raw.documents.forEach((document: Value, index: number) => {
    if (!Array.isArray(document?.noConnects)) return;
    document.noConnects.forEach((mark: Value, markIndex: number) => {
      if (mark?.endpoint && Object.hasOwn(mark.endpoint, "memberId"))
        throw new ProjectFormatError([
          {
            code: "INVALID_PROJECT",
            path: [
              "documents",
              index,
              "noConnects",
              markIndex,
              "endpoint",
              "memberId",
            ],
            message: "Member No Connect requires Project schema 77",
          },
        ]);
    });
  });
}

/** Schema 75 understood ranges, but not ordered expressions or slice selectors. */
export function rejectOrderedSignals(raw: Value): void {
  const records = (value: unknown): Value[] =>
    Array.isArray(value)
      ? value.filter(
          (item) => item && typeof item === "object" && !Array.isArray(item),
        )
      : [];
  const reject = (path: (string | number)[], message: string): never => {
    throw new ProjectFormatError([{ code: "INVALID_PROJECT", path, message }]);
  };
  const checkBinding = (annotation: Value, path: (string | number)[]) => {
    for (const field of ["bind", "binding"]) {
      const binding = annotation[field];
      if (
        binding &&
        typeof binding === "object" &&
        Object.hasOwn(binding, "memberEndpoints")
      )
        reject(
          [...path, field, "memberEndpoints"],
          "Slice selectors require Project schema 76",
        );
    }
  };
  records(raw.documents).forEach((document, index) => {
    const path = ["documents", index];
    const checkExpression = (owner: Value, ownerPath: (string | number)[]) => {
      if (
        typeof owner.signal?.expression === "string" &&
        owner.signal.expression.includes(",")
      )
        reject(
          [...ownerPath, "signal", "expression"],
          "Ordered signal expressions require Project schema 76",
        );
    };
    records(document.netlist?.terminals).forEach((terminal, i) =>
      checkExpression(terminal, [...path, "netlist", "terminals", i]),
    );
    records(document.connectivityEvidence).forEach((evidence, i) =>
      checkExpression(evidence, [...path, "connectivityEvidence", i]),
    );
    records(document.annotations).forEach((annotation, i) =>
      checkBinding(annotation, [...path, "annotations", i]),
    );
    records(document.instances).forEach((instance, i) =>
      records(instance.labels).forEach((annotation, j) =>
        checkBinding(annotation, [...path, "instances", i, "labels", j]),
      ),
    );
  });
}

/** Old envelopes never infer or accept new member-qualified connectivity. */
export function rejectSignalMembers(raw: Value): void {
  const records = (value: unknown): Value[] =>
    Array.isArray(value)
      ? value.filter(
          (item) => item && typeof item === "object" && !Array.isArray(item),
        )
      : [];
  const check = (
    value: unknown,
    fields: string[],
    path: (string | number)[],
  ) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    for (const field of fields)
      if (Object.hasOwn(value, field))
        throw new ProjectFormatError([
          {
            code: "INVALID_PROJECT",
            path: [...path, field],
            message: "Signal members require Project schema 75",
          },
        ]);
  };
  const artwork = (
    definition: Value | undefined,
    path: (string | number)[],
  ) => {
    records(definition?.symbol?.pins).forEach((pin, index) =>
      check(pin, ["signalMembers"], [...path, "symbol", "pins", index]),
    );
    records(definition?.symbol?.variants).forEach((variant, index) =>
      records(variant.auxiliaryPins).forEach((pin, pinIndex) =>
        check(
          pin,
          ["signalMembers"],
          [...path, "symbol", "variants", index, "auxiliaryPins", pinIndex],
        ),
      ),
    );
  };
  records(raw.componentDefinitions).forEach((definition, index) =>
    artwork(definition, ["componentDefinitions", index]),
  );
  records(raw.modelSources).forEach((source, sourceIndex) =>
    records(source.draft?.authoring).forEach((candidate, index) => {
      const path = ["modelSources", sourceIndex, "draft", "authoring", index];
      artwork(candidate.lastValidArtwork, [...path, "lastValidArtwork"]);
      artwork(candidate.legacyRepair?.baseline, [
        ...path,
        "legacyRepair",
        "baseline",
      ]);
    }),
  );
  records(raw.documents).forEach((document, index) => {
    const path = ["documents", index];
    records(document.netlist?.terminals).forEach((terminal, i) =>
      check(terminal, ["signal"], [...path, "netlist", "terminals", i]),
    );
    records(document.connectivityEvidence).forEach((evidence, i) =>
      check(evidence, ["signal"], [...path, "connectivityEvidence", i]),
    );
    const checkAnnotation = (
      annotation: Value,
      annotationPath: (string | number)[],
    ) => {
      for (const field of ["bind", "binding"])
        check(
          annotation[field],
          ["memberEndpoint", "memberEndpoints"],
          [...annotationPath, field],
        );
    };
    records(document.annotations).forEach((annotation, i) =>
      checkAnnotation(annotation, [...path, "annotations", i]),
    );
    records(document.instances).forEach((instance, i) =>
      records(instance.labels).forEach((annotation, j) =>
        checkAnnotation(annotation, [...path, "instances", i, "labels", j]),
      ),
    );
    records(document.routes).forEach((route, i) => {
      const rp = [...path, "routes", i];
      check(route, ["members"], rp);
      check(route.start, ["memberId"], [...rp, "start"]);
      check(route.end, ["memberId"], [...rp, "end"]);
      records(route.legs).forEach((leg, j) => {
        check(leg, ["memberId"], [...rp, "legs", j]);
        check(
          leg.to?.endpoint,
          ["memberId"],
          [...rp, "legs", j, "to", "endpoint"],
        );
      });
    });
    records(document.junctions).forEach((junction, i) => {
      check(junction, ["members"], [...path, "junctions", i]);
      check(
        junction.contactAnchor,
        ["memberId"],
        [...path, "junctions", i, "contactAnchor"],
      );
    });
    records(document.nets).forEach((net, i) => {
      check(net.at, ["memberId"], [...path, "nets", i, "at"]);
      records(net.terminals).forEach((terminal, j) =>
        check(terminal, ["memberId"], [...path, "nets", i, "terminals", j]),
      );
    });
    records(document.noConnects).forEach((mark, i) =>
      check(
        mark.endpoint,
        ["memberId"],
        [...path, "noConnects", i, "endpoint"],
      ),
    );
    for (const kind of ["contacts", "unrouted"])
      if (Array.isArray(document.connections?.[kind]))
        document.connections[kind].forEach((link: unknown, i: number) =>
          records(link).forEach((endpoint, j) =>
            check(endpoint, ["memberId"], [...path, "connections", kind, i, j]),
          ),
        );
  });
}

/** An object's kept Document style first appears in schema 64. */
export function rejectKeptDocumentStyle(raw: Value): void {
  if (!Array.isArray(raw.documents)) return;
  const scan = (items: unknown, path: (string | number)[]) => {
    if (!Array.isArray(items)) return;
    items.forEach((item, index) => {
      if (
        item &&
        typeof item === "object" &&
        Object.hasOwn(item, "documentStyle")
      )
        throw new ProjectFormatError([
          {
            code: "INVALID_PROJECT",
            path: [...path, index, "documentStyle"],
            message: "A kept Document style requires Project schema 64",
          },
        ]);
    });
  };
  raw.documents.forEach((document: Value | null, index: number) => {
    if (!document || typeof document !== "object") return;
    const path = ["documents", index];
    for (const key of [
      "instances",
      "annotations",
      "routes",
      "junctions",
      "noConnects",
    ])
      scan(document[key], [...path, key]);
    if (Array.isArray(document.instances))
      document.instances.forEach((instance: Value | null, instanceIndex) =>
        scan(instance?.labels, [...path, "instances", instanceIndex, "labels"]),
      );
    scan(document.drafting?.objects, [...path, "drafting", "objects"]);
  });
}

export function encodeProjectFile(project: CircuitProject): Value {
  const owned = encodeOwned(project) as Value;
  const connections = captureSourceConnectivity(project);
  for (const [index, document] of owned.documents.entries()) {
    document.nets = connections[index]!.nets;
    document.connections = connections[index]!.connections;
    for (const route of document.routes) {
      delete route.netId;
      if (route.members)
        route.members = route.members.map(
          ({ netId: _netId, ...member }: Value) => member,
        );
    }
    for (const junction of document.junctions) {
      delete junction.netId;
      if (junction.members)
        junction.members = junction.members.map(
          ({ netId: _netId, ...member }: Value) => member,
        );
    }
  }
  owned.schemaVersion = CURRENT_PROJECT_FILE_VERSION;
  return compactProjectFile(owned);
}

export function decodeProjectFile(raw: Value): Value {
  if (raw.schemaVersion === 59) return decodeOwned(raw);
  try {
    const owned = expandProjectFile(raw);
    const sources: SourceConnectivity[] = [];
    for (const document of owned.documents) {
      sources.push({ nets: document.nets, connections: document.connections });
      delete document.connections;
      document.nets = document.nets.map((net: Value) => ({
        id: net.id,
        terminals: [],
      }));
      for (const route of document.routes) {
        if (Object.hasOwn(route, "netId"))
          throw new Error("Route netId is derived; edit its endpoints instead");
        route.netId = "pending-network";
        for (const member of route.members ?? []) {
          if (Object.hasOwn(member, "netId"))
            throw new Error(
              "Route member netId is derived; edit its endpoint mapping instead",
            );
          member.netId = "pending-network";
        }
      }
      for (const junction of document.junctions) {
        if (Object.hasOwn(junction, "netId"))
          throw new Error(
            "Junction netId is derived; edit its connections instead",
          );
        junction.netId = "pending-network";
        for (const member of junction.members ?? []) {
          if (Object.hasOwn(member, "netId"))
            throw new Error(
              "Junction member netId is derived; edit its connections instead",
            );
          member.netId = "pending-network";
        }
      }
    }
    const decoded = decodeOwned(owned, {
      allowParameterShowValue: raw.schemaVersion >= 61,
      allowFormulaFormat: raw.schemaVersion >= 62,
      allowSourceControl: raw.schemaVersion >= 65,
    }) as unknown as CircuitProject;
    const resolver = createProjectSymbolResolver(decoded, []);
    decoded.documents.forEach((document, index) =>
      materializeSourceConnectivity(document, sources[index]!, resolver),
    );
    return decoded as unknown as Value;
  } catch (error) {
    if (error instanceof ProjectFormatError) throw error;
    throw new ProjectFormatError([
      {
        code: "INVALID_PROJECT",
        path: [],
        message: error instanceof Error ? error.message : String(error),
      },
    ]);
  }
}
