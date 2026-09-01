export interface NetNamePropertiesProps {
  annotationId: string;
  authoredScope: "local" | "global";
  editableScope: boolean;
  effectiveScope: "local" | "global";
  preferredSpelling?: string;
  spellings: readonly string[];
  onScopeChange: (scope: "local" | "global") => void;
}

/** Owner-scoped authoring plus read-only revision-scoped export projection. */
export function NetNameProperties({
  annotationId,
  authoredScope,
  editableScope,
  effectiveScope,
  preferredSpelling,
  spellings,
  onScopeChange,
}: NetNamePropertiesProps) {
  return (
    <section
      className="property-section net-name-properties"
      aria-label="Net identity"
    >
      <div className="property-section-heading">Net identity</div>
      <label>
        Label scope
        <select
          key={`${annotationId}-${authoredScope}`}
          aria-label="Net Label scope"
          value={authoredScope}
          disabled={!editableScope}
          onChange={(event) =>
            onScopeChange(event.currentTarget.value as "local" | "global")
          }
        >
          <option value="local">Local to Cell</option>
          <option value="global">Global across Cells</option>
        </select>
      </label>
      <dl className="component-readonly-fields">
        <div>
          <dt>Effective scope</dt>
          <dd>
            {effectiveScope === "global" ? (
              <span className="net-scope-badge" data-scope="global">
                Global
              </span>
            ) : (
              "Local"
            )}
          </dd>
        </div>
        <div>
          <dt>Preferred export spelling</dt>
          <dd>{preferredSpelling ?? "Unnamed"}</dd>
        </div>
        {spellings.length > 1 ? (
          <div className="net-spelling-variants">
            <dt>Spelling variants</dt>
            <dd>{spellings.join(", ")}</dd>
          </div>
        ) : null}
      </dl>
      <small>
        Scope edits this Label claim only. Wire membership and source provenance
        are unchanged.
      </small>
    </section>
  );
}
