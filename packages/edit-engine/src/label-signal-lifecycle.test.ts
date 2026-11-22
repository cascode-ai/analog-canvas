import { expect, it } from "vitest";
import {
  createEmptyProject,
  createRoutePath,
  semanticTextDocument,
  type CircuitProject,
} from "@icm/model";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { resolveDocumentLogicalNets } from "@icm/derived";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import {
  createFreeWireAnchor,
  proposeWireCommit,
} from "./wire-commit-planner.js";
import {
  planNamedWireEdits,
  prepareNamedWireSource,
  planEnsureNamedRoute,
} from "./signal-wire-planner.js";
import { executeProjectTransaction } from "./project-transaction.js";
import type { SchematicEdit } from "./edit-schema.js";

function apply(project: CircuitProject, edits: readonly SchematicEdit[]) {
  const document = project.documents[0]!;
  const result = executeProjectTransaction(project, {
    transactionId: `label-${document.revision}`,
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    actor: { kind: "human", id: "test" },
    edits: [
      {
        kind: "transact_document",
        documentId: document.id,
        expectedRevision: document.revision,
        edits: [...edits],
      },
    ],
  });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.project;
}
function fixture() {
  const project = createEmptyProject("label-migration", "Label migration");
  const document = project.documents[0]!;
  const source = prepareNamedWireSource(
    createFreeWireAnchor({ x: 0, y: 0 }, "source", true, "start"),
    "CLK,RESET",
  );
  const wire = proposeWireCommit(
    source,
    createFreeWireAnchor({ x: 100, y: 0 }, "end", true, "end"),
    [],
    { routeId: "wire", newNetId: "net" },
  );
  return apply(
    project,
    planNamedWireEdits(
      document,
      wire.edits,
      wire.routeId,
      {
        name: "CLK,RESET",
        content: semanticTextDocument("CLK,RESET", "net-label"),
        sizeScale: 1,
        alignment: "start",
        position: { x: 50, y: -10 },
      },
      { symbolResolver: createProjectSymbolResolver(project, builtInSymbols) },
    ),
  );
}

it("deleting Label owners retains conductors and releases only the last owner's name join", () => {
  let project = fixture();
  let document = project.documents[0]!;
  const owner = document.annotations[0]!;
  const claim = document.connectivityEvidence.find(
    (item) => item.kind === "name-claim" && item.signal,
  )!;
  if (claim.kind !== "name-claim") throw new Error("Missing claim");
  const clock = claim.signal!.members[0]!;
  document.nets.push({ id: "remote", terminals: [] });
  document.junctions.push({
    id: "remote-junction",
    netId: "remote",
    position: { x: 200, y: 100 },
  });
  document.annotations.push(
    { ...owner, id: "remaining-owner" },
    {
      ...owner,
      id: "remote-owner",
      formatOverride: undefined,
      netId: "remote",
      binding: { kind: "net-name", netId: "remote" },
      anchor: { kind: "free", position: { x: 200, y: 90 } },
    },
  );
  document.connectivityEvidence.push(
    {
      ...claim,
      id: "remaining-claim",
      owner: { kind: "net-label", annotationId: "remaining-owner" },
    },
    {
      id: "remote-claim",
      kind: "name-claim",
      name: "CLK",
      netId: "remote",
      scope: "local",
      owner: { kind: "net-label", annotationId: "remote-owner" },
    },
  );
  project = parseProject(serializeProject(project));
  const geometry = structuredClone({
    routes: project.documents[0]!.routes,
    junctions: project.documents[0]!.junctions,
  });
  const joined = (cell: typeof document) =>
    resolveDocumentLogicalNets(cell)
      .byBaseNetId.get(clock.netId)!
      .baseNetIds.includes("remote");
  expect(joined(project.documents[0]!)).toBe(true);
  project = apply(project, [
    { kind: "remove_schematic_annotation", annotationId: owner.id },
  ]);
  expect(joined(project.documents[0]!)).toBe(true);
  expect(
    project.documents[0]!.connectivityEvidence.some(
      (item) => item.id === claim.id,
    ),
  ).toBe(false);
  project = parseProject(
    serializeProject(
      apply(project, [
        {
          kind: "remove_schematic_annotation",
          annotationId: "remaining-owner",
        },
      ]),
    ),
  );
  document = project.documents[0]!;
  expect(joined(document)).toBe(false);
  expect({ routes: document.routes, junctions: document.junctions }).toEqual(
    geometry,
  );
  expect(document.connectivityEvidence.map((item) => item.id)).toEqual([
    "remote-claim",
  ]);
});

