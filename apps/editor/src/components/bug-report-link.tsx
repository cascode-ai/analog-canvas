/**
 * A new public GitHub issue, labelled bug and otherwise blank: the reporter
 * writes what they like, without a template to clear first.
 */
export const NEW_BUG_ISSUE_URL =
  "https://github.com/cascode-ai/analog-canvas/issues/new?labels=bug";

export function BugReportLink({
  className,
  testId,
}: {
  className?: string | undefined;
  testId: string;
}) {
  return (
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
  );
}
