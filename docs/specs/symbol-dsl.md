# Symbol DSL

Status: `accepted`

Primary owner: `packages/symbols`

The Symbol DSL defines runtime-independent electrical pins, reviewed vector
geometry, and visual variants. Runtime resolution is exact by canonical asset
ID; symbol aliases and compatibility libraries do not exist.

## Current product assets

The canonical [component definitions](../../packages/components/README.md)
own artwork, electrical facts and catalog eligibility. Runtime `@icm/symbols`
and `@icm/devices` are generated projections. The ordered catalog, rather than
a duplicated list here, declares reviewed Razavi and Extended Devices entries.

`port`, `port-filled` and `vdd-port` are single-terminal assets with pin `P`.
Cell Pin and Bias Voltage Port author formal interface terminals. VDD Power
does so by default, with an explicit Global mode using an owned naming claim
instead. A drawn Power Rail remains ordinary Net/Route geometry and is a
separate authoring gesture. Naming and interface behavior follow
[the schematic model](schematic-model.md); geometry supplies no Net authority.

Canonical `nmos` and `pmos` retain D/G/S/B electrical pins. Their
`textbook-3terminal` visual variant is the deterministic default and may hide
bulk presentation without deleting the B electrical terminal. Separate
`nmos3`/`pmos3` assets do not exist.

## Resolution and variants

`SymbolResolver.resolve(symbolId, variantId?)` returns the exact validated
definition and either the requested variant or the definition's declared
default. Unknown asset or variant IDs return `undefined`; resolution never
substitutes a different pin order or asset.

A visual variant may hide named pin presentation or named primitive parts and
add reviewed presentation primitives. It cannot add, delete, reconnect, or
rename electrical pins. Selecting `textbook-3terminal` never implies `B=S`.

## Geometry and style

Primitives are line, polyline, polygon, circle, and path. Pins carry stable
name, electrical role, anchor, direction, and visibility metadata. Pin anchors
lie on the shared 2-unit electrical lattice; ordinary symbols continue to use
the 10-unit placement grid. Artwork may use finite decimal
coordinates. Razavi assets use semantic stroke roles resolved through the
Document style profile. Raw per-asset compatibility widths are not accepted.

A reviewed auxiliary/variant pin contact may be off its authored connection
lattice only when its `routing` metadata declares an outward, grid-aligned
`preferredLanding`.
Registration rejects a landing behind or transverse to the pin direction.
Runtime resolves the exact contact and the landing as one
`EndpointConnection`; the Symbol never persists a Document Route escape.

## Invariants

- Symbol IDs and pin names are unique.
- Every hidden pin or primitive part names an existing member.
- Hidden or implicit pins retain electrical membership while disappearing from
  visible snap/flightline/formal-pin presentation.
- Geometry contains no placement, Net, model, or reference-label authority.
- PDK mappings name an exact canonical symbol, terminal count, and full ordered
  pin list; no mapping is inferred from model spelling alone.
- The component's `electrical` section owns class, reference prefix, pin order,
  target policy, parameters, dialects and capabilities; `@icm/devices` projects
  these facts. The symbol projection owns artwork and anchors. Pin parity is
  enforced across those generated consumers.

The application ships the compiled catalog. Instances retain exact Symbol and
optional variant IDs; portable Projects capture the definitions they use.
Project-owned definitions take precedence over the current compiled catalog,
so a catalog update alone does not repair previously captured artwork.
Generated catalog tests prove every advertised asset resolves and that retired
IDs and aliases fail.

For signed amplifier families, positive and negative strokes must appear beside
the corresponding named input/output pins. Family generation derives their
positions from semantic pins, and registration verifies the strokes separately.
This presentation rule does not grant artwork electrical authority.

## Source-backed custom artwork

A Project component may use `circuitBinding` instead of `electrical`,
`subcircuit` or `generatedFrom`. Its `definitionId` selects an external model
owner; `terminals` maps each stable native `terminalId` to one graphical
`pinName`, or explicitly to the existing `VDD`/`VSS` property supply mechanism.
Every formal terminal and graphical pin must be accounted for exactly once.
A complete, exact same-name interface can initialize this checked mapping at
Apply; renamed or incomplete interfaces need an explicit mapping.

The native source owns the target, formal port order and parameter defaults.
Graphical names, display labels and pin array order do not override them or name
parent Nets. Runtime symbol resolution projects mapped graphical pins onto the
formal names used by ordinary endpoints, routes, No Connects and X invocations.
Variants and auxiliary contacts follow this projection without gaining a new
logical terminal. An implicit supply remains an electrical member; its existing
property-binding rules still apply.