it("does not reconnect a removed Label member when the same name is added again", () => {
  let project = fixture();
  const claim = project.documents[0]!.connectivityEvidence.find(
    (item) => item.kind === "name-claim" && item.signal,
  )!;
  if (claim.kind !== "name-claim") throw new Error("Missing claim");
  const removed = claim.signal!.members[0]!;
  const request = {
    candidateNetId: claim.netId,
    evidenceId: claim.id,
    owner: claim.owner,
  };
  const reduced = planEnsureNamedRoute(
    project.documents[0]!,
    "wire",
    { ...request, name: "RESET" },
    { memberMap: { [removed.id]: null } },
  );
  if (!reduced.ok) throw new Error(reduced.message);
  project = apply(project, reduced.edits);
  const added = planEnsureNamedRoute(project.documents[0]!, "wire", {
    ...request,
    name: "CLK,RESET",
  });
  if (!added.ok) throw new Error(added.message);
  project = parseProject(serializeProject(apply(project, added.edits)));
  const next = project.documents[0]!.connectivityEvidence.find(
    (item) => item.id === claim.id,
  )!;
  if (next.kind !== "name-claim") throw new Error("Missing claim");
  expect(next.signal!.members[0]!.id).not.toBe(removed.id);
  expect(next.signal!.members[0]!.netId).not.toBe(removed.netId);
  expect(
    project.documents[0]!.routes.filter((route) => route.id !== "wire").every(
      (route) => route.netId !== removed.netId,
    ),
  ).toBe(true);
});

it("keeps a bound ordered selector valid when its named conductor is reordered and narrowed", () => {
  let project = fixture();
  let document = project.documents[0]!;
  const route = document.routes[0]!;
  const original = document.annotations[0]!;
  project = apply(project, [
    {
      kind: "upsert_schematic_annotation",
      annotation: {
        ...original,
        id: "selector",
        formatOverride: undefined,
        binding: {
          kind: "net-name",
          netId: route.netId,
          memberEndpoints: route.members!.map((member) => ({
            ...route.start,
            memberId: member.startMemberId,
          })),
        },
      },
    },
  ]);
  document = project.documents[0]!;
  const claim = document.connectivityEvidence.find(
    (item) => item.kind === "name-claim" && item.signal,
  )!;
  if (claim.kind !== "name-claim") throw new Error("Missing claim");
  const [clock, reset] = claim.signal!.members;
  expect(
    planEnsureNamedRoute(
      document,
      "wire",
      {
        candidateNetId: claim.netId,
        name: "CLK,RESET",
        evidenceId: "selector-claim",
        owner: { kind: "net-label", annotationId: "selector" },
      },
      { memberMap: { [clock!.id]: "RESET", [reset!.id]: "CLK" } },
    ).ok,
  ).toBe(false);
  const request = {
    candidateNetId: claim.netId,
    name: "RESET,CLK",
    evidenceId: claim.id,
    owner: claim.owner,
  };
  const reordered = planEnsureNamedRoute(document, "wire", request);
  expect(reordered.ok).toBe(true);
  if (!reordered.ok) return;
  const locked = structuredClone(project);
  locked.documents[0]!.annotations.find(
    (item) => item.id === "selector",
  )!.locked = true;
  const rejected = executeProjectTransaction(locked, {
    transactionId: "locked-selector",
    projectId: locked.id,
    expectedStructureRevision: locked.structureRevision,
    actor: { kind: "human", id: "test" },
    edits: [
      {
        kind: "transact_document",
        documentId: document.id,
        expectedRevision: document.revision,
        edits: reordered.edits,
      },
    ],
  });
  expect(rejected.ok).toBe(false);
  expect(planEnsureNamedRoute(locked.documents[0]!, "wire", request).ok).toBe(
    false,
  );
  project = apply(project, reordered.edits);
  const selection = project.documents[0]!.annotations.find(
    (item) => item.id === "selector",
  )!.binding;
  expect(
    selection?.kind === "net-name" &&
      selection.memberEndpoints?.map((endpoint) => endpoint.memberId),
  ).toEqual([
    route.members![1]!.startMemberId,
    route.members![0]!.startMemberId,
  ]);
  const narrowed = planEnsureNamedRoute(
    project.documents[0]!,
    "wire",
    { ...request, name: "CLK" },
    { memberMap: { [reset!.id]: null } },
  );
  expect(narrowed.ok).toBe(true);
  if (!narrowed.ok) return;
  project = parseProject(serializeProject(apply(project, narrowed.edits)));
  expect(
    project.documents[0]!.annotations.find((item) => item.id === "selector")!
      .binding,
  ).toMatchObject({
    kind: "net-name",
    netId: clock!.netId,
    memberEndpoint: { memberId: route.members![0]!.startMemberId },
  });
});
it("reorders and explicitly renames one Label owner's members without changing their physical nets", () => {
  let project = fixture();
  const document = project.documents[0]!;
  const claim = document.connectivityEvidence.find(
    (item) => item.kind === "name-claim" && item.signal,
  )!;
  if (claim.kind !== "name-claim") throw new Error("Missing claim");
  const old = claim.signal!.members;
  const planned = planEnsureNamedRoute(
    document,
    "wire",
    {
      candidateNetId: claim.netId,
      name: "RST,CLOCK",
      evidenceId: claim.id,
      owner: claim.owner,
    },
    { memberMap: { [old[0]!.id]: "CLOCK", [old[1]!.id]: "RST" } },
  );
  expect(planned.ok, JSON.stringify(planned)).toBe(true);
  if (!planned.ok) return;
  project = parseProject(serializeProject(apply(project, planned.edits)));
  const next = project.documents[0]!.connectivityEvidence.find(
    (item) => item.id === claim.id,
  )!;
  expect(next.kind === "name-claim" && next.signal!.members).toEqual([
    { ...old[1]!, name: "RST" },
    { ...old[0]!, name: "CLOCK" },
  ]);
});

