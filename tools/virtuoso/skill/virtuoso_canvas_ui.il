; Virtuoso Canvas native UI. Schematic reads are read-only; Node performs conversion and publishing.
unless(boundp('VCUIForm) VCUIForm = nil)
unless(boundp('VCUIBusy) VCUIBusy = nil)
unless(boundp('VCUIEditor) VCUIEditor = nil)
unless(boundp('VCUIEditorFormVersion) VCUIEditorFormVersion = 0)
unless(boundp('VCUICatalogForm) VCUICatalogForm = nil)
unless(boundp('VCUICatalogFormVersion) VCUICatalogFormVersion = 0)
unless(boundp('VCUICatalogCanSelect) VCUICatalogCanSelect = nil)
unless(boundp('VCUICatalog) VCUICatalog = nil)
unless(boundp('VCUIFullCatalog) VCUIFullCatalog = nil)
unless(boundp('VCUIRules) VCUIRules = nil)
unless(boundp('VCUIParamEditor) VCUIParamEditor = nil)
unless(boundp('VCUISessionRules) VCUISessionRules = nil)
unless(boundp('VCUIScannedSource) VCUIScannedSource = nil)
unless(boundp('VCUILastScannedCell) VCUILastScannedCell = nil)
unless(boundp('VCUIProjectFilenameSource) VCUIProjectFilenameSource = nil)
unless(boundp('VCUILastOutput) VCUILastOutput = nil)
unless(boundp('VCUIFormVersion) VCUIFormVersion = 0)
unless(boundp('VCUIRoot)
    VCUIRoot = if(getShellEnvVar("VC_ROOT") then
        getShellEnvVar("VC_ROOT")
    else
        error("Set VC_ROOT to the absolute tools/virtuoso path before loading this file.\n")))
unless(boundp('VCUIPersonalRoot)
    VCUIPersonalRoot = if(getShellEnvVar("VC_PERSONAL_DIR") then
        getShellEnvVar("VC_PERSONAL_DIR")
    else
        strcat(getShellEnvVar("HOME") "/.config/virtuoso-canvas")))
unless(boundp('VCUIMappingPath)
    VCUIMappingPath = if(getShellEnvVar("VC_MAPPING_PATH") then
        getShellEnvVar("VC_MAPPING_PATH")
    else
        strcat(VCUIPersonalRoot "/mappings.json")))
unless(boundp('VCUIConfigPath)
    VCUIConfigPath = if(getShellEnvVar("VC_CONFIG_PATH") then
        getShellEnvVar("VC_CONFIG_PATH")
    else
        strcat(VCUIPersonalRoot "/config.json")))

procedure(VCUISetStatus(message)
    when(VCUIForm VCUIForm->VCUIStatus->value = message)
    printf("VCUI: %s\n" message)
)

procedure(VCUIUpdateDefaultOutputNames(oldCell newCell)
    let((output suffix prefix)
        when(VCUIForm && oldCell && oldCell != "" && oldCell != newCell
            output = VCUIForm->VCUIOutput->value
            suffix = strcat("/" oldCell "-canvas")
            when(strlen(output) >= strlen(suffix) &&
                substring(output strlen(output) - strlen(suffix) + 1 strlen(suffix)) == suffix
                prefix = if(strlen(output) == strlen(suffix) then "" else
                    substring(output 1 strlen(output) - strlen(suffix)))
                VCUIForm->VCUIOutput->value = if(prefix == "" then "/" else prefix))))
)

procedure(VCUIUpdateProjectFilenameForSource()
    let((source)
        when(VCUIForm && VCUIForm->VCUICell->value != ""
            source = list(VCUIForm->VCUILibrary->value
                VCUIForm->VCUICell->value VCUIForm->VCUIView->value)
            when(null(equal(source VCUIProjectFilenameSource)) ||
                VCUIForm->VCUIProjectFile->value == ""
                VCUIForm->VCUIProjectFile->value = VCUIForm->VCUICell->value)
            VCUIProjectFilenameSource = source))
)

procedure(VCUIShellArg(value)
    let((result ch)
        result = "'"
        for(i 1 strlen(value)
            ch = substring(value i 1)
            result = strcat(result if(ch == "'" then "'\\''" else ch)))
        strcat(result "'"))
)

procedure(VCUIJoinNetNames(names)
    let((joined)
        joined = ""
        foreach(name names
            joined = if(joined == "" then name else strcat(joined " " name)))
        joined)
)

procedure(VCUIAcceptConfig(version mode powerNets groundNets file)
    unless(version == 1 && member(mode list("load" "save"))
        error("Unexpected VCUI configuration response: %L %L" version mode))
    when(VCUIForm
        VCUIForm->VCUIPowerNets->value = VCUIJoinNetNames(powerNets)
        VCUIForm->VCUIGroundNets->value = VCUIJoinNetNames(groundNets)
        VCUIForm->VCUIConfigInfo->value = strcat("Personal config: " file))
    when(mode == "save"
        printf("VCUI: Network settings saved to %s\n" file)
        VCUISetStatus("Power and ground networks saved. Future windows will load these settings."))
    t
)

procedure(VCUIRunConfig(mode)
    let((result logFile command status)
        result = strcat(makeTempFileName("/tmp/vcui-config-result-") ".il")
        logFile = strcat(makeTempFileName("/tmp/vcui-config-log-") ".txt")
        command = if(mode == "save" then
            sprintf(nil "bash %s %s config save --out %s --config %s --power-nets %s --ground-nets %s > %s 2>&1"
                VCUIShellArg(strcat(VCUIRoot "/scripts/node24.sh"))
                VCUIShellArg(strcat(VCUIRoot "/dist/cli/skill-ui.js"))
                VCUIShellArg(result) VCUIShellArg(VCUIConfigPath)
                VCUIShellArg(VCUIForm->VCUIPowerNets->value)
                VCUIShellArg(VCUIForm->VCUIGroundNets->value)
                VCUIShellArg(logFile))
        else
            sprintf(nil "bash %s %s config load --out %s --config %s > %s 2>&1"
                VCUIShellArg(strcat(VCUIRoot "/scripts/node24.sh"))
                VCUIShellArg(strcat(VCUIRoot "/dist/cli/skill-ui.js"))
                VCUIShellArg(result) VCUIShellArg(VCUIConfigPath)
                VCUIShellArg(logFile)))
        status = system(command)
        if(status == 0 && isFile(result) && errset(load(result) t) then
            deleteFile(logFile)
        else
            VCUISetStatus(sprintf(nil "Cannot %s personal network settings; see %s" mode logFile))
            VCUIPrintLogDetails(logFile))
        when(isFile(result) deleteFile(result))
        status)
)

procedure(VCUISaveConfig()
    if(VCUIBusy then
        VCUISetStatus("Another operation is running.")
    else
        VCUIBusy = t
        VCUIRunConfig("save")
        VCUIBusy = nil)
)

procedure(VCUIAcceptCatalog(version targets allSymbols)
    unless(version == 1 error("Unsupported VCUI catalog version: %L" version))
    VCUICatalog = targets
    VCUIFullCatalog = allSymbols
    t
)

procedure(VCUIAcceptRules(version rows)
    unless(version == 1 error("Unsupported VCUI mapping version: %L" version))
    VCUIRules = rows
    VCUISessionRules = nil
    t
)

procedure(VCUIAcceptScan(version instanceCount netCount rows)
    unless(version == 1 error("Unsupported VCUI scan protocol version: %L" version))
    rows = foreach(mapcar row rows
        if(nth(2 row) == "omit" then
            list(car(row) cadr(row) "Skip device" nth(3 row) nth(4 row) nth(5 row))
        else row))
    when(VCUIForm
        VCUIUpdateDefaultOutputNames(VCUILastScannedCell VCUIForm->VCUICell->value)
        VCUIUpdateProjectFilenameForSource()
        VCUIForm->VCUIDevices->choices = rows
        VCUIForm->VCUISummary->value = sprintf(nil "%d instances / %d nets / %d masters"
            instanceCount netCount length(rows))
        VCUIScannedSource = list(
            VCUIForm->VCUILibrary->value
            VCUIForm->VCUICell->value
            VCUIForm->VCUIView->value)
        VCUILastScannedCell = VCUIForm->VCUICell->value
        when(VCUIForm->VCUIOutput->value == ""
            VCUIForm->VCUIOutput->value = "/tmp")
        VCUISetStatus("Scan complete. Select a device, then open Edit mapping."))
    t
)

procedure(VCUIAcceptExport(version status output projectFile diagnostics)
    unless(version == 1 error("Unsupported VCUI export protocol version: %L" version))
    VCUILastOutput = output
    printf("VCExport: %s/%s\n" output projectFile)
    foreach(item diagnostics
        cond(
            (car(item) == "error" printf("*Error* VCExport: %s\n" cadr(item)))
            (car(item) == "warning" printf("*WARNING* VCExport: %s\n" cadr(item)))
            (t printf("VCExport info: %s\n" cadr(item)))))
    VCUISetStatus(if(diagnostics then
        sprintf(nil "Export complete (%d items to review): %s/%s" length(diagnostics) output projectFile)
    else
        strcat("Export complete: " output "/" projectFile)))
    t
)

procedure(VCUIAcceptExportError(version code message diagnosticsDirectory details)
    let((summary)
        unless(version == 1 error("Unsupported VCUI export protocol version: %L" version))
        printf("*Error* VCExport [%s]: %s\n" code message)
        foreach(line details printf("VCExport detail: %s\n" line))
        when(diagnosticsDirectory != ""
            printf("VCExport diagnostics: %s\n" diagnosticsDirectory))
        summary = if(details then car(details) else message)
        when(strlen(summary) > 115 summary = strcat(substring(summary 1 112) "..."))
        VCUISetStatus(sprintf(nil "Export failed [%s]: %s" code summary))
        t)
)

procedure(VCUIPrintLogDetails(path)
    let((port line count)
        port = infile(path)
        count = 0
        when(port
            while(gets(line port)
                when(count < 16 &&
                    null(strlen(line) >= 5 && substring(line 1 5) == "VCUI|")
                    printf("VCExport detail: %s\n" line)
                    count = count + 1))
            close(port))
        when(count == 0 printf("VCExport detail: No error text was captured in %s\n" path)))
)

procedure(VCUIChooseOutputFolder()
    let((selection directory)
        selection = hiGetExistingDirectory(
            ?workingDir getWorkingDir()
            ?caption "Choose parent directory for the project"
            ?modal t)
        when(selection
            directory = truename(car(selection))
            VCUIForm->VCUIOutput->value = directory
            VCUISetStatus("Save directory selected; edit the project filename if needed.")))
)

procedure(VCUIRefreshSource()
    let((cv previousCell)
        cv = geGetEditCellView()
        when(cv && cv->viewName == "schematic" && VCUIForm
            previousCell = VCUIForm->VCUICell->value
            VCUIForm->VCUILibrary->value = cv->libName
            VCUIForm->VCUICell->value = cv->cellName
            VCUIForm->VCUIView->value = cv->viewName
            VCUIUpdateDefaultOutputNames(previousCell cv->cellName)
            VCUIUpdateProjectFilenameForSource()
            VCUISetStatus("Current schematic selected. Scan reads the saved cell view."))
        unless(cv && cv->viewName == "schematic"
            VCUISetStatus("Enter a library/cell/view, or open a schematic and press Current."))
    )
)

procedure(VCUIStartScan()
    let((library cell view snapshot result logFile command status exportOk)
        if(VCUIBusy then
            VCUISetStatus("A scan is already running.")
        else
            VCUIBusy = t
            VCUIScannedSource = nil
            library = VCUIForm->VCUILibrary->value
            cell = VCUIForm->VCUICell->value
            view = VCUIForm->VCUIView->value
            if(library == "" || cell == "" || view == "" then
                VCUISetStatus("Library, cell and view are required.")
            else
                snapshot = strcat(makeTempFileName("/tmp/vcui-snapshot-") ".json")
                result = strcat(makeTempFileName("/tmp/vcui-result-") ".il")
                logFile = strcat(makeTempFileName("/tmp/vcui-log-") ".txt")
                VCUISetStatus("Reading saved schematic...")
                unless(getd('VCExportCell)
                    load(strcat(VCUIRoot "/skill/export_schematic.il")))
                exportOk = errset(VCExportCell(library cell view snapshot) t)
                if(exportOk then
                    VCUISetStatus("Scanning devices and mappings...")
                    command = sprintf(nil
                        "bash %s %s scan %s --out %s --mappings %s > %s 2>&1"
                        VCUIShellArg(strcat(VCUIRoot "/scripts/node24.sh"))
                        VCUIShellArg(strcat(VCUIRoot "/dist/cli/skill-ui.js"))
                        VCUIShellArg(snapshot) VCUIShellArg(result)
                        VCUIShellArg(VCUIMappingPath) VCUIShellArg(logFile))
                    status = system(command)
                    if(status == 0 && isFile(result) then
                        if(errset(load(result) t) then
                            deleteFile(snapshot)
                            deleteFile(result)
                            deleteFile(logFile)
                            t
                        else
                            VCUISetStatus(strcat("Cannot read scan result; see " logFile)))
                    else
                        VCUISetStatus(strcat("Scan failed; see " logFile)))
                else
                    VCUISetStatus("Cannot read that schematic; check CIW for details."))
            )
            VCUIBusy = nil
        )
    )
)

procedure(VCUIFindRule(device)
    let((found)
        foreach(rule VCUIRules
            when(car(rule) == device found = rule))
        found)
)

procedure(VCUITargetPins(target)
    let((found)
        foreach(entry VCUICatalog
            when(car(entry) == target found = cadr(entry)))
        found)
)

procedure(VCUISelectedTarget()
    let((target)
        target = VCUIEditor->VCUIEditTarget->value
        if(target == "Skip device" then "omit" else target))
)

procedure(VCUITargetParameters(target)
    let((found)
        foreach(entry VCUICatalog
            when(car(entry) == target found = nth(2 entry)))
        found)
)

procedure(VCUIRefreshEditorStatus()
    let((target pins valid count ignored)
        target = VCUISelectedTarget()
        pins = VCUITargetPins(target)
        valid = t
        ignored = 0
        when(pins
            foreach(row VCUIEditPinRows
                when(cadr(row) == "Unassigned" valid = nil)
                when(cadr(row) == "Ignore" ignored = ignored + 1))
            foreach(pin pins
                count = 0
                foreach(row VCUIEditPinRows
                    when(cadr(row) == pin count = count + 1))
                unless(count == 1 valid = nil)))
        VCUIEditValid = valid
        VCUIEditor->VCUIEditValidation->value =
            if(valid then
                if(target == "generic-box" then
                    "Generic box keeps every source pin. Preview only; not saved."
                else
                    if(target == "omit" then
                        "This device will not be exported. Preview only; not saved."
                    else
                        sprintf(nil "All target pins covered; %d source pins ignored. Preview only; not saved." ignored)))
            else
                "Incomplete mapping: assign each target pin once; explicitly Ignore extra source pins.")
    )
)

procedure(VCUIEditorTargetChanged()
    let((target pins oldTarget oldPairs oldOmitted choices rows assigned)
        target = VCUISelectedTarget()
        pins = VCUITargetPins(target)
        oldTarget = nth(3 VCUIEditRule)
        oldPairs = nth(4 VCUIEditRule)
        oldOmitted = nth(5 VCUIEditRule)
        choices = if(pins then append(list("Unassigned" "Ignore") pins)
            else if(target == "generic-box" then list("Keep") else list("Skip device")))
        VCUIEditor->VCUIEditPinTarget->choices = choices
        VCUIEditor->VCUIEditPinTarget->value = car(choices)
        rows = nil
        foreach(source VCUIEditSourcePins
            assigned = if(target == "generic-box" then "Keep"
                else if(target == "omit" then "Skip device"
                else if(target == oldTarget && assoc(source oldPairs) then
                    cadr(assoc(source oldPairs))
                else if(target == oldTarget && member(source oldOmitted) then "Ignore"
                else if(member(source pins) then source else "Unassigned")))))
            rows = cons(list(source assigned) rows))
        VCUIEditPinRows = reverse(rows)
        VCUIEditor->VCUIEditPins->choices = VCUIEditPinRows
        VCUIEditParamRows = if(target == oldTarget then nth(6 VCUIEditRule) else nil)
        VCUIRefreshEditorStatus())
)

procedure(VCUISelectPin()
    let((selection row)
        selection = VCUIEditor->VCUIEditPins->value
        when(selection
            row = nth(car(selection) VCUIEditPinRows)
            when(row VCUIEditor->VCUIEditPinTarget->value = cadr(row))))
)

procedure(VCUIAssignPin()
    let((selection index i rows choice target)
        selection = VCUIEditor->VCUIEditPins->value
        target = VCUISelectedTarget()
        if(null(selection) then
            VCUIEditor->VCUIEditValidation->value = "Select a source pin first."
        else if(target == "generic-box" || target == "omit" then
            VCUIRefreshEditorStatus()
        else
            index = car(selection)
            choice = VCUIEditor->VCUIEditPinTarget->value
            rows = nil
            i = 0
            foreach(row VCUIEditPinRows
                rows = cons(if(i == index then list(car(row) choice) else row) rows)
                i = i + 1)
            VCUIEditPinRows = reverse(rows)
            VCUIEditor->VCUIEditPins->choices = VCUIEditPinRows
            VCUIEditor->VCUIEditPins->value = list(index)
            VCUIRefreshEditorStatus())))
)

procedure(VCUISelectParameter()
    let((selection row)
        selection = VCUIParamEditor->VCUIParamRows->value
        when(selection
            row = nth(car(selection) VCUIEditParamRows)
            when(row
                VCUIParamEditor->VCUIParamSource->value = car(row)
                VCUIParamEditor->VCUIParamTarget->value = cadr(row))))
)

procedure(VCUIUpsertParameter()
    let((source target targets rows duplicate)
        source = VCUIParamEditor->VCUIParamSource->value
        target = VCUIParamEditor->VCUIParamTarget->value
        targets = VCUITargetParameters(VCUISelectedTarget())
        cond(
            (null(member(source VCUIEditSourceParams))
                VCUIParamEditor->VCUIParamNote->value =
                    strcat("Unknown source parameter: " source))
            (null(member(target targets))
                VCUIParamEditor->VCUIParamNote->value =
                    strcat("Target parameter is not supported: " target))
            (t
                duplicate = nil
                foreach(row VCUIEditParamRows
                    when(cadr(row) == target && car(row) != source duplicate = t))
                if(duplicate then
                    VCUIParamEditor->VCUIParamNote->value =
                        strcat("Target parameter already assigned: " target)
                else
                    rows = nil
                    foreach(row VCUIEditParamRows
                        unless(car(row) == source rows = cons(row rows)))
                    VCUIEditParamRows = append(reverse(rows) list(list(source target)))
                    VCUIParamEditor->VCUIParamRows->choices = VCUIEditParamRows
                    VCUIParamEditor->VCUIParamNote->value =
                        sprintf(nil "%s maps to %s. %d parameter mappings in this edit."
                            source target length(VCUIEditParamRows)))))
    )
)

procedure(VCUIRemoveParameter()
    let((selection index rows i)
        selection = VCUIParamEditor->VCUIParamRows->value
        if(null(selection) then
            VCUIParamEditor->VCUIParamNote->value = "Select a mapping row to remove."
        else
            index = car(selection)
            rows = nil
            i = 0
            foreach(row VCUIEditParamRows
                unless(i == index rows = cons(row rows))
                i = i + 1)
            VCUIEditParamRows = reverse(rows)
            VCUIParamEditor->VCUIParamRows->choices = VCUIEditParamRows
            VCUIParamEditor->VCUIParamNote->value = "Parameter mapping removed from this edit."))
)

procedure(VCUIBuildParameterEditor()
    let((targets)
        unless(VCUIParamEditor
            VCUIParamEditor = hiCreateAppForm(
                ?name 'VCUIParamEditor
                ?formTitle "Virtuoso Canvas | Parameter mapping"
                ?fields list(
                    list(hiCreateLabel(?name 'VCUIParamTitle
                        ?labelText "MAP SOURCE PARAMETERS TO CANVAS PARAMETERS") 20:15 600:22)
                    list(hiCreateReportField(?name 'VCUIParamRows
                        ?headers list(list("Source parameter" 270 'left) list("Canvas parameter" 280 'left))
                        ?choices nil ?selectMode 'single ?callback "VCUISelectParameter()") 20:48 600:165)
                    list(hiCreateStringField(?name 'VCUIParamSource ?prompt "Source" ?value "") 20:235 270:28 65)
                    list(hiCreateCyclicField(?name 'VCUIParamTarget ?prompt "Canvas" ?choices list("none")
                        ?value "none") 310:235 310:28 65)
                    list(hiCreateButton(?name 'VCUIParamAdd ?buttonText "Add / replace"
                        ?callback "VCUIUpsertParameter()") 20:282 165:30)
                    list(hiCreateButton(?name 'VCUIParamRemove ?buttonText "Remove selected"
                        ?callback "VCUIRemoveParameter()") 200:282 165:30)
                    list(hiCreateLabel(?name 'VCUIParamNote ?labelText " ") 20:330 600:35))
                ?buttonLayout 'Close
                ?initialSize 640:430
                ?minSize 640:430
                ?maxSize 640:430))
        targets = VCUITargetParameters(VCUISelectedTarget())
        VCUIParamEditor->VCUIParamTarget->choices = if(targets then targets else list("none"))
        VCUIParamEditor->VCUIParamTarget->value = car(VCUIParamEditor->VCUIParamTarget->choices)
        VCUIParamEditor->VCUIParamRows->choices = VCUIEditParamRows
        VCUIParamEditor->VCUIParamNote->value =
            if(targets then
                sprintf(nil "%d source parameters available. Type an exact name; only mapped values are exported."
                    length(VCUIEditSourceParams))
            else
                "This symbol has no mapped parameters.")
        VCUIParamEditor)
)

procedure(VCUIEditParameters()
    when(VCUIBuildParameterEditor() hiDisplayForm(VCUIParamEditor))
)

procedure(VCUIRuleObject()
    let((target pins omitted)
        target = VCUISelectedTarget()
        cond(
            (target == "generic-box" nil)
            (target == "omit" VCObject(list(list("omit" t))))
            (t
                pins = nil
                omitted = nil
                foreach(row VCUIEditPinRows
                    if(cadr(row) == "Ignore" then
                        omitted = cons(car(row) omitted)
                    else
                        pins = cons(list(car(row) cadr(row)) pins)))
                VCObject(list(
                    list("symbol" target)
                    list("pins" VCObject(reverse(pins)))
                    list("parameters" VCObject(VCUIEditParamRows))
                    list("omitPins" VCArray(reverse(omitted)))))))
    )
)

procedure(VCUIAcceptMapping(version device mode file)
    let((target pins omitted newRule rules rows i ignored sessionRules)
        unless(version == 1 && device == VCUIEditDevice && member(mode list("session" "personal")) &&
            (mode == "session" || file != "")
            error("Unexpected mapping response: %L %L %L %L" version device mode file))
        target = VCUISelectedTarget()
        pins = nil
        omitted = nil
        ignored = 0
        foreach(row VCUIEditPinRows
            if(cadr(row) == "Ignore" then
                omitted = cons(car(row) omitted)
                ignored = ignored + 1
            else
                when(VCUITargetPins(target)
                    pins = cons(list(car(row) cadr(row)) pins))))
        newRule = list(device VCUIEditSourcePins VCUIEditSourceParams target
            reverse(pins) reverse(omitted) VCUIEditParamRows)
        rules = nil
        foreach(rule VCUIRules
            rules = cons(if(car(rule) == device then newRule else rule) rules))
        VCUIRules = reverse(rules)
        VCUIEditRule = newRule
        sessionRules = nil
        foreach(rule VCUISessionRules
            unless(car(rule) == device
                sessionRules = cons(rule sessionRules)))
        VCUISessionRules = reverse(sessionRules)
        when(mode == "session"
            VCUISessionRules = cons(newRule VCUISessionRules))
        rows = nil
        i = 0
        foreach(row VCUIForm->VCUIDevices->choices
            rows = cons(if(i == VCUIEditIndex then
                list(car(row) cadr(row) if(target == "omit" then "Skip device" else target)
                    sprintf(nil "%d pins, %d ignored" length(VCUIEditSourcePins) ignored)
                    mode "ready")
                else row) rows)
            i = i + 1)
        VCUIForm->VCUIDevices->choices = reverse(rows)
        VCUIForm->VCUIDevices->value = list(VCUIEditIndex)
        VCUIEditor->VCUIEditValidation->value = if(mode == "personal" then
            strcat("Saved to: " file)
        else
            "Applied to this run only; no personal file was changed.")
        VCUISetStatus(if(mode == "personal" then
            strcat("Validated and saved to " file)
        else
            "Validated for this run only; personal mappings were not changed."))
        when(mode == "personal" printf("VCUI: Personal mapping saved to %s\n" file))
        t)
)

procedure(VCUIErrorCodeFromLog(path)
    let((port line fields code separator)
        separator = strcat("|" buildString(list(intToChar(10))))
        port = infile(path)
        when(port
            while(gets(line port)
                fields = parseString(line separator)
                when(length(fields) >= 5 && nth(2 fields) == "ERROR"
                    code = nth(4 fields)))
            close(port))
        if(code then code else "UNKNOWN"))
)

procedure(VCUIDoApplyMapping(mode)
    let((snapshot edit result logFile port request command status exported)
        snapshot = strcat(makeTempFileName("/tmp/vcui-apply-snapshot-") ".json")
        edit = strcat(makeTempFileName("/tmp/vcui-apply-edit-") ".json")
        result = strcat(makeTempFileName("/tmp/vcui-apply-result-") ".il")
        logFile = strcat(makeTempFileName("/tmp/vcui-apply-log-") ".txt")
        VCUISetStatus("Validating mapping against saved schematic...")
        unless(getd('VCExportCell)
            load(strcat(VCUIRoot "/skill/export_schematic.il")))
        exported = errset(VCExportCell(
            VCUIForm->VCUILibrary->value
            VCUIForm->VCUICell->value
            VCUIForm->VCUIView->value snapshot) nil)
        if(null(exported) then
            VCUISetStatus("Cannot read saved schematic; check CIW for details.")
        else
            request = VCObject(list(
                list("version" 1)
                list("device" VCUIEditDevice)
                list("rule" VCUIRuleObject())))
            port = outfile(edit)
            unless(port error("Cannot create mapping edit file: %s" edit))
            VCJson(port request)
            fprintf(port "\n")
            close(port)
            command = sprintf(nil
                "bash %s %s apply %s --edit %s --out %s --mode %s --mappings %s > %s 2>&1"
                VCUIShellArg(strcat(VCUIRoot "/scripts/node24.sh"))
                VCUIShellArg(strcat(VCUIRoot "/dist/cli/skill-ui.js"))
                VCUIShellArg(snapshot) VCUIShellArg(edit) VCUIShellArg(result)
                VCUIShellArg(mode) VCUIShellArg(VCUIMappingPath) VCUIShellArg(logFile))
            status = system(command)
            if(status == 0 && isFile(result) then
                if(errset(load(result) nil) then
                    deleteFile(logFile)
                else
                    VCUISetStatus(strcat("Cannot read mapping response; see " logFile)))
            else
                VCUISetStatus(sprintf(nil "Mapping rejected (%s); details: %s"
                    VCUIErrorCodeFromLog(logFile) logFile))))
        when(isFile(snapshot) deleteFile(snapshot))
        when(isFile(edit) deleteFile(edit))
        when(isFile(result) deleteFile(result))
        t)
)

procedure(VCUIApplyMapping(mode)
    let((checked)
        if(VCUIBusy then
            VCUISetStatus("Another scan or mapping operation is running.")
        else
            VCUIRefreshEditorStatus()
            if(null(VCUIEditValid) then
                VCUISetStatus("Mapping is incomplete; assign every target pin once.")
            else
                VCUIBusy = t
                checked = errset(VCUIDoApplyMapping(mode) nil)
                VCUIBusy = nil
                unless(checked VCUISetStatus("Mapping operation failed in SKILL; see CIW."))))
    )
)

procedure(VCUISelectCatalogSymbol()
    let((selection row symbol)
        selection = VCUICatalogForm->VCUICatalogRows->value
        when(selection
            row = nth(car(selection) VCUICatalogForm->VCUICatalogRows->choices)
            when(row
                symbol = car(row)
                if(null(VCUICatalogCanSelect) then
                    VCUICatalogForm->VCUICatalogNote->value =
                        "View only here. Open Edit mapping to choose a symbol."
                else if(nth(3 row) == "supported" then
                    VCUIEditor->VCUIEditTarget->value = symbol
                    VCUIEditorTargetChanged()
                    VCUICatalogForm->VCUICatalogNote->value =
                        strcat("Selected " symbol ". Close this catalog to review pin mapping.")
                else
                    VCUICatalogForm->VCUICatalogNote->value =
                        strcat(symbol " is view-only: conversion is " nth(3 row) "."))))))
)

procedure(VCUIBuildCatalog()
    let((supported other rows)
    if(null(VCUIFullCatalog) then
        VCUISetStatus("Scan a schematic to load the installed symbol catalog.")
        nil
    else
        when(VCUICatalogFormVersion != 2
            VCUICatalogForm = nil
            VCUICatalogFormVersion = 2)
        unless(VCUICatalogForm
            VCUICatalogForm = hiCreateAppForm(
                ?name 'VCUICatalogForm
                ?formTitle "Analog Canvas | Symbol catalog"
                ?fields list(
                    list(hiCreateLabel(?name 'VCUICatalogNote
                        ?labelText "Click a supported symbol to use it; other entries are view-only.") 20:15 760:24)
                    list(hiCreateReportField(
                        ?name 'VCUICatalogRows
                        ?headers list(
                            list("Symbol" 180 'left)
                            list("Category" 140 'left)
                            list("Pins" 245 'left)
                            list("Conversion" 180 'left))
                        ?choices nil
                        ?selectMode 'single
                        ?callback "VCUISelectCatalogSymbol()") 20:48 760:480))
                ?buttonLayout 'Close
                ?initialSize 800:590
                ?minSize 800:590
                ?maxSize 800:590))
        supported = nil
        other = nil
        foreach(row VCUIFullCatalog
            if(nth(3 row) == "supported" then
                supported = cons(row supported)
            else
                other = cons(row other)))
        rows = append(reverse(supported) reverse(other))
        VCUICatalogForm->VCUICatalogRows->choices = rows
        VCUICatalogForm->VCUICatalogNote->value =
            if(VCUICatalogCanSelect then
                "Click a supported symbol to use it; other entries are view-only."
            else
                "View only here. Open Edit mapping to choose a symbol.")
        VCUICatalogForm))
)

procedure(VCUIShowCatalog()
    VCUICatalogCanSelect = nil
    when(VCUIBuildCatalog() hiDisplayForm(VCUICatalogForm))
)

procedure(VCUIShowCatalogForMapping()
    VCUICatalogCanSelect = t
    when(VCUIBuildCatalog() hiDisplayForm(VCUICatalogForm))
)

procedure(VCUIPrepareMapping()
    let((selection row rule targets)
        selection = VCUIForm->VCUIDevices->value
        if(null(selection) then
            VCUISetStatus("Select a device row before editing its mapping.")
            nil
        else
            VCUIEditIndex = car(selection)
            row = nth(VCUIEditIndex VCUIForm->VCUIDevices->choices)
            VCUIEditDevice = car(row)
            rule = VCUIFindRule(VCUIEditDevice)
            if(null(rule) then
                VCUISetStatus("Selected device has no scan details; scan again.")
                nil
            else
                VCUIEditRule = rule
                VCUIEditSourcePins = cadr(rule)
                VCUIEditSourceParams = nth(2 rule)
                when(VCUIEditorFormVersion != 5
                    VCUIEditor = nil
                    VCUIEditorFormVersion = 5)
                unless(VCUIEditor
                    VCUIEditor = hiCreateAppForm(
                        ?name 'VCUIEditor
                        ?formTitle "Virtuoso Canvas | Edit device mapping"
                        ?fields list(
                            list(hiCreateLabel(?name 'VCUIEditIntro ?labelText "DEVICE MAPPING  |  Validate before use or save") 20:15 720:22)
                            list(hiCreateStringField(?name 'VCUIEditMaster ?prompt "Virtuoso master" ?value "" ?editable nil) 20:45 720:28 110)
                            list(hiCreateCyclicField(?name 'VCUIEditTarget ?prompt "Canvas symbol" ?choices list("generic-box")
                                ?value "generic-box" ?callback "VCUIEditorTargetChanged()") 20:85 430:28 110)
                            list(hiCreateButton(?name 'VCUIBrowseCatalog ?buttonText "Browse all symbols..."
                                ?callback "VCUIShowCatalogForMapping()") 475:85 265:28)
                            list(hiCreateLabel(?name 'VCUIPinTitle ?labelText "SOURCE PIN  ->  CANVAS PIN") 20:130 720:22)
                            list(hiCreateReportField(?name 'VCUIEditPins
                                ?headers list(list("Source pin" 310 'left) list("Canvas pin / action" 390 'left))
                                ?choices nil ?selectMode 'single ?callback "VCUISelectPin()") 20:157 720:270)
                            list(hiCreateCyclicField(?name 'VCUIEditPinTarget ?prompt "Selected pin" ?choices list("Unassigned")
                                ?value "Unassigned") 20:445 440:28 110)
                            list(hiCreateButton(?name 'VCUIAssign ?buttonText "Assign pin" ?callback "VCUIAssignPin()") 475:445 265:28)
                            list(hiCreateLabel(?name 'VCUIEditValidation ?labelText " ") 20:495 720:42)
                            list(hiCreateButton(?name 'VCUIParameters ?buttonText "Edit parameters..."
                                ?callback "VCUIEditParameters()") 20:545 210:32)
                            list(hiCreateButton(?name 'VCUIUseSession ?buttonText "Use this run"
                                ?callback "VCUIApplyMapping(\"session\")") 245:545 225:32)
                            list(hiCreateButton(?name 'VCUISavePersonal ?buttonText "Save personal"
                                ?callback "VCUIApplyMapping(\"personal\")") 485:545 255:32))
                        ?buttonLayout 'Close
                        ?initialSize 760:625
                        ?minSize 760:625
                        ?maxSize 760:625))
                targets = list("generic-box" "Skip device")
                foreach(entry VCUICatalog targets = append(targets list(car(entry))))
                VCUIEditor->VCUIEditTarget->choices = targets
                VCUIEditor->VCUIEditMaster->value = VCUIEditDevice
                VCUIEditor->VCUIEditTarget->value = if(nth(3 rule) == "omit" then "Skip device" else nth(3 rule))
                VCUIEditorTargetChanged()
                VCUIEditor)))
)

procedure(VCUIEditMapping()
    when(VCUIPrepareMapping() hiDisplayForm(VCUIEditor))
)

procedure(VCUIStoredRuleObject(rule)
    let((target)
        target = nth(3 rule)
        cond(
            (target == "generic-box" nil)
            (target == "omit" VCObject(list(list("omit" t))))
            (t VCObject(list(
                list("symbol" target)
                list("pins" VCObject(nth(4 rule)))
                list("parameters" VCObject(nth(6 rule)))
                list("omitPins" VCArray(nth(5 rule)))))))
    )
)

procedure(VCUISessionMappingsObject()
    let((devices)
        devices = nil
        foreach(rule VCUISessionRules
            devices = cons(list(car(rule) VCUIStoredRuleObject(rule)) devices))
        VCObject(list(
            list("version" 1)
            list("devices" VCObject(reverse(devices))))))
)

procedure(VCUIResolvedProjectFilename()
    let((value suffix)
        value = VCUIForm->VCUIProjectFile->value
        suffix = ".icproj.json"
        if(strlen(value) >= strlen(suffix) &&
            substring(value strlen(value) - strlen(suffix) + 1 strlen(suffix)) == suffix then
            value
        else
            strcat(value suffix)))
)

procedure(VCUIDoExport(replace)
    let((snapshot session result logFile port command status exported output projectFile bus disabled isolated showNames)
        snapshot = strcat(makeTempFileName("/tmp/vcui-export-snapshot-") ".json")
        session = strcat(makeTempFileName("/tmp/vcui-export-session-") ".json")
        result = strcat(makeTempFileName("/tmp/vcui-export-result-") ".il")
        logFile = strcat(makeTempFileName("/tmp/vcui-export-log-") ".txt")
        output = VCUIForm->VCUIOutput->value
        projectFile = VCUIForm->VCUIProjectFile->value
        bus = if(VCUIForm->VCUIBus->value == "Bundled" then "bundled" else "reject")
        disabled = if(VCUIForm->VCUIDisabled->value == "Skip" then "omit" else "keep")
        isolated = if(VCUIForm->VCUIIsolated->value then "omit" else "keep")
        showNames = if(VCUIForm->VCUIShowNames->value then "true" else "false")
        VCUISetStatus("Reading saved schematic for export...")
        unless(getd('VCExportCell)
            load(strcat(VCUIRoot "/skill/export_schematic.il")))
        exported = errset(VCExportCell(
            VCUIForm->VCUILibrary->value
            VCUIForm->VCUICell->value
            VCUIForm->VCUIView->value snapshot) t)
        if(null(exported) then
            VCUISetStatus("Cannot read saved schematic; check CIW for details.")
        else
            port = outfile(session)
            unless(port error("Cannot create session mapping file: %s" session))
            VCJson(port VCUISessionMappingsObject())
            fprintf(port "\n")
            close(port)
            VCUISetStatus("Converting and validating Analog Canvas project...")
            command = sprintf(nil
                "bash %s %s export %s --out %s --project-file %s --result %s --session %s --mappings %s --config %s --scale %s --bus-mode %s --disabled-instances %s --isolated-ports %s --show-instance-names %s --power-nets %s --ground-nets %s --replace %s > %s 2>&1"
                VCUIShellArg(strcat(VCUIRoot "/scripts/node24.sh"))
                VCUIShellArg(strcat(VCUIRoot "/dist/cli/skill-ui.js"))
                VCUIShellArg(snapshot) VCUIShellArg(output) VCUIShellArg(projectFile) VCUIShellArg(result)
                VCUIShellArg(session) VCUIShellArg(VCUIMappingPath) VCUIShellArg(VCUIConfigPath)
                VCUIShellArg(VCUIForm->VCUIScale->value) VCUIShellArg(bus)
                VCUIShellArg(disabled) VCUIShellArg(isolated) VCUIShellArg(showNames)
                VCUIShellArg(VCUIForm->VCUIPowerNets->value)
                VCUIShellArg(VCUIForm->VCUIGroundNets->value)
                VCUIShellArg(if(replace then "true" else "false"))
                VCUIShellArg(logFile))
            status = system(command)
            if(isFile(result) then
                if(errset(load(result) t) then
                    if(status == 0 || VCUIErrorCodeFromLog(logFile) == "OUTPUT_EXISTS" then
                        deleteFile(logFile)
                    else
                        printf("VCExport log: %s\n" logFile))
                else
                    VCUISetStatus(strcat("Cannot read export response; see " logFile)))
            else
                VCUISetStatus(sprintf(nil "Export failed (%s); details: %s"
                    VCUIErrorCodeFromLog(logFile) logFile))
                printf("*Error* VCExport [%s]: see %s\n" VCUIErrorCodeFromLog(logFile) logFile)
                VCUIPrintLogDetails(logFile)))
        when(isFile(snapshot) deleteFile(snapshot))
        when(isFile(session) deleteFile(session))
        when(isFile(result) deleteFile(result))
        t)
)

procedure(VCUIStartExport()
    let((source checked output projectFile reportFile conflict)
        if(VCUIBusy then
            VCUISetStatus("Another scan, mapping, or export operation is running.")
        else
            source = list(
                VCUIForm->VCUILibrary->value
                VCUIForm->VCUICell->value
                VCUIForm->VCUIView->value)
            output = VCUIForm->VCUIOutput->value
            cond(
                (null(VCUIScannedSource)
                    VCUISetStatus("Scan this schematic before export."))
                (null(equal(source VCUIScannedSource))
                    VCUISetStatus("The source changed after scanning; scan it again before export."))
                (output == ""
                    VCUISetStatus("Output directory is required."))
                (VCUIForm->VCUIProjectFile->value == ""
                    VCUISetStatus("Project filename is required."))
                (VCUIForm->VCUIScale->value == ""
                    VCUISetStatus("Scale is required."))
                (t
                    projectFile = VCUIResolvedProjectFilename()
                    reportFile = strcat(substring(projectFile 1 strlen(projectFile) - strlen(".icproj.json")) ".report.json")
                    conflict = isFile(strcat(output "/" projectFile)) || isFile(strcat(output "/" reportFile))
                    if(conflict && null(hiDisplayAppDBox(
                        ?name 'VCUIOverwriteDialog
                        ?dboxBanner "Replace existing project?"
                        ?dboxText sprintf(nil "Existing files for %s may be replaced in:\n%s\n\nContinue?" projectFile output)
                        ?dialogType hicQuestionDialog
                        ?buttonLayout 'YesNo
                        ?defaultButton 2
                        ?dialogStyle 'modal)) then
                        VCUISetStatus("Export cancelled; existing files were not changed.")
                    else
                        VCUIBusy = t
                        checked = errset(VCUIDoExport(conflict) t)
                        VCUIBusy = nil
                        unless(checked VCUISetStatus("Export failed in SKILL; see CIW."))))))
    )
)

procedure(VCUIOpenCanvas()
    let((logFile command status port line)
        logFile = strcat(makeTempFileName("/tmp/vcui-canvas-") ".txt")
        command = sprintf(nil "bash %s %s > %s 2>&1"
            VCUIShellArg(strcat(VCUIRoot "/scripts/node24.sh"))
            VCUIShellArg(strcat(VCUIRoot "/scripts/open_canvas.mjs"))
            VCUIShellArg(logFile))
        status = system(command)
        port = infile(logFile)
        when(port
            gets(line port)
            close(port))
        if(status == 0 then
            VCUISetStatus(strcat("Local Analog Canvas opened: " line))
            deleteFile(logFile)
        else
            VCUISetStatus(sprintf(nil "Cannot open local Analog Canvas: %s (log: %s)"
                if(line then line else "unknown error") logFile)))
        status)
)

procedure(VCUIBuildForm()
    when(VCUIFormVersion != 9
        VCUIForm = nil
        VCUIFormVersion = 9)
    unless(VCUIForm
        VCUIForm = hiCreateAppForm(
            ?name 'VCUIForm
            ?formTitle "Virtuoso Canvas | Export schematic"
            ?fields list(
                list(hiCreateLabel(?name 'VCUISourceTitle ?labelText "SOURCE SCHEMATIC") 20:14 800:22)
                list(hiCreateStringField(?name 'VCUILibrary ?prompt "Library" ?value "") 20:42 270:28 65)
                list(hiCreateStringField(?name 'VCUICell ?prompt "Cell" ?value "") 300:42 270:28 45)
                list(hiCreateStringField(?name 'VCUIView ?prompt "View" ?value "schematic") 580:42 185:28 45)
                list(hiCreateButton(?name 'VCUICurrent ?buttonText "Current" ?callback "VCUIRefreshSource()") 780:42 100:28)
                list(hiCreateButton(?name 'VCUIScan ?buttonText "Scan devices" ?callback "VCUIStartScan()") 20:80 150:30)
                list(hiCreateLabel(?name 'VCUISummary ?labelText "No scan yet") 185:83 690:23)
                list(hiCreateLabel(?name 'VCUIMappingTitle ?labelText "DEVICE MAPPINGS  |  Unmapped devices use a generic box") 20:125 860:22)
                list(hiCreateReportField(
                    ?name 'VCUIDevices
                    ?headers list(
                        list("Virtuoso master" 175 'left)
                        list("Count" 55 'left)
                        list("Canvas symbol" 150 'left)
                        list("Pins" 260 'left)
                        list("Rule" 75 'left)
                        list("State" 75 'left))
                    ?choices nil
                    ?selectMode 'single) 20:155 860:192)
                list(hiCreateButton(?name 'VCUIEditButton ?buttonText "Edit mapping..." ?callback "VCUIEditMapping()") 20:357 150:28)
                list(hiCreateButton(?name 'VCUICatalogButton ?buttonText "Symbol catalog..." ?callback "VCUIShowCatalog()") 185:357 165:28)
                list(hiCreateLabel(?name 'VCUIOptionsTitle ?labelText "EXPORT OPTIONS") 20:400 860:22)
                list(hiCreateStringField(?name 'VCUIOutput ?prompt "Save directory" ?value "") 20:430 710:28 105)
                list(hiCreateButton(?name 'VCUIBrowseOutput ?buttonText "Browse..." ?callback "VCUIChooseOutputFolder()") 740:430 140:28)
                list(hiCreateStringField(?name 'VCUIProjectFile ?prompt "Project filename" ?value "") 20:470 475:28 105)
                list(hiCreateStringField(?name 'VCUIScale ?prompt "Scale" ?value "140") 520:470 175:28 60)
                list(hiCreateLabel(?name 'VCUIBusLabel ?labelText "Bus") 20:514 40:22)
                list(hiCreateCyclicField(?name 'VCUIBus ?prompt " " ?choices list("Bundled" "Reject") ?value "Bundled") 70:510 150:28 0)
                list(hiCreateLabel(?name 'VCUIDisabledLabel ?labelText "Disabled") 300:514 65:22)
                list(hiCreateCyclicField(?name 'VCUIDisabled ?prompt " " ?choices list("Keep" "Skip") ?value "Keep") 375:510 150:28 0)
                list(hiCreateBooleanButton(?name 'VCUIShowNames ?buttonText " " ?value t) 20:555 24:26)
                list(hiCreateLabel(?name 'VCUIShowNamesLabel ?labelText "Show instance names") 50:558 185:22)
                list(hiCreateBooleanButton(?name 'VCUIIsolated ?buttonText " " ?value t) 280:555 24:26)
                list(hiCreateLabel(?name 'VCUIIsolatedLabel ?labelText "Skip unconnected pins") 310:558 180:22)
                list(hiCreateStringField(?name 'VCUIPowerNets ?prompt "Power nets" ?value "") 20:595 860:28 95)
                list(hiCreateStringField(?name 'VCUIGroundNets ?prompt "Ground nets" ?value "") 20:632 860:28 95)
                list(hiCreateButton(?name 'VCUISaveConfig ?buttonText "Save network settings" ?callback "VCUISaveConfig()") 20:675 190:30)
                list(hiCreateLabel(?name 'VCUIConfigInfo ?labelText "Network names: space-separated; unsaved values apply to this export.") 225:678 655:23)
                list(hiCreateLabel(?name 'VCUIStatusTitle ?labelText "STATUS") 20:720 860:20)
                list(hiCreateLabel(?name 'VCUIStatus ?labelText "Open a schematic or enter its library/cell/view.") 20:745 860:23)
                list(hiCreateButton(?name 'VCUIOpenCanvas ?buttonText "Open Analog Canvas" ?callback "VCUIOpenCanvas()") 20:785 190:32)
                list(hiCreateButton(?name 'VCUIExport ?buttonText "Export project" ?callback "VCUIStartExport()") 690:785 190:32)
            )
            ?buttonLayout 'Empty
            ?initialSize 900:850
            ?minSize 900:850
            ?maxSize 900:850
        ))
    when(VCUIForm->VCUILibrary->value == "" VCUIRefreshSource())
    VCUIForm
)

procedure(VCUIShow()
    VCUIBuildForm()
    VCUIRunConfig("load")
    hiDisplayForm(VCUIForm)
    VCUIForm
)

procedure(VCUIShowFromSchematic()
    VCUIBuildForm()
    VCUIRefreshSource()
    VCUIRunConfig("load")
    hiDisplayForm(VCUIForm)
    VCUIForm
)

procedure(VCUICreateSchematicMenu()
    hiCreatePulldownMenu(
        'VCUISchematicMenu
        "Schematic to Canvas"
        list(hiCreateMenuItem(
            ?name 'VCUIExportSchematicMenuItem
            ?itemText "Export schematic..."
            ?callback "VCUIShowFromSchematic()")))
)

procedure(VCUISchematicMenuTrigger(args)
    list(VCUICreateSchematicMenu())
)

procedure(VCUIRegisterSchematicMenu()
    let((app info checked cv win menu index)
        foreach(app list("schematic" "schematicXL" "analogArtist-schematic")
            info = deGetAppInfo(app)
            unless(info && member('VCUISchematicMenuTrigger info->userMenuTrigList)
                deRegUserTriggers(app nil 'VCUISchematicMenuTrigger)))
        foreach(win hiGetWindowList()
            when(win != hiGetCIWindow() && rexMatchp("chematic" hiGetAppType(win))
                checked = errset(geGetWindowCellView(win) nil)
                cv = if(checked then car(checked) else nil)
                when(cv && cv->viewName == "schematic"
                    index = 0
                    foreach(menu hiGetBannerMenus(win)
                        when(get_pname(menu) == "VCUISchematicMenu"
                            hiDeleteBannerMenu(win index))
                        index = index + 1)
                    VCUICreateSchematicMenu()
                    hiInsertBannerMenu(win 'VCUISchematicMenu hiGetNumMenus(win)))))
        t)
)

VCUIRegisterSchematicMenu()
