// Publishing: a submission, an entry's update, and the routes of a
// publisher's quota, submissions and version history.

import { designExtractsNetlist } from "@icm/netlist";
import { galleryComponentCount } from "./gallery-components";
import {
  CURRENT_PROJECT_FILE_VERSION,
  parseProject,
  serializeProject,
} from "@icm/project-protocol";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { type CircuitProject } from "@icm/model";
import { AI_ACCOUNT_PROVIDER, sessionUserOf } from "./auth";
import { sameOrigin } from "./same-origin";
import {
  aiSeatOf,
  dailySubmissionLimit,
  isAiSeatEntry,
  GALLERY_MAX_AUTHOR_LENGTH,
  GALLERY_MAX_DESCRIPTION_LENGTH,
  GALLERY_MAX_NAME_LENGTH,
  GALLERY_MAX_PROJECT_BYTES,
  sanitizeGalleryTags,
  wrapTags,
  type GalleryEnv,
} from "./gallery-store";
import {
  callGallery,
  entryManager,
  fieldText,
  readsTestbench,
  recoverFormulaPreview,
  renderPreview,
} from "./gallery-requests";
import {
  storedProject,
  testbenchOf,
  withTestbench,
  withoutTestbench,
} from "./gallery-testbench";

/**
 * The publisher's AI mark: true or false when the request gives one,
 * undefined when it leaves the mark alone, null when it is not a boolean.
 */
function aiMark(value: unknown): boolean | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "boolean" ? value : null;
}

/**
 * The simulation folders an entry holds now, as the current model spells
 * them: what an update keeps for a writer who never received them.
 */
function heldFolders(
  projectText: string,
  testbench: string | null | undefined,
): CircuitProject["simulationFolders"] {
  if (!testbenchOf({ project_text: projectText, testbench_text: testbench }))
    return [];
  try {
    return parseProject(withTestbench(projectText, testbench))
      .simulationFolders;
  } catch {
    // Unreadable now; the version the update leaves behind still holds it.
    return [];
  }
}

function publicationBindingFields(body: {
  cloudProjectId?: unknown;
  expectedGalleryEntryId?: unknown;
}): { cloudProjectId?: string; expectedGalleryEntryId?: string | null } | null {
  if (body.cloudProjectId === undefined) return {};
  if (
    typeof body.cloudProjectId !== "string" ||
    !body.cloudProjectId ||
    !(
      body.expectedGalleryEntryId === null ||
      (typeof body.expectedGalleryEntryId === "string" &&
        body.expectedGalleryEntryId.length > 0)
    )
  )
    return null;
  return {
    cloudProjectId: body.cloudProjectId,
    expectedGalleryEntryId: body.expectedGalleryEntryId,
  };
}

