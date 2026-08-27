# Project File Compatibility

The released Project schema version is `27`. It retains schematic-only
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
and are grouped only by the read-only formal interface projection. A canonical
v25 file can be opened, saved, reopened, and saved again without byte drift.

Schema v24 is accepted through a bounded upgrade to v25. The upgrade splits
every previous multi-marker terminal into independent singleton declarations,
rebinds marker-owned annotations, and preserves existing Net/Route/Junction
topology. The next save writes v25. The original file is never overwritten
silently. Schema v23 and older, and versions newer than v25, are rejected.

The canonical-current corpus at
[`fixtures/projects/compatibility-corpus.json`](../../fixtures/projects/compatibility-corpus.json)
lists every shipped Project fixture. It distinguishes byte-stable accepted
files from named rejected inputs. Previous-version compatibility uses a
focused synthetic regression instead of retaining historic Project assets.
Retired fields such as first-class
`Document.ports`, `Net.ports`, `spice.*`, and `routeAttachment` are invalid.

An incompatible Project is rejected before it can replace the current browser
Project. Conversion, when needed, is an explicit external operation that must
produce and validate a complete v25 candidate before a human chooses to load it.

The editor never silently merges duplicate canonical Ground (`0`) or VDD Nets.
Duplicate folded Net names are invalid and remain diagnostics until the author
explicitly corrects the Project.

Viewport, selection, canvas overlays, import compiler state, Agent session
credentials, and recovery envelopes are not part of the Project file. Browser
recovery is a non-authoritative safety copy kept in this browser's IndexedDB:
at most two recent working copies, each with a current and a previous
generation, each copy at most 4 MB and 12 MB in total. It does not survive
explicitly clearing site data. Use **File / Save Project** for the portable
editable Project; saving or downloading a Project never deletes the browser
recovery copies.
