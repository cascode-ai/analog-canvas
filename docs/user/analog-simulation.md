# Analog simulation — Code workspace

The top **Simulation** button opens Code beside the canvas. Before setup it
shows a three-step Agent guide (connect your Agent, describe your goal, review
results); **Connect Agent** opens the same panel as the header's **Agent**
button. **Set up manually** creates the starter yourself and **Explore
examples** lists example projects. Save, Run and file operations work without
an Agent.

## Experiments and files

**Explorer** shows each experiment's files, a **Run** row (tagged `tmp`) with
**Results** and **Logs**, and a context menu to create, clone, rename or
delete experiments. Several experiments may share one testbench.

**New experiment** asks for a Name, a Cell and an Environment and starts with
an OP analysis:

- **A Cell with pins** is the circuit under test: the experiment gets a
  `testbench.spice` calling it (`XDUT …`, ports in order) where you add
  sources, loads and clocks.
- **A Cell without pins** is a testbench you drew and runs as it is.

The Environment defaults to the one Profile qualified for every PDK device the
Cell uses, marked "(automatic)" (SKY130 ngspice on the hosted site);
**Change** picks another, such as VACASK. When none fits uniquely, choose one
before **Create**. Each Environment uses its own native language.

The generated Circuit file (diamond icon) belongs to the canvas: edit mapped
numeric parameters there, but change nodes or devices on the schematic.
Other files are yours to edit, with completion, hover help and **Helper**
templates. The entry file is what runs. Invalid code can be saved; preparing
the run reports what to fix.

**Save source** (or `Ctrl+S` in the editor) applies pending files to the
Project without a cloud request; **File → Save** saves the whole Project to
your account. Run and Export apply pending source first. A conflicting edit
from another writer keeps your draft visible.

Analyses, saves, measurements and temperature belong in the native source.
For ngspice, `write` captures the current plot into one literal path:

```spice
.control
set filetype=ascii
set appendwrite
op
write out.raw
ac dec 20 1 1G
write out.raw
.endc
.end
```

Edit an entry's existing control block rather than pasting a second one.

## Testbench from a drawing

1. Draw the DUT Cell with its Cell Pins.
2. In **Cell Manager…**, **New Cell** for the testbench, then **Place Cell**
   to place the DUT in it.
3. Draw sources and loads and create an experiment for the testbench.

Independent V/I sources keep DC, AC and transient settings on the instance.
VDD/GND markers are not sources. **Pick Net on Canvas** and **Pick current on
Canvas** add outputs from the actual Net or pin (current is positive into the
pin).

## Example: five-transistor OTA

`/editor?example=five-transistor-ota-sky130` (or import
`apps/editor/src/examples/five-transistor-ota-sky130.icproj.json`) opens a
SKY130 OTA with OP/DC/AC/TRAN/Noise, corner and waveform experiments written
for the "SKY130 · VACASK (preview)" environment. For ngspice, use
`netlists/ngspice-ota-qualification/source.icproj.json`; changing the Profile
alone does not translate source.

## Run

**Run** captures the source and starts a run; the hosted site requires sign-in.
**Preview input netlist…** (experiment menu) compiles without running.
**Cancel run** stops it; closing or minimizing a panel or tab does not. Input
errors affect only that run. Older version-1 configurations keep their saved
sweep plans; new experiments write loops in native source, and Agents can run
corner, temperature or parameter batches without changing it.

## Results

**Specs** and **Console** share the row below Code. Write uniquely named
native measurements with Spec comments:

```spice
meas tran peak MAX v(out)
* @spec peak <= 1.8 unit=V
```

The [Spec protocol](../agent/simulation-specs.md) gives conditions and units.
The table shows **Spec / Sim result / Expected / Judgment**, acceptance rules
and problems first, measurements without a rule under a collapsed **Other
measurements** section, and groups in declaration order. Values use
engineering prefixes for base units (`36.27 MΩ`); hover shows the exact value
and unit; clicking a name opens its source (a report-only measurement opens
Console). Missing measurements and invalid rules are **Not evaluated**, never
zero or Failed. Editing the input marks the report stale; it is never
re-evaluated against live edits.

Explorer lists source files and runs; select files or a folder and choose
Download. Raw files, per-analysis CSV and `specs.csv` are there for external
plotting. **View executed netlist…** shows the deck a run actually used, and
**Export diagnostic bundle…** its complete evidence. Completed runs are kept in
this browser (not in the Project or Cloud): open a saved result without
rerunning, **Archive current run**, **Download complete run**, or for an opened
archive **Download project + results**.

The Code workspace can be resized, minimized or maximized without closing
Properties; completion updates the status without moving focus.
