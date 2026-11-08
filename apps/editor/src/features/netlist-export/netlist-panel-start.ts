// The Live netlist panel starts closed: a drawing opens on the canvas, the
// Library and Project Info. A reader who opens it from the toolbar finds it
// open with the next drawing and page, until they close it.

const OPEN_KEY = "icm.netlist-panel.v1";

export function netlistPanelStartsOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "open";
  } catch {
    return false;
  }
}

export function rememberNetlistPanel(open: boolean): void {
  try {
    if (open) localStorage.setItem(OPEN_KEY, "open");
    else localStorage.removeItem(OPEN_KEY);
  } catch {
    // Without storage it starts closed with the next page.
  }
}
