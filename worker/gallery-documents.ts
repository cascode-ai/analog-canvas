// Server-readable public Gallery documents: the catalog and entry pages,
// suspended for now, and what they are built from.

import { parseProject } from "@icm/project-protocol";
import { type GalleryEntrySummary, type GalleryEnv } from "./gallery-store";
import { callGallery } from "./gallery-requests";

interface PublicGalleryCatalog {
  entries: GalleryEntrySummary[];
  total: number;
  netlistable: number;
  tags: { tag: string; count: number; group: string }[];
  groups: { group: string; count: number }[];
  authors: { author: string; ownerUserId: string | null; count: number }[];
}

interface PublicGalleryStoredEntry {
  entry: GalleryEntrySummary;
  status: string;
  projectText: string;
}

export interface GalleryReadableDocument {
  title: string;
  description: string;
  headHtml: string;
  bodyHtml: string;
}

// Temporarily suspend the server-readable Gallery documents. The interactive
// Gallery still uses its existing paginated API.
export const PUBLIC_GALLERY_DOCUMENTS_ENABLED = false;

export async function publicGalleryCatalog(
  env: GalleryEnv,
): Promise<PublicGalleryCatalog | null> {
  const { status, payload } = await callGallery<PublicGalleryCatalog>(
    env,
    "catalog",
    {},
  );
  return status === 200 ? payload : null;
}

export async function publicGalleryEntry(
  env: GalleryEnv,
  id: string,
): Promise<PublicGalleryStoredEntry | null> {
  const { status, payload } = await callGallery<PublicGalleryStoredEntry>(
    env,
    "entry",
    { id },
  );
  return status === 200 ? payload : null;
}

export function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function publicHref(path: string, value?: string): string {
  return value === undefined ? path : `${path}${encodeURIComponent(value)}`;
}

function normalizedSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("en-US");
}

function readableJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function catalogEntryHtml(entry: GalleryEntrySummary): string {
  const tags = entry.tags.length
    ? ` Tags: ${entry.tags
        .map(
          (tag) =>
            `<a href="${publicHref("/?tags=", tag)}">${escapeHtml(tag)}</a>`,
        )
        .join(", ")}.`
    : "";
  return `<li data-gallery-entry-id="${escapeHtml(entry.id)}">
    <a href="/g/${encodeURIComponent(entry.id)}">${escapeHtml(entry.name)}</a>
    <span> by ${escapeHtml(entry.author || "Unknown contributor")}.</span>
    ${entry.description ? `<span> ${escapeHtml(entry.description)}</span>` : ""}
    <span>${tags} ${entry.netlistable ? "Netlist available." : "Netlist currently blocked."} ${entry.likes} likes.</span>
  </li>`;
}

