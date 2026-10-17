# SPICE Frontend

Status: `accepted`

Primary owner: `packages/spice`

Turns selected SPICE-family files into typed statements, diagnostics and
transient [Circuit IR](circuit-ir.md), without making parser or filesystem part
of the Project.

## SourceBundle

One normalized relative entry path plus reachable files, include
dependencies, syntax files and diagnostics. Each file keeps its bytes'
SHA-256, detected UTF encoding, exact decoded text, stable ID and relative
path. The pure adapter takes explicit virtual files; Node may collect files
below the entry directory and the browser passes the user's files to the same
adapter.

## Lossless rules

- Decoded text round-trips exactly; every non-comment logical statement keeps
  its physical slice, line numbers and half-open one-based span.
- A leading `+` or a preceding line ending in two backslashes continues a
  statement; splitting respects quotes, parentheses and braces; inline `$`,
  `;`, `//` comments are ignored for projection only.
- Unrecognized or malformed statements become opaque with a located
  diagnostic, never discarded.
- `.include`, `.incpslt` and `.lib file section` share one sandboxed resolver:
  relative to the including file; absolute, URL, drive-qualified and
  root-escaping paths denied; missing targets and cycles are errors; repeats
  suppressed; unreachable files excluded; no network or simulator search
  paths. `.lib` elaborates only the named section (all text kept).

## Compatibility profile

Baseline `ngspice-46-core`, defined by the
[matrix](../../fixtures/spice-baseline/ngspice-46-core.json): structural, not
simulation equivalence; no simulator is embedded to parse untrusted source.

| Form                                            | Projection                                                      |
| ----------------------------------------------- | --------------------------------------------------------------- |
| R/C/L, V/I, E/F/G/H, B                          | primitive connectivity plus raw value/expression                |
| D/Q/J/Z/M, S/W                                  | model-backed ordered connectivity                               |
| T/O/P/U/Y                                       | transmission/distributed-line connectivity plus raw tail        |
| K                                               | typed coupling references without invented electrical terminals |
| X                                               | ordered terminals and subcircuit/master name                    |
| `.subckt`, `.ends`, `.model`, `.global`         | structural definitions                                          |
| `.param`, `.func`, `.if/.elseif/.else/.endif`   | raw expressions plus bounded deterministic elaboration          |
| `.include`, `.incpslt`, `.lib/.endl`            | sandboxed dependency/section structure                          |
| analyses, output, option, metadata dot commands | typed name/category plus raw arguments                          |
| `.control/.endc` and enclosed commands          | preserved structure; never executed                             |

XSPICE A, Verilog-A/OSDI N, XSPICE U forms, CIDER and vendor translations stay
opaque with warnings, without blocking surrounding structure.
`ltspice-24-structural` and `xyce-7-structural` are versioned profiles over
the same grammar with lossless fixtures in `fixtures/spice-vendors/`; neither
evaluates vendor semantics.

Profiles may be selected explicitly. Auto mode: `.backanno`, `.wave` or
`.netlist` → LTspice; else analysis-qualified `.print`/`.measure`
(`tran`/`dc`/`ac`) → Xyce; else `.control`, `.func`, conditionals or
ngspice-only dot commands → `ngspice-46-core`; else `spice3f5-core`. The
profile and its evidence are reported (also in the IR) and never change
parsing or elaboration. New dialect work adds a versioned profile or matrix
revision; it never silently changes `ngspice-46-core`.

## Expressions and elaboration

- Official T/G/Meg/K/mil/m/u/n/p/f/a scale factors; raw expressions stay
  authoritative.
- An independent V or I source's card tail is split into the fields a Canvas
  source keeps: `dc`, `acMagnitude`/`acPhase`, and `waveform` (`pulse`, `sin`,
  `pwl`) with its arguments, so its value label shows the DC value, not the
  card. A plain DC value stays `dc` alone, with no waveform. A tail that fits
  no field (EXP, a PULSE with defaulted arguments, a parameter reference)
  stays whole as written. The SCS import reaches the same fields through its
  SPICE conversion; the export prints them as the same card. A bounded evaluator handles conditions; an unevaluable
  condition excludes all its branches with a warning.
- Identifiers match case-insensitively, keeping display spelling and order.
  Ports and terminals are contiguous and zero-based.
- Known X masters bind to cells; unknown ones stay opaque with positional
  pins. Families keep terminal order per the matrix.
- Nets are cell-scoped; `0` and `.global` names are global. Roots are cells
  no bound subcircuit calls.
- A `K` card of two inductors of its cell imports as a Document coupling named
  as the card (text as k, each inductor dotted at its first node's pin).
  Other counts, missing/repeated inductors or an already-coupled pair are
  skipped with `SPICE_IMPORT_COUPLING_SKIPPED`.
- No device simulation, analyses or control commands are executed.

Diagnostics have a stable code (distinct prefixes for source, syntax, bind,
import), severity, message and optional spans. Include errors, malformed
recognized statements, duplicate definitions or invalid hierarchy prevent a
successful result; other issues may recover with warnings.

Only the source manifest, Document source bindings, instance source
references, raw instance properties and imported connectivity persist.
