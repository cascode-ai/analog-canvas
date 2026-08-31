# Project File Compatibility

The released Project schema version is `33`. It retains schematic-only
hierarchy integrity, a Project structural revision, stable formal Cell ports,
and definition-level Cell symbol presentation. It also has one typed Instance
netlist authority, formal Cell parameters, and Project-local external
subcircuit definitions with stable ordered terminal identities and directions.
Every ordinary Instance has one RichText schematic label, initially derived
from its internal schematic or netlist reference until the user edits it. A
Cell Pin is identified by its own stable terminal identity and displays its
Port Name, such as `Vout`; `port` and `port-filled` are only hollow and filled
artwork variants for that independent interface declaration.
Its bound annotation may persist same-text RichText formatting but cannot store
a divergent alias. Equal Port Names remain independent in the saved drawing
and are grouped only by the read-only formal interface projection. Drafting
text may also carry one of three polarity-label forms while its editable RichText
content remains independent from the fixed vector marks. Annotations and
drafting objects position at 1-unit integer precision, while Instance
placements, route bends, and Junctions stay aligned to the Document grid. An
Instance may carry an optional `styleOverride` with independent foreground and
background colors; when absent, document style defaults remain authoritative.
Each Annotation may independently carry an optional presentation-only
`textColor`. An instance reference or value with Automatic text color inherits
its owning Instance foreground; other annotations inherit the document
foreground. Drafting text keeps its separate drawing-object color override.
An Instance may also carry optional schematic-only `signalFlowParameters`
(`formula`, `coefficient`, `bodyWidth`, `bodyHeight`) that are independent from
netlist/SPICE parameters. Width and height are optional 10-unit-grid minimums:
the shared Transfer Function renderer expands beyond them when 12-unit formula
text, a fraction, or a coefficient needs more room, and never clips or shrinks
the formula to satisfy an undersized request. A canonical v33 file can be
opened, saved, reopened, and saved again without byte drift.

Schemas v24 through v32 are accepted through the explicit chained upgrades.
Schema v32 adds optional `Annotation.textColor`; schema v33 removes the
ownerless `explicit-equivalence` record. A v32 file without that record changes
only its version stamp. A file containing it is rejected at the exact evidence
path because the editor cannot safely guess whether the intended replacement
was a wire, Label, Alias, or hierarchy terminal. The original file is never
overwritten silently. Schemas older than v24 and versions newer than v33 are
rejected by the project-file boundary.

The canonical-current corpus at
[`fixtures/projects/compatibility-corpus.json`](../../fixtures/projects/compatibility-corpus.json)
lists every shipped Project fixture. It distinguishes byte-stable accepted
files from named rejected inputs. Previous-version compatibility uses a
focused synthetic regression instead of retaining historic Project assets.
Retired fields such as first-class
`Document.ports`, `Net.ports`, `spice.*`, and `routeAttachment` are invalid.

An incompatible Project is rejected before it can replace the current browser
Project. Conversion, when needed, is an explicit external operation that must
produce and validate a complete v33 candidate before a human chooses to load it.

The editor never silently merges duplicate canonical Ground (`0`) or VDD Nets.
Duplicate folded Net names are invalid and remain diagnostics until the author
explicitly corrects the Project.

Viewport, selection, canvas overlays, import compiler state, Agent session
credentials, and recovery envelopes are not part of the Project file. Browser
recovery is a non-authoritative safety copy kept in this browser's IndexedDB:
at most two recent working copies, each with a current and a previous
generation, each copy at most 4 MB and 12 MB in total. It does not survive
explicitly clearing site data. Use **File / Save** for the formal Cloud Project
and **Export Project File…** for portable bytes. A direct backup download is
shown when recovery storage fails. These operations do not delete browser
recovery copies.
