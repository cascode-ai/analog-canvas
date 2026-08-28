const NEW_BUG_ISSUE_URL =
  "https://github.com/cascode-ai/analog-canvas/issues/new";

export interface BugReportEnvironment {
  pathname: string;
  browser: string;
  viewport: string;
  mode: "browser tab" | "installed app" | "unknown";
  reportedAt: string;
}

export interface BugReportDetails {
  surface: string;
  projectSchemaVersion?: number | undefined;
}

function inlineCode(value: string, maxLength = 240): string {
  return value
    .replace(/[\r\n]+/gu, " ")
    .replaceAll("`", "'")
    .trim()
    .slice(0, maxLength);
}

function pathnameWithoutPrivateParts(pathname: string): string {
  const staticPathname = pathname.split(/[?#]/u, 1)[0] || "/";
  // Gallery entry ids can identify rejected, recycled, or otherwise private
  // submissions linked from /mine. The route is useful; the id is not.
  const redactedPathname = /^\/g\/[^/]+\/?$/u.test(staticPathname)
    ? "/g/:id"
    : staticPathname;
  return inlineCode(redactedPathname, 160);
}

/** Keep only a coarse browser family and major version, not the full UA. */
export function browserSummary(userAgent: string): string {
  for (const [pattern, name] of [
    [/Edg\/(\d+)/u, "Edge"],
    [/OPR\/(\d+)/u, "Opera"],
    [/CriOS\/(\d+)/u, "Chrome iOS"],
    [/Chrome\/(\d+)/u, "Chrome"],
    [/FxiOS\/(\d+)/u, "Firefox iOS"],
    [/Firefox\/(\d+)/u, "Firefox"],
    [/Version\/(\d+).+Safari\//u, "Safari"],
  ] as const) {
    const match = pattern.exec(userAgent);
    if (match?.[1]) return `${name} ${match[1]}`;
  }
  return "Other / unknown";
}

export function currentBugReportEnvironment(): BugReportEnvironment {
  if (typeof window === "undefined") {
    return {
      pathname: "/",
      browser: "Unknown",
      viewport: "Unknown",
      mode: "unknown",
      reportedAt: new Date().toISOString(),
    };
  }
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches;
  return {
    // Path only: query strings and hashes can carry private Project/session data.
    pathname: window.location.pathname,
    browser:
      typeof navigator === "undefined"
        ? "Unknown"
        : browserSummary(navigator.userAgent),
    viewport: `${window.innerWidth} × ${window.innerHeight} @ ${window.devicePixelRatio || 1}×`,
    mode: standalone ? "installed app" : "browser tab",
    reportedAt: new Date().toISOString(),
  };
}

export function buildBugReportUrl(
  environment: BugReportEnvironment,
  details: BugReportDetails,
): string {
  const schemaLine =
    details.projectSchemaVersion === undefined
      ? []
      : [`- Project schema: \`${details.projectSchemaVersion}\``];
  const body = [
    "## What happened?",
    "",
    "<!-- Describe the problem. This GitHub Issue will be public: do not include private circuit content, PDK/model files, secrets, access links, or tokens. -->",
    "",
    "## Steps to reproduce",
    "",
    "1. ",
    "2. ",
    "3. ",
    "",
    "## Expected behavior",
    "",
    "<!-- What should have happened instead? -->",
    "",
    "## Environment",
    "",
    `- Surface: \`${inlineCode(details.surface, 80)}\``,
    `- Page: \`${pathnameWithoutPrivateParts(environment.pathname)}\``,
    `- Browser: \`${inlineCode(environment.browser, 80)}\``,
    `- Viewport: \`${inlineCode(environment.viewport, 80)}\``,
    `- Mode: \`${environment.mode}\``,
    ...schemaLine,
    `- Report prepared: \`${inlineCode(environment.reportedAt, 40)}\``,
    "",
    "## Additional context",
    "",
    "<!-- Add screenshots only if they contain no private circuit or account data. -->",
  ].join("\n");
  const params = new URLSearchParams({
    labels: "bug",
    title: "[Bug] ",
    body,
  });
  return `${NEW_BUG_ISSUE_URL}?${params.toString()}`;
}

export function BugReportLink({
  className,
  testId,
  surface,
  projectSchemaVersion,
  environment,
}: {
  className?: string | undefined;
  testId: string;
  surface: string;
  projectSchemaVersion?: number | undefined;
  /** Deterministic override for tests; production always reads the current page. */
  environment?: BugReportEnvironment | undefined;
}) {
  const reportUrl = () =>
    buildBugReportUrl(environment ?? currentBugReportEnvironment(), {
      surface,
      projectSchemaVersion,
    });
  return (
    <a
      className={["bug-report-link", className].filter(Boolean).join(" ")}
      href={reportUrl()}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={testId}
      aria-label="Report a bug publicly on GitHub (opens in a new tab)"
      title="Open a prefilled public GitHub issue in a new tab"
      onClick={(event) => {
        // Refresh timestamp, route, and viewport for long-lived editor tabs.
        event.currentTarget.href = reportUrl();
      }}
    >
      <span className="bug-report-mark" aria-hidden="true">
        !
      </span>
      <span className="bug-report-label">Report bug</span>
    </a>
  );
}
