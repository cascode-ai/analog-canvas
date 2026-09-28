; Versioned, read-only snapshot of one schematic cellView.
procedure(VCObject(pairs) list('aaObject pairs))
procedure(VCArray(values) list('aaArray values))
procedure(VCString(port value)
  let((ch code)
    fprintf(port "\"")
    for(i 1 strlen(value)
      ch=substring(value i 1)
      code=charToInt(concat(ch))
      cond(
        (code==34 fprintf(port "\\\""))
        (code==92 fprintf(port "\\\\"))
        (code<32 fprintf(port "\\u%04x" code))
        (t fprintf(port "%s" ch))))
    fprintf(port "\"")))
procedure(VCJson(port value)
  cond(
    (null(value) fprintf(port "null"))
    (stringp(value) VCString(port value))
    (numberp(value) fprintf(port "%L" value))
    (value==t fprintf(port "true"))
    (value=='aaFalse fprintf(port "false"))
    (car(value)=='aaObject
      fprintf(port "{")
      let((first) first=t
        foreach(pair cadr(value)
          unless(first fprintf(port ",")) first=nil
          VCString(port car(pair)) fprintf(port ":") VCJson(port cadr(pair))))
      fprintf(port "}"))
    (car(value)=='aaArray
      fprintf(port "[")
      let((first) first=t
        foreach(item cadr(value)
          unless(first fprintf(port ",")) first=nil VCJson(port item)))
      fprintf(port "]"))
    (t error("Unsupported JSON value: %L" value))))
procedure(VCValue(value)
  cond((null(value) nil) (stringp(value) value) (numberp(value) value)
    (value==t t)
    (listp(value) VCArray(mapcar('VCValue value)))
    (t sprintf(nil "%L" value))))
procedure(VCProps(obj)
  VCArray(foreach(mapcar p obj~>prop
    VCObject(list(list("name" p~>name) list("type" p~>valueType)
      list("value" VCValue(p~>value)))))))
procedure(VCShape(shape id @optional attachedWireId)
  VCObject(list(
    list("id" id) list("type" shape~>objType)
    list("layer" shape~>layerName) list("purpose" shape~>purpose)
    list("netId" shape~>net~>name)
    list("bbox" VCValue(shape~>bBox))
    list("points" VCValue(shape~>points))
    list("position" VCValue(shape~>xy))
    list("attachedWireId" attachedWireId)
    list("text" if(shape~>objType=="textDisplay" then
      if(shape~>text=="name" then shape~>associate~>name else nil)
      else shape~>theLabel)) list("labelType" shape~>labelType)
    list("displayAttribute" shape~>text) list("parentInstanceId" shape~>parent~>name)
    list("visible" if(shape~>isVisible then t else 'aaFalse))
    list("ellipseBBox" VCValue(shape~>ellipseBBox))
    list("startAngle" shape~>startAngle) list("stopAngle" shape~>stopAngle)
    list("orientation" shape~>orient) list("height" shape~>height)
    list("justify" shape~>justify) list("font" shape~>font)
    list("width" shape~>width)
    list("properties" VCProps(shape)))))
procedure(VCAttachedWireId(parent shapes)
  let((index result)
    index=0
    foreach(shape shapes
      index=index+1
      when(shape==parent result=sprintf(nil "shape-%d" index)))
    result))
procedure(VCPins(term transform)
  VCArray(foreach(mapcan pin term~>pins
    foreach(mapcar fig pin~>figs
      VCObject(list(list("figureType" fig~>objType)
        list("instanceId" if(fig~>objType=="inst" then fig~>name else nil))
        list("localBBox" VCValue(fig~>bBox))
        list("worldBBox" VCValue(dbTransformBBox(fig~>bBox transform)))
        list("localCenter" VCValue(centerBox(fig~>bBox)))
        list("worldCenter" VCValue(dbTransformPoint(centerBox(fig~>bBox) transform)))))))))
; Read simulator metadata only. Never invoke PDK callbacks or netlist procedures.
procedure(VCSimulationInfo(cdf)
  let((entries checked info)
    when(cdf
      foreach(sim '(spectre hspiceD auCdl)
        ; Guard the entire optional metadata read, not only simulator lookup.
        checked=errset(progn(
          info=get(cdf->simInfo sim)
          when(info
            ; simInfo entries are DPLs: ~> would map over their list elements.
            VCObject(list(
              list("name" symbolToString(sim))
              list("termOrder" VCValue(info->termOrder))
              list("componentName" VCValue(info->componentName))
              list("modelName" VCValue(info->modelName)))))) nil)
        if(checked then
          when(car(checked) entries=cons(car(checked) entries))
          else
          warn("VCExport: cannot read %s CDF simulation metadata; skipping this simulator.\n"
            symbolToString(sim)))))
    VCObject(list(list("status" if(entries then "available" else "unavailable"))
      list("simulators" VCArray(reverse(entries)))))))
procedure(VCExportSchematic(path @optional selectedCellView)
  let((cv instances nets shapes terminals symbols warnings index symbolId root port cdf params)
    cv=or(selectedCellView geGetEditCellView())
    unless(cv && cv~>cellViewType=="schematic" error("Provide a schematic cellView or select a schematic editor"))
    when(isFile(path) error("Output already exists: %s" path))
    warnings=list("Connectivity is read as stored; no schCheck or connectivity extraction was run."
      "Single-level export; hierarchy is represented by symbol instances."
      "Pin centers are geometric centers, not guaranteed wire attachment points."
      "Symbol labels retain raw expressions; dynamic display text is not evaluated.")
    foreach(inst cv~>instances
      symbolId=strcat(inst~>libName "/" inst~>cellName "/" inst~>viewName)
      ; Include geometry variants separately: evaluated masters may differ by parameters.
      symbolId=strcat(symbolId "/" inst~>name)
      when(inst~>master~>instances || inst~>master~>mosaics
        warnings=cons(sprintf(nil "Symbol %s contains nested instances/mosaics not exported" symbolId) warnings))
      params=nil
      cdf=cdfGetInstCDF(inst)
      when(cdf
        foreach(p cdf~>parameters
          params=cons(VCObject(list(list("name" p~>name) list("type" p~>type)
            list("value" VCValue(p~>value)))) params)))
      instances=cons(VCObject(list(
        list("id" inst~>name) list("name" inst~>name)
        list("library" inst~>libName) list("cell" inst~>cellName) list("view" inst~>viewName)
        list("symbolId" symbolId) list("position" VCValue(inst~>xy))
        list("orientation" inst~>orient) list("transform" VCValue(inst~>transform))
        list("bbox" VCValue(inst~>bBox)) list("arrayCount" inst~>numInst)
        list("properties" VCProps(inst)) list("effectiveCdfParameters" VCArray(reverse(params)))
        list("simulationInfo" VCSimulationInfo(cdf))
        list("terminals" VCArray(foreach(mapcar it inst~>instTerms
          VCObject(list(list("name" it~>name) list("netId" it~>net~>name)
            list("direction" it~>term~>direction) list("pins" VCPins(it~>term inst~>transform))))))))) instances)
      index=0
      symbols=cons(VCObject(list(list("id" symbolId)
        list("bbox" VCValue(inst~>master~>bBox))
        list("shapes" VCArray(foreach(mapcar fig inst~>master~>shapes
          index=index+1
          unless(member(fig~>objType '("line" "path" "rect" "label" "polygon" "ellipse" "arc" "textDisplay"))
            warnings=cons(sprintf(nil "Symbol %s: shape %s needs additional geometry support" symbolId fig~>objType) warnings))
          VCShape(fig sprintf(nil "shape-%d" index)))))
        list("terminals" VCArray(foreach(mapcar term inst~>master~>terminals
          VCObject(list(list("name" term~>name) list("direction" term~>direction)
            list("pins" VCPins(term list(0:0 "R0" 1)))))))))) symbols)
      when(inst~>numInst>1 warnings=cons(sprintf(nil "Iterated instance %s is not expanded" inst~>name) warnings)))
    foreach(net cv~>nets
      nets=cons(VCObject(list(list("id" net~>name) list("name" net~>name)
        list("isGlobal" if(net~>isGlobal t 'aaFalse)) list("signalType" net~>sigType)
        list("numBits" net~>numBits) list("aliases" VCValue(net~>aliases))
        list("terminals" VCArray(foreach(mapcar it net~>instTerms
          VCObject(list(list("instanceId" it~>inst~>name) list("pinName" it~>name)))))))) nets)
      when(net~>numBits>1 warnings=cons(sprintf(nil "Bus %s is not expanded" net~>name) warnings)))
    foreach(term cv~>terminals
      terminals=cons(VCObject(list(list("id" term~>name) list("name" term~>name)
        list("netId" term~>net~>name) list("direction" term~>direction)
        list("pins" VCPins(term list(0:0 "R0" 1))))) terminals))
    index=0
    foreach(shape cv~>shapes
      index=index+1
      shapes=cons(VCShape(shape sprintf(nil "shape-%d" index)
        if(shape~>objType=="label" && shape~>parent &&
            member(shape~>parent~>objType '("line" "path")) then
          VCAttachedWireId(shape~>parent cv~>shapes) else nil)) shapes)
      unless(member(shape~>objType '("line" "path" "rect" "label" "polygon" "ellipse" "arc" "textDisplay"))
        warnings=cons(sprintf(nil "Top-level shape %s needs additional geometry support" shape~>objType) warnings)))
    when(cv~>mosaics warnings=cons("Mosaics are not exported" warnings))
    root=VCObject(list(list("schemaVersion" 1) list("format" "analog-agent.schematic")
      list("source" VCObject(list(list("library" cv~>libName) list("cell" cv~>cellName)
        list("view" cv~>viewName) list("virtuosoVersion" getVersion()))))
      list("coordinates" VCObject(list(list("space" "Virtuoso schematic user coordinates")
        list("yAxis" "up") list("dbuPerUserUnit" cv~>DBUPerUU))))
      list("instances" VCArray(reverse(instances))) list("symbols" VCArray(reverse(symbols)))
      list("nets" VCArray(reverse(nets))) list("terminals" VCArray(reverse(terminals)))
      list("shapes" VCArray(reverse(shapes))) list("warnings" VCArray(reverse(warnings)))))
    port=outfile(path)
    unless(port error("Cannot write %s" path))
    unwindProtect(VCJson(port root) close(port))
    list("exported" path length(instances) length(nets) length(shapes))))

procedure(VCExportCell(library cell view path)
  let((cv)
    cv=dbOpenCellViewByType(library cell view "schematic" "r")
    unless(cv error("Cannot open schematic %s/%s/%s" library cell view))
    ; Release only our open reference; never purge another editor's changes.
    unwindProtect(VCExportSchematic(path cv) dbClose(cv))))