function catalogDocument(
  request: Request,
  catalog: PublicGalleryCatalog,
): GalleryReadableDocument {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  const author = (url.searchParams.get("author") ?? "").trim();
  const requestedTags = [
    ...url.searchParams.getAll("tag"),
    ...(url.searchParams.get("tags") ?? "").split(","),
  ]
    .map((tag) => tag.trim().toLocaleLowerCase("en-US"))
    .filter((tag, index, values) => tag && values.indexOf(tag) === index);
  const netlistableOnly =
    url.searchParams.get("netlist") === "1" ||
    url.searchParams.get("netlistable") === "1";
  const normalizedQuery = normalizedSearchText(query);
  const entries = catalog.entries.filter((entry) => {
    if (
      author &&
      entry.author.toLocaleLowerCase("en-US") !==
        author.toLocaleLowerCase("en-US")
    ) {
      return false;
    }
    if (
      requestedTags.length &&
      !requestedTags.every((tag) => entry.tags.includes(tag))
    ) {
      return false;
    }
    if (netlistableOnly && !entry.netlistable) return false;
    if (!normalizedQuery) return true;
    return normalizedSearchText(
      [entry.name, entry.author, entry.description, ...entry.tags].join(" "),
    ).includes(normalizedQuery);
  });
  const filters = [
    query ? `text “${query}”` : "",
    author ? `author “${author}”` : "",
    requestedTags.length ? `tags ${requestedTags.join(", ")}` : "",
    netlistableOnly ? "netlistable only" : "",
  ].filter(Boolean);
  const description = `${catalog.total} public analog circuits with searchable authors, descriptions, tags, Project Code and generated netlists.`;
  const tagsByGroup = new Map<string, { tag: string; count: number }[]>();
  for (const tag of catalog.tags) {
    tagsByGroup.set(tag.group, [...(tagsByGroup.get(tag.group) ?? []), tag]);
  }
  const groupHtml = catalog.groups
    .map(({ group, count }) => {
      const tags = (tagsByGroup.get(group) ?? [])
        .map(
          ({ tag, count: tagCount }) =>
            `<li><a href="${publicHref("/?tags=", tag)}">${escapeHtml(tag)}</a> (${tagCount})</li>`,
        )
        .join("");
      return `<li><strong>${escapeHtml(group)}</strong> (${count} circuits)<ul>${tags}</ul></li>`;
    })
    .join("");
  const authors = catalog.authors
    .map(
      ({ author, count }) =>
        `<li><a href="${publicHref("/?author=", author)}">${escapeHtml(author)}</a> (${count})</li>`,
    )
    .join("");
  const structured = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Analog Canvas Community Gallery",
    description,
    numberOfItems: catalog.total,
    mainEntity: entries.map((entry) => ({
      "@type": "CreativeWork",
      "@id": `${url.origin}/g/${entry.id}`,
      name: entry.name,
      author: entry.author,
      description: entry.description,
      keywords: entry.tags,
    })),
  };
  return {
    title: "Analog Canvas Community Gallery",
    description,
    headHtml: `<link rel="canonical" href="${escapeHtml(url.origin)}/"><script type="application/ld+json">${readableJson(structured)}</script>`,
    bodyHtml: `<main data-public-gallery-document="catalog">
      <header>
        <h1>Analog Canvas Community Gallery</h1>
        <p>${escapeHtml(description)}</p>
      </header>
      <section aria-labelledby="gallery-overview">
        <h2 id="gallery-overview">Gallery overview</h2>
        <dl>
          <dt>Public circuits</dt><dd>${catalog.total}</dd>
          <dt>Netlistable circuits</dt><dd>${catalog.netlistable}</dd>
          <dt>Tags</dt><dd>${catalog.tags.length}</dd>
          <dt>Contributors</dt><dd>${catalog.authors.length}</dd>
        </dl>
        <p>Search the same URL with <code>?q=ota</code>, <code>?tags=bandgap</code>, <code>?author=Magic%20Li</code>, or <code>?netlist=1</code>.</p>
      </section>
      <section aria-labelledby="gallery-taxonomy">
        <h2 id="gallery-taxonomy">Tags</h2>
        <p>Tags are the sole public classification system. Tag groups organize those tags without creating a second category system.</p>
        <ul>${groupHtml}</ul>
      </section>
      <section aria-labelledby="gallery-contributors">
        <h2 id="gallery-contributors">Contributors</h2>
        <ul>${authors}</ul>
      </section>
      <section aria-labelledby="gallery-circuits">
        <h2 id="gallery-circuits">${entries.length}${filters.length ? ` matching` : " public"} circuits</h2>
        ${filters.length ? `<p>Active filters: ${escapeHtml(filters.join("; "))}. <a href="/">Clear filters</a>.</p>` : ""}
        <ol>${entries.map(catalogEntryHtml).join("")}</ol>
      </section>
    </main>`,
  };
}

