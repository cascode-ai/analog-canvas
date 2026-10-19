# Electrical Names and Label Display

Status: `accepted`

Primary owner: `packages/model` (label typography), `apps/editor` (text
editing and placement), `packages/edit-engine` (rename transactions)

Covers labels that show an electrical name: device Reference
(`instance-reference`), Cell Pin name (`cell-terminal-name`, incl. its parent
block pin), Net label and supply label (VDD Power, drawn rail). Not parameter
values, drafting text, formulas or Symbol body text.

## Two facts

- The **electrical name** (`Instance.reference`, a Cell terminal `name`, a Net
  name claim) is stored exactly as typed, connected or generated; netlists,
  simulation and Agents read only it.
- The **label display** is the label's `formatOverride` (Project Code
  `format`), presentation only, never read back into a name.
- The only link: a stored display spells its name (visible characters equal
  the name, or the name with one `_` omitted at a subscript start); the schema
  refuses anything else. Why: the same drawing can come from different names
  and one name can be drawn several ways, so neither is derived from the
  other.

## Standard looks

Created stored (not computed at render time, so a later rule change never
redraws seen drawings), whether the name was typed, connected or generated:

| Role                                             | Names                                                     | Stored look                                                             |
| ------------------------------------------------ | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| Supply (VDD Power, drawn rail)                   | `V` followed by letters/digits, then an optional + or −   | Italic `V`, upright subscript rest: V_DD, V_DDH                         |
| Device Reference starting with its device letter | the device's one-letter prefix followed by letters/digits | Italic letter, upright subscript rest: M₁, R₁₂, R_L1, C_L, R_FB, M_TAIL |
| Any other device Reference                       | letters followed by digits                                | Italic letters, upright subscript index: XU₀, OA₁                       |
| Voltage node (Cell Pin, Bias Voltage, Net label) | `V` followed by letters/digits, then an optional + or −   | Italic `V`, upright subscript rest: V_in, V_BP, V_casP, V_in+, V_bn−    |
| Current (Cell Pin, Net label)                    | `I` followed by letters/digits, except `IN…` and `IO`     | Italic `I`, upright subscript rest: I_out, I_REF, I₁                    |
| Greek-led name (any role above)                  | a Greek letter, then Latin letters/digits                 | Italic Greek letter, upright subscript rest: Φ₁, Φ_1pp, φ_S, ω₀         |

- Device letters: R, C, L, M, Q, D, V, I, S, B; X-called parts and Blocks have
  none. `ΔV` and Greek runs like `ΣΔ` get no Greek-led look. Any other spelling
  (`AVDD`, `XBIAS`, `M_1`, `CLK`, bare `V+`, `IN`, `INP`, `IO`) is shown as
  written. A differential sign stays in the subscript (`Vin-` → V_in−).
- A label is "still standard" when its styled characters equal the standard
  look of its current name; an author's own format always wins (turning off
  V_BP's subscript stores flat `VBP`, kept across renames).
- Without a stored display, the historical rule draws bold italic with `_`
  starting a subscript and a final `_bar` an overbar, per the drawing's
  `labels` settings; display only.
