/** One day of the change log: what changed, a sentence a change. */
export interface ChangeLogDay {
  date: string;
  items: readonly string[];
}

/**
 * What changed in Analog Canvas, newest first: the days main took changes
 * people notice, in the operator's time zone, from that day's pull requests
 * and commits. A day lists each notable change as its own sentence (one,
 * or a few numbered); internal work is left out. A day is written once it
 * is over, never the same day.
 */
export const CHANGE_LOG: readonly ChangeLogDay[] = [
  {
    date: "2026-11-07",
    items: [
      "Review, a new Gallery tab, lets members pass or flag each drawing beside its reference figure, with comments, likes and a layout check; Enter sends and → passes.",
      "A dataset comparison page sets each reference circuit's original figure beside our redraw with their netlists' verdict, and accounts with ten public circuits may fix the drawing.",
      "Statistics open on headline numbers and a board of each dataset's circuits, errors and accuracy; a shuffled wall reshuffles from a ↻ button.",
      "A Gallery circuit can carry a reference image, pasted or dropped, shown in a Reference panel beside the canvas when opened.",
      "Differential ADC and DAC parts join the Library, and the PowerPoint add-in saves from the header.",
      "External circuits are listed in the hierarchy tree, one model per sheet; Flatten keeps Nets joined by labels connected, and an Agent can refactor the hierarchy as the tree does.",
    ],
  },
  {
    date: "2026-11-06",
    items: [
      "Statistics chart the Gallery's and each account's circuits by source; the wall orders by most likes, opens unfiltered on a new visit and marks circuits exported from Virtuoso.",
      "Cells are browsed, entered and refactored from one quiet hierarchy tree; User Components live in the Library panel, Official parts above Community ones.",
      "An optional PowerPoint add-in keeps circuits editable inside slides.",
      "A fully differential op-amp holds its outputs about a set common-mode level (vocm); bent arrows slide a straight leg and rotate whole from a ↻ button.",
      "RNL import gives another tool's labels the house look and reads .global supplies and each Cell's own pins correctly.",
      "This change log lists what changed each day.",
    ],
  },
  { date: "2026-11-05", items: ["A more reliable first Agent connection."] },
  {
    date: "2026-11-04",
    items: ["Unsaved edits and Gallery state survive a delayed update."],
  },
  {
    date: "2026-11-03",
    items: [
      "IHP SG13G2 fully qualified for simulation, corners and cells included.",
    ],
  },
  {
    date: "2026-11-02",
    items: [
      "An op-amp can draw its VDD and VSS supplies as pins.",
      "RNL import reads more drawings correctly: rectangles, gate symbols, wire ends and supplies drawn as ground.",
    ],
  },
  {
    date: "2026-11-01",
    items: [
      "Spectre export keeps a SPICE model library it cannot convert as SPICE.",
    ],
  },
  {
    date: "2026-10-31",
    items: [
      "Every Library part with a generated model, from ADC to crystal, can bind to a Project Cell or an external subcircuit.",
      "RNL round trips keep free labels, curves, transformers, T-coils and body ties as drawn.",
    ],
  },
  {
    date: "2026-10-30",
    items: [
      "Selection boards: link-shared lists of Gallery circuits that collaborators build together.",
      "A quartz crystal part, and the mouse wheel says how to zoom.",
      "A Gallery rejection can email its author the reason.",
      "RNL round trips keep many more drawings exactly, from Cell symbols to no-connects.",
    ],
  },
  {
    date: "2026-10-29",
    items: [
      "Labels pick clearer spots, and the Gallery loads faster.",
      "SKY130 generic poly resistors bind to their reviewed models.",
    ],
  },
  {
    date: "2026-10-28",
    items: [
      "Op-amps and comparators can call transistor-level Cells of their Project.",
      "Net labels can show a display alias, such as VEA,OUT, while the Net keeps its name.",
      "Agents can style a name label and size a Cell's block, and are told when their MCP adapter is out of date.",
    ],
  },
  {
    date: "2026-10-27",
    items: ["Unticking Datasets hides the reference circuits from the wall."],
  },
  {
    date: "2026-10-26",
    items: [
      "Wire crossings can hop, per canvas, on screen and in every export.",
      "Free text can run up the page beside a vertical line.",
      "RNL carries wire hops, with many round-trip fixes.",
      "A blocked account sees a clear notice instead of a grey status line.",
    ],
  },
  {
    date: "2026-10-25",
    items: [
      "RNL import never loses a circuit, and Spectre numbers stay as written.",
      "A blocked member is emailed why, and how to report a mistake.",
    ],
  },
  {
    date: "2026-10-24",
    items: [
      "Pages load faster: assets come compressed, and RNL support loads only when used.",
      'Error messages say what actually failed instead of "unavailable".',
    ],
  },
  { date: "2026-10-23", items: ["Every page states the site's usage policy."] },
  {
    date: "2026-10-22",
    items: [
      "Native buses: name a wire inline, take ordered bus slices, and carry buses from Cell to netlist and between Projects.",
    ],
  },
  {
    date: "2026-10-21",
    items: [
      "A behavioral delay cell, which can also bind to a Cell of the Project.",
      "Cell symbols are laid out directly.",
      "The Gallery is protected against bulk collection.",
    ],
  },
  {
    date: "2026-10-20",
    items: [
      "No Connect markers, placed from the toolbar.",
      "RNL exports open in the online RNL Viewer.",
      "Junctions take their own colors.",
    ],
  },
  {
    date: "2026-10-19",
    items: [
      "RNL netlist formats (SPICE+RNL, Spectre+RNL) and File › Import › RNL.",
      "File › Export › Netlist saves the netlist the Netlist panel shows.",
      "SPICE and Spectre import keep number suffixes and read Spectre's name escapes.",
      "A fully differential ideal comparator.",
    ],
  },
  {
    date: "2026-10-18",
    items: [
      "One font per canvas, Metropolis or a Times-style serif, on screen and in every export.",
      "A Net label renames from its code, and Shift/Ctrl add to the selection reliably.",
    ],
  },
  {
    date: "2026-10-17",
    items: [
      "Gallery circuits drawn on a finer grid insert cleanly; a new Windows build.",
    ],
  },
  {
    date: "2026-10-16",
    items: ["Managing User Components moved into My shelf."],
  },
  {
    date: "2026-10-15",
    items: [
      "The whole User Components catalog loads by itself, and authoring them is simpler.",
      "Lines under subscripts or CJK text keep even spacing.",
      "New overbar signal labels get their complement name.",
      "A usage policy for crawlers and AI.",
    ],
  },
  {
    date: "2026-10-14",
    items: [
      "Phones can view Gallery circuits, leaving drawing to a computer.",
      "A clicked wire or part shows what it connects to, and a wire is named as the netlist names its Net.",
      "A D flip-flop can bind to a transistor-level Cell and keep its symbol.",
      "Exports the browser saves late still find their file.",
    ],
  },
  {
    date: "2026-10-13",
    items: [
      "Reference datasets join the community wall as a third side beside AI generated and Human made.",
      "Pages opened before an update keep working, and the editor says when a new version is live.",
      "The Library's fully differential amplifier pairs + with − on each row.",
      "A dragged pin joins the wire it lands on, however the snap got it there.",
      'An Arena battle\'s drawing opens as a new project from "Draw it yourself".',
    ],
  },
  {
    date: "2026-10-12",
    items: [
      "Two drawn inductors can be coupled by k, with dotted ends and an optional arrow, and SPICE K lines import.",
      "The first screen loads faster.",
      "Entering or leaving a Cell fits the view.",
      "Arena voting: a Cloud Save invites you to judge a few Arena battles.",
    ],
  },
  {
    date: "2026-10-11",
    items: [
      "The desktop app manages projects offline.",
      "A Chopper part: four switches on one clock.",
      "Current sources can be drawn as a diamond, and T-coil and transformer leads are a grid square shorter.",
      "Hosted simulation runs logic gates bound to SKY130 standard cells.",
      "SKY130's larger vertical PNP binds, and a poly resistor's body defaults to the substrate.",
    ],
  },
  {
    date: "2026-10-10",
    items: [
      "A logic gate can bind to a transistor-level Cell of its Project.",
      "AnalogArena opens, with Arena buttons in the editor and the Gallery.",
      "The wall opens in random order, with Newest/Oldest and Most/Fewest parts.",
      "Signed-out visitors see the wall's first twelve circuits, dimmed.",
      "Unsaved tabs survive Reopen tabs and a return to the editor.",
    ],
  },
  {
    date: "2026-10-09",
    items: [
      "Each Gallery circuit's testbench stays private to its author.",
      "User Components: your own circuits and custom symbols, with pin mapping.",
      "Metropolis becomes the textbook font, formulas and exports included.",
      "Reference datasets appear among the Gallery's contributors, hidden with a Datasets checkbox.",
      "The NMOS body defaults to the Cell's substrate, and a drawn negative rail wins over ground.",
    ],
  },
  {
    date: "2026-10-08",
    items: [
      "Library logic gates take standard cells for SKY130, IHP SG13G2 and TSMC 28.",
      "Reference datasets open read-only beside the community wall.",
      "Running a simulation needs a signed-in account.",
      "Faster Gallery filters for AI and netlist, a tidier tag sidebar, and contributors sorted by count or name.",
      "SKY130 parts keep sizes their models cover, high-voltage devices included.",
      "Switch clock phases are plain signals, and undriven ones become Cell pins.",
    ],
  },
  {
    date: "2026-10-07",
    items: [
      "External Circuits bring model netlists from outside into the editor and simulation.",
      "Gallery circuits carry an AI mark and a spelled-out Netlist mark.",
      "A tab menu, editable Project Info, and Cloud Projects on the account page.",
      "AI accounts publish to the Gallery through the Agent.",
      "Placed parts show their names alone, and labels render the same on every system.",
      "Gallery opens are capped per day.",
    ],
  },
  {
    date: "2026-10-06",
    items: [
      "Projects rename inline in their tabs.",
      "Agents can insert Gallery drawings.",
      "Wires enter drawn blocks at their thirds and middle, and labels in a new wire's path move clear.",
      "A new simulation folder picks the process Profile its Cell's devices need.",
    ],
  },
  {
    date: "2026-10-05",
    items: [
      "An account dashboard with one entry card.",
      "Agents' actions are planned by the editor's own code, so they place and wire parts as the GUI does.",
      "Arranged labels stay beside their own part, clear of junction dots and free text.",
      "New Cell blocks fit their pin names, Cell Pins follow their drawn Ports, and a typed move no longer shorts a pin.",
    ],
  },
  {
    date: "2026-10-04",
    items: [
      "Labels sit beside their part, and bus-bit names export.",
      "R turns a Net label, and copied Net labels attach to the wires they land on.",
    ],
  },
  {
    date: "2026-10-03",
    items: ["IHP SG13G2 process support.", "Reopen tabs in a fresh window."],
  },
  {
    date: "2026-10-01",
    items: [
      "Logic gates, adders, multipliers and converters get simulation models.",
      "A File menu and Project Properties.",
      "A privacy notice, and accounts can be deleted.",
      "SKY130 parameters are checked, and Spectre export warns instead of blocking.",
    ],
  },
  {
    date: "2026-09-30",
    items: [
      "Sign in with an emailed code.",
      "Three header menus.",
      "Gallery search runs on the server, and signed-out visitors see a short preview of the wall.",
      "Dropping a part over a wire's end splices it in series, and recovery keeps open tabs.",
    ],
  },
  {
    date: "2026-09-29",
    items: [
      "One overbar per barred name, and several pin names can share one bar.",
      "Labels flip as text boxes, with even gaps.",
      "Shift gathers wires, and New Circuit starts blank.",
      "Supply roles switch cleanly between Rail and Port, and analog block supplies are simpler in Properties.",
    ],
  },
  {
    date: "2026-09-28",
    items: [
      "Ideal models for amplifier blocks, the Zener and the comparator.",
      "SKY130 16 V and 20 V devices for the DMOS symbols.",
      "Signed-out visitors see a preview of the Gallery, and the wall loads faster.",
      "A 45° segment drags any way without bending, and / picks a wire's corner.",
    ],
  },
  {
    date: "2026-09-27",
    items: [
      "Linear controlled sources, with their controls picked on the canvas.",
      "The wall filters by part count.",
      "Formulas are set in label type, and PDF draws Greek and math symbols.",
      "A multi-selection edits every shared parameter per part.",
      "Placing a part snaps its pins onto nearby pins.",
    ],
  },
  {
    date: "2026-09-26",
    items: [
      "An offline Windows preview of the desktop app, with project files.",
      "T-coils and transformers export as coupled windings, in SPICE and Spectre.",
      "Copies match their source: its style, label text and substrate.",
      "A whole selection mirrors as one drawing.",
      "The netlist shows a draft, marked ?, while the drawing does not yet extract.",
    ],
  },
  {
    date: "2026-09-25",
    items: [
      "Every netlist issue is listed and shown on the canvas, and a picked part lights its Netlist card.",
      "Drawn switches export as SPICE S cards on the phase their label names.",
      "The Community Gallery is read when signed in.",
      "Labels point at what they belong to, and copies never add connections.",
      "Gallery notes up to 1000 characters show in full.",
    ],
  },
  {
    date: "2026-09-24",
    items: [
      "Labels take textbook typography: V-led names and currents subscripted, subscripts upright by default.",
      "Logic gates take 2 to 4 inputs.",
      "Greek letters insert from the symbol menu or by LaTeX name, and export by their standard names.",
      "PVT sweeps run in ngspice.",
      "A Razavi battery symbol, and C copies across tabs.",
    ],
  },
  {
    date: "2026-09-23",
    items: [
      "Faster hosted simulation.",
      "The product is called Analog Canvas everywhere.",
    ],
  },
  {
    date: "2026-09-22",
    items: [
      "Agents work in workspace sessions, with local plotting.",
      "Waveforms stream back, with no size cap on results.",
      "Image exports no longer clip text at the edge.",
      "Amplifiers offer standard and S spacing.",
    ],
  },
  {
    date: "2026-09-21",
    items: [
      "An NMOS brand mark, and a GitHub link in the Gallery header.",
      "Gallery circuits keep a version history.",
      "Overbarred signals take _bar names in the netlist.",
      "The Gallery filters by tag, and the duplicate check moves into Publish.",
    ],
  },
  {
    date: "2026-09-20",
    items: [
      "Gallery circuits matching the current Cell are found by topology, not port labels.",
      "All Cell Port labels format in one action from Properties.",
      "Wire taps stay connected while pins are dragged.",
    ],
  },
  {
    date: "2026-09-19",
    items: [
      "SKY130 is the default process.",
      "A circuit drawn before choosing a process fills its device models in one click.",
      "Public component authoring, with portable component code.",
      "Wires draw as the gesture asks, refusing only untrue shapes.",
    ],
  },
  {
    date: "2026-09-18",
    items: [
      "Gallery circuits that extract to a netlist are marked, and the wall filters by netlist and likes.",
      "VACASK runs beside ngspice.",
      "Duplicate Gallery circuits are detected.",
      "Net labels take rich formatting.",
      "The netlist refuses a dead-end node and reports a pin that a wire of another Net crosses.",
    ],
  },
  {
    date: "2026-09-17",
    items: [
      "A Razavi externally controlled switch.",
      "Netlist export states supply interfaces explicitly.",
      "Wires start and end on an existing T-junction, and wire capture follows the zoom.",
      "A one-click grid toggle in the status bar, and 45° segments drag cleanly.",
    ],
  },
  {
    date: "2026-09-16",
    items: [
      "VACASK as a second simulator.",
      "Analog Blocks export as subcircuits.",
      "No unintended VDD or VSS pins or MOS body connections appear in the netlist.",
    ],
  },
  {
    date: "2026-09-15",
    items: [
      "Code-first netlists, VDD as an explicit Cell interface and more reliable wiring.",
    ],
  },
  {
    date: "2026-09-14",
    items: ["Agent guidance in simulation and a faster start."],
  },
  {
    date: "2026-09-13",
    items: [
      "Every component shares one Properties surface, with its netlist identity apart from its look.",
      "Depletion MOS symbols.",
      "Simulation starter projects with guidance.",
      "Rotation turns in quarter turns, and text selections move as one body.",
    ],
  },
  {
    date: "2026-09-12",
    items: [
      "Properties edits apply live, with help on request.",
      "Simulation files live in one explorer.",
      "Color and layering controls for shapes.",
      "Net labels land where expected.",
    ],
  },
  {
    date: "2026-09-11",
    items: [
      "A code-first simulation workspace.",
      "Component properties edit as code in a guided JSON editor.",
      "Upright block text and wire arrows.",
      "W/L labels are fully clickable and draggable, with the multiplier beside them.",
    ],
  },
  {
    date: "2026-09-10",
    items: ["A Gallery contributor leaderboard and a wider Insert picker."],
  },
  {
    date: "2026-09-09",
    items: ["Parameter sweeps, waveform overlays and more SKY130 devices."],
  },
  {
    date: "2026-09-08",
    items: [
      "Reuse Cells across Cloud Projects; Agents manage simulation setups.",
    ],
  },
  {
    date: "2026-09-07",
    items: [
      "Process corners, noise analysis, operating points on the canvas and a selection filter.",
    ],
  },
  {
    date: "2026-09-06",
    items: [
      "DC sweeps, A/B waveform cursors, output expressions and terminal currents.",
    ],
  },
  {
    date: "2026-09-05",
    items: [
      "Structured simulation setups, transient analysis and a five-transistor OTA lab.",
      "Source waveforms edit in Properties.",
      "Transformer and bridged T-coil symbols.",
    ],
  },
  {
    date: "2026-09-04",
    items: [
      "Hosted SKY130 simulation returns real numbers, and a refused run says why.",
      "Bent arrows draw with quiet snapping.",
      "A dragged wire end lands electrically, and the wire drawn is the wire committed.",
      "A component can wear a label other than its Reference.",
    ],
  },
  {
    date: "2026-09-03",
    items: [
      "ERC and visual checks run on demand from Check and Save.",
      "Hollow outline arrows join the arrow styles.",
      "Visual selections copy, and drawings export as groups.",
      "Agents catch up with the editor's drawing abilities.",
    ],
  },
  {
    date: "2026-09-02",
    items: [
      "Complete SKY130 netlist export.",
      "A faster Gallery and a faster canvas.",
    ],
  },
  {
    date: "2026-09-01",
    items: [
      "First simulation: a testbench, ngspice runs, voltages on the canvas and AC plots.",
      "Shift+M and Shift+drag move parts without their wires.",
      "New symbols: ADC and DAC blocks, a plain and an SPDT switch, and amplifiers lettered by stage.",
      "Arrows can carry a head at either end or both.",
      "Wire ends butted together, or resting on a wire, connect.",
    ],
  },
  {
    date: "2026-08-31",
    items: [
      "A live issues badge, with findings marked on the canvas.",
      "A two-pin part dropped on a wire splices in series.",
      "The docked Gallery pages, searches and filters like the wall.",
      "Arrow keys pan the canvas, and an adaptive transconductance block joins the Library.",
    ],
  },
  {
    date: "2026-08-30",
    items: [
      "Per-wire and per-text colors.",
      "A D flip-flop that brings out only Q.",
      "Transistors and two-pin parts splice in series by their exact pins.",
      "The Gallery filter box searches circuits, and large circuits respond faster.",
    ],
  },
  {
    date: "2026-08-29",
    items: [
      "Cadence-style commands: press C, M, R or Delete, then click.",
      "Mac trackpad and shortcuts: two-finger panning, and Cmd+Z, Y, S, O and A work as expected.",
      "Transfer-function blocks and a three-dot annotation.",
      "Ctrl/Cmd+drag moves a part without its wires.",
      "Authors can delete their own Gallery circuits, and may publish up to 100 a day.",
      "The Library is ordered by family.",
    ],
  },
  {
    date: "2026-08-28",
    items: [
      "A quick-pick tile grid replaces the Insert dialog.",
      "Vector LaTeX formulas in text.",
      "Signal Flow blocks: adder, multiplier, 1/s, z⁻¹ and quantizer.",
      "One-click bug reports.",
      "A private shelf beside the community Gallery.",
      "Saving centers on Cloud Projects, and unsaved work survives recovery.",
    ],
  },
  {
    date: "2026-08-27",
    items: [
      "Vector PDF export.",
      "Circles join the drafting tools, and C copies drafting objects.",
      "New symbols: high-voltage DMOS, an unmarked comparator, a buffer, a D flip-flop and a delay.",
      "R always rotates, never draws a rectangle.",
      "Gallery moderation, and a visitor count in the status bar.",
    ],
  },
  {
    date: "2026-08-26",
    items: [
      "A netlist check report.",
      "A fully differential amplifier drawn after Razavi's figure.",
      "Copied and same-name Cell Pins stay independent.",
      "Analog Canvas is licensed under AGPL-3.0.",
    ],
  },
  {
    date: "2026-08-25",
    items: ["The Gallery shows its newest circuits first."],
  },
  {
    date: "2026-08-23",
    items: [
      "Selections rotate and flip as one rigid body.",
      "Check and Save, with a shelf for the last three circuits.",
      "Gallery circuits get likes, a star when they extract, and short readable addresses.",
      "Publishing needs sign-in and goes straight to the wall.",
      "A design can carry more than one named supply.",
      "Save writes back to the chosen file.",
    ],
  },
  {
    date: "2026-08-22",
    items: [
      "The Community Gallery opens: publish, sign in, tags, version history and a masonry wall.",
      "Wires can run at any angle, and middle-click cycles a wire's corner.",
      "MOS width is the total width, with finger width derived.",
      "Document settings dock beside the canvas, and the editor works in a half-screen window.",
      "The circuit renames from the canvas.",
      "A differential-output op-amp, and amplifier inputs can swap.",
    ],
  },
  {
    date: "2026-08-21",
    items: [
      "Block diagrams, window and crossing selection, and a variable resistor.",
    ],
  },
  {
    date: "2026-08-20",
    items: ["45-degree wiring and the first netlist integration."],
  },
  {
    date: "2026-08-19",
    items: ["A simpler Properties panel and Cell symbol layout."],
  },
  {
    date: "2026-08-18",
    items: ["Schematic hierarchy: circuits made of Cells."],
  },
  {
    date: "2026-08-17",
    items: [
      "Bundled examples, wires that snap to block edges, and a first hierarchy.",
    ],
  },
  {
    date: "2026-08-16",
    items: [
      "Q toggles Properties, and device values read as textbook fractions.",
      "A VDD power port part, and shortcuts to move a selection.",
    ],
  },
  {
    date: "2026-08-15",
    items: [
      "A compact component Library, per-type designators and zoom to a frame.",
    ],
  },
  {
    date: "2026-08-14",
    items: ["Agents connect through MCP, and coordinates sit on the grid."],
  },
  {
    date: "2026-08-13",
    items: [
      "Netlist export, Port symbols, and junctions that sit where wires actually meet.",
    ],
  },
  {
    date: "2026-08-12",
    items: [
      "The site goes live on Cloudflare, with privacy-friendly visitor counts.",
      "VDD can be drawn as a rail.",
    ],
  },
  {
    date: "2026-08-11",
    items: [
      "Contextual Properties, Net labels and Virtuoso-style component insertion.",
      "Switch, BJT and diode symbols redrawn to the textbook, with a closed switch.",
    ],
  },
  {
    date: "2026-08-10",
    items: [
      "Reworked interactions with snapping and alignment.",
      "Common textbook device families, with inductor and op-amp symbols.",
    ],
  },
  { date: "2026-08-09", items: ["Wire ends reconnect without seams."] },
  {
    date: "2026-08-08",
    items: [
      "Drafting tools (text, arrows, guides) and calibrated textbook MOS symbols.",
      "MOS transistors show a three- or four-terminal view.",
    ],
  },
  {
    date: "2026-08-07",
    items: [
      "Direct editing of parts and wires, in the Razavi textbook style.",
      "Moving a part stretches its connected wires.",
    ],
  },
  {
    date: "2026-08-06",
    items: [
      "The first editor: drawing, SPICE import, connectivity, symbols and an Agent API.",
    ],
  },
];
