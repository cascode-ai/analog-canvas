# Circuit understanding and style knowledge

Owner: Agent reasoning. Strength: hard for preserving evidenced connectivity;
advisory for functional interpretation and visual expression. Trigger: before
placement, RouteGraph design, visual refinement, or acceptance of a formal
render.

This layer teaches the Agent how to turn electrical facts into a readable
textbook/Razavi-style view. It offers evidence and visual shapes, not a fixed
recipe or classifier.

## Keep four kinds of decision separate

1. **Electrical fact:** device pin and Net membership from the Snapshot/import.
2. **Functional interpretation:** likely inverter, differential pair, mirror,
   switch, storage node, bias path, or repeated cell, with counterevidence.
3. **Visible topology:** which real branch points, trunks, local labels, and
   boundaries best communicate those facts.
4. **Geometry:** coordinates, grid alignment, whitespace, and label placement.

Never change an electrical fact to simplify visible topology. Never ask the
geometry helper to recover a functional interpretation that the Agent omitted.

## Read the circuit

- Establish formal cell terminals, ordinary interface-marker Instances,
  supply/ground Nets, hierarchy, and source binding.
- Resolve device type, symbol variant, pin roles, body/bulk connection, model,
  and parameters before assigning function.
- Trace likely signal paths from input to output, then feedback, bias, clock,
  reset, common-mode, and protection paths.
- Identify shared terminals, diode-connected devices, stacks, cross-coupling,
  repeated branches, and parameter ratios.
- Test every pattern hypothesis against mismatched parameters, extra loads,
  unequal body connections, different controls, or asymmetric fanout.
- Use names as hints, never proof.

For unfamiliar or large circuits, load
[`knowledge/circuit-reading.md`](knowledge/circuit-reading.md). Keep the full
Document graph available while focusing on one electrically coherent region.

## Compose the page

- Prefer main signal flow from left to right.
- Put positive supply above and ground/negative supply below when it clarifies
  device operation.
- Keep bias, reset, and clock visually secondary but locally discoverable.
- Preserve local symmetry for truly matched/differential structures; do not
  force global symmetry over feedback or hierarchy.
- Reserve whitespace between functional neighborhoods and reserve explicit
  horizontal/vertical corridors before routing.
- Align repeated cells by semantic order such as bit, weight, stage, or tap.
- Use hierarchy when formal terminals tell a clearer story; use flat views when the user
  needs transistor-level inspection.
- In behavioral Signal Flow views, use the right-tapered transconductance block
  for signed `g_m` relations. Keep A-to-Y flow left-to-right and edit its formula
  rather than treating it as a transistor or an automatic SPICE mapping.

## Express nodes honestly

Use three visibly distinct concepts:

| Concept                               | Model object                          | Appearance |
| ------------------------------------- | ------------------------------------- | ---------- |
| Direction change only                 | transient `bend` folded into waypoint | no dot     |
| Real electrical branch                | explicit Junction with branch role    | dot        |
| Geometric crossing without connection | crossing Routes, no shared Junction   | no dot     |

Do not create a Junction for every waypoint. Do not rely on two overlapping
lines to imply a branch. A branch dot should answer “these conductors connect,”
not “the Agent needed a coordinate anchor.”

Prefer one shared branch point when several device terminals express one local
functional node. Two nearby dots connected by a tiny segment often make one
node look like two stages. Split them only when the spatial separation carries
real meaning.

## Remove bumps, hooks, and small boxes

A small bump is usually evidence of a bad visible graph, not merely a bad
coordinate. Inspect its cause before moving a waypoint:

- terminal escaped in the wrong direction and immediately reversed;
- two branch Junctions should have been one;
- a bend was persisted as a Junction;
- parallel paths duplicate the same Net span;
- separate terminal routes formed a small rectangle around one logical node;
- label anchor or trunk was placed inside an active wiring corridor;
- instance movement stretched a formerly clear Route into a hook.

Repair in this order:

1. confirm the electrical endpoints;
2. decide the one visible node/branch relation the reader should see;
3. simplify the RouteGraph topology;
4. then adjust grid coordinates and label positions;
5. inspect `resolvedRoutes` and the new render.

