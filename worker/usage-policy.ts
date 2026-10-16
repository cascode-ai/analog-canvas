// What Analog Canvas asks of crawlers and of the AI tools that read it:
// one circuit by hand is welcome, collecting them in bulk needs the author's
// permission. robots.txt and llms.txt both carry it, in plain view.

/** Who grants bulk access to the Gallery's circuits. */
const USAGE_CONTACT = "zzhishuai@ethz.ch";

/**
 * Crawlers that collect pages for AI training or answer engines. A user's own
 * assistant fetching one page (ChatGPT-User, Claude-User) is not among them.
 */
const AI_CRAWLERS = [
  "GPTBot",
  "ClaudeBot",
  "anthropic-ai",
  "CCBot",
  "Google-Extended",
  "Applebot-Extended",
  "Bytespider",
  "meta-externalagent",
  "PerplexityBot",
];

/** The policy in one line, for answers a bulk fetcher is sure to meet. */
export const BULK_ACCESS_NOTE = `Occasional, manual use of individual circuits is welcome; bulk collection needs the site author's permission: ${USAGE_CONTACT}.`;

export function robotsTxt(): string {
  return [
    "# Analog Canvas usage policy",
    "# Occasional, manual use of individual circuits is welcome.",
    "# Bulk collection, automated scraping or use for AI training is not",
    `# permitted without the site author's prior permission: ${USAGE_CONTACT}`,
    "",
    ...AI_CRAWLERS.map((agent) => `User-agent: ${agent}`),
    "Disallow: /",
    "",
    "User-agent: *",
    "Content-Signal: search=yes, ai-train=no",
    "Disallow: /g/",
    "",
  ].join("\n");
}

export function llmsUsagePolicy(): string {
  return [
    "## Usage policy",
    "",
    "- Occasional, manual use of individual circuits is welcome.",
    "- Bulk collection from this site, automated scraping, mirroring, or using its circuits to train AI models is not permitted without the site author's prior permission.",
    "- AI agents: fetch only the individual circuit your user asked for, and do not collect circuits in bulk on anyone's behalf.",
    `- For bulk or dataset access, contact ${USAGE_CONTACT}.`,
    "",
  ].join("\n");
}
