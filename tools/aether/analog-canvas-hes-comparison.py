#!/usr/bin/env python3
"""Build a comparison of source previews and verified native Aether captures."""
import argparse
import html
import json
from datetime import datetime, timezone
from pathlib import Path
import shutil
from PIL import Image
from analog_canvas_hes_contract import validate_manifest


def screenshot_markup(path, title, size):
    """Display the entire application screenshot, without cropping or stretching."""
    width, height = size
    return (f'<img loading="lazy" src="{html.escape(path, quote=True)}" '
            f'alt="Aether {html.escape(title, quote=True)}" width="{width}" height="{height}">')


def panel_markup(brand, path, picture):
    return (f'<figure><figcaption>{html.escape(brand)}</figcaption>'
            f'<a class="frame" href="{html.escape(path, quote=True)}">{picture}</a></figure>')


def captured_circuits(circuits, root, screenshot_dir, partial):
    if not partial:
        return circuits
    return [source for source in circuits if (root / screenshot_dir / (source["cellName"] + ".png")).is_file()]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--screenshots-dir", default="screenshots")
    parser.add_argument("--cell", action="append", help="Include a specific verified cell; repeat for a sample report")
    parser.add_argument("--progress", action="store_true", help="Publish completed screenshots without claiming the remainder are captured")
    args = parser.parse_args()
    root = args.root
    screenshot_dir = Path(args.screenshots_dir)
    if screenshot_dir.is_absolute() or ".." in screenshot_dir.parts:
        parser.error("--screenshots-dir must be a directory inside --root")
    spec = json.loads((root / "aether_hes_import_spec.json").read_text(encoding="utf-8"))
    validate_manifest(spec)
    checked = json.loads((root / "aether_hes_readback.json").read_text(encoding="utf-8"))
    names = {item["cellName"] for item in spec["circuits"]}
    verified_names = {item["cellName"] for item in checked["circuits"] if item["passed"]}
    if not checked["passed"] or names != verified_names or len(names) != len(spec["circuits"]):
        raise ValueError("Matching passing readback is required for every circuit")
    if checked["library"] != spec["targetLibrary"]:
        raise ValueError("Library mismatch")
    included = spec["circuits"]
    if args.cell:
        if len(set(args.cell)) != len(args.cell) or set(args.cell) - names:
            raise ValueError("Every requested cell must exist exactly once in the verified manifest")
        by_name = {item["cellName"]: item for item in included}
        included = [by_name[name] for name in args.cell]
    included = captured_circuits(included, root, screenshot_dir, args.progress)
    (root / "canvas").mkdir(exist_ok=True)
    sections = []
    pictures = []
    for index, source in enumerate(included, 1):
        name = source["cellName"]
        screenshot = screenshot_dir / (name + ".png")
        with Image.open(root / screenshot) as image:
            if image.format != "PNG":
                raise ValueError("Invalid PNG: " + name)
            image.load()
            size = image.size
            if size != (1920, 1080):
                raise ValueError("A full 1920x1080 Aether capture is required: " + name)
        pictures.append({"cellName": name, "originalSize": size,
                         "displayBounds": [0, 0, *size], "file": screenshot.as_posix()})
        shutil.copy2(args.snapshot / "circuits" / source["galleryId"] / "preview.svg", root / "canvas" / (name + ".svg"))
        title = html.escape(source["galleryName"])
        picture = screenshot_markup(screenshot.as_posix(), source["galleryName"], size)
        canvas_path = f"canvas/{name}.svg"
        canvas = panel_markup("Analog Canvas", canvas_path,
                              f'<img loading="lazy" src="{canvas_path}" alt="Canvas {title}">')
        aether = panel_markup("Aether", screenshot.as_posix(), picture)
        sections.append(f'<section><h2>{index:02d}. {title}</h2><div class="pair">'
                        f'{canvas}{aether}</div></section>')
    document = '''<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Analog Canvas / Aether 电路对照</title><style>
*{box-sizing:border-box;letter-spacing:0}body{margin:0;color:#25282b;background:white;font:15px/1.5 system-ui,sans-serif}
header,main{max-width:1600px;margin:auto;padding:24px}header{border-bottom:2px solid #555}h1{font-size:26px}h2{font-size:19px;margin:0 0 12px}
section{padding:22px 0;border-bottom:1px solid #bbb}.pair{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}
figure{margin:0;min-width:0}figcaption{margin:0 0 8px}.frame{display:block;aspect-ratio:16/9;overflow:hidden;border:1px solid #ccc}
figure:last-child .frame{background:#ededed}.frame img{display:block;width:100%;height:100%;object-fit:contain}p{margin:6px 0}
.progress{display:flex;flex-wrap:wrap;gap:12px 32px;padding:12px 0}.progress strong{font-size:24px;display:block}time{color:#656565}
@media(max-width:760px){.pair{grid-template-columns:1fr}header,main{padding:16px}}
@page{size:A4 landscape;margin:8mm}
@media print{header{display:none}main{padding:0;max-width:none}section{height:96mm;padding:3mm 0;break-inside:avoid}section:nth-child(2n){break-after:page}section:last-child{break-after:auto}.pair{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.frame{height:70mm;width:124.44mm;max-width:100%;margin:auto}figcaption{font-size:12px;margin-bottom:2mm}h2{font-size:15px;margin-bottom:2mm}}
</style><header><h1>Analog Canvas / Aether 电路对照</h1>
<div class="progress"><div>已导入<strong>__VERIFIED__ / __VERIFIED__</strong></div><div>数据库已核对<strong>__VERIFIED__ / __VERIFIED__</strong></div><div>截图<strong>__COUNT__ / __VERIFIED__</strong></div></div>
<p>待截图 __PENDING__ 个。<time>更新于 __UPDATED__</time></p>
<p>数据库核对不代表跨工艺仿真等价。</p>
</header><main>__SECTIONS__</main>__REFRESH__</html>'''
    updated = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    refresh = '''<script>
try { const y = sessionStorage.getItem('canvas-report-scroll'); if(y) scrollTo(0,Number(y)); } catch(e) {}
setTimeout(() => { try { sessionStorage.setItem('canvas-report-scroll',String(scrollY)); } catch(e) {} location.reload(); }, 60000);
</script>''' if args.progress and len(included) < len(names) else ''
    document = document.replace("__COUNT__", str(len(sections))).replace("__VERIFIED__", str(len(names))).replace("__SECTIONS__", "\n".join(sections)).replace("__PENDING__", str(len(names) - len(included))).replace("__UPDATED__", updated).replace("__REFRESH__", refresh)
    temporary = root / "comparison.html.tmp"
    temporary.write_text(document, encoding="utf-8")
    temporary.replace(root / "comparison.html")
    progress = {"updatedAt": updated, "library": spec["targetLibrary"], "total": len(names),
                "imported": len(names), "databaseVerified": len(names), "screenshots": len(included),
                "pendingScreenshots": len(names) - len(included), "complete": len(included) == len(names),
                "capturedCells": [source["cellName"] for source in included]}
    temporary = root / "capture-progress.json.tmp"
    temporary.write_text(json.dumps(progress, indent=2) + "\n")
    temporary.replace(root / "capture-progress.json")
    (root / "report-layout.json").write_text(json.dumps({"aspectRatio": "16:9",
        "originalScreenshotsModified": False, "captureMode": "full-aether-interface",
        "labels": "above-image-frames",
        "circuits": pictures}, indent=2) + "\n", encoding="utf-8")
    print(root / "comparison.html")


if __name__ == "__main__":
    main()
