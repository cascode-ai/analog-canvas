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
- 422 `{ status: "blocked", issues }` with original `line`, `statement`,
  `code`, `message`; no partial text.
- 400 invalid JSON/envelope, 405 method, 415 media type, 413 size: text ≤
  512 KiB and 10,000 non-comment statements, body ≤ 1 MiB; 500 a converter
  failure.
- The editor's local import converts the user's own files whole, with neither
  limit: the limits protect the endpoint, not the conversion.
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
  qualification); existing SPICE sections stay SPICE. The editor's import
  reads each SPICE section as its own SPICE file, its bytes as written, and
  leaves it out of the size and statement limits; the endpoint counts it.
- Native export stand-ins read as SPICE models: `bsim4 type=n|p` as
  `nmos|pmos level=54`, `bjt type=npn|pnp` with `is`, `bf`, `vaf`, and
  `diode` with `is`, `n`. The bipolar and diode mappings cover only these
  classical parameters, with the same units; other native model options
  are rejected. This is structural interchange, not simulator qualification.
- The editor's import alone also reads a foundry's native MOS card the
  converter does not translate (`bsim3v3`, `psp103`, `bsimsoi` and the
  other listed kinds) as no card: its instances, and a binned `nch.1`'s
  group `nch`, take the device type of its `type=n|p` (refused without
  one), the card stays out of the converted text, and the import warns
  `SPICE_CONVERSION_MODEL_EXTERNAL`. The endpoint still refuses it.
- Spectre's name escapes are read, since SPICE has none: `Vin\+` is the net
  `Vin+`, `D\<3\>` the bus bit `D<3>`, in node lists, instance, subcircuit
  and port names alike, so the import names a Cell Pin and its Net as the
  drawing does, and the SCS export writes the escapes back. Quoted text
  (paths, strings) is untouched, as is a backslash before a space, a
  parenthesis, a brace, a quote or another backslash, which escapes no name.
  SPICE→Spectre does not add escapes.
- Spectre instance names gain the SPICE prefix if needed (collisions block);
  declared subcircuits and reviewed SKY130 wrappers use X even when named M….
  At the endpoint, undeclared M/D/Q follow model designators and other
  masters need an explicit X or declaration.
- The editor's import reads a design whole (#2294):
  - Every file's declarations (subcircuits, models by designator) outside a
    library section or in a section some include selects, and a caller's
    device types, classify every file's calls; a card in an unselected section
    declares and types nothing.
  - Exact [ICS55 and GPDK045 MOS names](netlist-export.md#process-configuration) with no
    overriding declaration or explicit call binding identify four-terminal MOS devices.
    Any other unrecognized master is a call of it, whatever its instance's first
    letter, keeping ordered ports, parameters as written and its Spectre name
    as the Reference; `SPICE_IMPORT_EXTERNAL_CALLS` names each such master.
  - In a call of such a master, a value outside the common arithmetic stays as
    written, with a finding; any other part's still refuses.
  - Analyses, options, `save`/`ic`/`nodeset` and `ahdl_include` stay out of the
    drawing (an analysis the subset has still converts); Spectre `section`
    reads as SPICE's `.lib`/`.endl`.
  - Every refusal of every file is listed with its location (the endpoint
    still answers its first). Names Spectre tells apart only by case across
    files (subcircuits, models, file-level parameters, `vdd!`/`VDD!`), and
    one master called with two port counts, are refused before conversion.
- Never invents model cards, maps PDK aliases, infers geometry or searches the
  server. Blocked: `.control`, unsupported device parameters, Spectre model
  equations, UIC, arbitrary simulator functions. SCS output is not qualified
  with licensed Spectre.

## Import boundary

File → Open accepts `.scs` beside SPICE. UTF-8 SCS and recognizable Spectre
local includes are converted without changing original bytes, then go through
the existing SPICE importer (includes, bounds, validation, placement).
File → Open, an Agent's staging and local circuit, RNL import and a review's
reference all read through one import entry (`importNetlistSources`), differing
only in the evidence they bring. Unsupported source or unresolved dependencies
leave the Project unchanged. Import builds the circuit only; simulation decks
belong in source folders.