export async function handleSubmission(
  request: Request,
  env: GalleryEnv,
): Promise<Response> {
  if (!sameOrigin(request)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  // Signing in is the whole gate: every signed-in user publishes straight to
  // the wall. Anonymous upload stays impossible, because an entry has to be
  // attributable to the account that submitted it.
  const user = await sessionUserOf(request, env);
  if (!user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const privileged = user.isAdmin === true || user.role === "moderator";
  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    description?: unknown;
    tags?: unknown;
    projectText?: unknown;
    cloudProjectId?: unknown;
    expectedGalleryEntryId?: unknown;
    aiGenerated?: unknown;
  } | null;
  const name = fieldText(body?.name, GALLERY_MAX_NAME_LENGTH);
  // The byline is the signed-in account's display name. Reading it from the
  // request would let one account publish under another's name.
  const author = user.displayName.slice(0, GALLERY_MAX_AUTHOR_LENGTH);
  const description = fieldText(
    body?.description,
    GALLERY_MAX_DESCRIPTION_LENGTH,
  );
  const aiGenerated = aiMark(body?.aiGenerated);
  if (!body || !name || description === null || aiGenerated === null) {
    return Response.json({ error: "invalid-fields" }, { status: 400 });
  }
  const binding = publicationBindingFields(body);
  if (!binding)
    return Response.json({ error: "invalid-fields" }, { status: 400 });
  if (typeof body.projectText !== "string") {
    return Response.json({ error: "invalid-project" }, { status: 400 });
  }
  if (
    new TextEncoder().encode(body.projectText).length >
    GALLERY_MAX_PROJECT_BYTES
  ) {
    return Response.json({ error: "too-large" }, { status: 413 });
  }
  let project: CircuitProject;
  try {
    project = parseProject(body.projectText);
  } catch {
    return Response.json({ error: "invalid-project" }, { status: 400 });
  }
  const projectResolver = createProjectSymbolResolver(project, builtInSymbols);
  project.name = name;
  const now = new Date();
  // The testbench is kept apart from the Project Code readers get (#1545).
  const stored = storedProject(serializeProject(project));
  const { status, payload } = await callGallery<{
    id?: string;
    previewRevision?: string;
  }>(env, "submit", {
    ...binding,
    userId: user.id,
    day: now.toISOString().slice(0, 10),
    enforceLimit: !privileged,
    limit: dailySubmissionLimit(user),
    entry: {
      // The id is drawn inside the Durable Object, which is the only place
      // that can tell whether one is already taken.
      id: "",
      // Recorded, never enforced: a circuit that does not extract is
      // published exactly the same way, it simply does not wear the badge.
      netlistable: designExtractsNetlist(project) ? 1 : 0,
      component_count: galleryComponentCount(project),
      // The publisher's word, never inferred here, except that what an AI
      // account publishes is always AI-generated. An Agent's publish asks
      // for it; a person publishing by hand ticks it themselves.
      ai_generated:
        aiGenerated || user.provider === AI_ACCOUNT_PROVIDER ? 1 : 0,
      name,
      author,
      description,
      created_at: now.toISOString(),
      schema_version: CURRENT_PROJECT_FILE_VERSION,
      owner_user_id: user.id,
      // Recorded per submission, so an entry stays traceable to the
      // identity that published it even if the account later changes.
      submitter_email: user.email,
      submitter_provider: user.provider,
      tags: wrapTags(sanitizeGalleryTags(body.tags)),
      project_text: stored.projectText,
      testbench_text: stored.testbench,
      svg_text: await renderPreview(project, projectResolver),
    },
  });
  if (status === 429) {
    return Response.json({ error: "rate-limited" }, { status: 429 });
  }
  if (status !== 200) return Response.json(payload, { status });
  return Response.json(
    {
      id: payload.id,
      status: "public",
      previewRevision: payload.previewRevision ?? "legacy",
    },
    { status: 201 },
  );
}

/**
 * Owner or curator entry update. A moderator may update any entry; an
 * ordinary session must own the entry and passes the quality gates. Either
 * way the entry keeps its byline and its current status, so editing a
 * published circuit neither takes it off the wall nor re-attributes it.
 */
export async function handleEntryUpdate(
  request: Request,
  env: GalleryEnv,
  id: string,
): Promise<Response> {
  if (!sameOrigin(request)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const existing = await callGallery<{
    status?: string;
    entry?: { author?: string };
    ownerUserId?: string | null;
    projectText?: string;
    testbench?: string | null;
  }>(env, "any-entry", { id });
  if (existing.status !== 200) {
    return Response.json({ error: "not-found" }, { status: 404 });
  }
  const user = await sessionUserOf(request, env);
  if (!user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const privileged = user.isAdmin === true || user.role === "moderator";
  const owner =
    user !== null &&
    existing.payload.ownerUserId != null &&
    existing.payload.ownerUserId === user.id;
  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    description?: unknown;
    tags?: unknown;
    projectText?: unknown;
    cloudProjectId?: unknown;
    expectedGalleryEntryId?: unknown;
    aiGenerated?: unknown;
    takeOver?: unknown;
  } | null;
  // An AI account takes over another AI account's circuit as its update
  // lands (#1499; all are the Owner's), a rejected one too, which stays
  // rejected (#1540): never a person's, never for one.
  const seat = aiSeatOf(user);
  const takingOver = body?.takeOver === true && !owner;
  if (
    takingOver &&
    !(
      seat &&
      isAiSeatEntry(
        existing.payload.ownerUserId,
        existing.payload.entry?.author,
      )
    )
  )
    return Response.json({ error: "take-over-forbidden" }, { status: 403 });
  if (!privileged && !owner && !takingOver) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const name = fieldText(body?.name, GALLERY_MAX_NAME_LENGTH);
  // An update never re-attributes the entry, not even when a moderator
  // makes it: the byline stays the one the submitter published under. Only
  // a take-over moves it, to the AI account that made this version.
  const author = takingOver
    ? seat!.displayName
    : (existing.payload.entry?.author ?? "");
  const description = fieldText(
    body?.description,
    GALLERY_MAX_DESCRIPTION_LENGTH,
  );
  const aiGenerated = aiMark(body?.aiGenerated);
  if (!body || !name || description === null || aiGenerated === null) {
    return Response.json({ error: "invalid-fields" }, { status: 400 });
  }
  const binding = publicationBindingFields(body);
  if (!binding)
    return Response.json({ error: "invalid-fields" }, { status: 400 });
  if (typeof body.projectText !== "string") {
    return Response.json({ error: "invalid-project" }, { status: 400 });
  }
  if (
    new TextEncoder().encode(body.projectText).length >
    GALLERY_MAX_PROJECT_BYTES
  ) {
    return Response.json({ error: "too-large" }, { status: 413 });
  }
  let project: CircuitProject;
  try {
    project = parseProject(body.projectText);
  } catch {
    return Response.json({ error: "invalid-project" }, { status: 400 });
  }
  const projectResolver = createProjectSymbolResolver(project, builtInSymbols);
  project.name = name;
  // A writer who may not read the testbench never received it: the entry
  // keeps the one it holds. One who may replaces it with the Project's own,
  // as the update replaces the rest of the content (#1545).
  if (
    !readsTestbench(user, {
      ownerUserId: existing.payload.ownerUserId,
      author: existing.payload.entry?.author,
    })
  )
    project.simulationFolders = heldFolders(
      existing.payload.projectText ?? "",
      existing.payload.testbench,
    );
  const stored = storedProject(serializeProject(project));
  const nextStatus = existing.payload.status ?? "public";
  // Every republication re-answers this; the badge follows the drawing.
  const netlistable = designExtractsNetlist(project) ? 1 : 0;
  const { status, payload } = await callGallery(env, "replace-entry", {
    ...binding,
    userId: user.id,
    id,
    at: new Date().toISOString(),
    name,
    author,
    description,
    projectText: stored.projectText,
    testbench: stored.testbench,
    svgText: await renderPreview(project, projectResolver),
    schemaVersion: CURRENT_PROJECT_FILE_VERSION,
    netlistable,
    componentCount: galleryComponentCount(project),
    status: nextStatus,
    tags: wrapTags(sanitizeGalleryTags(body.tags)),
    // Absent leaves the stored mark as it is; an AI account's entry always
    // keeps it, whoever updates it.
    ...(takingOver || isAiSeatEntry(existing.payload.ownerUserId, author)
      ? { aiGenerated: true }
      : aiGenerated === undefined
        ? {}
        : { aiGenerated }),
    ...(takingOver ? { ownerUserId: user.id } : {}),
  });
  return Response.json(
    takingOver && status === 200
      ? { ...(payload as object), ownerUserId: user.id, author }
      : payload,
    { status },
  );
}

/** A publisher's quota and submissions, and an entry's version history. */
export async function routeGalleryPublishing(
  request: Request,
  env: GalleryEnv,
  segments: readonly string[],
): Promise<Response | null> {
  // What a signed-in publisher may still publish today, before they fill in
  // a form the quota would refuse (#1417).
  if (
    segments.length === 1 &&
    segments[0] === "quota" &&
    request.method === "GET"
  ) {
    const user = await sessionUserOf(request, env);
    if (!user) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const now = new Date();
    const { payload } = await callGallery<{ used: number }>(env, "quota", {
      ownerUserId: user.id,
      day: now.toISOString().slice(0, 10),
    });
    const used = payload.used ?? 0;
    const limit = dailySubmissionLimit(user);
    return Response.json(
      {
        limit,
        used,
        remaining: Math.max(0, limit - used),
        // The day is the UTC calendar day a submission is counted in.
        resetsAt: new Date(
          Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate() + 1,
          ),
        ).toISOString(),
        exempt: user.isAdmin === true || user.role === "moderator",
      },
      { headers: { "cache-control": "no-store" } },
    );
  }
  if (
    segments.length === 1 &&
    segments[0] === "mine" &&
    request.method === "GET"
  ) {
    const user = await sessionUserOf(request, env);
    if (!user) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    // `scope=ai-seats`: every AI account's entries, rejected ones with their
    // reasons, for an AI account to redo and take over (#1540). A person's
    // entries never appear there, and only an AI account may ask.
    const scope = new URL(request.url).searchParams.get("scope");
    if (scope !== null && scope !== "ai-seats")
      return Response.json({ error: "invalid-scope" }, { status: 400 });
    if (scope && !aiSeatOf(user))
      return Response.json({ error: "ai-accounts-only" }, { status: 403 });
    const { payload } = await callGallery(
      env,
      scope ? "ai-seat-entries" : "mine",
      { ownerUserId: user.id },
    );
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  }
  if (
    segments.length === 2 &&
    segments[1] === "versions" &&
    request.method === "GET"
  ) {
    const access = await entryManager(request, env, segments[0]!);
    if (!access.found) {
      return Response.json({ error: "not-found" }, { status: 404 });
    }
    if (!access.reviewer && !access.reads) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const { status, payload } = await callGallery(env, "versions", {
      entryId: segments[0],
    });
    return Response.json(payload, {
      status,
      headers: { "cache-control": "no-store" },
    });
  }
  if (
    segments.length === 4 &&
    segments[1] === "versions" &&
    segments[3] === "project" &&
    request.method === "GET"
  ) {
    const headers = { "cache-control": "no-store" };
    const access = await entryManager(request, env, segments[0]!);
    if (!access.found || (!access.reviewer && !access.reads)) {
      return Response.json({ error: "not-found" }, { status: 404, headers });
    }
    const { status, payload } = await callGallery<{
      projectText?: string;
      testbench?: string | null;
    }>(env, "version", { entryId: segments[0], versionId: segments[2] });
    if (status !== 200 || !payload.projectText) {
      return Response.json({ error: "not-found" }, { status: 404, headers });
    }
    // The version's testbench by the entry's rule (#1545).
    return Response.json(
      {
        projectText: access.testbench
          ? withTestbench(payload.projectText, payload.testbench)
          : withoutTestbench(payload.projectText),
      },
      { headers },
    );
  }
  if (
    segments.length === 4 &&
    segments[1] === "versions" &&
    segments[3] === "preview.svg" &&
    request.method === "GET"
  ) {
    const access = await entryManager(request, env, segments[0]!);
    if (!access.found || (!access.reviewer && !access.reads)) {
      return Response.json({ error: "not-found" }, { status: 404 });
    }
    const { status, payload } = await callGallery<{
      svgText?: string;
      projectText?: string;
    }>(env, "version", { entryId: segments[0], versionId: segments[2] });
    if (status !== 200 || !payload.svgText) {
      return Response.json({ error: "not-found" }, { status: 404 });
    }
    return new Response(
      await recoverFormulaPreview(payload.svgText, payload.projectText),
      {
        headers: {
          "content-type": "image/svg+xml",
          "cache-control": "no-store",
          "content-security-policy":
            "default-src 'none'; style-src 'unsafe-inline'",
        },
      },
    );
  }
  if (
    segments.length === 4 &&
    segments[1] === "versions" &&
    segments[3] === "restore" &&
    request.method === "POST"
  ) {
    if (!sameOrigin(request)) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    const access = await entryManager(request, env, segments[0]!);
    if (!access.found) {
      return Response.json({ error: "not-found" }, { status: 404 });
    }
    if (!access.reviewer && !access.owner) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const { status, payload } = await callGallery(env, "restore-version", {
      entryId: segments[0],
      versionId: segments[2],
      at: new Date().toISOString(),
    });
    return Response.json(payload, { status });
  }
  return null;
}
