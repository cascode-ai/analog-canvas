// Gallery maintenance over HTTP: backup pages, the netlist read, schema and
// Project format passes, netlist marks, and label looks.

import {
  diagnoseLabelClearance,
  diagnoseVisualQuality,
  sha256Hex,
} from "@icm/derived";
import { referenceDeviceLetter } from "@icm/devices";
import { createDesignNetlistExport } from "@icm/netlist";
import {
  CURRENT_PROJECT_FILE_VERSION,
  parseProject,
  serializeProject,
} from "@icm/project-protocol";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  type SymbolResolver,
} from "@icm/symbols";
import {
  CircuitProjectSchema,
  labelLookChanges,
  type CircuitProject,
  type RichTextDocument,
} from "@icm/model";
import { sameOrigin } from "./same-origin";
import { GALLERY_MAX_PROJECT_BYTES, type GalleryEnv } from "./gallery-store";
import {
  callGallery,
  hasGalleryReadToken,
  hasStoreBackupToken,
  isAdmin,
  isAutomatedBackup,
  renderPreview,
} from "./gallery-requests";

/**
 * One entry of the netlist read: the netlist its drawing prints, or null when
 * the export is blocked, with every finding either way, so a reader sees a
 * wire that reaches no peer beside the netlist it did not stop.
 */