Do not hide a bump by removing a real connection, moving a dot off its branch,
or routing through a symbol.

## Local circuit expressions

These are preferred visual readings when supported by topology, not templates.

### CMOS inverter or complementary switch stage

- Place PMOS above NMOS with a clear local vertical relationship.
- Express the shared gate as one input branch/handoff, not two independent
  routes that form a box around the pair.
- Express joined drains as one output Junction when they are one electrical
  node.
- Keep source supply connections short and visually secondary.
- Put PMOS/NMOS instance labels outside the gate/drain corridor; repeated labels
  should have consistent positions.

### Differential input stage

- Present paired devices with comparable orientation and local wire length.
- Make the two input gates and the shared source/tail relation immediately
  visible.
- Keep output branches distinct and balanced until topology intentionally
  combines them.
- Place current-mirror or active loads above the pair when that exposes current
  flow, but do not fake symmetry when loads differ.

### Current mirror and cascode stack

- Make the shared control/gate Net obvious and keep the diode-connected
  reference branch readable.
- Align comparable devices and preserve stack order.
- Avoid long control wires that visually dominate the current paths.
- Distinguish reference and output branches through placement and labels rather
  than extra Junctions.

### Switched-capacitor and repeated arrays

- Treat each repeated cell as a readable local unit before adding common rails.
- Align units by bit/weight/order and keep exceptions next to the affected unit.
- Use a shared trunk only when a clear corridor exists and the continuous wire
  improves comprehension.
- Use labeled local islands for wide supply/control distribution when a trunk
  would cross cells or obscure signal structure.
- In an inverter-controlled switch cell, show the inverter output, shared
  switch gate, and bottom-plate node as separate functional nodes only when the
  topology actually distinguishes them.

### Cross-coupled or sequential structures

- Preserve feedback visibility; do not route both feedback directions through
  one indistinguishable bundle.
- Keep clock and complementary clock paths recognizable and secondary to state
  nodes.
- Use labels to bridge distant feedback only when both attachment points are
  unambiguous in the formal render.

Load the detailed evidence cards from `knowledge/patterns/` only after the
Snapshot supports the pattern.

## Choose a route-tree shape

Possible visible shapes include direct connection, local branch tree, shared
trunk/rail, labeled islands, and ordered repeated taps. They are a vocabulary,
not helper enums or a priority list. Read
[`knowledge/route-tree-shapes.md`](knowledge/route-tree-shapes.md), choose from
circuit evidence and available corridors, then express the chosen shape as an
explicit RouteGraph.

For each important multi-terminal Net, be able to state briefly:

- what relationship the chosen shape communicates;
- why its branch points are electrically real;
- why its trunk/labels are clearer than a plausible alternative;
- where it may cross or approach other geometry.

## Labels and text

- Keep instance names, values, Net labels, and power labels attached to their
  intended objects.
- Move text locally before disturbing a clear electrical arrangement.
- Keep labels out of terminal escape lanes, branch points, and narrow corridors.
- Use consistent label positions for repeated devices.
- Prefer one meaningful label on each intentionally disconnected local island;
  do not label every pin when one compact rail is clearer.
- A caption is not electrical connectivity. A label-based relation must attach
  to the relevant Net branch.
- Keep the semantic identifier human-readable, but provide canonical RichText
  AST `content` for every newly authored annotation. Represent subscripts and
  superscripts as span nodes; do not depend on underscore/string parsing at
  render time.

## Review the image, not only the metrics

Review at two scales.

Whole page:

- Can a reader find inputs, outputs, supply, ground, clocks, and main stages?
- Does placement expose signal flow, matching, hierarchy, and repetition?
- Are long trunks/labels helping rather than dominating?

Local region:

- Does each gate/mirror/pair/cell look like one functional unit?
- Are real branches marked once and bends dot-free?
- Are there unexplained stubs, bumps, hooks, tiny rectangles, or reversals?
- Do labels avoid devices and wiring corridors?
- Do terminal departures agree with symbol orientation?

Diagnostics provide evidence for this review but do not perform it. If a human
would need to trace pixels to discover a standard local relationship, revise
the Agent's visible topology even when structural checks are clean.
