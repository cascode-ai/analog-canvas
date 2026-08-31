# SPICE Frontend

Status: `accepted`

Primary owner: `packages/spice`

## Purpose

Define the source-preserving boundary that turns selected SPICE-family files
into typed statements, diagnostics, and transient Circuit IR without making
the parser or filesystem part of the persistent Project model.

## Consumers

- browser and Node source adapters
- SPICE elaborator
- Schematic importer
- current-corpus and later dialect-conformance tests

## SourceBundle contract

A `SourceBundle` has one normalized relative entry path, the reachable source
files, include dependencies, syntax files, and diagnostics. Each source file
retains its original bytes' SHA-256 digest, detected UTF encoding, exact decoded
text, stable file ID, and normalized relative path.

The pure adapter accepts an explicit set of virtual files. The Node adapter may
collect files below the entry directory before invoking the same pure adapter.
The browser editor supplies all user-selected files to the pure adapter. Source
selection is therefore separate from parsing and does not expose a parser API
to the persistent model.

## Lossless and source-location rules

- Exact decoded source text is retained and can be returned byte-for-text,
  including LF/CRLF choice, blank lines, comments, and continuation spelling.
- Every non-comment logical statement retains its exact physical slice,
  physical line numbers, and a half-open offset span with one-based line and
  column positions.
- A leading `+` or a preceding line ending in two backslashes joins a SPICE
  continuation to the preceding logical statement.
- Top-level whitespace splitting respects quotes, parentheses, and braces.
- Inline `$`, `;`, and `//` comments are ignored for typed projection only;
  source text and raw statement text remain unchanged.
- Unrecognized or malformed non-comment statements become opaque statements
  and emit a source-located diagnostic. They are never silently discarded.

## Include policy

Quoted or unquoted local relative `.include`, `.incpslt`, and `.lib file
section` targets use the same sandboxed resolver.

- paths are resolved relative to the including file;
- absolute, URL, drive-qualified, and root-escaping paths are denied;
- missing targets and include cycles are errors;
- repeated includes are recorded and suppressed deterministically;
- files not reachable from the entry remain outside the resulting bundle;
- parsing never performs network access.

For `.lib`, only the named `.lib section` through matching `.endl` content is
elaborated. All library text remains losslessly available. Configured simulator
search paths are not used or guessed.

## Compatibility profile

The accepted baseline is `ngspice-46-core`, defined by
[`ADR 0004`](../adr/0004-ngspice-46-core-structural-baseline.md) and the
[machine-readable matrix](../../fixtures/spice-baseline/ngspice-46-core.json).
The baseline is structural, not a promise of simulation equivalence.

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

XSPICE A devices, Verilog-A/OSDI N devices, XSPICE-specific U forms, CIDER,
and vendor translations remain opaque with warnings. They are preserved
exactly and do not block recognized surrounding circuit structure.

## Expressions and dialect evidence

Official T/G/Meg/K/mil/m/u/n/p/f/a scale factors are recognized. Raw
expressions remain authoritative. A bounded evaluator supports numeric,
arithmetic, relational, logical, and common scalar-function forms needed for
deterministic condition selection. If a condition cannot be evaluated, all of
its branches are excluded from Circuit IR and a warning is emitted; the source
is not guessed or repaired.

Callers may explicitly select `ngspice-46-core` or `spice3f5-core`. In auto
mode, `.control`, `.func`, conditionals, or ngspice-specific dot commands are
recorded as evidence for `ngspice-46-core`; otherwise the shared core is
classified as `spice3f5-core`.

## Elaboration rules

- SPICE identifiers are matched case-insensitively while display spelling and
  source order are retained.
- Cell ports and instance terminals are contiguous and zero-based in source
  order.
- Known X masters bind to subcircuit cells. Unknown X masters remain opaque
  targets with positional pins.
- Primitive, model-backed, transmission-line, and subcircuit families retain
  ordered terminals according to the compatibility matrix.
- Net identity is scoped to a cell. `0` and explicit `.global` names are global;
  other names are local.
- Root candidates are defined cells not called by another bound subcircuit.
- Parameters and models retain raw expressions. Bounded condition evaluation
  does not simulate devices or execute analyses/control commands.

## Diagnostics

Diagnostics have stable code, severity, message, optional source span, and
optional related spans. Source, syntax, bind, and import stages use distinct
code prefixes. An import may recover with warnings, but an include error,
malformed recognized statement, duplicate definition, or invalid hierarchy
prevents a successful result.

## Persistence boundary

Only the Project source manifest, Document source bindings, instance source
references, raw instance properties, and imported connectivity persist.
Source text, syntax files, Circuit IR, dependencies, and diagnostics remain
transient or test-fixture data.

## Deterministic validation

- exact-text and continuation tests;
- offset/line/column tests;
- missing, cycle, duplicate, and escape include tests;
- per-family typed statement tests;
- compatibility-matrix completeness tests;
- exact parse/print and no-silent-loss accounting;
- official scale-factor and conditional-expression tests;
- `.lib` section and control-block tests;
- deterministic fuzz termination/preservation tests;
- opaque-preservation assertions;
- hierarchy, terminal-order, parameter, and model tests;
- schema validation and connectivity goldens for every current netlist.

## Extension rule

Later dialect work must preserve this source and opaque behavior and add a new
versioned profile or explicit matrix revision rather than silently changing
`ngspice-46-core` interpretation.
