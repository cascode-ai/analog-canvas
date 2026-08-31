# Project File Compatibility

The released Project schema version is `35`. It retains schematic-only
hierarchy integrity, a Project structural revision, stable formal Cell ports,
and definition-level Cell symbol presentation. It also has one typed Instance
netlist authority, formal Cell parameters, and Project-local external
subcircuit definitions with stable ordered terminal identities and directions.
Every ordinary Instance has at most one authored `reference`; an emitting
Instance requires it, displays it through a live `instance-reference`
Annotation, and emits the same token. Descriptive attached RichText is an
ordinary literal Annotation with no identity or emission authority. A
Cell Pin is identified by its own stable terminal identity and displays its
Port Name, such as `Vout`; `port` and `port-filled` are only hollow and filled
artwork variants for that independent interface declaration.
Its bound annotation may persist same-text RichText formatting but cannot store
a divergent alias. Equal Port Names remain separate physical Base Nets in the
saved drawing but resolve into the same Logical Net. Drafting
text may also carry one of three polarity-label forms while its editable RichText
content remains independent from the fixed vector marks. Annotations and
drafting objects position at 1-unit integer precision, while Instance
placements, route bends, and Junctions stay aligned to the Document grid. An
Instance may carry an optional `styleOverride` with independent foreground and
background colors; when absent, document style defaults remain authoritative.
Each Annotation may independently carry an optional presentation-only
`textColor`. An Instance Reference or value with Automatic text color inherits
its owning Instance foreground; other annotations inherit the document
foreground. Drafting text keeps its separate drawing-object color override.
An Instance may also carry optional schematic-only `signalFlowParameters`
(`formula`, `coefficient`, `bodyWidth`, `bodyHeight`) that are independent from
netlist/SPICE parameters. Width and height are optional 10-unit-grid minimums:
the shared Transfer Function renderer expands beyond them when 12-unit formula
text, a fraction, or a coefficient needs more room, and never clips or shrinks
the formula to satisfy an undersized request. A canonical v34 file can be
opened, saved, reopened, and saved again without byte drift.

Schemas v24 through v33 are accepted through the explicit chained upgrades.
Schema v32 adds optional `Annotation.textColor`; schema v33 removes the
ownerless `explicit-equivalence` record. A v32 file without that record changes
only its version stamp. A file containing it is rejected at the exact evidence
path because the editor cannot safely guess whether the intended replacement
was a wire, Label, Alias, or hierarchy terminal. Schema v34 retires the hidden
`explicit-net-property` naming owner. Source-backed local names become
non-electrical round-trip hints, explicit SPICE globals retain declaration
authority, and visible power objects become the owner where one already exists.
The original file is never overwritten silently. Schemas older than v24 and
versions newer than v34 are rejected by the project-file boundary.

The canonical-current corpus at
[`fixtures/projects/compatibility-corpus.json`](../../fixtures/projects/compatibility-corpus.json)
lists every shipped Project fixture. It distinguishes byte-stable accepted
files from named rejected inputs. Previous-version compatibility uses a
focused synthetic regression instead of retaining historic Project assets.
Retired fields such as first-class
`Document.ports`, `Net.ports`, `spice.*`, and `routeAttachment` are invalid.

An incompatible Project is rejected before it can replace the current browser
Project. Conversion, when needed, is an explicit external operation that must
produce and validate a complete v34 candidate before a human chooses to load it.

Equal visible Label, Port, power-marker, and explicit global-declaration names
resolve to one Logical Net without erasing their separate Base Net identities.
Imported or legacy source-name hints never trigger that union, so composing two
Documents cannot create an invisible connection merely because both sources
used a local spelling such as `OUT`.

Viewport, selection, canvas overlays, import compiler state, Agent session
credentials, and recovery envelopes are not part of the Project file. Browser
recovery is a non-authoritative safety copy kept in this browser's IndexedDB:
at most two recent working copies, each with a current and a previous
generation, each copy at most 4 MB and 12 MB in total. It does not survive
explicitly clearing site data. Use **File / Save** for the formal Cloud Project
and **Export Project File…** for portable bytes. A direct backup download is
shown when recovery storage fails. These operations do not delete browser
recovery copies.
