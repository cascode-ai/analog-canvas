# Netlist dialect conversion

Status: accepted
Primary owner: `packages/spice`

## Runtime integration

`convertNetlist` is a pure TypeScript adaptation of netlist-crawler's MIT
structural translator. The Worker and Vite development server expose the same
`POST /api/netlist/convert` protocol. Editor SCS import calls that core directly
so importing local files also works offline. No additional service, Python
process, account or simulator is involved. Existing canonical SPICE/Spectre
export printers remain the authority for authored circuit exports.

The request is a JSON object:

```json
{
  "text": "R1 in out 1k",
  "source": "spice",
  "target": "spectre",
  "fragment": true
}
```

`source` and `target` accept `spice`, `ngspice`, or `spectre`. SPICE/ngspice are
syntax aliases in this subset. Success returns HTTP 200 with `status: converted`,
`text`, `source`, `target`, and `issues`. Unsupported input returns HTTP 422,
`status: blocked`, and diagnostics with the original `line`, `statement`, `code`,
and `message`; no partial translated text is returned. Invalid JSON/envelopes,
methods and media types use 400, 405 and 415. Input text is limited to 512 KiB,
10,000 non-comment statements; the JSON wire body is limited to 1 MiB. Size
violations return 413. Responses are `no-store`; no input is stored or executed.

The default is a structural fragment. `fragment: false` recognizes the first
physical line of a SPICE source as its simulator title, and appends `.end` to
SPICE output if absent. Conversion is not a simulator validation or a complete
SPICE/Spectre language implementation.

## Preserved subset

- Ideal two-terminal R/C/L; conventional M/D/Q models; declared or external X
  subcircuits; linear four-node E/G controlled sources.
- Ordered subcircuit interfaces, globals, scalar parameter assignments and
  common arithmetic expressions. Optional Spectre port parentheses are removed
  for SPICE. Numeric suffixes are converted explicitly: Spectre `M` is mega,
  SPICE `M` is milli. Node case aliases that would change meaning are rejected.
- Independent DC and AC sources, complete PULSE and PWL waveforms, and SIN
  waveforms including damping and phase. Missing values or unhandled extras
  cause diagnostics rather than invented values or dropped parameters.
- Simple OP, single-source DC, AC and transient statements. Nested sweeps,
  measurement scripts, options and simulator-specific behavioral expressions
  are outside the native conversion subset.
- Quoted local include paths are retained without opening them. A SPICE model
  or library declaration remains in a `simulator lang=spice` section when
  producing SCS. This does not translate model equations or qualify a library
  for a different simulator. Existing SPICE-language sections in SCS are retained
  as SPICE, including their control text when the target is SPICE.

Native Spectre instance names normally acquire the SPICE device prefix if
needed; collisions block conversion. Declared subcircuits and reviewed SKY130
wrappers use X even when the original name begins with M. Undeclared M/D/Q
references follow conventional model designators. Other external masters need an
explicit X reference or a subcircuit declaration, so unsupported native primitives
are not silently rewritten as subcircuit calls.
The converter does not invent model cards, map arbitrary PDK aliases, infer
physical geometry or search a server's filesystem.

Native conversion of `.control`, unsupported device parameters, native Spectre
model equations, UIC semantics and arbitrary simulator functions is blocked.
SPICE language wrapping never claims to make ngspice control scripts executable
by Spectre. SCS output has not been qualified with licensed Cadence Spectre.

## Import boundary

The File menu accepts `.scs` alongside existing SPICE entries. UTF-8 SCS and
recognizable native Spectre local include files are converted without changing
the original bytes. Include resolution, resource bounds, Project validation and
placement continue through the existing SPICE importer. Unsupported source or
unresolved dependencies leave the active Project unchanged. As with ordinary
SPICE import, this constructs the circuit; it does not retain a complete
simulation deck as attached source. Simulation source folders serve that purpose.

The complete upstream CLI is not embedded. Attribution and the MIT license
are under `packages/spice/third-party/netlist-crawler/`; the conversion source
also carries the license notice for bundled distributions.
