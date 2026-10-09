"""Import one prepared circuit through PyAether; the caller owns the session.

Aether(api, library, library_parent) contains no SSH or batch selection logic.
Call preflight for every source, open once, then import_one / verify_one per cell.
"""

import os
from pathlib import Path

from aether_geometry import (build_layout, planned_wire_segments, pin_orientation, TARGET_PIN_OFFSETS)
from aether_parameters import parameter_plan, read_parameters, check_parameters
from common import validate_aether_manifest

LINE_LAYER = 228

def object_name(value):
    for attribute in (
        "name",
        "getName",
        "_emyInst__getName",
        "_emyInstTerm__getName",
        "_emyTerm__getName",
        "_emyNet__getName",
    ):
        if not hasattr(value, attribute):
            continue
        result = getattr(value, attribute)
        try:
            result = result() if callable(result) else result
        except Exception:
            continue
        if result is not None:
            return str(result)
    return None

def master_term_name(inst_term):
    for method in ("getTermName",):
        if hasattr(inst_term, method):
            try:
                result = getattr(inst_term, method)()
                if result is not None:
                    return str(result)
            except Exception:
                pass
    for method in ("getTerm", "_emyInstTerm__getTerm"):
        if hasattr(inst_term, method):
            try:
                return object_name(getattr(inst_term, method)())
            except Exception:
                pass
    return object_name(inst_term)


