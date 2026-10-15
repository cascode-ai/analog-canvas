# Symbol DSL

Status: `accepted`

Primary owner: `packages/symbols`

Electrical pins, reviewed vector geometry and visual variants, independent of
runtime. The [component definitions](../../packages/components/README.md) own
artwork, electrical facts and catalog eligibility; `@icm/symbols` and
`@icm/devices` are generated projections; [Razavi](razavi-visual-contract.md)
owns visual authority.

## Rules

- Resolution is exact by canonical ID; no aliases or compatibility libraries.
  `SymbolResolver.resolve(symbolId, variantId?)` returns the definition with
  the requested or default variant, or `undefined`; it never substitutes.
  Catalog tests prove every advertised asset resolves and retired IDs fail.
- A variant may hide named pins or parts and add reviewed primitives; it never
  adds, deletes, reconnects or renames electrical pins. Hidden pins keep
  membership but leave snap, flightline and formal-pin presentation.
- `port`, `port-filled`, `vdd-port` have one pin `P`; naming and interface
  follow the [schematic model](schematic-model.md). `nmos`/`pmos` keep D/G/S/B;
  default variant `textbook-3terminal` may hide bulk and never implies `B=S`;
  no `nmos3`/`pmos3`.
- Primitives: line, polyline, polygon, circle, path. Pins carry unique name,
  role, anchor, direction, visibility. Anchors lie on the 2-unit electrical
  lattice (ordinary symbols on the 10-unit grid); artwork may be decimal.
  Razavi assets use semantic stroke roles, no raw widths.
- An off-lattice auxiliary/variant contact needs `routing.preferredLanding`,
  outward and grid-aligned (behind or transverse is rejected); runtime
  resolves contact and landing as one `EndpointConnection`; no Route escape is
  persisted.
- Geometry holds no placement, Net, model or label authority. The
  `electrical` section owns class, prefix, pin order, target policy,
  parameters, dialects and capabilities; pin parity is enforced across
  projections. PDK mappings name an exact symbol, terminal count and ordered
  pins; none is inferred from model spelling.
- Instances keep exact Symbol and variant IDs; Projects capture definitions,
  which override the shipped catalog (a catalog update never repairs
  captured artwork).
- Signed amplifier strokes sit beside their named pins, derived from semantic
  pins and verified separately.

## Source-backed custom artwork

- A component may use `circuitBinding` instead of `electrical`, `subcircuit`
  or `generatedFrom`: `definitionId` selects the external owner; `terminals`
  maps each stable native `terminalId` to one graphical `pinName` or to the
  `VDD`/`VSS` property supply. Every terminal and pin is accounted for exactly
  once. An exact same-name interface may initialize the mapping at Apply;
  renamed or incomplete ones need explicit mapping.
- Native source owns target, port order and defaults; graphical names,
  labels and pin order never override them or name parent Nets. Resolution
  projects mapped pins onto formal names for endpoints, routes, No Connects
  and X calls; variants and auxiliary contacts follow without new terminals.
- An external definition's optional `symbolId` picks artwork for new
  placements; existing occurrences keep their captured IDs. Apply may select
  callers and capture a new ID atomically, never overwrite a captured ID with
  changed artwork. Geometry and mode changes use route-follow or refuse.
- Reorder and explicit rename keep terminal IDs; rename changes logical and
  routed endpoint names, not the captured graphical name. Removal uses the
  terminal lifecycle planner (wires stay at detached Junctions, its No
  Connects go); custom captures fork only affected contacts and migrate
  occurrences in the same transaction. Adding a port to custom artwork
  refuses until mapping is repaired or callers choose automatic artwork.
  Compatible parameter overrides survive. Source, interface, artwork and
  wiring validate together before a new revision reaches copy, export or
  simulation.

## Component authoring

- Circuit and Symbol are views of one candidate (default Circuit): native
  source owns the interface, JSON the artwork, `circuitBinding` alone maps
  contacts. Unknown, duplicate or missing correspondences refuse Apply.
  Formal direction (input/output/inout/passive) is separate from geometric
  side and JSON roles (gate/bulk); direction edits keep roles and mode.
  Customize symbol captures generated artwork before exceptional mapping;
  returning to Automatic is explicit with the dirty-change safeguard. Display
  name edits change `symbol.name`, not the source entry.
- Invalid artwork stays a draft (source and directions stay editable); stale
  previews are labelled and never applied.
- `apply_model_source.definitions[].authoring` (GUI and Agent): `symbolMode`,
  optional `artworkText`/`artworkOrigin`, formal-name-keyed
  `terminalDirections`, optional complete `pinMap` (`{pinName}` or
  `{supply: "VDD" | "VSS"}`). Automatic rejects artwork and mappings; cannot
  coexist with compiled `symbol`/`terminalDirections` on one target; a
  supplied `pinMap` is complete, not a patch; missing directions keep owner
  metadata; omitted Custom artwork keeps the existing capture (creation needs
  it); a mode change resets to Automatic. `authoringDefinitionIds` default to
  the explicitly supplied targets; other shared-source entries keep their
  drafts at the new revision. Transient input, no parallel fact store.
- Save draft keeps the whole candidate, invalid text included, apart from
  applied facts. Local Apply and Place need no account and never publish;
  Place applies pending changes first. Interface-only definitions refuse
  execution.
- Public-library editing uses an isolated snapshot in the Project's
  non-executable drafts at its fixed library revision, never replacing
  drawing captures; destination and write rules are in
  [publication](component-publication.md).
- Discovery derives capability from the validated definition (**Symbol
  only**, **Needs repair**, **Not applied**; none certifies an engine).
  Invalid historical records stay visible but unplaceable and never block
  valid ones; summaries carry no executable source; selection
  re-reads the full record and checks its revision.
- The GUI loads every summary automatically, displays arrivals progressively,
  and retains bounded public-list caches for the Editor session. Refresh,
  publication and account changes invalidate them; interrupted public loads
  resume at their remaining page. Previews load near the visible area. The
  Agent/HTTP cursor interface remains paginated.
- GUI placement uses the Agent insert planner: capture, instance and
  annotations commit together; cancel leaves nothing; one Undo; the snapshot
  never advances to newer cloud content.

## Public circuit snapshots

Payload: `definition` (raw artwork, checked `circuitBinding`) plus
`circuit: { version: 1, externalDefinition, source }` selecting an applied
`ProjectModelSource` entry; only the applied version publishes; only
reachable owned files are packaged; third-party dependencies keep IDs, mount
paths and SHA-256. The Component Library Durable Object keeps one current row
per entry (`components` table; the revision is a concurrency guard, not an
archive). Insertion captures source, owner and artwork via dependency-copy
planning (no cloud lookup), reuses equivalent resources and refuses
incompatible ones first; later public changes never alter captures.

## Explicit legacy repair

- A noncanonical interface-only component is not an implementation; its
  `subcircuit.target` never selects a same-name source. Built-in block
  contracts keep their generated bodies; reusing a built-in Symbol ID inherits
  nothing. Unrepaired declarations load and place, but netlist copy and
  execution require repair.
- Repair maps legacy terminals to stable IDs on a placeholder owner (never a
  synthesized body) or on a selected applied owner with an explicit
  one-to-one correspondence; scope is the selected class or one occurrence;
  removed connected contacts need explicit disconnect-and-keep-wires. The new
  capture has `circuitBinding` and no legacy `subcircuit`. Preview mutates
  nothing; Apply is atomic; stale or invalid repairs refuse; Undo restores.