- Other authorities: a parameter value is a live projection (a stored format
  applies only while its text matches); free text and route markers are
  stored RichText from their creation rule (new drafting identifiers and route
  markers use the voltage labels' upright power suffix); Instance and Cell Pin
  aliases are stored literals with no identity (the parent pin draws a Pin
  alias); a Cell/master word uses whole-word presentation, not Reference
  splitting; a parent Cell pin projects its child label, explicit content
  bypassing generic pin typography.
- Scripts are upright by default: in standard looks, in new drawings
  (`labelSubscriptItalic` false) and when Subscript/Superscript is applied to
  italic text. An author's explicit italic script is kept.

## Editing

- Changing visible characters renames exactly as typed; characters the old
  look hid (`_` before a subscript, trailing `_bar`) stay in place around the
  edit.
- Styling-only changes never rename; a hidden character left with nothing to
  hide it is shown, not dropped.
- Adding/removing an overbar in the Net or Cell Pin label editor renames
  (`D` ↔ `D_bar`); creating a barred Net Label follows the same rule, without
  doubling `_bar`. This names a separate signal, not an automatic inverter.
  On a device Reference an overbar is styling. An older bound signal label
  barred without `_bar` keeps its name and look; existing ERC reports the
  mismatch and suggests an explicit rename. Loading, copying and Project Code
  format changes never infer a rename from the bar.
- A still-standard label regenerates for its new name after any rename
  (text, Properties, netlist code, Agent, clipboard); a spelling without a
  standard form returns to the historical rule; an authored format keeps its
  styling around new text. A renamed Cell Pin whose unlocked label has no or
  only the automatic look takes the look a newly placed Pin with that name
  gets.
- Placement preserves the authored name, including the label editor's
  explicit overbar naming rule above. The whole-drawing `labels` action may
  change only subscript case (undoable). The first-letter convention (off for new
  drawings) only changes drawing: `Start` draws S + subscript tart and stays
  `Start`; standard looks are untouched.
- An override equal to the fallback may be omitted. Creation, editing,
  rename, reset and arrangement may share construction primitives but not
  authorization or target selection; entry points applying one role
  exception share its RichText construction.

## Batch operations

- **Reset labels** (one undoable edit over unlocked labels, keeping position,
  color, visibility): default size; bound names take their standard look, or
  keep displays doing more than italic/bold (dropping italic/bold-only ones);
  values lose their own display; hand-written labels keep characters and
  subscripts, and free label-type text sheds its size, weight and slant;
  other free text is untouched; a subscript never becomes plain text.
- Agent **arrange-labels** moves only eligible labels of requested Instances
  (visible, unrotated, unlocked, still at default position and style,
  including an earlier value-over-name stack; hand-moved ones only with
  `includeManual`) to bounded nearby positions; it never resets all labels.
  Reference and value move together (default side, other sides, then slid
  along a side while half the group stays beside the part), name first with
  the value under it (above the part: value nearest, name a row over). A place
  is clear of wires, parts, labels and free text with word/line spacing, ~10
  units from a neighbour's label on the row, a line's space from junction
  dots, no foreign wire between label and part or name and value, and no
  reading as another part's label. Failing that, overlap outranks crowding and
  the Reference is kept clear before the value. Series two-terminal parts on a
  wired horizontal row are arranged first and take the side above when they
  would share a row with a neighbour. A placed Cell's name counts as the
  part's name and is never restyled; MOS `×m` follows its name or W/L row as
  the planner tests pin. A requested Cell Pin's name takes its first clear
  own side. The same arrangement runs automatically for parts whose labels a
  typed move, arrange, pin change or changed Cell Pins newly cover
  ([connectivity and routing](connectivity-and-routing.md)).
- Agent **apply-label-preset** `textbook`: one transaction over requested (or
  all placed) parts that hides each MOS W/L like the Value toggle, then runs
  arrange-labels with the first-letter style. Shows nothing hidden, not a
  placement default, no GUI command.

## Existing drawings

An administrator maintenance pass ([Community Gallery](community-gallery.md#administration))
gives drawn supply, Reference, Cell Pin and Net labels without their own look
the standard look, may nudge restyled labels a few grid units, sets
`labelSubscriptItalic` false where no slant was chosen, and refuses any change
to a name or netlist. `legacyLooks` (pre-standard drawings only) also
converts looks that merely copy the historical look and straightens scripts
that inherited italic.

## Netlist

Netlists print names verbatim; export-format obligations (prefixes, escaping,
refusals) apply only inside that export, never written back.

- Greek letters become their names in the letter's case (`φ1`→`phi1`,
  `Φ1`→`PHI1`, `Σ`→`SIGMA`), including Latin-lookalike capitals, omicron,
  variant forms and the micro/ohm signs. Parameter names are not rewritten.
- Full-width letters, digits and punctuation in Net/Pin names become ASCII.
- Bus brackets stay in drawing, name and Spectre (escaped `DATA\<3\>`);
  SPICE writes each bracket as `_` (`DATA<3>`→`DATA_3_`) because ngspice's
  control language reads `<>` as redirection and `[]` as indexing.
- Importing SCS reads the escapes back: `DATA\<3\>` and `Vin\+` name the
  Nets `DATA<3>` and `Vin+`, as the drawing does, and the SCS export writes
  them again.
- Hand-written ngspice source follows the same rules when run and writes any
  other non-ASCII character as `u` + hex code point (`输入`→`u8f93u5165`)
  since ngspice reads such bytes as `_`; the source text is unchanged.
- Two names that become one spelling (`φ1`/`phi1`, `DATA<3>`/`DATA_3_`) are
  refused, never merged.
