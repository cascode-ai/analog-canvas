/**
 * A new public GitHub issue, labelled bug and otherwise blank: the reporter
 * writes what they like, without a template to clear first.
 */
export const NEW_BUG_ISSUE_URL =
  "https://github.com/cascode-ai/analog-canvas/issues/new?labels=bug";

/** Where a report goes from someone without a GitHub account (#2162). */
export const BUG_REPORT_EMAIL = "zzhishuai@ethz.ch";

/**
 * A prefilled email: the page and the browser, which a report needs and its
 * writer rarely knows to give. It opens in their own mail program, so they
 * see and can change everything before it is sent.
 */
export function bugReportMailto(page?: string, browser?: string): string {
  const lines = [
    "What happened, and what did you expect?",
    "",
    "",
    ...(page ? [`Page: ${page}`] : []),
    ...(browser ? [`Browser: ${browser}`] : []),
  ];
  return `mailto:${BUG_REPORT_EMAIL}?subject=${encodeURIComponent(
    "Analog Canvas bug",
  )}&body=${encodeURIComponent(lines.join("\n"))}`;
}

export function BugReportLink({
  className,
  testId,
}: {
  className?: string | undefined;
  testId: string;
}) {
  return (
    <>
      <a
        className={["bug-report-link", className].filter(Boolean).join(" ")}
        href={NEW_BUG_ISSUE_URL}
        target="_blank"
        rel="noopener noreferrer"
        data-testid={testId}
        aria-label="Report a bug publicly on GitHub (opens in a new tab)"
        title="Open a new public GitHub issue in a new tab"
      >
        <span className="bug-report-mark" aria-hidden="true">
          !
        </span>
        <span className="bug-report-label">Report bug</span>
      </a>
      <a
        className="bug-report-email"
        href={bugReportMailto()}
        data-testid={`${testId}-email`}
        aria-label={`Report a bug by email to ${BUG_REPORT_EMAIL}`}
        title={`No GitHub account? Email ${BUG_REPORT_EMAIL}`}
        onClick={(event) => {
          // The page and browser are only known here, not when rendered.
          event.currentTarget.href = bugReportMailto(
            window.location.href,
            navigator.userAgent,
          );
        }}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <rect x="1.5" y="3.5" width="13" height="9" rx="1" />
          <path d="M2 4.5 8 9l6-4.5" />
        </svg>
      </a>
    </>
  );
}
