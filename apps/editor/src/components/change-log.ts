/**
 * What changed in Analog Canvas, one line a day, newest first: the days main
 * took changes, in the operator's time zone, summarised from that day's
 * pull requests and commits. Add a line for each new day with changes.
 */
export const CHANGE_LOG: readonly { date: string; summary: string }[] = [
  {
    date: "2026-11-06",
    summary:
      "Statistics with charts, a hierarchy tree, sorting by most likes, User Components in the Library, an optional PowerPoint add-in and this change log.",
  },
  {
    date: "2026-11-05",
    summary: "A more reliable first Agent connection.",
  },
  {
    date: "2026-11-04",
    summary: "Unsaved edits and Gallery state survive a delayed update.",
  },
  {
    date: "2026-11-03",
    summary:
      "IHP SG13G2 fully qualified for simulation, corners and cells included.",
  },
  {
    date: "2026-11-02",
    summary: "An op-amp can draw its supply pins; more RNL import fixes.",
  },
  {
    date: "2026-11-01",
    summary:
      "Spectre export keeps a SPICE model library it cannot convert as SPICE.",
  },
  {
    date: "2026-10-31",
    summary:
      "RNL round-trip fixes; Library parts take an author's own definition through set-model.",
  },
  {
    date: "2026-10-30",
    summary:
      "Selection boards for sharing Gallery picks, a quartz crystal part and 21 RNL round-trip fixes.",
  },
  {
    date: "2026-10-29",
    summary: "Labels pick clearer spots, and the Gallery loads faster.",
  },
  {
    date: "2026-10-28",
    summary:
      "Op-amps and comparators can call transistor-level Cells; Net labels can show a display alias.",
  },
  {
    date: "2026-10-27",
    summary: "Unticking Datasets hides the reference circuits from the wall.",
  },
  {
    date: "2026-10-26",
    summary: "Wire crossings can hop, and free text can run up the page.",
  },
  {
    date: "2026-10-25",
    summary:
      "RNL import never loses a circuit, and Spectre numbers stay as written.",
  },
  {
    date: "2026-10-24",
    summary:
      "Faster loading: compressed assets, and RNL loaded only when used.",
  },
  {
    date: "2026-10-23",
    summary: "Every page states the site's usage policy.",
  },
  {
    date: "2026-10-22",
    summary: "Native buses, with inline wire naming and bus slices.",
  },
  {
    date: "2026-10-21",
    summary:
      "A behavioral delay cell, direct Cell symbol layout, and protection against bulk collection of the Gallery.",
  },
  {
    date: "2026-10-20",
    summary: "No Connect markers, the online RNL Viewer and colored junctions.",
  },
  {
    date: "2026-10-19",
    summary:
      "RNL netlist formats, File › Export › Netlist, and better SPICE and Spectre import.",
  },
  {
    date: "2026-10-18",
    summary: "One font per canvas: Metropolis or a Times-style serif.",
  },
  {
    date: "2026-10-17",
    summary:
      "Gallery circuits drawn on a finer grid insert cleanly; a new Windows build.",
  },
  {
    date: "2026-10-16",
    summary: "Managing User Components moved into My shelf.",
  },
  {
    date: "2026-10-15",
    summary:
      "The whole User Components catalog loads by itself; a usage policy for crawlers.",
  },
  {
    date: "2026-10-14",
    summary:
      "Phones can view Gallery circuits; a clicked wire shows what it connects to.",
  },
  {
    date: "2026-10-13",
    summary:
      "Reference datasets join the wall, circuits count their opens, and open pages survive a deploy.",
  },
  {
    date: "2026-10-12",
    summary: "Coupled inductors, a faster first load and Arena voting.",
  },
  {
    date: "2026-10-11",
    summary:
      "Desktop project management, a Chopper part and diamond current sources.",
  },
  {
    date: "2026-10-10",
    summary:
      "Gates bind to transistor-level Cells, AnalogArena opens, and the wall starts in random order.",
  },
  {
    date: "2026-10-09",
    summary:
      "Private testbenches with a Sim check, User Components, and Metropolis as the textbook font.",
  },
  {
    date: "2026-10-08",
    summary:
      "Standard-cell gates for SKY130, SG13G2 and TSMC 28, reference datasets, and sign-in to simulate.",
  },
  {
    date: "2026-10-07",
    summary:
      "External model sources, the Gallery AI mark, AI accounts and point-in-time backups.",
  },
  {
    date: "2026-10-06",
    summary: "Rename projects in their tabs; Agents insert Gallery drawings.",
  },
  {
    date: "2026-10-05",
    summary:
      "An account dashboard; Agents place and wire parts as the GUI does, with tidier labels.",
  },
  {
    date: "2026-10-04",
    summary: "Labels sit beside their part, and bus-bit names export.",
  },
  {
    date: "2026-10-03",
    summary: "IHP SG13G2 process support.",
  },
  {
    date: "2026-10-01",
    summary: "Logic gate bodies, a privacy notice and account deletion.",
  },
  {
    date: "2026-09-30",
    summary:
      "Sign in with an emailed code, three header menus and server-side Gallery search.",
  },
  {
    date: "2026-09-29",
    summary:
      "Clearer supply roles, one bar per barred name, and flippable labels.",
  },
  {
    date: "2026-09-28",
    summary:
      "Ideal models for amplifier blocks, Zener and comparator; SKY130 16 V and 20 V devices.",
  },
  {
    date: "2026-09-27",
    summary:
      "Linear controlled sources picked on the canvas, and filtering the wall by part count.",
  },
  {
    date: "2026-09-26",
    summary:
      "An offline Windows preview, coupled T-coils and transformers, and copies that match their source.",
  },
  {
    date: "2026-09-25",
    summary:
      "Every netlist issue shown on the canvas, switches as SPICE S cards, and a signed-in Gallery.",
  },
  {
    date: "2026-09-24",
    summary:
      "Textbook label typography, 2–4 input gates, Greek letters and PVT sweeps.",
  },
  {
    date: "2026-09-23",
    summary:
      "Faster hosted simulation; the product is called Analog Canvas everywhere.",
  },
  {
    date: "2026-09-22",
    summary:
      "Agent workspace sessions, streamed waveforms, and exports that no longer clip text.",
  },
  {
    date: "2026-09-21",
    summary:
      "The NMOS brand mark, Gallery history, and _bar names for overbarred signals.",
  },
  {
    date: "2026-09-20",
    summary:
      "Find Gallery circuits by topology, format Port labels at once, verified backups.",
  },
  {
    date: "2026-09-19",
    summary:
      "SKY130 as the default process, one-click model fill and public component authoring.",
  },
  {
    date: "2026-09-18",
    summary:
      "Netlist marks and filters on the Gallery, VACASK released, and duplicate detection.",
  },
  {
    date: "2026-09-17",
    summary:
      "An externally controlled switch, explicit supply interfaces and T-junction wiring.",
  },
  {
    date: "2026-09-16",
    summary:
      "VACASK as a second simulator; Analog Blocks export as subcircuits.",
  },
  {
    date: "2026-09-15",
    summary:
      "Code-first netlists, VDD as an explicit Cell interface and more reliable wiring.",
  },
  {
    date: "2026-09-14",
    summary: "Agent guidance in simulation and a faster start.",
  },
  {
    date: "2026-09-13",
    summary:
      "Releases 0.3 to 0.5: one Properties surface, depletion MOS and simulation starter projects.",
  },
  {
    date: "2026-09-12",
    summary: "Live Properties edits and one file explorer for simulation.",
  },
  {
    date: "2026-09-11",
    summary:
      "A code-first simulation workspace and component properties as JSON.",
  },
  {
    date: "2026-09-10",
    summary: "A Gallery contributor leaderboard and a wider Insert picker.",
  },
  {
    date: "2026-09-09",
    summary: "Parameter sweeps, waveform overlays and more SKY130 devices.",
  },
  {
    date: "2026-09-08",
    summary:
      "Reuse Cells across Cloud Projects; Agents manage simulation setups.",
  },
  {
    date: "2026-09-07",
    summary:
      "Process corners, noise analysis, operating points on the canvas and a selection filter.",
  },
  {
    date: "2026-09-06",
    summary:
      "DC sweeps, A/B waveform cursors, output expressions and terminal currents.",
  },
  {
    date: "2026-09-05",
    summary:
      "Structured simulation setups, transient analysis and a five-transistor OTA lab.",
  },
  {
    date: "2026-09-04",
    summary:
      "A hosted simulator returning real results, release-only deploys and bent arrows.",
  },
  {
    date: "2026-09-03",
    summary:
      "On-demand ERC checks and hollow arrows; Agents catch up with the editor.",
  },
  {
    date: "2026-09-02",
    summary: "Complete SKY130 netlist export and a faster Gallery.",
  },
  {
    date: "2026-09-01",
    summary:
      "First simulation: testbench, ngspice runs, voltages on the canvas and AC plots.",
  },
  {
    date: "2026-08-31",
    summary:
      "A live issues badge and findings on the canvas; a part dropped on a wire splices in.",
  },
  {
    date: "2026-08-30",
    summary: "Per-wire colors, a Q-only D flip-flop and series splicing.",
  },
  {
    date: "2026-08-29",
    summary:
      "Cadence-style C/M/R commands, Mac trackpad gestures and transfer-function blocks.",
  },
  {
    date: "2026-08-28",
    summary:
      "A quick-pick insert grid, LaTeX formulas, Signal Flow blocks, bug reports and a private shelf.",
  },
  {
    date: "2026-08-27",
    summary:
      "Vector PDF export, circles, high-voltage DMOS and Gallery moderation.",
  },
  {
    date: "2026-08-26",
    summary:
      "A netlist check report, a fully differential amplifier figure and the AGPL-3.0 licence.",
  },
  {
    date: "2026-08-25",
    summary: "The Gallery shows its newest circuits first.",
  },
  {
    date: "2026-08-24",
    summary: "Gallery data maintenance and a documentation clean-up.",
  },
  {
    date: "2026-08-23",
    summary:
      "Rotate and flip selections as one, Check and Save, and likes in the Gallery.",
  },
  {
    date: "2026-08-22",
    summary:
      "The Community Gallery opens: publish, sign in, tags, version history and a masonry wall.",
  },
  {
    date: "2026-08-21",
    summary:
      "Block diagrams, window and crossing selection, and a variable resistor.",
  },
  {
    date: "2026-08-20",
    summary: "45-degree wiring and the first netlist integration.",
  },
  {
    date: "2026-08-19",
    summary: "A simpler Properties panel and Cell symbol layout.",
  },
  {
    date: "2026-08-18",
    summary: "Schematic hierarchy: circuits made of Cells.",
  },
  {
    date: "2026-08-17",
    summary:
      "Bundled examples, wires that snap to block edges, and a first hierarchy.",
  },
  {
    date: "2026-08-16",
    summary:
      "Q toggles Properties, and device values read as textbook fractions.",
  },
  {
    date: "2026-08-15",
    summary:
      "A compact component Library, per-type designators and zoom to a frame.",
  },
  {
    date: "2026-08-14",
    summary: "Agents connect through MCP, and coordinates sit on the grid.",
  },
  {
    date: "2026-08-13",
    summary: "Netlist export, canonical junctions and Port symbols.",
  },
  {
    date: "2026-08-12",
    summary:
      "The site goes live on Cloudflare, with privacy-friendly visitor counts.",
  },
  {
    date: "2026-08-11",
    summary:
      "Contextual Properties, Net labels and Virtuoso-style component insertion.",
  },
  {
    date: "2026-08-10",
    summary:
      "Reworked interactions with snapping and alignment; inductor and op-amp symbols.",
  },
  {
    date: "2026-08-09",
    summary: "Wire ends reconnect without seams.",
  },
  {
    date: "2026-08-08",
    summary:
      "Drafting tools (text, arrows, guides) and calibrated textbook MOS symbols.",
  },
  {
    date: "2026-08-07",
    summary: "Direct editing of parts and wires, in the Razavi textbook style.",
  },
  {
    date: "2026-08-06",
    summary:
      "The first editor: drawing, SPICE import, connectivity, symbols and an Agent API.",
  },
];