function galleryNetlist(
  projectText: string,
  format: "spice" | "spectre",
): {
  netlist: string | null;
  diagnostics: { severity: string; code: string; message: string }[];
} {
  let project: CircuitProject;
  try {
    project = parseProject(projectText);
  } catch (error) {
    return {
      netlist: null,
      diagnostics: [
        {
          severity: "error",
          code: "PROJECT_UNREADABLE",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
  const result = createDesignNetlistExport(project, { format });
  return {
    netlist: result.status === "ready" ? result.file.text : null,
    diagnostics: result.diagnostics.map(({ severity, code, message }) => ({
      severity,
      code,
      message,
    })),
  };
}

/** Largest batch one label-look maintenance request may check. */
const LABEL_LOOK_BATCH = 20;
/** A planner may move a restyled label this far to keep its clearance. */
const LABEL_LOOK_NUDGE = { x: 16, y: 12 };
/**
 * When the label standards took effect (#1052). `legacyLooks` restyles only
 * content saved before; in a later drawing a slanted script is the author's
 * choice (names-and-labels.md).
 */
const LABEL_STANDARDS_SINCE = Date.parse("2026-09-24T09:55:19Z");

/**
 * What each label is drawn over, as `label → other ids`: wires and parts
 * (label clearance) and other labels (label overlap). The visual pass is
 * read uncached, since the document is edited in place between readings.
 */
function labelConflicts(
  document: CircuitProject["documents"][number],
  resolver: SymbolResolver,
): Map<string, Set<string>> {
  const conflicts = new Map<string, Set<string>>();
  const add = (label: string, others: readonly string[]) =>
    conflicts.set(
      label,
      new Set([
        ...(conflicts.get(label) ?? []),
        ...others.filter((other) => other !== label),
      ]),
    );
  for (const diagnostic of diagnoseLabelClearance(document, resolver))
    if (diagnostic.code === "VISUAL_LABEL_CLEARANCE")
      add(diagnostic.objectIds[0]!, diagnostic.objectIds.slice(1));
  for (const diagnostic of diagnoseVisualQuality(document, resolver, {
    minimumSegmentLength: document.presentation.grid,
  }))
    if (diagnostic.code === "VISUAL_LABEL_OVERLAP")
      for (const label of diagnostic.objectIds)
        add(label, diagnostic.objectIds);
  return conflicts;
}

type LabelLookNudge = { label: string; dx: number; dy: number };
const LABEL_LOOK_TABLES = ["galleryEntries", "galleryEntryVersions"] as const;
type LabelLookTable = (typeof LABEL_LOOK_TABLES)[number];

/** Names a drawing exposes electrically; a look change must keep all of them. */
function electricalNames(project: CircuitProject): string {
  return JSON.stringify(
    project.documents.map((document) => ({
      references: document.instances.map((instance) => instance.reference),
      terminals: document.netlist?.terminals.map((terminal) => terminal.name),
      claims: document.connectivityEvidence.map((evidence) =>
        evidence.kind === "name-claim" ? evidence.name : null,
      ),
    })),
  );
}

function designNetlists(project: CircuitProject): string {
  return (["spice", "spectre"] as const)
    .map((format) => {
      const result = createDesignNetlistExport(project, { format });
      return result.status === "ready"
        ? result.file.text
        : `blocked:${result.diagnostics.map((item) => item.code).join(",")}`;
    })
    .join("\n");
}

/**
 * Bring one existing entry's labels to the standard (V_DD, M₁, V_in, upright
 * subscripts), with the planner's bounded nudges. The server recomputes the
 * change itself and refuses anything that would alter a name, a netlist or
 * the Project beyond those labels and the drawing's subscript slant.
 */
async function labelLookEntry(
  env: GalleryEnv,
  id: string,
  options: {
    apply: boolean;
    expected?: string;
    nudges: LabelLookNudge[];
    keep: string[];
    legacyLooks: boolean;
    /** Current entries, or the retained versions they keep as history. */
    table: LabelLookTable;
  },
): Promise<Record<string, unknown>> {
  const read = await callGallery<{
    status?: string;
    projectText?: string;
    savedAt?: string;
    entryId?: string;
  }>(env, "label-looks-read", { id, table: options.table });
  const originalProjectText = read.payload.projectText;
  if (read.status !== 200 || typeof originalProjectText !== "string")
    return { id, skipped: "not-found" };
  // The public Gallery only: a withdrawn or rejected entry, and the history
  // it keeps, are left as they are.
  const where = {
    id,
    status: read.payload.status,
    ...(read.payload.entryId ? { entryId: read.payload.entryId } : {}),
    savedAt: read.payload.savedAt,
  };
  if (read.payload.status !== "public")
    return { ...where, skipped: "not-public" };
  // A missing date reads as later: legacy looks stay unless known older.
  const legacyLooks =
    options.legacyLooks &&
    Date.parse(read.payload.savedAt ?? "") < LABEL_STANDARDS_SINCE;
  const sha = sha256Hex(originalProjectText);
  let before: CircuitProject;
  let project: CircuitProject;
  try {
    before = parseProject(originalProjectText);
    project = parseProject(originalProjectText);
  } catch {
    return { ...where, sha, skipped: "unreadable" };
  }
  const labels: {
    id: string;
    documentId: string;
    name: string;
    kind: "standard" | "upright";
    role?: string;
  }[] = [];
  const changed = new Map<
    string,
    CircuitProject["documents"][number]["annotations"][number]
  >();
  const keep = new Set(options.keep);
  const kept: string[] = [];
  const uprightDocuments: string[] = [];
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  // Annotation ids are unique within a Document only.
  const key = (documentId: string, annotationId: string) =>
    `${documentId}\u0000${annotationId}`;
  /** What each restyled label was drawn over before, by document. */
  const clearBefore = new Map<string, Map<string, Set<string>>>();
  const originalLooks = new Map<string, RichTextDocument | undefined>();
  for (const document of project.documents) {
    const changes = labelLookChanges(document, {
      legacyLooks,
      deviceLetterOf: (annotation) => {
        const binding = annotation.binding;
        if (binding?.kind !== "instance-reference") return undefined;
        const instance = document.instances.find(
          (candidate) => candidate.id === binding.instanceId,
        );
        return instance
          ? referenceDeviceLetter(instance.symbolId, project)
          : undefined;
      },
    });
    for (const change of changes.labels) {
      // A label the planner could not keep clear keeps its current look.
      if (change.kind === "standard" && keep.has(change.annotationId)) {
        kept.push(change.annotationId);
        continue;
      }
      const annotation = document.annotations.find(
        (candidate) => candidate.id === change.annotationId,
      )!;
      // Only a new standard look changes a label's extent, so only it moves.
      if (change.kind === "standard") {
        if (!clearBefore.has(document.id))
          clearBefore.set(document.id, labelConflicts(document, resolver));
        originalLooks.set(
          key(document.id, annotation.id),
          annotation.formatOverride,
        );
        changed.set(annotation.id, annotation);
      }
      annotation.formatOverride = change.format;
      labels.push({
        id: annotation.id,
        documentId: document.id,
        name: change.name,
        kind: change.kind,
        ...(change.role ? { role: change.role } : {}),
      });
    }
    if (changes.uprightSubscripts) {
      document.presentation.labelSubscriptItalic = false;
      uprightDocuments.push(document.id);
    }
  }
  const unknownKeep = options.keep.find((label) => !kept.includes(label));
  if (unknownKeep)
    return { ...where, sha, skipped: `invalid-keep:${unknownKeep}` };
  for (const nudge of options.nudges) {
    const annotation = changed.get(nudge.label);
    if (
      !annotation ||
      !Number.isFinite(nudge.dx) ||
      !Number.isFinite(nudge.dy) ||
      Math.abs(nudge.dx) > LABEL_LOOK_NUDGE.x ||
      Math.abs(nudge.dy) > LABEL_LOOK_NUDGE.y ||
      (annotation.anchor.kind !== "object" && annotation.anchor.kind !== "free")
    )
      return { ...where, sha, skipped: `invalid-nudge:${nudge.label}` };
    if (annotation.anchor.kind === "object") {
      annotation.anchor.localOffset = {
        x: annotation.anchor.localOffset.x + nudge.dx,
        y: annotation.anchor.localOffset.y + nudge.dy,
      };
      annotation.anchor.fallbackPosition = {
        x: annotation.anchor.fallbackPosition.x + nudge.dx,
        y: annotation.anchor.fallbackPosition.y + nudge.dy,
      };
    } else {
      annotation.anchor.position = {
        x: annotation.anchor.position.x + nudge.dx,
        y: annotation.anchor.position.y + nudge.dy,
      };
    }
  }
  // A restyle may not draw a label over anything it cleared before. Such a
  // label keeps its look, for manual repair; a nudge that leaves it over
  // something refuses the row. Putting one back can crowd a neighbour that
  // kept its new look, so this repeats until nothing more goes back.
  const nudged = new Set(options.nudges.map((nudge) => nudge.label));
  const restored = new Set<string>();
  const clearanceKept: string[] = [];
  for (let again = true; again;) {
    again = false;
    for (const document of project.documents) {
      const had = clearBefore.get(document.id);
      if (!had) continue;
      const now = labelConflicts(document, resolver);
      for (const annotation of document.annotations) {
        const at = key(document.id, annotation.id);
        if (!originalLooks.has(at) || restored.has(at)) continue;
        const clear = had.get(annotation.id) ?? new Set<string>();
        if (![...(now.get(annotation.id) ?? [])].some((o) => !clear.has(o)))
          continue;
        if (nudged.has(annotation.id))
          return { ...where, sha, skipped: `unclear-nudge:${annotation.id}` };
        const look = originalLooks.get(at);
        if (look === undefined) delete annotation.formatOverride;
        else annotation.formatOverride = look;
        restored.add(at);
        clearanceKept.push(annotation.id);
        again = true;
      }
    }
  }
  const restyled = labels.filter(
    (label) => !restored.has(key(label.documentId, label.id)),
  );
  const summary = {
    ...where,
    sha,
    labels: restyled,
    clearanceKept,
    ...(options.legacyLooks && !legacyLooks ? { legacyWithheld: true } : {}),
    kept: kept.length,
  };
  if (!restyled.length && !uprightDocuments.length)
    return { ...summary, changed: false };
  let projectText: string;
  let stored: CircuitProject;
  try {
    projectText = serializeProject(CircuitProjectSchema.parse(project));
    stored = parseProject(projectText);
  } catch {
    return { ...where, sha, skipped: "invalid-result" };
  }
  if (new TextEncoder().encode(projectText).length > GALLERY_MAX_PROJECT_BYTES)
    return { ...where, sha, skipped: "too-large" };
  const namesUnchanged = electricalNames(before) === electricalNames(stored);
  const netlistUnchanged = designNetlists(before) === designNetlists(stored);
  const report = {
    ...summary,
    uprightDocuments,
    nudged: options.nudges.length,
    namesUnchanged,
    netlistUnchanged,
  };
  if (!namesUnchanged || !netlistUnchanged)
    return { ...report, skipped: "electrical-change" };
  if (!options.apply) return { ...report, changed: true };
  if (options.expected !== sha) return { ...report, skipped: "stale" };
  const svgText = await renderPreview(
    stored,
    createProjectSymbolResolver(stored, builtInSymbols),
  );
  const write = await callGallery<{ previewRevision?: string }>(
    env,
    "label-looks-store",
    {
      id,
      table: options.table,
      originalProjectText,
      projectText,
      svgText,
      schemaVersion: CURRENT_PROJECT_FILE_VERSION,
      at: new Date().toISOString(),
    },
  );
  return write.status === 200
    ? {
        ...report,
        applied: true,
        previewRevision: write.payload.previewRevision,
      }
    : {
        ...report,
        skipped: write.status === 409 ? "concurrent-change" : "store-failed",
      };
}

async function handleLabelLooks(
  request: Request,
  env: GalleryEnv,
): Promise<Response> {
  if (!sameOrigin(request))
    return Response.json({ error: "forbidden" }, { status: 403 });
  if (!(await isAdmin(request, env)))
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    ids?: unknown;
    apply?: unknown;
    expected?: unknown;
    nudges?: unknown;
    keep?: unknown;
    legacyLooks?: unknown;
    table?: unknown;
  } | null;
  const ids = body?.ids;
  const table = body?.table ?? "galleryEntries";
  if (
    !LABEL_LOOK_TABLES.includes(table as LabelLookTable) ||
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > LABEL_LOOK_BATCH ||
    ids.some((id) => typeof id !== "string" || !id)
  )
    return Response.json({ error: "invalid-request" }, { status: 400 });
  const expected =
    body?.expected && typeof body.expected === "object"
      ? (body.expected as Record<string, unknown>)
      : {};
  const nudges =
    body?.nudges && typeof body.nudges === "object"
      ? (body.nudges as Record<string, unknown>)
      : {};
  const keep =
    body?.keep && typeof body.keep === "object"
      ? (body.keep as Record<string, unknown>)
      : {};
  const results = [];
  for (const id of ids as string[]) {
    const entryNudges = Array.isArray(nudges[id])
      ? (nudges[id] as unknown[]).map((item) => {
          const nudge = (item ?? {}) as Record<string, unknown>;
          return {
            label: String(nudge.label),
            dx: Number(nudge.dx),
            dy: Number(nudge.dy),
          };
        })
      : [];
    results.push(
      await labelLookEntry(env, id, {
        apply: body?.apply === true,
        ...(typeof expected[id] === "string"
          ? { expected: expected[id] as string }
          : {}),
        nudges: entryNudges,
        keep: Array.isArray(keep[id])
          ? (keep[id] as unknown[]).map((label) => String(label))
          : [],
        legacyLooks: body?.legacyLooks === true,
        table: table as LabelLookTable,
      }),
    );
  }
  return Response.json(
    { results },
    { headers: { "cache-control": "no-store" } },
  );
}

/**
 * Re-answer one batch of stored netlist marks whose rule version is behind
 * this build's. Both callers want the same thing and neither has to know how
 * staleness is found: the moderation button when somebody wants it now, and
 * the schedule so that nobody has to.
 */
export async function refreshNetlistMarks(
  env: GalleryEnv,
  limit?: number,
): Promise<{ status: number; payload: unknown }> {
  return callGallery(env, "netlistable-refresh", {
    ...(limit === undefined ? {} : { limit }),
  });
}

/** `/api/gallery/maintenance/*`: backups, the netlist read and the passes. */
export async function routeGalleryMaintenance(
  request: Request,
  env: GalleryEnv,
  url: URL,
  segments: readonly string[],
): Promise<Response | null> {
  if (isAutomatedBackup(segments)) {
    // Each credential reads its own scope: Gallery-only, or the whole store
    // with private Cloud Projects.
    const scope =
      url.searchParams.get("scope") === "store" ? "store" : "gallery";
    if (
      scope === "store"
        ? !hasStoreBackupToken(request, env)
        : !hasGalleryReadToken(request, env)
    )
      return Response.json(
        { error: "unauthorized" },
        { status: 401, headers: { "cache-control": "no-store" } },
      );
    if (request.method !== "GET")
      return Response.json(
        { error: "method-not-allowed" },
        { status: 405, headers: { Allow: "GET", "cache-control": "no-store" } },
      );
    // The object allows only its scope's tables, so a Gallery page never
    // names a private Project.
    const { status, payload } = await callGallery(env, "schema-backup", {
      scope,
      table: url.searchParams.get("table"),
      after: url.searchParams.get("after"),
    });
    return Response.json(payload, {
      status,
      headers: { "cache-control": "no-store" },
    });
  }
  if (
    segments.length === 2 &&
    segments[0] === "maintenance" &&
    segments[1] === "netlists"
  ) {
    // The public Gallery's netlists for a reader elsewhere: a script with the
    // read-only Gallery credential, or an admin's browser session. Pages run
    // in entry-id order; pass `nextCursor` back as `after` until it is null.
    const noStore = { "cache-control": "no-store" };
    if (!hasGalleryReadToken(request, env) && !(await isAdmin(request, env)))
      return Response.json(
        { error: "unauthorized" },
        { status: 401, headers: noStore },
      );
    if (request.method !== "GET")
      return Response.json(
        { error: "method-not-allowed" },
        { status: 405, headers: { Allow: "GET", ...noStore } },
      );
    const format = url.searchParams.get("format") ?? "spice";
    if (format !== "spice" && format !== "spectre")
      return Response.json(
        { error: "invalid-format" },
        { status: 400, headers: noStore },
      );
    const id = url.searchParams.get("id");
    const { status, payload } = await callGallery<{
      entries?: (Record<string, unknown> & { projectText: string })[];
      nextCursor?: string | null;
    }>(env, "netlist-sources", {
      id,
      after: url.searchParams.get("after"),
      limit: url.searchParams.get("limit"),
    });
    if (status !== 200 || !payload.entries)
      return Response.json(payload, { status, headers: noStore });
    if (id && payload.entries.length === 0)
      return Response.json(
        { error: "not-found" },
        { status: 404, headers: noStore },
      );
    return Response.json(
      {
        format: "analog-canvas-gallery-netlists-v1",
        netlistFormat: format,
        entries: payload.entries.map(({ projectText, ...entry }) => ({
          ...entry,
          ...galleryNetlist(projectText, format),
        })),
        nextCursor: payload.nextCursor ?? null,
      },
      { headers: noStore },
    );
  }
  if (
    segments.length === 2 &&
    segments[0] === "maintenance" &&
    segments[1] === "schema-backup" &&
    request.method === "GET"
  ) {
    if (!(await isAdmin(request, env))) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    // The same one-row pages as the store credential reads; the whole store
    // no longer fits one response.
    const { status, payload } = await callGallery(env, "schema-backup", {
      scope: "store",
      table: url.searchParams.get("table"),
      after: url.searchParams.get("after"),
    });
    return Response.json(payload, {
      status,
      headers: { "cache-control": "no-store" },
    });
  }
  if (
    segments.length === 2 &&
    segments[0] === "maintenance" &&
    segments[1] === "project-format" &&
    request.method === "POST"
  ) {
    if (!sameOrigin(request))
      return Response.json({ error: "forbidden" }, { status: 403 });
    if (!(await isAdmin(request, env)))
      return Response.json({ error: "unauthorized" }, { status: 401 });
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body))
      return Response.json({ error: "invalid-request" }, { status: 400 });
    const { status, payload } = await callGallery(
      env,
      "gallery-project-format",
      body,
    );
    return Response.json(payload, {
      status,
      headers: { "cache-control": "no-store" },
    });
  }
  if (
    segments.length === 2 &&
    segments[0] === "maintenance" &&
    segments[1] === "label-looks" &&
    request.method === "POST"
  ) {
    return handleLabelLooks(request, env);
  }
  if (
    segments.length === 2 &&
    segments[0] === "maintenance" &&
    segments[1] === "schema-current" &&
    request.method === "POST"
  ) {
    if (!(await isAdmin(request, env))) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const body = (await request.json().catch(() => null)) as {
      apply?: unknown;
    } | null;
    const { status, payload } = await callGallery(env, "schema-converge", {
      apply: body?.apply === true,
    });
    return Response.json(payload, {
      status,
      headers: { "cache-control": "no-store" },
    });
  }
  if (
    segments.length === 2 &&
    segments[0] === "maintenance" &&
    segments[1] === "netlist-badges" &&
    request.method === "POST"
  ) {
    if (!(await isAdmin(request, env))) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const body = (await request.json().catch(() => null)) as {
      after?: unknown;
      limit?: unknown;
    } | null;
    const { status, payload } = await refreshNetlistMarks(
      env,
      Number.isFinite(Number(body?.limit)) ? Number(body!.limit) : undefined,
    );
    return Response.json(payload, {
      status,
      headers: { "cache-control": "no-store" },
    });
  }
  if (
    segments.length === 2 &&
    segments[0] === "maintenance" &&
    segments[1] === "schema-restore" &&
    request.method === "POST"
  ) {
    if (!sameOrigin(request)) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    if (!(await isAdmin(request, env))) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const body = (await request.json().catch(() => null)) as {
      backup?: unknown;
    } | null;
    const { status, payload } = await callGallery(env, "schema-restore", {
      backup: body?.backup,
    });
    return Response.json(payload, {
      status,
      headers: { "cache-control": "no-store" },
    });
  }
  return null;
}