An external definition's optional `symbolId` selects artwork for new placement.
Existing occurrences retain their captured IDs. Native Apply can select callers
explicitly and capture a new ID atomically with the source and mapping. It cannot
overwrite a captured ID with changed artwork. Geometry changes and mode switches
use the existing route-follow authority, or refuse without changing the Project.

Native interface edits retain stable terminal IDs for reordering and explicit
renaming. A rename changes ordinary logical and routed endpoint names, while
the captured graphical name and its mapping remain intact. An explicit removal
uses the existing terminal lifecycle planner: incident wires remain at detached
Junctions and No Connects on the removed terminal disappear. Custom captures fork
only the removed mapped contacts and variant contacts; the preferred capture and
affected occurrences migrate in the same Project transaction. Unaffected artwork
remains unchanged, and Undo retains the preceding complete capture.

Adding a formal port to custom artwork requires complete correspondence. Apply
refuses until the JSON/mapping is repaired or the affected caller explicitly
chooses compatible automatic artwork. Body/default edits preserve compatible
occurrence parameter overrides. Source, interface, artwork and wiring changes
are validated together before any new applied revision becomes visible to
copy, export or simulation preparation.

## Public circuit snapshots

User Components publishes the same native facts as a Project. A complete public
payload contains `definition` (raw artwork and checked `circuitBinding`) and
`circuit: { version: 1, externalDefinition, source }`. The external definition
selects an applied `ProjectModelSource` entry. Native text remains the authority
for the target, formal port order and defaults; the package adds no library-only
electrical declaration. Source drafts and pending artwork must be applied before
public Save. Only reachable owned files are packaged; declared third-party
dependencies retain their explicit IDs, relative mount paths and SHA-256 digests.

The public Component Library Durable Object stores one current record per entry
in its `components` table. Its numeric revision is a concurrency guard, not a
retrievable archive. Primitive/artwork-only and legacy definitions keep their
existing readable form. New source-backed records carry the versioned native
resources alongside that definition. Author/admin, official/deleted and stale
revision rules apply to both forms.

Opening a public native record edits an isolated Project snapshot through the
ordinary model Apply transaction. It cannot modify the active drawing. Public
Save is distinct from Apply and explicitly states that everyone can insert a
copy. Insertion captures the selected applied source, external owner and checked
artwork into the destination Project through ordinary dependency-copy planning;
the placed instance has an external-subcircuit binding, not a cloud lookup.
Equivalent applied resources can be reused while each occurrence retains its
own reference and parameter overrides. Incompatible bodies, dependencies or
same-revision artwork/mappings refuse before changing the Project.

Portable and formal Project saves, Undo/Redo and cross-project copy retain these
captures. Partial copying cuts unselected external Nets under the shared copy
rules. Later public updates, deletion or network failure do not change captured
implementations. Copied/exported netlists and qualified simulation preparation
resolve the applied Project source and its helper closure; declaring a model
does not qualify arbitrary syntax, dependencies or electrical behavior for an
execution environment.

## Explicit legacy repair

A noncanonical interface-only User Component is not an implementation. Its
`subcircuit.target` cannot silently select a same-name Project source. Canonical
built-in block contracts retain their existing reviewed generated bodies.
An inherited built-in black-box contract retains its descriptor identity and
complete graphical/property contact membership and directions. Formal aliases,
order and retargeting remain authorable; calls to generated bodies still require
their fixed positional interface. A local definition merely reusing a built-in
Symbol ID does not inherit that contract or escape explicit repair.
An older occurrence without an explicit binding still has only its legacy
interface declaration and requires the same repair.
Unresolved custom declarations remain loadable and placeable, but copying a
usable design netlist or preparing execution requires an explicit repair.

The User Components repair entrance initializes a virtual placeholder owner and
maps the legacy graphical/property terminals to stable native terminal IDs. It
never synthesizes a circuit body. User-supplied source follows ordinary native
Apply, including explicit connected-port migration and shared mapping checks.
Alternatively, selecting an applied Project owner by ID requires an explicit
complete one-to-one correspondence and captures the selected applied resources
through ordinary copy planning; destination drafts and existing callers remain
unchanged. No ownership is inferred from a target name.

Only occurrences of the explicitly selected captured class are migrated.
Ordinary symbol/binding transactions preserve compatible contacts, routes, Nets,
references, parameters and selected symbol variants. The new capture has
`circuitBinding` without a competing legacy `subcircuit` declaration. Preview
alone does not mutate the
Project. Apply commits the source, owner, artwork and callers atomically; stale
or invalid repairs refuse, and Project Undo restores the pre-repair evidence.

Public legacy repair runs in an isolated Project snapshot and uses the same
versioned package as native creation. Public Save is a separate deliberate
author/admin update or another contributor's fork. The Durable Object retains
one current row with a numeric revision; earlier embedded Project captures are
independent, not floating references or an archived public revision history.