function entryDocument(
  request: Request,
  stored: PublicGalleryStoredEntry,
): GalleryReadableDocument {
  const url = new URL(request.url);
  const entry = stored.entry;
  const project = parseProject(stored.projectText);
  const documents = project.documents;
  const instances = documents.flatMap((document) => document.instances);
  const symbolCounts = new Map<string, number>();
  for (const instance of instances) {
    symbolCounts.set(
      instance.symbolId,
      (symbolCounts.get(instance.symbolId) ?? 0) + 1,
    );
  }
  const resourceBase = `/g/${encodeURIComponent(entry.id)}`;
  const cells = documents
    .map((document) => {
      const ports = (document.netlist?.terminals ?? [])
        .map(
          (terminal) =>
            `${escapeHtml(terminal.name)} (${escapeHtml(terminal.direction)})`,
        )
        .join(", ");
      return `<li><strong>${escapeHtml(document.name)}</strong>${document.netlist?.name ? ` · netlist name ${escapeHtml(document.netlist.name)}` : ""}; ${document.instances.length} components; ports: ${ports || "none"}.</li>`;
    })
    .join("");
  const components = [...symbolCounts.entries()]
    .sort((left, right) => left[0].localeCompare(right[0], "en"))
    .map(([symbolId, count]) => `<li>${escapeHtml(symbolId)}: ${count}</li>`)
    .join("");
  const tags = entry.tags
    .map(
      (tag) => `<a href="${publicHref("/?tags=", tag)}">${escapeHtml(tag)}</a>`,
    )
    .join(", ");
  const description =
    entry.description || `${entry.name}, a public Analog Canvas circuit.`;
  const structured = {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    "@id": url.href,
    name: entry.name,
    author: entry.author,
    description,
    datePublished: entry.createdAt,
    keywords: entry.tags,
    encoding: [
      `${url.origin}${resourceBase}/project.icproj.json`,
      `${url.origin}${resourceBase}/netlist.sp`,
      `${url.origin}${resourceBase}/netlist.scs`,
    ],
  };
  return {
    title: `${entry.name} · Analog Canvas`,
    description,
    headHtml: `<link rel="canonical" href="${escapeHtml(url.origin + resourceBase)}"><link rel="alternate" type="application/json" href="${resourceBase}/project.icproj.json" title="Analog Canvas Project Code"><link rel="alternate" type="text/plain" href="${resourceBase}/netlist.sp" title="SPICE netlist"><link rel="alternate" type="text/plain" href="${resourceBase}/netlist.scs" title="Spectre netlist"><script type="application/ld+json">${readableJson(structured)}</script>`,
    bodyHtml: `<main data-public-gallery-document="entry" data-gallery-entry-id="${escapeHtml(entry.id)}">
      <header>
        <p><a href="/">Analog Canvas Community Gallery</a></p>
        <h1>${escapeHtml(entry.name)}</h1>
        <p>By <a href="${publicHref("/?author=", entry.author)}">${escapeHtml(entry.author || "Unknown contributor")}</a>.</p>
        <p>${escapeHtml(description)}</p>
        <p>Tags: ${tags || "none"}.</p>
      </header>
      <section aria-labelledby="circuit-overview">
        <h2 id="circuit-overview">Circuit overview</h2>
        <dl>
          <dt>Gallery ID</dt><dd>${escapeHtml(entry.id)}</dd>
          <dt>Published</dt><dd>${escapeHtml(entry.createdAt)}</dd>
          <dt>Project schema</dt><dd>${entry.schemaVersion}</dd>
          <dt>Cells</dt><dd>${documents.length}</dd>
          <dt>Components</dt><dd>${instances.length}</dd>
          <dt>Nets</dt><dd>${documents.reduce((sum, document) => sum + document.nets.length, 0)}</dd>
          <dt>Routes</dt><dd>${documents.reduce((sum, document) => sum + document.routes.length, 0)}</dd>
          <dt>Junctions</dt><dd>${documents.reduce((sum, document) => sum + document.junctions.length, 0)}</dd>
          <dt>Netlist</dt><dd>${entry.netlistable ? "Available" : "Currently blocked; read a netlist URL for diagnostics"}</dd>
          <dt>Likes</dt><dd>${entry.likes}</dd>
        </dl>
      </section>
      <section aria-labelledby="circuit-cells"><h2 id="circuit-cells">Cells and ports</h2><ul>${cells}</ul></section>
      <section aria-labelledby="circuit-components"><h2 id="circuit-components">Component types</h2><ul>${components || "<li>None</li>"}</ul></section>
      <section aria-labelledby="circuit-resources">
        <h2 id="circuit-resources">Direct public resources</h2>
        <ul>
          <li><a href="${resourceBase}/project.icproj.json">Complete Project Code</a></li>
          <li><a href="${resourceBase}/netlist.sp">SPICE netlist</a></li>
          <li><a href="${resourceBase}/netlist.scs">Spectre netlist</a></li>
          <li><a href="${resourceBase}/preview.svg">SVG preview</a></li>
        </ul>
        <p>This page becomes the interactive Editor when browser JavaScript runs. Reading the page or resources above requires no account or private Canvas connection; modifying a circuit still requires explicit authorization.</p>
      </section>
    </main>`,
  };
}

/** Server-readable content for the same public URLs the browser application owns. */
export async function galleryReadableDocument(
  request: Request,
  env: GalleryEnv,
): Promise<GalleryReadableDocument | null> {
  if (!PUBLIC_GALLERY_DOCUMENTS_ENABLED) return null;
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  if (/^\/?$/u.test(url.pathname)) {
    const catalog = await publicGalleryCatalog(env);
    return catalog ? catalogDocument(request, catalog) : null;
  }
  const match = /^\/g\/([A-Za-z0-9-]{1,64})\/?$/u.exec(url.pathname);
  if (!match) return null;
  const stored = await publicGalleryEntry(env, match[1]!);
  if (!stored) return null;
  try {
    return entryDocument(request, stored);
  } catch {
    return null;
  }
}
