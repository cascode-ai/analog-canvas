# Hierarchy and Electrical Authoring

Status: `accepted`

Owners: `packages/model`, `packages/edit-engine`, `packages/netlist`

## Decision

Keep typed electrical intent distinct from display text and imported syntax.
[Schematic model](../specs/schematic-model.md) owns identity, interfaces and
presentation; [netlist export](../specs/netlist-export.md) owns extraction,
reference policy and dialect output.

## Context

Manually drawn and imported circuits must export consistently. Reusing a Cell,
naming a device, showing a formula and invoking an external library are different
authoring actions, even when they share artwork.

## Rationale

A child Document is a reusable definition, while each caller is an occurrence.
Independent Cell-Pin declarations preserve editing identity; deriving the formal
interface avoids physically merging markers merely because their names match.
A definition-level symbol can change appearance without becoming another
electrical interface.

An external library declaration supplies an ordered interface. With the accepted
[Issue #1401](https://github.com/cascode-ai/analog-canvas/issues/1401), an authored
external circuit instead binds its interface to a Project-owned native model
source. GUI and Agent Apply use the same boundary; export, mapped edits and
simulation consume that source rather than maintaining parallel bodies. Keeping
the native text preserves expressions and behavioral models without introducing
an incomplete schematic representation of their implementation. Stable master
and terminal IDs preserve call relationships during explicit interface migration.
Library interfaces and unimplemented placeholders remain distinct; missing model
knowledge is never inferred from artwork.

Explicit interface migration keeps compatible custom artwork. A changed custom
pin name creates an immutable captured artwork variant, retargets the affected
callers and maps their logical and routed endpoints in the same Project
transaction. Stable terminal IDs remain the electrical identity; a captured
symbol is presentation, not another model body or ordered interface. Editing an
existing captured ID to different content is refused. Generated blocks continue
to derive from the definition. The shared caller planner serves internal Cells
and external circuits; the Project resolver, connectivity, rendering and netlist
consumers all resolve the resulting instance symbol through that same capture.
Replacing custom artwork with a generic block would move existing wire contacts;
keeping the old pin names would split the drawn and electrical interfaces.

One authored Instance Reference gives copy, rename and export one collision
policy. Custom annotation text remains presentation: matching spelling is not
an instruction to resume following the electrical name.

A validated transient export IR lets dialect printers share naming, pin order
and hierarchy checks. Import IR preserves source syntax and uncertainty; it is
not the edited design's authority. Patching source text or printing independently
from the Project in each dialect would split that authority again. Simulation
adds explicit experiment intent to the electrical projection rather than
requiring the structural exporter to invent a testbench.