it("requires explicit removal and retains the surviving Label member on its original endpoint identities", () => {
  let project = fixture();
  const document = project.documents[0]!;
  const claim = document.connectivityEvidence.find(
    (item) => item.kind === "name-claim" && item.signal,
  )!;
  if (claim.kind !== "name-claim") throw new Error("Missing claim");
  const [removed, survivor] = claim.signal!.members;
  const request = {
    candidateNetId: claim.netId,
    name: "RESET",
    evidenceId: claim.id,
    owner: claim.owner,
  };
  expect(planEnsureNamedRoute(document, "wire", request).ok).toBe(false);
  const planned = planEnsureNamedRoute(document, "wire", request, {
    memberMap: { [removed!.id]: null },
  });
  expect(planned.ok, JSON.stringify(planned)).toBe(true);
  if (!planned.ok) return;
  project = parseProject(serializeProject(apply(project, planned.edits)));
  const next = project.documents[0]!;
  expect(
    next.routes.find((route) => route.id === "wire")!.members,
  ).toBeUndefined();
  expect(next.routes.find((route) => route.id === "wire")!.start.memberId).toBe(
    document.routes[0]!.members![1]!.startMemberId,
  );
  expect(
    next.connectivityEvidence.find((item) => item.id === claim.id),
  ).toMatchObject({ signal: { members: [survivor] } });
});

