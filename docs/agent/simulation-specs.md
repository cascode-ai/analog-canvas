# Simulation Spec annotations (version 1)

## Engine boundary

Scalar generation and acceptance evaluation are different operations. VACASK
measurements come from authored Python `report_measurement` output; obtain the
current helper from `simulation` / `authoring-help` with name `embed`, then
execute it through native `postprocess`. ngspice instead uses native `meas` or
`.meas`. Never translate those commands literally between engines.

The annotation grammar below is the existing SPICE-comment extraction contract.
It is not a promise that VACASK accepts SPICE comments or that every native
include is traversed by that extractor. Inspect the captured `specs.json` and
diagnostics: a scalar report alone is not an evaluated acceptance rule. Do not
claim a native rule was applied unless the captured report contains it.

## SPICE annotations

Spec annotations are ordinary SPICE comments, not simulator commands. Author
them in reachable source files alongside uniquely named native `meas`/`.meas`
declarations. The simulator computes measurements; the shared simulation service
evaluates specifications from the captured execution input, never live edits.

```spice
* @spec peak <= 1.8 unit=V
* @spec bandwidth >= 1e6 unit=Hz
* @spec gain >= 40 unit=dB group="Gain and bandwidth" label="DC gain"
* @spec bias range 0.4 0.6 unit=V
* @spec delay target 1e-6 tol 1e-8 unit=s
* @spec zmag_1mhz unit=Ohm label="Input impedance at 1 MHz"
* @spec cin unit=F label={"runs":[{"kind":"text","value":"C"},{"kind":"span","style":"subscript","children":[{"kind":"text","value":"in"}]}]}
```

The grammar is `* @spec NAME [CONDITION] [unit=UNIT] [group=NAME] [label=JSON]`. Conditions are `< N`,
`<= N`, `> N`, `>= N`, `range MIN MAX` (inclusive), or
`target VALUE tol ABSOLUTE_TOLERANCE`. Numbers use decimal/scientific notation;
SPICE suffixes, expressions and implicit conversions are deliberately unsupported.
Units are the author's declaration of the measurement's numerical unit, not an
inferred dimension check. For example a result measured in seconds uses `1e-6
unit=s`, not `1 unit=us` unless the code explicitly computed microseconds.

A measurement-only annotation may omit the condition if it declares a unit or
label or group; it remains `unconstrained` (GUI: **Measured only**), not Pass. Keep all
metadata and any condition in one annotation per measurement. `group` is an optional
plain token or JSON string (1–80 characters, no control characters); it organizes
display only, not electrical meaning or acceptance. `label` is last
and accepts a JSON string or a compact single-line subset of canonical RichText:
up to 16 text/style runs (bold, italic, subscript, superscript or overbar with
text children), or one inline `math` run. Text/formula strings are limited to
256 characters; use inline math for fractions rather than nested document
layouts. No HTML or new markup language is interpreted. The
machine measurement name is unchanged. Invalid metadata is `invalid-spec`.
Optional labels are captured in reports, not read back from live source.

The compact four-column table uses engineering prefixes for base electrical
units (e.g. `36.27 MΩ`, `4.39 fF`) and the same scale for a row's expected value.
Unit `1` explicitly means dimensionless; absent units have no visible suffix.
Small/large unknown-unit values use scientific notation without rescaling.
Hover explains missing units; they are never guessed from measurement names. Hover exposes the original
unrounded numerical value and declared unit. Clicking a name still opens its
source. Rendering/rounding does not change evaluation or the stored numbers.
Historical reports without labels keep their original names and units.

Acceptance conditions and unresolved issues are shown first. Measurements without
conditions are in a collapsed Other measurements section; errors are never hidden
there. Optional groups retain first-declaration order, with Failed then Not evaluated
first within each group and stable source order otherwise. Unnamed groups display
Ungrouped only when named groups exist. Grouping/sorting does not reorder stored
reports or CSV. Agents can author this metadata, but no Agent interpretation is
required to render a report.

Each measurement name has at most one specification. Multiple declarations with
the same measurement name are ambiguous; use distinct names. Repeated reports
from one declaration retain their occurrence and log line, without inventing a
corner/plot mapping. A batch's ordinary run ID identifies its run point.

The `specs.json` artifact (materialized as GUI `outputData.specs`) contains the versioned
report: runId, preparedId, inputDigest and results with source path/line/text,
measurement name, occurrence, numeric value, unit, structured expected condition,
judgment, reason and logLine. Retrieve artifacts through the existing authorized
file API; no new authority or UI interaction is required. `specs.csv` preserves
the result and provenance for external tools, with an appended plain-text label
column and optional group column (formula-leading labels/groups are escaped for spreadsheet safety). Raw and
analysis CSV remain intact. Clients consuming strict report schemas must support
the optional RichText `label` and plain-text `group` fields before receiving
newly annotated reports. Publish a compatible MCP package with grouped-report
support before deploying producers of those reports; do not replace an immutable
published package in place.

The GUI file tree presents `specs.csv`; `specs.json` remains available through
File Resource and diagnostic export. Run receipts expose Spec counts in
`details.specs`; complete reports are fetched from files. Waveforms live in the GUI's materialized `result.data` or
`result.json`, with one complete CSV per analysis record. New runs do not compute
automatic min/max/RMS summaries or generate a second `outputs-*.csv` family.
Legacy output fields and archived files remain readable but are not regenerated.

Judgments: `pass`, `failed`, `not-evaluated`, `unconstrained`. Stable reasons:
`satisfied`, `outside-spec`, `no-spec`, `invalid-spec`, `duplicate-spec`,
`ambiguous-measurement`, `measurement-missing`, `run-incomplete`. Missing or
nonfinite measurements never become zero or a circuit failure. Invalid rules
do not prevent execution or artifact retrieval. Runs that do not complete
successfully cannot certify partial measurements. Transport failures with no
result have no report. A historical report is not reevaluated when source changes.

Old results without this optional report stay readable; do not interpret absence
as passing. Helper is optional authoring assistance, not the execution path.
