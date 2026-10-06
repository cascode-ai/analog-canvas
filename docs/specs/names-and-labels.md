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

| Role                                             | Names                                                     | Stored look                                                             |
| ------------------------------------------------ | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| Supply (VDD Power, drawn rail)                   | `V` followed by letters/digits, then an optional + or −   | Italic `V`, upright subscript rest: V_DD, V_DDH                         |
| Device Reference starting with its device letter | the device's one-letter prefix followed by letters/digits | Italic letter, upright subscript rest: M₁, R₁₂, R_L1, C_L, R_FB, M_TAIL |
| Any other device Reference                       | letters followed by digits                                | Italic letters, upright subscript index: XU₀, OA₁                       |
| Voltage node (Cell Pin, Bias Voltage, Net label) | `V` followed by letters/digits, then an optional + or −   | Italic `V`, upright subscript rest: V_in, V_BP, V_casP, V_in+, V_bn−    |
| Current (Cell Pin, Net label)                    | `I` followed by letters/digits, except `IN…` and `IO`     | Italic `I`, upright subscript rest: I_out, I_REF, I₁                    |
| Greek-led name (any role above)                  | a Greek letter, then Latin letters/digits                 | Italic Greek letter, upright subscript rest: Φ₁, Φ_1pp, φ_S, ω₀         |

A clock phase is the usual Greek-led name. A difference such as `ΔV` and a run
of Greek such as `ΣΔ` read as one symbol, so they get no Greek-led look.

The look applies whether the name was typed, connected or generated. A device
letter is the one-letter Reference prefix a device declares (R, C, L, M, Q,
D, V, I, S, B); a subcircuit call's `X` names how SPICE invokes it rather than
what it is, so X-called parts and Blocks have none. Any other spelling
(`AVDD`, a MOS named `XBIAS`, `M_1`, `CLK`, a bare `V+`, an input such as
`IN`, `INP` or `INN`, an `IO` pin) gets no standard look and is shown as
written. A differential half keeps its sign in the subscript: `Vin-` is
drawn V_in−. A stored standard look is recognised by comparing its styled
characters with the standard look of the label's current name; only a
label still carrying it is treated as a default. An author's own format always
wins and is never replaced by a default: removing V_BP's subscript stores
`VBP` drawn flat as the author's look, which later renames keep.

### Labels without a stored display

A bound label with no `formatOverride` is drawn by the historical rule: a bold
italic name in which `_` starts a subscript and a trailing `_bar` draws an
overbar, subject to the drawing's `labels` settings. This rule is kept so
existing drawings keep their look; it is display only and never changes a
name.

### Scripts

Subscripts and superscripts are upright by default: in every standard look,
in the historical rule of any drawing made from now on (`labelSubscriptItalic`
is false), and when the editor applies Subscript or Superscript to italic
text, which never carries the italic into the script. An author may still
slant a script on purpose, by setting Italic inside it or choosing italic
subscripts for the whole drawing, and that choice is kept.

### Reset labels

The toolbar's Reset labels puts every unlocked label of a drawing back to its
standard look in one undoable edit, keeping where each label sits, its color
and whether it shows.

- Every label returns to the default size.
- A bound name takes its standard look. A name with no standard form keeps a
  display that writes more than italic and bold — a subscript, a bar, a case
  change — and sets letters over one subscript in the standard italic and
  bold; a display of italic and bold alone is dropped. Reset never turns a
  subscript back into plain text.
- A value loses any display of its own.
- A label written by hand keeps its characters and which of them are
  subscripts, and letters over one subscript take the standard italic and
  bold: a part's own words (a switch's Φ₁), a route marker's text, and a free
  label-type text that spells letters over one subscript (a V_icm beside a
  Pin). Such a free text also sheds its own size, weight and slant. Any other
  free text is not a label and is left as it is.

### Existing drawings

