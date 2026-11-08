/**
 * Netlist │ Testbench: one dock, two views of the same Cell (#2110). The
 * switch sits in the panel's own control row, so it costs no room until the
 * dock is open.
 */
export function ProjectDockViews({
  view,
  onChange,
}: {
  view: "netlist" | "testbench";
  onChange(view: "netlist" | "testbench"): void;
}) {
  return (
    <div className="project-dock-views" role="group" aria-label="Dock view">
      {(["netlist", "testbench"] as const).map((item) => (
        <button
          key={item}
          type="button"
          aria-pressed={view === item}
          onClick={() => {
            if (view !== item) onChange(item);
          }}
        >
          {item === "netlist" ? "Netlist" : "Testbench"}
        </button>
      ))}
    </div>
  );
}
