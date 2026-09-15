# Simulation Spec annotations (version 1)

Spec annotations are ordinary SPICE comments, not simulator commands. Author
them in reachable source files alongside uniquely named native `meas`/`.meas`
declarations. The simulator computes measurements; the shared simulation service
evaluates specifications from the captured execution input, never live edits.

```spice
* @spec peak <= 1.8 unit=V
* @spec bandwidth >= 1e6 unit=Hz
* @spec bias range 0.4 0.6 unit=V
* @spec delay target 1e-6 tol 1e-8 unit=s
```

The grammar is `* @spec NAME CONDITION [unit=LABEL]`. Conditions are `< N`,
`<= N`, `> N`, `>= N`, `range MIN MAX` (inclusive), or
`target VALUE tol ABSOLUTE_TOLERANCE`. Numbers use decimal/scientific notation;
SPICE suffixes, expressions and implicit conversions are deliberately unsupported.
Units are the author's declaration of the measurement's numerical unit, not an
inferred dimension check. For example a result measured in seconds uses `1e-6
unit=s`, not `1 unit=us` unless the code explicitly computed microseconds.

Each measurement name has at most one specification. Multiple declarations with
the same measurement name are ambiguous; use distinct names. Repeated reports
from one declaration retain their occurrence and log line, without inventing a
corner/plot mapping. A batch's ordinary run ID identifies its run point.

Run `outputData.specs` and the `specs.json` artifact contain the same versioned
report: runId, preparedId, inputDigest and results with source path/line/text,
measurement name, occurrence, numeric value, unit, structured expected condition,
judgment, reason and logLine. Retrieve artifacts through the existing authorized
file API; no new authority or UI interaction is required. `specs.csv` preserves
the result and provenance for external tools. Raw and analysis CSV remain intact.

Judgments: `pass`, `failed`, `not-evaluated`, `unconstrained`. Stable reasons:
`satisfied`, `outside-spec`, `no-spec`, `invalid-spec`, `duplicate-spec`,
`ambiguous-measurement`, `measurement-missing`, `run-incomplete`. Missing or
nonfinite measurements never become zero or a circuit failure. Invalid rules
do not prevent execution or artifact retrieval. Runs that do not complete
successfully cannot certify partial measurements. Transport failures with no
result have no report. A historical report is not reevaluated when source changes.

Old results without this optional report stay readable; do not interpret absence
as passing. Helper is optional authoring assistance, not the execution path.