Existing Gallery drawings are moved to the standard by an administrator
maintenance pass ([Community Gallery](community-gallery.md#administration)).
It gives drawn supply, device Reference, Cell Pin and Net labels without a
look of their own their standard look, may nudge a restyled label a few grid
units clear of its neighbours or leave one that cannot stay as clear as it
was, sets `labelSubscriptItalic` to false in a drawing that never chose a
subscript slant, and refuses any change to an electrical name or netlist.
For drawings made before these standards, `legacyLooks` also gives a label
whose stored look only copies its historical look its standard look, and
straightens a script that took the surrounding italic along. It is not for
later drawings, where a slanted script is the author's choice.

### Editing

- Changing the visible characters renames the object exactly as typed:
  nothing is inserted, removed or re-cased. Characters the old look hid, such
  as an underscore before a subscript or a trailing `_bar` under an overbar,
  stay where they were around the edit.
- Changing only styling (subscript, superscript, slant, weight) never
  renames. If a styling change leaves a hidden character with nothing to hide
  it, that character is shown again rather than dropped from the name.
- An overbar over a Net or Cell Pin label is the one style that renames,
  because it means the complement: barring D names it `D_bar`, a signal apart
  from D, and taking the bar off gives D back. A device Reference's overbar
  stays styling. A label an older drawing barred without `_bar` in its name
  keeps that look until it is edited.
- A label still carrying its standard look is regenerated for its new name
  after a text edit or any rename (Properties, netlist code, Agent, clipboard);
  a new spelling without a standard form returns the label to the historical
  rule. An authored format keeps its styling around the new text.
- Placing a Cell Pin, Net label or supply never alters the name it is given.
- The explicit whole-drawing `labels` action in document Properties is the one
  remaining operation that may change names, and only their subscript case; it
  is undoable. Turning the first-letter convention on or off only changes how
  names are drawn: `Start` is shown as S with subscript tart and stays `Start`
  in the netlist, and a standard look (V_DD, M₁, V_in) is left as it is. New
  drawings start with it off.

### Netlist

Netlists print electrical names verbatim. Obligations of an export format,
such as SPICE instance prefixes, escaping and refusals, are applied only
inside that export and are never written back to a name.

Netlist formats read only ASCII names, so a Greek letter in a Net, Pin, device
or Cell name is written as its standard name in the letter's own case, a
small letter in small letters and a capital in capitals: `φ1` exports as
`phi1`, `Φ1` as `PHI1`, `σ` as `sigma` and `Σ` as `SIGMA`. The capitals that
look like Latin letters (`Α` is `ALPHA`) and omicron are named the same way,
as are the variant forms (`ς`, `ϕ`, `ϑ` …) and the micro and ohm signs
keyboards type for `μ` and `Ω`. The drawing and the stored name keep the letter. Two names that
become the same once written out, such as `φ1` and `phi1`, are refused rather
than merged. Parameter names are not rewritten, because values refer to them.
Hand-written ngspice simulation source follows the same rule when it runs,
and gives any other non-ASCII character `u` and its code point in hex:
`输入` runs as `u8f93u5165`, `né` as `nu00e9`. ngspice would otherwise read
each such byte as `_`, merging `输入` and `输出` into one node. The source text
keeps what was written, and two names that would run under one spelling
are refused.

In a Net or Pin name, the full-width letters, digits and punctuation an East
Asian input method types (`：`, `＜`, `Ａ`) are written as the ASCII
characters they stand for. A bus bit keeps its brackets in the drawing, in
the stored name and in Spectre, which escapes them (`DATA\<3\>`). ngspice
reads them in an element line, but its control language takes `<` and `>` as
redirection and `[ ]` as an index, so SPICE writes each bracket as `_`:
`DATA<3>` exports as `DATA_3_`, `BFT_h<7>` as `BFT_h_7_`. Two names that
become one spelling, such as `DATA<3>` and `DATA_3_`, are refused like `φ1`
and `phi1`.

### Examples

| Name    | Label              | Drawn as                                    | Netlist |
| ------- | ------------------ | ------------------------------------------- | ------- |
| `VDD`   | VDD Power          | V_DD                                        | `VDD`   |
| `VDDH`  | VDD Power          | V_DDH                                       | `VDDH`  |
| `AVDD`  | VDD Power          | AVDD                                        | `AVDD`  |
| `M1`    | device             | M₁                                          | `M1`    |
| `VBP`   | Bias Voltage Pin   | V_BP; turning the subscript off keeps `VBP` | `VBP`   |
| `φ1`    | Net label          | φ1, or φ₁ with the 1 subscripted            | `phi1`  |
| `D<3>`  | Net label          | D<3>                                        | `D_3_`  |
| `Vout`  | Net label          | V_out                                       | `Vout`  |
| `MTAIL` | device             | M_TAIL                                      | `MTAIL` |
| `RL1`   | resistor           | R_L1                                        | `RL1`   |
| `CLK1`  | typed Pin          | CLK1; subscripting 1 keeps `CLK1`           | `CLK1`  |
| `V_ref` | Pin without format | V with subscript ref                        | `V_ref` |
| `D_bar` | Pin without format | D with an overbar                           | `D_bar` |

## Design rationale

The same drawing can come from different names (`VIN` and `V_IN` can both be
drawn as V with subscript IN), and one name can be drawn in several ways
(`CLK1` or CLK₁). Inferring either from the other is guessing, so neither is
derived from the other: the name is authored, the display is stored, and the
only link is the spelling check above. Standard looks are stored at creation
rather than computed at render time so that a later rule change never
redraws a drawing its author has already seen.

## Evidence

### Refactor boundary (tracking issue #1213)

Default construction and edit policy are separate responsibilities. Preserve
the role exceptions above; two entry points applying the same exception must
share its RichText construction. In particular, new drafting identifiers and
route markers use the same upright power suffix as voltage labels. Explicit
stored italic scripts are not rewritten.

| Path | Current presentation authority |
| --- | --- |
| New Reference, Net/supply or Cell Pin label | Role-selected stored standard, otherwise drawing typography |
| Parameter value | Live parameter projection; a stored format is usable only while its text matches |
| Free Text or route marker | Stored RichText, initially generated from its creation rule |
| Instance alias | Stored literal RichText; no electrical identity is inferred from it |
| Cell Pin alias | Stored literal RichText that does not present the Pin's name; the parent pin draws it |
| Cell/master word | Whole-word presentation, not the device-reference splitting rule |
| Parent Cell pin | Projected child label content; explicit content bypasses generic pin typography |
| Label without a stored display | Historical drawing-typography fallback |

The current editing policy is intentionally retained: opening, applying and
renaming can identify an unchanged standard by styled-content equality and
regenerate it; an override equal to the fallback may be omitted. This is not
proof of user intent. Moving to defaults-once with authoritative user edits is
a deferred UX decision, not part of the structural refactor. Do not introduce
a new persistent default/custom flag to support this refactor.

Batch operations are explicit and distinct:

- **Reset labels** reapplies the rules in its section above, retaining existing
  locks and geometry protections. It is not a background render operation.
- **Drawing typography settings** apply the changed options to the current
  drawing. Existing case-conversion paths can rename electrical objects;
  they are not pure visual formatting. Preserve this behavior pending a
  separate product decision, including existing complement semantics.
- Agent **arrange-labels** operates on requested Instances, eligible visible
  unrotated/unlocked labels, and still-default positions/styles. It tries
  bounded nearby positions to reduce collisions; it does not reset every
  label. A placed Cell's name under its block counts as the part's name,
  or as its value beside a shown Reference, and moves as one; its text is
  the Cell's and is never restyled (#1366). The same arrangement runs on
  its own for the parts whose labels a typed move, an arrange, a pin change
  or a Cell's changed Pins newly draw a wire or a part over ([connectivity and
  routing](connectivity-and-routing.md)). A part's Reference and value move
  together: their default side, then the part's other sides, then the same rows slid along each side to
  the clear place nearest where they stood, while at least half of the
  group stays beside the part. On every side the name comes first and its
  value under it; above the part the value takes the row nearest it and the
  name stands a row over it (#1384). A place is clear when the labels meet no
  wire, part, other label or free drawing text, keep a word's space from
  another label or text on their line and a little space between lines,
  keep that line's space from a junction dot,
  and no wire runs between a
  label and its part or between the Reference and the value, other than
  the part's own wires. Labels are read in groups, a name and then its value
  below it or after it on its line: a value may not follow another part's
  name about as closely as it stands by its own part and labels, nor a name
  stand just before another part's value. A value stacked above its name,
  just under a neighbour's name, read as the neighbour's (#1347). Where
  nothing is clear, text drawn over a wire, a part or other text counts for
  more than a label too close to text or to a junction dot, cut off by a
  wire, or read as another part's. A part's Reference comes first: no position that clears the value
  but draws the Reference over a wire, a part or another label is preferred
  to one that keeps the Reference clear. A requested Cell Pin's name, while
  still on one of its own sides, takes the first of them where it meets
  nothing, as a new Pin's name does. Its optional first-letter reference style is explicit. The existing
  style-equality eligibility check is retained, not promoted into a general
  definition of whether a user has edited an object.
- Agent **apply-label-preset** `textbook` (#1350) is one transaction over the
  requested parts, or every placed part of the Cell: it hides each MOS
  transistor's W/L as the Value visibility toggle does, then runs
  arrange-labels with the first-letter reference style on the same parts,
  planned on that result. It shows nothing hidden and changes no other
  value's visibility. It is not a placement default: parts placed later still
  show their W/L, and people have no such command.

Creation, editing, rename, reset and arrangement may share construction
primitives without sharing their authorization or target-selection policy.
No historical Gallery rewrite is authorized by this refactor.

- `packages/model/src/label-typography.test.ts`: standard looks, role
  recognition, rename following and restored hidden characters.
- `packages/edit-engine/src/standard-label-look.test.ts` and
  `packages/edit-engine/src/net-name-operation-planner.test.ts`: rails, Cell
  Pin, claim, marker and device renames keep stored looks valid.
- `apps/editor/src/features/text-editing/text-editing.test.ts`: verbatim text
  renames, styling that never renames, and hidden-character splicing.
- `apps/editor/src/features/instance-display/default-instance-display.test.ts`
  and `apps/editor/src/features/properties/property-edit-planner.test.ts`: new
  Pin and Net labels take the voltage-node look for V-led names and the
  current look for I-led names only.
- `packages/model/src/label-typography.test.ts` and
  `apps/editor/e2e/manual-editor.spec.ts`: a new subscript is upright, an
  author's slanted subscript is kept, and legacy looks change only on request.
- `worker/gallery.test.ts` (label-look maintenance): a dry run writes
  nothing; an apply needs the checked content, keeps names, netlists and
  history, and leaves nothing for a second pass.
- `apps/editor/e2e/component-insert.spec.ts` and
  `apps/editor/e2e/manual-editor.spec.ts`: placed supplies in their standard
  look, a V-led Net label whose subscript the author turns off without
  renaming the Net, and verbatim canvas renames.

Custom display text that differs from its name (for example Q′ for `Q_prime`),
one-click formatting presets, and a literal default for typed names are not
yet provided.
