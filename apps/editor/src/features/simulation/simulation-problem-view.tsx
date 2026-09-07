import type { ObjectLocator } from "@icm/model";
import type { Problem } from "@icm/simulation-service/contract";
const RECOVERY_LABELS: Record<Problem["recovery"], string> = {
  "fix-input": "Review the highlighted input and apply the correction.",
  reprepare: "The input changed. Prepare it again before running.",
  "retry-same-request":
    "The response is uncertain. Refresh this run; do not start a duplicate.",
  "retry-after":
    "Keep the current work and try again after the service recovers.",
  reauthorize:
    "Reconnect the simulation session, then continue with the same Project.",
  "not-retryable":
    "This run will not be retried automatically. Preserve its files before starting another.",
};

export function SimulationProblemView({
  problem,
  onFocus,
}: {
  problem: Problem;
  onFocus?: (locator: ObjectLocator) => void;
}) {
  const locator = (
    value: NonNullable<NonNullable<Problem["diagnostics"]>[number]["primary"]>,
  ): ObjectLocator => ({
    documentId: value.documentId,
    hierarchyPath: value.hierarchyPath.map((frame) => ({ ...frame })),
    kind: value.kind,
    objectId: value.objectId,
    ...(value.endpoint === undefined ? {} : { endpoint: value.endpoint }),
    ...(value.sourceRef === undefined ? {} : { sourceRef: value.sourceRef }),
  });
  return (
    <section className="simulation-problem" aria-label="Simulation problem">
      <header>
        <strong>{problem.code}</strong>
        <small>
          {problem.stage} · {problem.recovery}
        </small>
      </header>
      <p>{problem.message}</p>
      <p>{RECOVERY_LABELS[problem.recovery]}</p>
      {problem.retryAfterMs !== undefined ? (
        <small>
          Try again after {Math.ceil(problem.retryAfterMs / 1000)} s.
        </small>
      ) : null}
      {problem.diagnostics?.length ? (
        <ul>
          {problem.diagnostics.map((diagnostic, index) => (
            <li key={`${diagnostic.code}:${index}`}>
              <span>
                <strong>{diagnostic.code}</strong> {diagnostic.message}
                {diagnostic.field ? <small>{diagnostic.field}</small> : null}
              </span>
              {diagnostic.primary && onFocus ? (
                <button
                  type="button"
                  onClick={() => onFocus(locator(diagnostic.primary!))}
                >
                  Show
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
