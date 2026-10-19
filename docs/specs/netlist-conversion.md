# Netlist dialect conversion

Status: accepted
Primary owner: `packages/spice`

`convertNetlist` is a pure TypeScript port of netlist-crawler's MIT structural
translator (license and attribution in
`packages/spice/third-party/netlist-crawler/`, also carried in the source for
bundles). The Worker and Vite dev server expose `POST /api/netlist/convert`;
editor SCS import calls the core directly so it works offline. No other
service, process, account or simulator. Canonical SPICE/Spectre export
printers stay the authority for authored exports.

## Protocol

Request `{ text, source, target, fragment }`; `source`/`target` are `spice`,
`ngspice` (alias) or `spectre`.

- 200 `{ status: "converted", text, source, target, issues }`.
- 422 `{ status: "blocked", diagnostics }` with original `line`, `statement`,
  `code`, `message`; no partial text.
- 400 invalid JSON/envelope, 405 method, 415 media type, 413 size: text ≤
  512 KiB and 10,000 non-comment statements, body ≤ 1 MiB.
- Responses `no-store`; input is never stored or executed.
- Default is a fragment. `fragment: false` treats a SPICE source's first
  physical line as its title and appends `.end` to SPICE output if absent.
  Conversion is not simulator validation.

## Preserved subset

- Ideal R/C/L; conventional M/D/Q; declared or external X; linear four-node
  E/G; DC/AC sources, complete PULSE/PWL, SIN with damping and phase; simple
  OP, single-source DC, AC, TRAN. Missing or extra values are diagnostics,
  never invented or dropped. Nested sweeps, measurements, options and
  behavioral expressions are outside the subset.
- Ordered subcircuit interfaces, globals, scalar parameters, common
  arithmetic; Spectre port parentheses are dropped for SPICE. Suffixes are
  explicit (Spectre `M` = mega, SPICE `M` = milli). Reading Spectre, a number
  keeps its digits and its suffix (`96u`, `1p`, `1.50k` stay as written, so
  a value label reads as drawn), spelled as SPICE reads it: Spectre `M`
  (mega) becomes `Meg`, `K` becomes `k`, `m` (milli) stays `m`. Spectre's atto
  (`a`) has no SPICE suffix, so that number is written out as a plain
  exponent (`1a` as `1e-18`). SPICE→Spectre writes plain decimals.
  Meaning-changing node case aliases are rejected; SPICE→Spectre also rejects
  case-mismatched calls, closing names, parameter references and known formal
  overrides (local/global scope; overrides in the caller's scope). Owned model
  conversion checks the helper closure, returning a located refusal without
  replacing the source.
- Quoted local includes are kept unopened. SPICE model/library declarations go
  in a `simulator lang=spice` section for SCS (no translation or
  qualification); existing SPICE sections stay SPICE.
- Spectre's name escapes are read, since SPICE has none: `Vin\+` is the net
  `Vin+`, `D\<3\>` the bus bit `D<3>`, in node lists, instance, subcircuit
  and port names alike, so the import names a Cell Pin and its Net as the
  drawing does, and the SCS export writes the escapes back. Quoted text
  (paths, strings) is untouched, as is a backslash before a space, a
  parenthesis, a brace, a quote or another backslash, which escapes no name.
  SPICE→Spectre does not add escapes.
- Spectre instance names gain the SPICE prefix if needed (collisions block);
  declared subcircuits and reviewed SKY130 wrappers use X even when named M…;
  undeclared M/D/Q follow model designators; other masters need an explicit X
  or declaration.
- Never invents model cards, maps PDK aliases, infers geometry or searches the
  server. Blocked: `.control`, unsupported device parameters, Spectre model
  equations, UIC, arbitrary simulator functions. SCS output is not qualified
  with licensed Spectre.

## Import boundary

File → Open accepts `.scs` beside SPICE. UTF-8 SCS and recognizable Spectre
local includes are converted without changing original bytes, then go through
the existing SPICE importer (includes, bounds, validation, placement).
Unsupported source or unresolved dependencies leave the Project unchanged.
Import builds the circuit only; simulation decks belong in source folders.
