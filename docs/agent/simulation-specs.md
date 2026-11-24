# Simulation Spec annotations (version 1)

## Engines

Scalar generation and acceptance are separate. ngspice computes measurements
with native `meas`/`.meas`; VACASK with authored Python `report_measurement`
(helper `embed` from `simulation` / `authoring-help`, run through native
`postprocess`). Never translate either literally into the other. Annotate with
standalone `* @spec` comments for ngspice and `// @spec` for VACASK; the
execution engine picks the adapter (no extension guessing or SPICE fallback).
VACASK's literal includes and selected sections are traversed; strings,
embedded Python, block comments and unreachable files are not annotation
sources. VACASK measurement names are case-sensitive; ngspice's are not. Both
feed one evaluation path, from the captured execution input, never live edits.
A scalar report alone is not an evaluated rule: inspect `specs.json`.

## Grammar

`* @spec NAME [CONDITION] [unit=UNIT] [group=NAME] [label=JSON]` (`//` for
VACASK), beside a uniquely named measurement in a reachable source file:

```spice
* @spec peak <= 1.8 unit=V
* @spec bandwidth >= 1e6 unit=Hz
* @spec gain >= 40 unit=dB group="Gain and bandwidth" label="DC gain"
* @spec bias range 0.4 0.6 unit=V
* @spec delay target 1e-6 tol 1e-8 unit=s
* @spec zmag_1mhz unit=Ohm label="Input impedance at 1 MHz"
* @spec cin unit=F label={"runs":[{"kind":"text","value":"C"},{"kind":"span","style":"subscript","children":[{"kind":"text","value":"in"}]}]}
```

- Conditions: `< N`, `<= N`, `> N`, `>= N`, `range MIN MAX` (inclusive),
  `target VALUE tol ABSOLUTE_TOLERANCE`. Numbers are decimal/scientific or
  take one SPICE scale suffix, case-insensitive: `f p n u m k meg g t`
  (`16.5u` judges as `16.5e-6`, `2.5MEG` as `2.5e6`). A bare `M` is refused,
  since SPICE reads it as milli and VACASK as mega: write `m` or `meg`.
  Atto, `mil`, trailing unit text (`10kOhm`) and expressions are unsupported.
- `unit` declares the measurement's numeric unit; it is not inferred or
  dimension-checked (a result in seconds is `1e-6 unit=s`, not `1 unit=us`).
  Unit `1` means dimensionless.
- Without a condition, an annotation with a unit, label or group is
  `unconstrained` (GUI **Measured only**), not Pass. Keep all metadata and the
  condition in one annotation per measurement; each name has at most one Spec.
- `group` is a plain token or JSON string (1–80 characters, no control
  characters) for display only. `label`, last, is a JSON string or compact
  single-line RichText: up to 16 text/style runs (bold, italic, subscript,
  superscript, overbar) or one inline `math` run; strings up to 256
  characters. The measurement name is unchanged.
- Invalid metadata is `invalid-spec`; its `detail` names each bad token and the
  accepted form (e.g. `Bound "9.0ms" is not a decimal or scientific number or
  one with a SPICE suffix (f p n u m k meg g t); write 9.0e-3.`), checked before any run and shown in the Code editor. An
  MCP/CLI source `update` (whole writes from their text; `replacements` or
  `patches` read back once) returns `specWarnings:[{path,line,message}]`,
  omitted when none: a warning, not a refusal. A raw File Resource receipt
  carries none.

A measurement reads only the analysis it names: `meas dc NAME find v(x) at=X`
needs a sweep that spans X, so a one-point DC sweep (`dc vin 0.9 0.9 0.01`)
reports no value ("out of interval"): its Spec is `measurement-missing`, with
that hint in its detail, or, when the run then fails, every Spec is
`run-incomplete`. Sweep across the point instead (`dc vin 0.8 1.0 0.01`).

Without a rule, each valid VACASK `report_measurement` value still appears as
`unconstrained` with the postprocessor's declared unit. Unavailable reports
keep their failure and Console line.

## Verdicts

Judgments: `pass`, `failed`, `not-evaluated`, `unconstrained`. Reasons:
`satisfied`, `outside-spec`, `no-spec`, `invalid-spec`, `duplicate-spec`,
`ambiguous-measurement`, `measurement-missing`, `run-incomplete`. Missing or
nonfinite measurements never become zero or a failure; invalid rules do not
block execution or retrieval; an incomplete or partial run certifies nothing;
a transport failure has no report. Repeated reports from one declaration keep
their occurrence and log line; a batch's run ID identifies its point. A
historical report is never reevaluated, and a result without a report is not
passing.

## Result files

`specs.json` (GUI `outputData.specs`) holds runId, preparedId, inputDigest and
per result: source path/line/text, measurement name, occurrence, value, unit,
structured condition, judgment, reason and logLine. Report-only VACASK results
use `source.kind: "log"`, `path: "log.txt"` and the Console line (no `kind`
means authored input). `specs.csv` keeps result and provenance plus appended
label text, group, `source kind` and detail columns; earlier columns never
move; spreadsheet-formula-leading text is escaped. Clients with strict report
schemas must accept the optional `label` and `group`. Run receipts give counts
in `details.specs`; fetch reports through the authorized file API.

Waveforms are in `result.json` (GUI `result.data`) with one complete CSV per
analysis; raw files stay intact. New runs compute no min/max/RMS summaries or
`outputs-*.csv`; legacy outputs remain readable.
