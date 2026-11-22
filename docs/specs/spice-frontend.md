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
- Every non-comment logical statement of a reachable file has exactly one
  fate in the statement ledger (`statementLedger`): instance, definition,
  declaration, preserved, unresolved or refused. A native Spectre file is
  accounted by its own lines. The ledger is recomputed from the sources, never
  persisted; a statement without a fate, or given two, leaves coverage
  unknown, never complete. A design the conversion refuses lists each refused
  statement where it is. Each import reports it as `SPICE_IMPORT_COVERAGE`:
  each fate's count and where statements went unresolved or were refused (a
  warning when any did).
- `.include`, `.incpslt` and `.lib file section` share one sandboxed resolver:
  relative to the including file; root-escaping paths denied; missing targets
  and cycles are errors; repeats suppressed; unreachable files excluded; no
  network or simulator search paths. `.lib` elaborates only the named section
  (all text kept).
- An absolute, drive-qualified or URL path names an external library (a
  foundry's models): kept as written, never read, a located warning
  (`SPICE_SOURCE_INCLUDE_EXTERNAL`). A model it would define has no card in
  the sources, so its device type comes from the caller.
- A device naming a model no card declares records `importProvenance.status`
  `missing`; a type from the caller or an exact
  [ICS55 or GPDK045 MOS binding](netlist-export.md#process-configuration) supplies its
  symbol. A source declaration takes precedence, followed by a caller-supplied type. With no
  type, a D card is the diode its letter says, and an M, Q or J card comes in
  as a Project component box of its family (pins in SPICE's order, the card's
  letter, a required model) that prints as the card it was; no name decides
  n or p. `SPICE_IMPORT_UNTYPED_DEVICE` names them and asks for the defining
  library (or, from a caller that gives types, a type of the part's family),
  never a card.
- A part whose model or master its sources do not define keeps each
  parameter name as written (Spectre reads `AS` and `as` as two), except the
  names its device type defines (`w`, `l`, `nf`, `m` of a MOS), which read as
  the device's own. Every other part's names read case-insensitively.
- A part with more than 128 terminals, an external call setting more than 128
  parameters, or a Cell declaring more than 128 is refused by name and line
  (`SPICE_IMPORT_LIMIT`).

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
  SPICE conversion; the export prints them as the same card.
- A bounded evaluator handles conditions. A reachable condition it cannot
  evaluate excludes all its branches with a warning and marks them
  unresolved: the devices they add are unknown, not absent, so a structural
  comparison leaves topology inconclusive whether or not it compares
  declarations.
- A value or parameter the import rewrites keeps its meaning: exported in its
  dialect, it compiles to what the source compiled to, and imports again to
  the same Instances, values and connections. A rewrite that cannot show this
  is not made.
- Identifiers match case-insensitively, keeping display spelling and order.
  Ports and terminals are contiguous and zero-based.
- Known X masters bind to cells; unknown ones stay opaque with positional
  pins. Families keep terminal order per the matrix.
- A D, J or Q card's one number after its model (`Q1 c b e qmod 8`) is its
  `area`, as SPICE reads it, unless the card also names `area`; any other
  tail after a model stays whole as written.
- Nets are cell-scoped; `0` and `.global` names are global. A `.global` name a
  subcircuit also takes as a port is the supply that port states, one node.
  Roots are cells no bound subcircuit calls.
- A `K` card of two inductors of its cell imports as a Document coupling named
  as the card (text as k, each inductor dotted at its first node's pin); one
  converted from Spectre is named as Spectre wrote it (`TF1`, not `KTF1`).
  Other counts, missing/repeated inductors or an already-coupled pair are
  skipped with `SPICE_IMPORT_COUPLING_SKIPPED`.
- A subcircuit that is a body Analog Canvas writes itself (an op-amp's, a
  comparator's, a logic gate's, an ideal block's, a crystal's, a
  potentiometer's, a unijunction's, a PUT's, a Shockley diode's) imports as no
  Cell; each call of it imports as the built-in block that writes it, bound
  as a placed block is, with the call's parameters as written and an adder's signs from
  the body's name. A body is told from an author's subcircuit of its name by
  printing it again with the ports its definition lists and comparing every
  statement (`findBuiltInBodies` in `@icm/netlist`); any other statement
  leaves it a Cell. Recognition belongs to the active declaration's file and
  line, including after Spectre conversion. Unreferenced files and inactive
  definitions cannot authorize replacement of another definition.
  A supply the body does not read stays unbound where the
  call passes `0`, as an unbound one exports, and a ground no pin then
  reaches goes too. A native Spectre body found so reaches the converter
  without its statements, so its behavioral sources never need converting.
- The chopper's and SPDT's bodies are such bodies: a call of one imports as
  that part, clocked by the phase its label names, a label naming the node
  the call passes as its clock.
- An `S` card naming Analog Canvas's ideal switch (its model card exactly as
  Analog Canvas prints it; in Spectre, the ideal switch each Cell defines)
  imports as the switch with a CTRL pin, on the card's control node. Every
  switch Analog Canvas draws prints that card, whether the phase its label
  names or its CTRL pin closes it, so each comes back with a CTRL pin (an
  RNL drawing says which it was). The node the card reads its control
  against is the Cell's ground: a node other than `0`, a subcircuit's ground
  pin, takes a ground claim. Any other `S` card imports as the
  voltage-controlled switch bound to its model, as the catalog maps `S`.
  When a model name has both custom and built-in active definitions, all
  calls retain ordinary model bindings instead of sharing a built-in mapping.
  Spectre has each Cell define the ideal switch again, which the converter
  refuses, so those definitions reach it as one empty one; a card it names
  `XS1` keeps the reference `S1`.
- No device simulation, analyses or control commands are executed.

Diagnostics have a stable code (distinct prefixes for source, syntax, bind,
import), severity, message and optional spans. Include errors, malformed
recognized statements, duplicate definitions or invalid hierarchy prevent a
successful result; other issues may recover with warnings.

Only the source manifest, Document source bindings, instance source
references, raw instance properties and imported connectivity persist.
