"""Offline candidate conversion only; never edits upstream or registers a Profile.

Uses a pinned upstream parser and explicit lowerings, not text-only deck rewrite.
Python 3.10+ and Git are required. Output lives in a fresh directory per attempt.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re
import subprocess
import sys
import tempfile
from copy import deepcopy
from lib.vacask_model_binning import source_bin_guards
from lib.vacask_source_arithmetic import real_source_division

VACASK_REV = "c1a1c84f1b2b9aa71c0cddf06e555441434db7b7"
MODELS_REV = "403964dc7f9cca5ec1a8cc7b4f2a6f532b781676"

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--upstream", type=Path, required=True, help="clean pinned VACASK checkout")
parser.add_argument("--models", type=Path, required=True, help="clean pinned fossi-foundation/skywater-pdk-libs-sky130_fd_pr checkout")
parser.add_argument("--output", type=Path, required=True, help="parent of fresh candidate directories")
parser.add_argument("--corners", nargs="+", choices=["tt", "ff", "ss", "fs", "sf"], default=["tt", "ff", "ss", "fs", "sf"])
args = parser.parse_args()


def verify_checkout(directory, revision, paths):
    def git(*words):
        return subprocess.check_output(["git", "-C", str(directory), *words], text=True).strip()
    if git("rev-parse", "HEAD") != revision:
        raise ValueError(f"Unexpected source revision: {directory}; expected {revision}")
    # Compare content, not cached stat flags (Git can retain an M flag after
    # restoring LF-equivalent bytes on an autocrlf Windows checkout).
    if (git("diff", "HEAD", "--", *paths)
            or git("ls-files", "--others", "--exclude-standard", "--", *paths)):
        raise ValueError(f"Source files are dirty: {directory}; do not patch upstream in place")


verify_checkout(args.upstream, VACASK_REV, ["python/ng2vclib"])
verify_checkout(args.models, MODELS_REV, ["combined_models"])
source = args.models.resolve() / "combined_models"
sys.path.insert(0, str(args.upstream.resolve() / "python"))
from ng2vclib.converter import Converter
from ng2vclib.dfl import default_config

cfg = default_config()
cfg["sourcepath"] = [str(source)]
for version in ("4.5", "4.62"):
    # Product-approved explicit equation-version upgrade. Preserve source
    # declarations in conversion evidence, not a misleading native selector.
    cfg["family_map"][("mos", 54, version)] = (
        "spice/bsim4v8.osdi", "sp_bsim4v8", {"version": '"4.8.3"'}
    )
cfg["family_map"][("mos", 54, None)] = ("spice/bsim4v8.osdi", "sp_bsim4v8", {"version": '"4.8.3"'})
cfg["remove_model_params"]["sp_bsim4v8"] = {"lmin", "lmax", "wmin", "wmax"}

class RelativeIncludeConverter(Converter):
    # The tool's flat search path does not track the including file. Preserve
    # ownership of relative includes rather than searching all PDK directories.
    def __init__(self, config):
        super().__init__(config)
        self.parents = []
        self.emitted_bins = {}
        self.required_modules = set()
        self.source_files = set()
        self.bsim4_source_versions = {}

    def process_expressions(self, params):
        return [(name, real_source_division(value))
                for name, value in super().process_expressions(params)]

    def process_model(self, lws, line, eol, annot, in_sec, in_sub):
        parts = line.split(' ', 2)
        if '.' in parts[1]:
            base, label = parts[1].rsplit('.', 1)
            scope = (in_sec, in_sub, base)
            labels = self.emitted_bins.setdefault(scope, [])
            if label in labels:
                raise ValueError(f'Duplicate bin label {scope}: {label}')
            # Upstream collectors and instance selectors use declaration order,
            # not original labels. Emit the same ordinal on the model side.
            # Keep every parameter and the original order unchanged.
            parts[1] = f'{base}.{len(labels)}'
            labels.append(label)
            line = ' '.join(parts)
        result = super().process_model(lws, line, eol, annot, in_sec, in_sub)
        module = result.split()[2]
        if module == 'sp_bsim4v8':
            name = parts[1]
            if '.' in name:
                base, ordinal = name.rsplit('.', 1)
                model = self.data['bins'][(in_sec, in_sub)][base][int(ordinal)]
            else:
                model = self.data['models'][(in_sec, in_sub)][name]
            version = model[4] or 'unspecified'
            self.bsim4_source_versions[version] = self.bsim4_source_versions.get(version, 0) + 1
        paths = {path for path, name, _ in self.cfg['family_map'].values() if name == module}
        if len(paths) != 1:
            raise ValueError(f'Missing or ambiguous native module path for {module}: {paths}')
        self.required_modules.update(paths)
        return result

    def process_instance_r(self, lws, line, eol, annot, in_sec, in_sub):
        # A named rbody resistor is not necessarily behavioral. In particular
        # res_high_po uses a sheet-resistance model with only W/L parameters.
        # Change the emitter's dispatch hint, not the original emitted name.
        if not re.search(r'\b[vi]\s*\(', line):
            annot = {**annot, 'name': 'r_'+annot['name']}
        return super().process_instance_r(lws, line, eol, annot, in_sec, in_sub)

    def process_instance_m(self, lws, line, eol, annot, in_sec, in_sub):
        bins = self.data['bins'].get((in_sec, in_sub), {}).get(annot['mod_name'])
        if bins is None:
            bins = self.data['bins'].get((in_sec, None), {}).get(annot['mod_name'])
        if bins is None:
            return super().process_instance_m(lws, line, eol, annot, in_sec, in_sub)
        params = self.process_instance_params(annot['words'][5:], 'm', handle_m=True, in_sub=in_sub)
        values = dict(params)
        prefix = annot['output_name']+' ('+' '.join(self.process_terminals(annot['words'][:4]))+') '
        formatted, _, _ = self.format_params(params)
        lines = []
        # Preserve the source Profile's bin semantics, not the native foreign
        # parser's different edge/order rules. Model identities retain their
        # original declaration ordinals even though search order is reversed.
        boundaries = [self.get_bin_boundaries(bin_data[-1]) for bin_data in bins]
        for index, guard in source_bin_guards(values, boundaries):
            lines.append(('@if ' if not lines else '@elseif ')+guard)
            lines.append(prefix+annot['output_mod_name']+f'__{index} (\n'+formatted+'\n)')
        # This is an error guard, not another implementation of the MOS.
        # Keep every valid bin's instance path unchanged. A distinct guard name
        # also prevents an undefined error master from masquerading as a valid
        # alternative model for the MOS's output-variable identity.
        guard_prefix = annot['output_name']+'__icm_invalid_bin'+prefix[len(annot['output_name']):]
        lines.extend(['@else', guard_prefix+'icm_bin_not_found', '@end'])
        return '\n'.join(lines)

    def preprocess_line(self, line):
        # SPICE permits a quoted arithmetic expression inside {...}; keeping
        # those quotes in VACASK changes a numerical parameter into a string.
        line = re.sub(r'\{\s*"([^"{}]*)"\s*\}', lambda m: '{('+m.group(1)+')}', line)
        # Same parameter-name mappings as pinned VACASK lib/netlistrs.cpp;
        # numerical values are preserved, never silently removed.
        if re.match(r'\s*\.model\s+\S+\s+[rc]\b', line, re.I):
            line = re.sub(r'\btref\s*=', 'tnom=', line, flags=re.I)
        if re.match(r'\s*\.model\s+\S+\s+[np]mos\b', line, re.I):
            line = re.sub(r'\brgeomod\s*=', 'instance_rgeomod=', line, flags=re.I)
        if re.match(r'\s*\.model\b', line, re.I):
            def integer_level(match):
                value = float(match.group(1))
                if not value.is_integer():
                    raise ValueError('Non-integral model level: '+match.group(1))
                return 'level='+str(int(value))
            line = re.sub(r'\blevel\s*=\s*([^\s)]+)', integer_level, line, flags=re.I)
        return super().preprocess_line(line)

    def proces_params(self, line):
        # Whitespace can be part of an unquoted expression. Split only at
        # assignment boundaries, never at each space inside its value.
        directive, body = line.split(' ', 1)
        matches = list(re.finditer(r'(?:^|\s+)([a-zA-Z_][a-zA-Z0-9_]*)=(?!=)', body))
        if not matches or body[:matches[0].start()].strip():
            raise ValueError(f"Invalid parameter assignments: {line!r}")
        pairs = []
        for index, match in enumerate(matches):
            end = matches[index+1].start() if index+1 < len(matches) else len(body)
            value = body[match.end():end].strip()
            if not value:
                raise ValueError(f"Empty parameter assignment: {line!r}")
            pairs.append((match.group(1), value))
        return directive + ' ' + ' '.join(name+'='+self.format_value(value) for name,value in self.process_expressions(pairs))

    def collect_masters(self):
        super().collect_masters()
        # Scoped libraries may have no global bins; the emitter expects the key.
        self.data['bins'].setdefault((None, None), {})
        for name, (_, parameters) in self.data['subckts'].items():
            if any(key == '$mfactor' for key, _ in parameters):
                raise ValueError(f'Reserved multiplier collision in {name}')
            self.cfg['subckt_multiplier'][name] = ('$mfactor', True)

    def process_instance_params(self, params, insttype, handle_m=False, in_sub=None):
        return super().process_instance_params(params, insttype, handle_m=(handle_m or insttype == 'x'), in_sub=in_sub)

    def vacask_file(self):
        lines = super().vacask_file()
        if not self.data['is_toplevel']:
            # A separately shipped library must carry its own primitive masters;
            # users must not have to guess converter-private defmod_* names.
            return self.load_statements() + sorted(self.default_models()) + lines
        return lines

    def load_statements(self):
        paths = self.required_modules | set(self.data['osdi_loads'])
        for letter in self.data['default_models_needed']:
            paths.add(self.cfg['default_models'][letter][0])
        return ['load "'+path+'"' for path in sorted(paths)]

    def read_file(self, filename, *args, **kwargs):
        candidate = Path(filename)
        if not candidate.is_absolute() and self.parents:
            candidate = self.parents[-1] / candidate
        if not candidate.is_file() and not Path(filename).is_absolute():
            candidate = source / filename
        if not candidate.is_file():
            raise FileNotFoundError(candidate)
        candidate = candidate.resolve()
        self.source_files.add(candidate)
        self.parents.append(candidate.parent)
        try:
            return super().read_file(str(candidate), *args, **kwargs)
        finally:
            self.parents.pop()


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


args.output.mkdir(parents=True, exist_ok=True)
output = Path(tempfile.mkdtemp(prefix="candidate-", dir=args.output.resolve()))
print(output, flush=True)
report = {
    "status": "conversion-incomplete",
    "qualification": "not-qualified; no runtime registration",
    "converterRevision": VACASK_REV,
    "modelRevision": MODELS_REV,
    "recipeSha256": digest(Path(__file__)),
    "binningRecipeSha256": digest(Path(__file__).parent / 'lib/vacask_model_binning.py'),
    "arithmeticRecipeSha256": digest(Path(__file__).parent / 'lib/vacask_source_arithmetic.py'),
    "binning": {"source": "ngspice-46", "defaultWnflag": 0, "edgeToleranceM": 1e-9, "priority": "last-declared"},
    "scope": "combined_models/continuous tree; only the seven baseline wrappers are acceptance targets",
    "modelSemantics": {
        "family": "BSIM4", "targetVersion": "4.8.3", "module": "sp_bsim4v8",
        "policy": "explicit-upgrade; requalification required",
    },
    "limitations": [
        "BSIM4 source versions are explicitly upgraded to 4.8.3; old results remain historical comparisons",
        "module identity and the chain-rule correction must be independently verified before qualification",
        "conversion success is not electrical or hosted qualification",
        "other wrappers in this source tree are not qualified",
    ],
    "corners": {},
}
try:
    for corner in dict.fromkeys(args.corners):
        paths = [
            f"continuous/parameters_fet_{corner}.spice",
            "continuous/parameters_res_nom.spice",
            "continuous/parameters_cap_nom.spice",
            *[f"continuous/models_{name}.spice" for name in
              ["global", "fet", "bjt", "diodes", "resistors", "capacitors"]],
        ]
        entry = output / f"{corner}-entry.spice"
        entry.write_text(
            "* Candidate continuous-tree model entry; foundry files remain unchanged.\n"
            ".param MC_MM_SWITCH=0 MC_PR_SWITCH=0 corner_factor=1 process_mc_factor=1 mismatch_factor=1\n"
            + "".join(f'.include "{path}"\n' for path in paths),
            encoding="utf-8", newline="\n",
        )
        converter = RelativeIncludeConverter(deepcopy(cfg))
        native = output / f"{corner}.sim"
        # Collect output ourselves so native artifact bytes are LF on every OS.
        _, deck, input_path = converter.read_file(str(entry))
        converter.data["deck"] = deck
        converter.data["absolute_input_path"] = input_path
        converter.collect_masters()
        native.write_text("\n".join(converter.vacask_file()) + "\n", encoding="utf-8", newline="\n")
        inputs = sorted(path for path in converter.source_files if path != entry)
        report["corners"][corner] = {
            "nativeSha256": digest(native),
            "entrySha256": digest(entry),
            "sources": {path.relative_to(source).as_posix(): digest(path) for path in inputs},
            "bsim4SourceVersions": dict(sorted(converter.bsim4_source_versions.items())),
            "requiredModules": sorted(converter.required_modules | {
                cfg["default_models"][letter][0] for letter in converter.data["default_models_needed"]
            }),
        }
    report["status"] = "converted-not-qualified"
finally:
    (output / "conversion.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8", newline="\n")