it.each(["DATA<1:0>", "DATA[1:0]", "CLK,RESET"])(
  "converts legacy scalar Label %s only with explicit member mapping and preserves its existing contacts",
  (legacyName) => {
    let project = createEmptyProject("legacy-label", "Legacy Label");
    const cell = project.documents[0]!;
    cell.nets.push({ id: "old-net", terminals: [] });
    cell.junctions.push(
      { id: "a", netId: "old-net", position: { x: 0, y: 0 } },
      { id: "b", netId: "old-net", position: { x: 100, y: 0 } },
    );
    cell.routes.push(
      createRoutePath({
        id: "wire",
        netId: "old-net",
        start: { kind: "junction", junctionId: "a" },
        end: { kind: "junction", junctionId: "b" },
        bends: [],
        modes: ["manual"],
      }),
    );
    cell.annotations.push({
      id: "label",
      kind: "net-label",
      netId: "old-net",
      binding: { kind: "net-name", netId: "old-net" },
      anchor: { kind: "free", position: { x: 50, y: -10 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    cell.connectivityEvidence.push({
      id: "legacy-claim",
      kind: "name-claim",
      netId: "old-net",
      name: legacyName,
      scope: "local",
      owner: { kind: "net-label", annotationId: "label" },
    });
    project = parseProject(serializeProject(project));
    const original = project.documents[0]!;
    const request = {
      candidateNetId: "old-net",
      name: "DATA<1:0>",
      evidenceId: "legacy-claim",
      owner: { kind: "net-label" as const, annotationId: "label" },
    };
    expect(
      planEnsureNamedRoute(original, "wire", request, { convertLegacy: true })
        .ok,
    ).toBe(false);
    expect(
      planEnsureNamedRoute(original, "wire", { ...request, name: "DATA<3:0>" })
        .ok,
    ).toBe(false);
    const planned = planEnsureNamedRoute(original, "wire", request, {
      convertLegacy: true,
      memberMap: { "legacy-claim": "DATA<1>" },
    });
    expect(planned.ok, JSON.stringify(planned)).toBe(true);
    if (!planned.ok) return;
    project = parseProject(serializeProject(apply(project, planned.edits)));
    const converted = project.documents[0]!;
    const claim = converted.connectivityEvidence.find(
      (item) => item.id === "legacy-claim",
    )!;
    expect(
      claim.kind === "name-claim" &&
        claim.signal!.members.map((member) => member.name),
    ).toEqual(["DATA<1>", "DATA<0>"]);
    expect(
      converted.routes.find((route) => route.id === "wire")!.members,
    ).toHaveLength(2);
    expect(
      converted.junctions.find((junction) => junction.id === "a")!.netId,
    ).toBe("old-net");
    expect(
      converted.routes
        .filter((route) => route.id !== "wire")
        .every((route) => route.netId === "old-net" && !route.members),
    ).toBe(true);
  },
);

it.each([false, true])(
  "disconnects every old bundle member and replaces it with a fresh scalar (selector: %s)",
  (withSelector) => {
    let project = fixture();
    if (withSelector) {
      const document = project.documents[0]!;
      const route = document.routes[0]!;
      project = apply(project, [
        {
          kind: "upsert_schematic_annotation",
          annotation: {
            ...document.annotations[0]!,
            id: "selector",
            formatOverride: undefined,
            binding: {
              kind: "net-name",
              netId: route.netId,
              memberEndpoints: route.members!.map((member) => ({
                ...route.start,
                memberId: member.startMemberId,
              })),
            },
          },
        },
      ]);
    }
    const document = project.documents[0]!;
    const claim = document.connectivityEvidence.find(
      (item) => item.kind === "name-claim" && item.signal,
    )!;
    if (claim.kind !== "name-claim") throw new Error("Missing claim");
    const plan = planEnsureNamedRoute(
      document,
      "wire",
      {
        candidateNetId: claim.netId,
        name: "NEW",
        evidenceId: claim.id,
        owner: claim.owner,
      },
      {
        memberMap: Object.fromEntries(
          claim.signal!.members.map((member) => [member.id, null]),
        ),
      },
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error(plan.message);
    const changed = parseProject(serializeProject(apply(project, plan.edits)))
      .documents[0]!;
    const route = changed.routes.find((item) => item.id === "wire")!;
    expect(route.members).toBeUndefined();
    expect(route.start.memberId).toBeUndefined();
    if (withSelector) {
      const beforeSelector = document.annotations.find(
        (item) => item.id === "selector",
      )!;
      const afterSelector = changed.annotations.find(
        (item) => item.id === "selector",
      )!;
      expect(afterSelector.binding).toEqual(beforeSelector.binding);
      expect(
        afterSelector.anchor.kind === "route" && afterSelector.anchor.routeId,
      ).not.toBe(route.id);
    }
    expect(
      claim.signal!.members.some((member) => member.netId === route.netId),
    ).toBe(false);
    expect(
      document.junctions.every((old) =>
        changed.junctions.some(
          (next) => JSON.stringify(next) === JSON.stringify(old),
        ),
      ),
    ).toBe(true);
  },
);

it.each(["leg", "group", "constraint"] as const)(
  "refuses Label expansion protected by %s before any atomic writes",
  (protection) => {
    const project = fixture();
    const document = project.documents[0]!;
    const claim = document.connectivityEvidence.find(
      (item) => item.kind === "name-claim" && item.signal,
    )!;
    if (claim.kind !== "name-claim") throw new Error("Missing claim");
    const request = {
      candidateNetId: claim.netId,
      name: "CLK,RESET,ADD",
      evidenceId: claim.id,
      owner: claim.owner,
    };
    const plan = planEnsureNamedRoute(document, "wire", request);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error(plan.message);
    if (protection === "leg") document.routes[0]!.legs[0]!.mode = "locked";
    else if (protection === "group")
      document.layoutGroups.push({
        id: "lock",
        kind: "custom",
        locked: true,
        objectIds: ["wire"],
      });
    else
      document.constraints.push({
        id: "lock",
        kind: "keep-clear",
        locked: true,
        objectIds: ["wire", document.junctions[0]!.id],
      });
    const snapshot = serializeProject(project);
    const result = executeProjectTransaction(project, {
      transactionId: "protected-label",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: [
        {
          kind: "transact_document",
          documentId: document.id,
          expectedRevision: document.revision,
          edits: plan.edits,
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(serializeProject(project)).toBe(snapshot);
    expect(planEnsureNamedRoute(document, "wire", request).ok).toBe(false);
  },
);
