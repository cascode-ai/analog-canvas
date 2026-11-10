// What Analog Canvas tells crawlers and the AI tools that read it: every
// public circuit is free to read, download in bulk, mirror and use, AI
// training included. robots.txt and llms.txt both carry it, in plain view.

import {
  GALLERY_DOWNLOAD_SCRIPT,
  SITE_USAGE_CONTACT,
} from "../apps/editor/src/usage-policy-note";

export function robotsTxt(): string {
  return [
    "# Analog Canvas usage policy",
    "# Every public circuit is free to read, download in bulk, mirror and use",
    "# for any purpose, AI training included. Circuits from reference datasets",
    "# keep their dataset's license.",
    `# Download every circuit: ${GALLERY_DOWNLOAD_SCRIPT}`,
    "# Public Gallery reads have no request-rate cap or daily download quota.",
    `# Questions: ${SITE_USAGE_CONTACT}`,
    "",
    "User-agent: *",
    "Content-Signal: search=yes, ai-train=yes",
    "Disallow: /g/",
    "",
  ].join("\n");
}

export function llmsUsagePolicy(): string {
  return [
    "## Usage policy",
    "",
    "- Every public circuit is free to read, download in bulk, mirror and use for any purpose, AI training included.",
    "- Circuits from reference datasets keep their dataset's license.",
    `- Download every circuit with ${GALLERY_DOWNLOAD_SCRIPT}, or read the API: GET /api/gallery?limit=60&cursor=… lists circuits, GET /api/gallery/{id} returns one with its Project.`,
    "- Public Gallery reads have no request-rate cap or daily download quota.",
    `- Questions: ${SITE_USAGE_CONTACT}.`,
    "",
  ].join("\n");
}
