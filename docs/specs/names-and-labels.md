# Electrical Names and Label Display

Status: `accepted`

Primary owner: `packages/model` (label typography), `apps/editor` (text
editing and placement), `packages/edit-engine` (rename transactions)

## Scope

Every canvas label that shows an electrical name: a device Reference
(`instance-reference` binding), a Cell Pin name (`cell-terminal-name`,
including its projection onto a parent block pin), a Net label and a supply
label (VDD Power, drawn rail). Parameter values, drafting text, formulas and
Symbol body text are outside this contract.

## Contract

### Two facts, stored separately

- The **electrical name** is `Instance.reference`, a Cell terminal `name` or a
  Net name claim. It is authored text, stored exactly as typed, connected or
  generated. Netlists, simulation and Agents read only this.
- The **label display** is the label's own `formatOverride` (Project Code
  `format`): RichText saying how the name is drawn. It is presentation only
  and is never read back into a name.

### The one relation between them

A stored display must spell its name: its visible characters equal the name,
or equal it with one `_` omitted at the start of a subscript (the historical
identifier encoding). The schema refuses any other stored display.

### Standard looks

Labels whose look follows from what they label, never from guessing at a
spelling, are created with a stored standard look:

| Role                                                                  | Names                          | Stored look                                      |
| --------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------ |
| Supply (VDD Power, drawn rail)                                        | `V` followed by letters/digits | Italic `V`, upright subscript rest: V_DD, V_DDH  |
| Device Reference                                                      | letters followed by digits     | Italic letters, upright subscript index: M₁, R₁₂ |
| Cell Pin name the editor generated (`Vinp`, `Vinn`, `Vout`, `VB1`, …) | `V` followed by letters/digits | Italic `V`, upright subscript rest: V_inp        |

Any other spelling (`AVDD`, `MTAIL`, `RL`, `M_1`) gets no standard look, and a
name the user typed for a Pin or Net is shown as written. A stored standard
look is recognised by comparing its styled characters with the standard look
of the label's current name; only a label still carrying it is treated as a
default. An author's own format always wins and is never replaced by a
default.

### Labels without a stored display

A bound label with no `formatOverride` is drawn by the historical rule: a bold
italic name in which `_` starts a subscript and a trailing `_bar` draws an
overbar, subject to the drawing's `labels` settings. This rule is kept so
existing drawings keep their look; it is display only and never changes a
name.

Existing Gallery drawings are moved to stored standard looks by an
administrator maintenance pass
([Community Gallery](community-gallery.md#administration)). It changes only
unformatted supply and device Reference labels, may nudge a restyled label a
few grid units clear of its neighbours, and refuses any change to an
electrical name or netlist. Pin labels keep the historical rule, because an
older drawing cannot tell a generated Pin name from a typed one.

### Editing

- Changing the visible characters renames the object exactly as typed:
  nothing is inserted, removed or re-cased. Characters the old look hid, such
  as an underscore before a subscript or a trailing `_bar` under an overbar,
  stay where they were around the edit.
- Changing only styling (subscript, superscript, slant, weight, overbar) never
  renames. If a styling change leaves a hidden character with nothing to hide
  it, that character is shown again rather than dropped from the name.
- A label still carrying its standard look is regenerated for its new name
  after a text edit or any rename (Properties, netlist code, Agent, clipboard);
  a new spelling without a standard form returns the label to the historical
  rule. An authored format keeps its styling around the new text.
- Placing a Cell Pin, Net label or supply never alters the name it is given.
- The explicit whole-drawing `labels` action in document Properties is the one
  remaining operation that may change names (subscript case, and turning on
  the first-letter convention); it is undoable.

### Netlist

Netlists print electrical names verbatim. Obligations of an export format,
such as SPICE instance prefixes, escaping and refusals, are applied only
inside that export and are never written back to a name.

### Examples

| Name    | Label              | Drawn as                          | Netlist |
| ------- | ------------------ | --------------------------------- | ------- |
| `VDD`   | VDD Power          | V_DD                              | `VDD`   |
| `VDDH`  | VDD Power          | V_DDH                             | `VDDH`  |
| `AVDD`  | VDD Power          | AVDD                              | `AVDD`  |
| `M1`    | device             | M₁                                | `M1`    |
| `MTAIL` | device             | MTAIL                             | `MTAIL` |
| `CLK1`  | typed Pin          | CLK1; subscripting 1 keeps `CLK1` | `CLK1`  |
| `V_ref` | Pin without format | V with subscript ref              | `V_ref` |
| `D_bar` | Pin without format | D with an overbar                 | `D_bar` |

## Design rationale

The same drawing can come from different names (`VIN` and `V_IN` can both be
drawn as V with subscript IN), and one name can be drawn in several ways
(`CLK1` or CLK₁). Inferring either from the other is guessing, so neither is
derived from the other: the name is authored, the display is stored, and the
only link is the spelling check above. Standard looks are stored at creation
rather than computed at render time so that a later rule change never
redraws a drawing its author has already seen.

## Evidence

- `packages/model/src/label-typography.test.ts`: standard looks, role
  recognition, rename following and restored hidden characters.
- `packages/edit-engine/src/standard-label-look.test.ts` and
  `packages/edit-engine/src/net-name-operation-planner.test.ts`: rails, Cell
  Pin, claim, marker and device renames keep stored looks valid.
- `apps/editor/src/features/text-editing/text-editing.test.ts`: verbatim text
  renames, styling that never renames, and hidden-character splicing.
- `worker/gallery.test.ts` (label-look maintenance): a dry run writes
  nothing; an apply needs the checked content, keeps names, netlists and
  history, and leaves nothing for a second pass.
- `apps/editor/e2e/component-insert.spec.ts` and
  `apps/editor/e2e/manual-editor.spec.ts`: placed supplies in their standard
  look and verbatim canvas renames.

Custom display text that differs from its name (for example Q′ for `Q_prime`),
one-click formatting presets, and a literal default for typed names are not
yet provided.
