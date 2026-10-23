# Drawing a schematic

For drawing or redrawing a schematic from a figure, paper or netlist, and for
reviewing how one looks. Tool calls and edit mechanics are in
[authoring](shared/authoring.md); this page says what a good drawing is.

## Done means three things

1. **Connected right.**
   - Before placing, write the reference as structural SPICE: MOS in `D G S B` order, the
     named ports, and a name for every node the source names.
   - After drawing, run `verify` with `expectedNetlist` and `details:true` until
     `topology: "equal"`.
   - `port-order` and `binding` differences can be harmless. Skip them with
     `compare:{portOrder:false,bindings:false}`, or name them in the report.
2. **Compact and legible.** Use the targets in [Compact layout](#compact-layout),
   with room for every rendered label. Connectivity and clearance take priority over
   packing density.
3. **Reads like the source.** The render passes [Review the render](#review-the-render).

A drawing that only matches its netlist is not done.

## Source first

- The figure decides placement, orientation, signal flow, names and printed text. The
  netlist decides connectivity. When they disagree, follow the netlist: keep the figure's
  arrangement and draw the extra parts beside it.
- Measure the figure in device pitches, starting at one device pitch = 60 grid units.
  Preserve its grouping and proportions; widen a crowded local gap for labels or routing
  clearance instead of stretching the whole drawing.
- A block the figure draws as a symbol (op-amp, comparator) but the netlist gives as
  transistors is drawn either way:
  - as a Cell placed where the symbol is;
  - flat, beside the main drawing, joined by Net labels.
- With no figure (netlist only): main signal path left to right, positive rail above, ground
  or the negative rail below, repeated sequences in tap order, and a visible supply name.

## Compact layout

- **Pitch** (a MOS or BJT symbol is 40 tall):

  | Between | Spacing |
  | --- | --- |
  | Parts stacked on one node | 60 (a 20-unit S–D wire) |
  | Parts side by side in a row | 60–80 |
  | Differential-pair halves | 80–120 |
  | Stage to stage | 100–140 |
  | Ports, Net labels, names | 20–40 from their pin |
  | Ground | 30 below its terminal |
  | Supply rail | 30–40 above the top row |

- **Supplies:** one rail fed by one marker or Port, unless the source draws a marker per
  part. Put the marker's connection point on an explicitly connected rail tap or short
  feed wire; a detached `VDD` symbol above the drawing is not a visible supply connection.
  Rail geometry and printed names alone do not join pins. Inspect Net membership and
  exported supply-pin connections, preserving the reference's distinct supply and ground
  Nets. See [Cell Pins and supplies](shared/authoring.md#cell-pins-and-supplies).
- **Clearance:** reserve the complete rendered text box, including subscripts. Keep at
  least 10 grid units clear of unrelated wires, symbols and other text; aim for 20 beside
  supply rails. Move a label to a clear side or widen the local pitch in 10–20-unit steps
  until it fits. Do not shrink text or add a long label lead to meet a pitch target.
- **Long wires:** feedback and long returns run 30–40 outside the outermost part, never
  around an empty frame.
- **Unshown circuitry:** parts the source does not show (bias, a block's transistors) sit
  80–120 from the drawing, packed the same way.
- **Self-check** (targets from human-drawn Gallery circuits): area per part ≤ 10,000 grid²
  and nearest neighbour ≤ 55. Area per part is the bounding box of the part origins, plus 80
  on each axis, divided by the parts; Cells count separately. Also avoid a strip longer than
  3.5 times its width.
- **Compacting a loose drawing:** move whole areas with one selection `transform` so their
  internal wires come along. Redraw the few wires between areas instead of leaving
  stretched loops. If it is badly spread, redrawing is usually faster.

## Structures

Textbook defaults, chosen from actual pins and Nets. They are visual defaults, not
electrical evidence. Apply only the matching topology, and never rewire to fit a row.

| Structure | Layout | Wiring |
| --- | --- | --- |
| Differential pair | Local left/right symmetry; corresponding pins aligned | Shared tail: T-join |
| Folded-cascode input stage | Input pair beside two adjacent main branches; see [Folded-cascode input stages](#folded-cascode-input-stages) | Preserve each input drain's own folding-node connection |
| Current mirror | Adjacent branches; reference gate faces inward toward output gates | Common-gate line where clear; reference local closure |
| Common-source stage | Gate toward input; drain toward output | Direct signal path |
| Common-gate stage | Stacked along its branch | Branch connection; bias from the side |
| Tail current source | Below an NMOS input pair | Centred drop to the shared tail |
| Transmission gate | NMOS and PMOS form one parallel switch group; refs outside the group | Shared signal endpoints; separate complementary-control leads |
| Compensation network | Beside the stages it spans | Separate return corridor |

| Wiring shape | Use |
| --- | --- |
| Direct | Short Port leads; matching inputs get equal leads; no detour through another group |
| T-join | Local shared node, e.g. short tail crossbar with centred drop |
| Trunk + taps | A clear aligned pin row for common control; a separate spine only when needed |
| Local closure | Short reference/diode connection beside its owner |
| Separate return | Feedback/compensation corridor apart from the forward path |
| Body tie | Dashed body wire by `via`: a stub out of the channel, then the shortest path to the target Net or a Junction on it |

Plan branched Nets whole: spine, taps, exits; branches get Junctions. Bound Net labels may
replace distant wires.

## Folded-cascode input stages

Use this layout when the connectivity identifies a differential input pair feeding
folded branches, and the task supplies no placement reference or explicitly asks for
relayout. Otherwise [Source first](#source-first) takes precedence. A differential pair
alone does not identify a folded-cascode stage.

**Keep symmetry within the input pair, not by centring it between the two main
branches.** The pair is one group to the side; the two stacked branches are a second,
compact group. This is a readability preference, not a test of electrical correctness.

### Place the groups

1. **Identify roles from connectivity.** Locate the input pair and its shared bias
   source, the two folded branches, their folding nodes, and any following output stage.
   Trace each input drain to its actual folding node before moving anything. Device
   names in the examples are illustrative, not a role-detection rule.
2. **Keep the input pair together, normally on the left.** Align the pair's corresponding
   pins and keep its shared source connection and bias source local. For a PMOS input
   pair, the bias source is normally above; the complementary NMOS arrangement normally
   has it below. Place the pair near the height of the folding nodes so its drain leads
   enter the branches from the side. "Outside" means the whole pair beside the main
   branches, not one input transistor on each outer edge of the circuit.
3. **Place the two main stacks side by side.** Align corresponding devices and folding
   nodes at matching heights, with room for readable labels and short shared-control
   connections. Use the pitches in [Compact layout](#compact-layout). Neither the input
   pair nor an unrelated bias column belongs in the gap between these stacks.
4. **Route the fold explicitly.** Connect each input drain to its own folding node with
   short orthogonal routes where practical. Use separate routing lanes or matching bound
   Net labels where direct wiring would cross unrelated devices. Alignment does not imply
   a shared Net: do not merge the two folding nodes or swap input/output polarity.
5. **Take outputs from the actual output nodes.** A fully differential folded core can
   end at two nodes within the stacks; draw short output leads there. Add a separate
   output stage only if the netlist contains one. Place its compensation beside the
   stages it spans and bias generation at the periphery.

### Recommended and non-recommended examples

Both drawings show the same eleven-device PMOS-input example: ten transistors and
one current source. Body connections are omitted from the illustration; retain every
body connection in the actual circuit. Names describe this example only.

| Role | Devices and connections |
| --- | --- |
| Input pair | PMOS `M6/M7`; gates `Vinp/Vinn`; shared sources fed by `Iss` from `VDD` |
| Main stacks, top to bottom | `M2-M4-M10-M8` and `M3-M5-M11-M9` |
| PMOS loads | `M2/M3` share `VB4`; `M4/M5` share `VB3` |
| NMOS branches | `M10/M11` share `VB2`; `M8/M9` share `VB1` |
| Folding nodes | `M6.D -> M10.S/M8.D`; separately `M7.D -> M11.S/M9.D` |
| Outputs | `Voutp = M4.D/M10.D`; `Voutn = M5.D/M11.D` |

**Recommended: the whole input pair sits left of the adjacent stacks, near their
folding nodes.** The PMOS input drains feed the lower part of the core; the outputs
are above those folding nodes, between the PMOS loads and NMOS common-gate devices.

```text
                            VDD
                         M2     M3       <- VB4
                         M4     M5       <- VB3
                       Voutp   Voutn
      Iss                M10    M11      <- VB2
    M6   M7           fold A   fold B
    drains: M6 -> fold A, M7 -> fold B
                         M8     M9       <- VB1
                            VSS
```

The text sketch shows placement, not wire crossings. In the connected drawing below,
dots mark junctions and the wire hop is a crossing without a connection. `VB1`–`VB4`
each label an existing shared gate wire once, without an extra vertical stem or open
circle. Keep the top bias label clear of `VDD` and the bottom one clear of the ground
region; use [Bias and control labels](#bias-and-control-labels) when space is tight.

![Recommended PMOS-input folded-cascode schematic: M6 and M7 on the left feed two
distinct lower folding nodes of adjacent stacks; outputs leave the middle of the
stacks.](assets/folded-cascode-recommended.svg)

**Not recommended in this example: the input group splits the main stacks.**

```text
Main branch A             Input group              Main branch B
M2-M4-M10-M8              M6 / M7 + Iss             M3-M5-M11-M9
<----------------------- split main group --------------------->
```

![Non-recommended folded-cascode placement: input pair inserted between widely separated
main stacks.](assets/folded-cascode-not-recommended.svg)

The second arrangement can still be connected correctly; it makes the two related
stacks harder to read together and can lengthen their shared-control wiring. In the
render review, check that the pair remains recognisable, the stacks read as one group,
and both folding-node connections remain distinct and traceable. For NMOS-input or
multi-stage variants, derive the corresponding nodes from their own netlists instead
of copying these device numbers or blindly reflecting this drawing. Connectivity
checks and visual review are separate requirements.

## Names and text

The editor typesets names itself: `M1` → M₁, `VB1` → V_B1, `vin` → v_in, `φ1` → φ₁.

- **Device references:** the source's names (M1, C2, Q3), within the
  [Reference rules](shared/authoring.md#place-and-name). Parts it does not name continue the
  numbering. Never use generated or netlist names such as `MM3_2`, `RRF` or `net1005`; they
  typeset wrongly.
- **Ports and Net labels:**
  - the source's text, as plain text ([labels](shared/authoring.md#labels-and-text));
  - drop function arguments such as `(t)`;
  - a Net the source leaves unnamed but that needs a label gets a short name (`VB1`, `VX`).
- **Equations and notes** printed beside the circuit: annotations with a math run, near the
  same spot.
- **Values and W/L:** in a new drawing, show them only when the source does. In a user's own
  drawing, keep default attached labels, manual positions, formatting and values unless
  asked; never erase values.

### Bias and control labels

- **Local bias:** on an already connected common-gate wire, place one bound Net label
  beside its clear middle or end. `VB1`–`VB4` need no extra branch just to hold their text.
  Retain declared external Ports; when one is required, use a short side entry rather
  than a vertical stem toward a supply rail. Do not create extra Ports for internal bias
  names.
- **Distant connections:** use matching bound Net labels on short pin stubs at each
  disconnected drawing endpoint. Repetition is needed there, not along one continuous
  wire. Keep distinct Nets distinct and attach each label to its actual Net, not as free
  text. See [Wiring](shared/authoring.md#wiring).
- **Transmission-gate controls:** reserve separate space for device references and
  `track`/`trackb`, `reset`/`resetb` or clock labels. Put refs on the outside of their own
  devices and control names beside their own short leads; align corresponding labels
  across repeated switches. Keep complementary controls distinct. When a reset pair or
  neighbouring gate crowds those names, widen the group spacing using the clearance rule,
  rather than packing several refs and control names into the same gap.

## Review the render

Render and look at the full drawing and each dense group at a readable scale before
reporting:
- label boxes, including subscripts, meet the clearance rule, especially near both rails;
- shared bias wires have only the labels and leads they need;
- every supply marker visibly feeds its intended network, with Net membership checked
  separately from appearance;
- transmission-gate refs and complementary-control labels are distinct and readable;
- no overlapping parts, or wire through a symbol or an unrelated pin;
- names typeset like the source;
- the source's arrangement is recognisable at a glance;
- nothing is parked far away.

Fix what you see and re-render, at most two rounds. If a collision or supply-connection
ambiguity remains, report it as unresolved rather than calling the drawing finished.
