// Reference datasets over HTTP (#1510): each one's store, its count, and the
// Owner's import.

import { designExtractsNetlist } from "@icm/netlist";
import { galleryComponentCount } from "./gallery-components";
import {
  CURRENT_PROJECT_FILE_VERSION,
  parseProject,
  serializeProject,
} from "@icm/project-protocol";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { type CircuitProject } from "@icm/model";
import { sessionUserOf } from "./auth";
import {
  GALLERY_SOURCES,
  galleryStoreName,
  gallerySourceOfEntryId,
  type GallerySource,
} from "./gallery-sources";
import { sameOrigin } from "./same-origin";
import {
  GALLERY_MAX_DESCRIPTION_LENGTH,
  GALLERY_MAX_NAME_LENGTH,
  GALLERY_MAX_PROJECT_BYTES,
  sanitizeGalleryTags,
  wrapTags,
  type GalleryEnv,
} from "./gallery-store";
import { callGallery, fieldText, renderPreview } from "./gallery-requests";

/** The same bindings, with the Gallery store of a reference dataset. */
export function withGalleryStore(
  env: GalleryEnv,
  source: GallerySource,
): GalleryEnv {
  return {
    ...env,
    GALLERY: {
      getByName: () => env.GALLERY.getByName(galleryStoreName(source)),
    } as unknown as GalleryEnv["GALLERY"],
  };
}

/** Every reference dataset, with how many circuits its store shows. */
export async function gallerySourceCounts(env: GalleryEnv) {
  return Promise.all(
    GALLERY_SOURCES.map(async (source) => {
      const { payload } = await callGallery<{ count?: number }>(
        withGalleryStore(env, source),
        "public-count",
        {},
      );
      return { ...source, count: Number(payload.count ?? 0) };
    }),
  );
}

/** Circuits one import request may carry. */
const GALLERY_SOURCE_IMPORT_BATCH = 10;

/**
 * The Owner imports circuits into a reference dataset (#1510): each under
 * the id its dataset gives it, inserted or replaced in place, attributed to
 * the dataset. Same checks as a submission's Project; nothing else writes
 * to a dataset's store.
 */
export async function handleSourceImport(
  request: Request,
  env: GalleryEnv,
  source: GallerySource,
): Promise<Response> {
  if (!sameOrigin(request))
    return Response.json({ error: "forbidden" }, { status: 403 });
  const user = await sessionUserOf(request, env);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!user.isOwner)
    return Response.json({ error: "owner-only" }, { status: 403 });
  const body = (await request.json().catch(() => null)) as {
    entries?: unknown;
  } | null;
  const entries = Array.isArray(body?.entries) ? body.entries : null;
  if (
    !entries ||
    entries.length === 0 ||
    entries.length > GALLERY_SOURCE_IMPORT_BATCH
  )
    return Response.json({ error: "invalid-fields" }, { status: 400 });
  const store = withGalleryStore(env, source);
  const results = [];
  for (const item of entries as Record<string, unknown>[]) {
    const id = typeof item?.id === "string" ? item.id : "";
    const refuse = (error: string) => ({ id, ok: false, error });
    if (gallerySourceOfEntryId(id)?.key !== source.key) {
      results.push(refuse("invalid-id"));
      continue;
    }
    const name = fieldText(item.name, GALLERY_MAX_NAME_LENGTH);
    const description =
      item.description === undefined
        ? ""
        : fieldText(item.description, GALLERY_MAX_DESCRIPTION_LENGTH);
    const createdAt =
      typeof item.createdAt === "string" &&
      !Number.isNaN(Date.parse(item.createdAt))
        ? new Date(item.createdAt).toISOString()
        : undefined;
    if (!name || description === null) {
      results.push(refuse("invalid-fields"));
      continue;
    }
    if (
      typeof item.projectText !== "string" ||
      new TextEncoder().encode(item.projectText).length >
        GALLERY_MAX_PROJECT_BYTES
    ) {
      results.push(refuse("invalid-project"));
      continue;
    }
    let project: CircuitProject;
    try {
      project = parseProject(item.projectText);
    } catch {
      results.push(refuse("invalid-project"));
      continue;
    }
    project.name = name;
    const { status, payload } = await callGallery<Record<string, unknown>>(
      store,
      "import-entry",
      {
        id,
        at: new Date().toISOString(),
        ...(createdAt ? { createdAt } : {}),
        name,
        author: source.byline,
        description,
        projectText: serializeProject(project),
        svgText: await renderPreview(
          project,
          createProjectSymbolResolver(project, builtInSymbols),
        ),
        schemaVersion: CURRENT_PROJECT_FILE_VERSION,
        netlistable: designExtractsNetlist(project) ? 1 : 0,
        componentCount: galleryComponentCount(project),
        tags: wrapTags(sanitizeGalleryTags(item.tags)),
      },
    );
    results.push(
      status === 200 ? { ...payload, ok: true } : refuse(`http-${status}`),
    );
  }
  return Response.json({ source: source.key, results });
}
