; Add this file to your personal .cdsinit with:
; load("/path/to/virtuoso-canvas/skill/virtuoso_canvas_init.il")
let((root script)
    root = getShellEnvVar("VC_ROOT")
    unless(root
        error("Set VC_ROOT before starting Virtuoso.\n"))
    script = strcat(root "/skill/virtuoso_canvas_ui.il")
    unless(isFile(script)
        error(strcat("Virtuoso Canvas UI not found: " script "\n")))
    load(script)
)