class Aether:
    name = "aether"

    def __init__(self, api, library, library_parent):
        self.api = api
        self.library = library
        self.library_parent = Path(library_parent)
        self.emit = lambda phase, cell, **details: None
        self._ready = False
        self._preflight = False

    def preflight(self, source):
        validate_aether_manifest({"schema": "analog-canvas-hes-pyaether-import-v8",
            "targetTechnology": "hes", "targetLibrary": self.library, "circuits": [source]})
        if not self.library_parent.is_absolute() or not self.library_parent.is_dir():
            raise ValueError("Use an absolute, existing native-library parent directory")
        if (self.library_parent / self.library).exists():
            raise FileExistsError("Target library already exists; choose a new library")
        self.validate_source(source)
        self._preflight = True

    def validate_source(self, source):
        validate_aether_manifest({"schema": "analog-canvas-hes-pyaether-import-v8",
            "targetTechnology": "hes", "targetLibrary": self.library, "circuits": [source]})
        if any(port.get("synthesized") for port in source["sourceGeometry"]["portOccurrences"]):
            raise ValueError("Invented graphical ports are not allowed")
        layout = build_layout(source)
        if layout["geometryAudit"]["afterViolationCount"]:
            raise ValueError("Geometry constraints failed: " + source["cellName"])
        for item in source["instances"]:
            parameter_plan(item)

    def open(self):
        if self._ready:
            raise RuntimeError("Target library is already open")
        if not self._preflight:
            raise RuntimeError("Preflight the sources before opening the target")
        self.api.emyInitTcl()
        self.api.emyInitDb()
        self.validate_target_pin_offsets()
        if (self.library_parent / self.library).exists():
            raise FileExistsError("Target library already exists; choose a new library")
        library = self.api.dbCreateLib(self.library, path=str(self.library_parent), attachTechLib="hes")
        if library is None or library == 0:
            raise RuntimeError("Aether could not create target library " + self.library)
        self._ready = True

    def verify_one(self, source, result):
        from aether_readback import verify_one
        return verify_one(self.api, self.library, source)

    def read_master_pin_offsets(self, library, cell):
        master = self.api.dbOpenCV(library, cell, "symbol", "r")
        if master is None or master == 0:
            raise RuntimeError("Cannot open native master " + library + "/" + cell)
        result = {}
        try:
            for term in list(master.getTopBlock().getTerms()):
                pins = list(term.getPins())
                if len(pins) != 1:
                    raise ValueError(
                        "%s/%s.%s expected one pin, got %d"
                        % (library, cell, object_name(term), len(pins))
                    )
                figures = list(pins[0].getFigs())
                if len(figures) != 1:
                    raise ValueError(
                        "%s/%s.%s expected one pin figure, got %d"
                        % (library, cell, object_name(term), len(figures))
                    )
                box = figures[0].dbuBox
                left = box.left() if callable(box.left) else box.left
                right = box.right() if callable(box.right) else box.right
                bottom = box.bottom() if callable(box.bottom) else box.bottom
                top = box.top() if callable(box.top) else box.top
                result[object_name(term)] = (
                    int((left + right) // 2),
                    int((bottom + top) // 2),
                )
        finally:
            master.close()
        return result

    def validate_target_pin_offsets(self):
        for master_name, expected in TARGET_PIN_OFFSETS.items():
            library, cell = master_name.split("/", 1)
            actual = self.read_master_pin_offsets(library, cell)
            if actual != expected:
                raise ValueError(
                    "%s target pin coordinates changed: expected=%r actual=%r"
                    % (master_name, expected, actual)
                )

    def db_point(self, design, xy):
        point = self.api.emyPointF()
        self.api.emyDbu2UU(design, (int(xy[0]), int(xy[1])), point)
        return point

    def segment(self, design, net, start, end):
        start = tuple(map(int, start))
        end = tuple(map(int, end))
        if start == end:
            return 0
        figures = self.api.dbCrtSchWire(
            design, [self.db_point(design, start), self.db_point(design, end)]
        )
        for figure in figures:
            figure.addToNet(net)
            self.api.dbAddFigToNet(figure, net)
        return len(figures)

    def junction(self, block, net, xy):
        x, y = xy
        dot = self.api.emyEllipse.create(
            block, LINE_LAYER, self.api.emvPurposeNumberDrawing, (x - 5, y - 5, x + 5, y + 5)
        )
        dot.addToNet(net)

    def create_pin(self, design, net, port, xy):
        api_direction = (
            "inputOutput" if port["direction"] == "inout" else port["direction"]
        )
        pin = self.api.dbCrtSchPin(
            design,
            port["name"],
            self.db_point(design, xy),
            api_direction,
            False,
            pin_orientation(port),
        )
        if pin is None:
            raise ValueError("PyAether failed to create pin %s" % port["name"])
        term = pin.getTerm()
        if term is None:
            raise ValueError("PyAether pin %s has no terminal" % port["name"])
        term.moveToNet(net)

    def bind_instance_terms(self, instance, item, nets, design=None, cell=None):
        expected = {node["pinName"]: node["netName"] for node in item["nodes"]}
        bound = set()
        for inst_term in list(instance.getInstTerms()):
            pin_name = master_term_name(inst_term)
            if pin_name not in expected:
                continue
            net_name = expected[pin_name]
            net = self.api.dbFindNetByName(design, net_name) if design is not None else nets[net_name]
            if net is None or net == 0:
                raise ValueError("%s.%s: native net is missing: %s" % (item["reference"], pin_name, net_name))
            if cell is not None:
                self.emit("bind-terminal", cell, reference=item["reference"],
                                    terminal=pin_name, net=net_name)
            inst_term.addToNet(net)
            bound.add(pin_name)
        if bound != set(expected):
            raise ValueError(
                "%s terminal bind mismatch expected=%s actual=%s"
                % (item["reference"], sorted(expected), sorted(bound))
            )

    def import_one(self, source):
        if not self._ready:
            raise RuntimeError("Open the target library before importing a circuit")
        validate_aether_manifest({"schema": "analog-canvas-hes-pyaether-import-v8",
            "targetTechnology": "hes", "targetLibrary": self.library, "circuits": [source]})
        self.validate_source(source)
        layout = build_layout(source)
        cell_file = os.path.join(
            str(self.library_parent), self.library, source["cellName"], "schematic", "sch.oa"
        )
        if os.path.isfile(cell_file):
            raise FileExistsError("Refusing to reuse or overwrite %s; choose a new library or run the verifier explicitly" % cell_file)

        self.api.dbNewCV(self.library, source["cellName"], "schematic")
        design = self.api.dbOpenCV(self.library, source["cellName"], "schematic", "w")
        if design is None or design == 0:
            raise RuntimeError("Aether could not open new cell %s/%s" % (self.library, source["cellName"]))
        try:
            return self.populate_cell(source, layout, design)
        finally:
            design.close()

    def populate_cell(self, source, layout, design):
        block = design.getTopBlock()
        if block is None:
            block = self.api.emyBlock.create(design)
        nets = {}
        for name in source["nets"]:
            net = self.api.dbCrtNet(design, name)
            if net is None or net == 0:
                raise ValueError("%s: Aether rejected net name %r" % (source["cellName"], name))
            nets[name] = net
        for port in source["ports"]:
            term = self.api.dbCrtTerm(nets[port["netName"]], port["name"], "inputOutput")
            if term is None or term == 0:
                raise ValueError("%s: Aether rejected terminal %r" % (source["cellName"], port["name"]))

        parameters = {}
        for item in source["instances"]:
            self.emit("instance", source["cellName"], reference=item["reference"],
                                master=item["targetLibrary"] + "/" + item["targetCell"])
            master = self.api.dbOpenCV(item["targetLibrary"], item["targetCell"], "symbol", "r")
            if master is None or master == 0:
                raise RuntimeError("Cannot open native master for " + item["reference"])
            try:
                self.emit("create-instance", source["cellName"], reference=item["reference"])
                instance = self.api.dbCrtInst(
                    design,
                    self.db_point(design, layout["placements"][item["reference"]]),
                    master,
                    inst=item["reference"],
                    orient=layout["orientations"][item["reference"]],
                )
                if instance is None or instance == 0:
                    raise RuntimeError("Cannot create native instance " + item["reference"])
                self.bind_instance_terms(instance, item, nets, design, source["cellName"])
                plan = parameter_plan(item)
                for name, value in plan["writes"]:
                    self.emit("parameter", source["cellName"], reference=item["reference"],
                                        parameter=name, value=value)
                    if not self.api.dbSetInstParam(instance, name, value, mode=1):
                        raise ValueError("%s: parameter write failed: %s=%s" % (item["reference"], name, value))
                actual = read_parameters(self.api, instance, plan["expected"])
                mismatches = check_parameters(actual, plan["expected"])
                if mismatches:
                    raise ValueError("%s: PDK changed requested parameters: %r" % (item["reference"], mismatches))
                parameters[item["reference"]] = actual
                # Keep the master's native interpreted labels. schSetPropertyDisplay
                # creates extra instance text; it does not hide inherited CDF labels.
            finally:
                master.close()

        self.emit("wires", source["cellName"])
        wire_figures = 0
        for net_name, start, end in planned_wire_segments(layout):
            wire_figures += self.segment(design, nets[net_name], start, end)
        for item in layout["junctions"]:
            if item["role"] == "branch":
                self.junction(block, nets[item["netName"]], item["xy"])
        for port in layout["ports"]:
            self.emit("port", source["cellName"], port=port)
            self.create_pin(design, nets[port["netName"]], port, port["xy"])
        for marker in layout["internalNetMarkers"]:
            label = self.api.dbCrtLabel(design, self.db_point(design, marker["xy"]), marker["netName"],
                                  0.05, layer="228", draft=False)
            if label is None:
                raise RuntimeError("Cannot create internal net marker %s" % marker["netName"])
            self.api.dbAddFigToNet(label, nets[marker["netName"]])

        self.emit("save", source["cellName"])
        design.save()
        return {
            "cellName": source["cellName"],
            "galleryId": source["galleryId"],
            "galleryName": source["galleryName"],
            "instances": len(source["instances"]),
            "logicalPorts": [item["name"] for item in source["ports"]],
            "portOccurrences": len(layout["ports"]),
            "bulkLabels": len(source["sourceGeometry"].get("localBulkLabels", [])),
            "bulkShorts": len(source["sourceGeometry"].get("localBulkShorts", [])),
            "nets": len(source["nets"]),
            "wireFigures": wire_figures,
            "reusedExistingCell": False,
            "geometryMode": "Analog Canvas faithful",
            "sourceRoutes": source["sourceGeometry"]["sourceRouteCount"],
            "retainedRoutes": source["sourceGeometry"]["retainedRouteCount"],
            "sourceTransformsApplied": True,
            "repeatedPortsApplied": True,
            "instanceTermNetsBoundDirectly": True,
            "parametersWrittenAndReadBack": parameters,
            "labelMode": "native-pdk",
            "nativeNameMap": source.get("nativeNameMap", {}),
            "sizingAdjustments": [{"reference": item["reference"], **item["targetSizingAdjustment"]}
                                  for item in source["instances"] if item.get("targetSizingAdjustment")],
            "logicalOnlyPorts": source["sourceGeometry"].get("logicalOnlyPorts", []),
            "geometryAudit": layout["geometryAudit"],
        }
