# Simulation Spec annotations (version 1)

## Engine boundary

Scalar generation and acceptance evaluation are different operations. VACASK
measurements come from authored Python `report_measurement` output; obtain the
current helper from `simulation` / `authoring-help` with name `embed`, then
execute it through native `postprocess`. ngspice instead uses native `meas` or
`.meas`. Never translate those commands literally between engines.

Author standalone `* @spec` comments for ngspice and standalone `// @spec`
comments for VACASK. The selected execution engine chooses its source adapter;
there is no extension-based guessing or SPICE fallback. VACASK's native literal
includes and selected sections are traversed case-sensitively. Strings, embedded
Python, block comments and unreachable files are not annotation sources. Do not
hide `* @spec` in Python strings to work around the native grammar.

VACASK measurement names are case-sensitive (`Gain` and `gain` are distinct);
ngspice measurement names keep their case-insensitive native semantics. Both
adapters feed the same evaluation/report path. Inspect captured `specs.json`:
a scalar report alone is not an evaluated acceptance rule.

```text
// @spec q_w1 > 1.6 unit=V
// @spec delay target 1e-6 tol 1e-8 unit=s
```

Without a rule, each valid VACASK `report_measurement` value still appears in
`specs.json`/`specs.csv` as `unconstrained`. Its unit is the postprocessor's declared
unit (not inferred). Unavailable reports retain their failure and Console line;
partial/dropped-input runs cannot certify reported values. No extra native scalar
payload is added to run receipts.

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

The grammar is `* @spec NAME [CONDITION] [unit=UNIT] [group=NAME] [label=JSON]`
(replace `*` with `//` for VACASK). Conditions are `< N`,
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

An `invalid-spec` result's `detail` names each offending token and the form
accepted instead, for example `Bound "9.0m" is not a decimal or scientific
number; write 9.0e-3.` The parser the run uses also checks source before any
run. The Code editor shows the same message on the annotation's line as you
type. Over MCP or the HTTP CLI, `simulation_edit` (or `simulation_files`)
`update` returns it for each source file it saved, whether written whole or
changed by `replacements` or `patches`, as `specWarnings:[{path,line,message}]`. It is a warning, not a refusal: the file
is saved and the run proceeds. A raw File Resource receipt carries no warnings.

The compact four-column table uses engineering prefixes for base electrical
units (e.g. `36.27 MΩ`, `4.39 fF`) and the same scale for a row's expected value.
Unit `1` explicitly means dimensionless; absent units have no visible suffix.
Small/large unknown-unit values use scientific notation without rescaling.
Hover explains missing units; they are never guessed from measurement names. Hover exposes the original
unrounded numerical value and declared unit. Clicking a name still opens its
source; a report-only measurement opens Console instead. Rendering/rounding does not change evaluation or the stored numbers.
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
file API; no new authority or UI interaction is required. Report-only VACASK
results use optional `source.kind: "log"`, `path: "log.txt"` and the actual Console
line/text, not an invented input location. Historical sources without `kind`
still mean authored input. `specs.csv` preserves the result and provenance for
external tools, with appended plain-text label, optional group, `source kind`
(`input` or `log`) and detail columns; earlier columns never move. Formula-leading
labels, groups, details and report-only names/units are escaped for spreadsheet
safety, without altering JSON identities. Raw and
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
