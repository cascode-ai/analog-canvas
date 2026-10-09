# Analog Canvas 导入 Aether

把已授权导出的 Canvas 项目转换为华大九天 Aether 的原生 schematic。
这是独立的离线转换和桌面操作工具，不是 Canvas 网站的新接口，不负责登录、
获取生产数据库、安装 EDA 软件或分发 PDK。

流程：公开项目快照 → Canvas 原生 SPICE 解析 → 筛选和离线预检 →
PyAether 串行建库 → 保存后数据库读回 → 完整界面截图与 HTML/PDF 对照。

## 环境与目录

- 转换和回归在 Linux 上运行，使用当前 Canvas 源码、Node.js 24+、Python 3.10+。
- 独立 Node runtime 需安装 `node@24`、`esbuild` 及 Canvas 源码引用的外部依赖
  （当前为 `zod`、`@mathjax/src`、`mhchemparser`）；例如在外部 runtime 目录执行
  `npm install node@24 esbuild zod @mathjax/src mhchemparser`。
- 原生导入只在已授权、已启动的 Aether Python Console 中运行；需要现有
  `pyAether`、`hes` 和 `analog` 库。没有这些环境也能运行离线回归。
- 截图需要同一 Linux 桌面的 X11、`xdotool`、`xprop`、ImageMagick、`flock`；
  报告需要 Pillow。桌面至少能够容纳完整的 1920×1080 窗口。
- 输出全部放仓库外。导入包目录与原生库目录必须分开；每次使用新的库名。
  还应在 Design Manager 中确认该名字未注册到其他路径。

以下命令从仓库根目录运行，路径替换为实际绝对路径：

```bash
CANVAS="$PWD"
TOOLS="$CANVAS/tools/aether"
RUNTIME=/path/to/node-runtime
SNAPSHOT=/path/to/frozen-gallery-export
SELECTION=/path/to/selection.json
BUNDLE=/path/to/new-import-bundle
LIBRARY=canvas_hes_batch
```

## 1. 输入快照

转换器只读取冻结文件，不访问线上 Gallery，不更改源项目。快照结构：

```text
manifest.json                     # entries: [{id, formats.spice.qualified, ...}]
circuits/<id>/entry.json           # 同一 entry，必须具有 id 和 qualified 标志
circuits/<id>/project.icproj.json  # Canvas 原始项目
circuits/<id>/preview.svg          # 原始 Canvas 预览，用于对照报告
```

已有上述导出目录可直接复用。若持有已授权、已验证的公开 Gallery JSON 投影，
可用 `analog-canvas-gallery-export.mjs` 生成目录。它通过 Canvas 的真实解析与
网表导出接口重新判断 qualified，不信任旧的可网表标记：

```bash
"$RUNTIME/node_modules/node/bin/node" "$TOOLS/analog-canvas-hes-export-build.mjs" \
  "$CANVAS" "$RUNTIME" "$TOOLS/analog-canvas-gallery-export.mjs" /tmp/gallery-export.mjs
"$RUNTIME/node_modules/node/bin/node" /tmp/gallery-export.mjs \
  /path/to/public-gallery.json "$SNAPSHOT"
```

该 JSON 的 `format` 为 `analog-canvas-public-gallery-snapshot-v1`，包含
`consistentCapture: true`、`offlineRestoreVerified: true`、`origin`、`entries`。
每条 entry 包含 `id`、`name`、`project_text`、`svg_text`，可带作者等公开元数据。
这两个布尔值记录上游快照流程的证据，不是此工具对生产数据库的一致性认证。
不要把私有项目、所有权信息、凭据或数据库备份放进仓库。

## 2. 筛选与预检

选择文件格式为 `[["gallery-id", "target_cell"], ...]`。也可以按原始实例数
筛选最多 200 个，默认严格大于 10，包括 R/L/C、电源和晶体管；端口、线、标签、
nf、m 不增加数量，展开反相器仍按源实例计数：

```bash
python3 "$TOOLS/analog-canvas-hes-select.py" \
  --canvas-source "$CANVAS" --runtime "$RUNTIME" --snapshot "$SNAPSHOT" \
  --output /path/to/new-selection --library "$LIBRARY" --target 200 --more-than 10 \
  --expand-inverters --minimum-dimensions
```

看 `selection-summary.json` 的 `targetMet`，不足 200 时不能宣称完成。
`candidate-audit.json` 保留不支持或预检失败的原因。然后用生成的 selection.json
准备独立导入包，策略开关与筛选时保持一致：

```bash
python3 "$TOOLS/analog-canvas-hes-prepare.py" \
  --canvas-source "$CANVAS" --runtime "$RUNTIME" --snapshot "$SNAPSHOT" \
  --selection "$SELECTION" --output "$BUNDLE" --library "$LIBRARY" \
  --spacing-factor 1.5 --expand-inverters --minimum-dimensions
```

只有 `preflight.json` 为 passed 才进入导入。失败留下的目录用于排错，不覆盖重用。
两个近似转换开关默认关闭：

- `--expand-inverters`：每个受支持的行为反相器展开为 P/N 两个 MOS，两个反相器
  为四个 MOS；使用明确的 W=1um、L=150nm、nf=1、m=1。保留原行为参数元数据，
  不声称复现阈值或延迟。
- `--minimum-dimensions`：HES MOS 长度不在 130nm..20um，或每指宽度不在
  150nm..50um 时，目标对应尺寸取最小值。合法尺寸、nf、m 不变。
  原参数不改写，调整记录在 manifest 和 `sizing-adjustments.json`。
  不启用时越界会拒绝，而不是让 PDK 回调静默改值。

这些范围是已校准 HES 符号的范围，不是所有 PDK 的通用规则。

## 3. 原生导入与读回

把导入包传到 EDA 主机。在已有 Aether Python Console 中执行一次：

```python
import runpy
runpy.run_path('/path/to/new-import-bundle/analog-canvas-hes-pyaether-run.py',
    init_globals={
        'AETHER_IMPORT_ROOT': '/path/to/new-import-bundle',
        'AETHER_LIBRARY_PARENT': '/path/to/existing-native-library-parent',
    })
```

不要并发启动多个 GUI/import，也不要重跑覆盖已有库。执行中逐步保存
`import-journal.jsonl` 和 `aether_hes_import_result.json`。原生崩溃时查看最后操作，
保留失败库，再用新库名恢复需要处理的电路，不把部分成功标记为完整成功。

`execution-status.json` 的 complete/passed 表示导入及读回都完成；独立的
`aether_hes_readback.json` 核对保存后的器件、参数、pin-net 绑定、端口、方向、
坐标及导线。只看到截图或导入完成日志，不足以替代读回。

## 4. 截图与报告

先确认所有电路读回通过。打开已有 Aether Design Manager 的 Python Console，
确认 `import pyAether as ae`，按实际桌面设置 DISPLAY 和输入框坐标：

```bash
export DISPLAY=:0
export AETHER_CONSOLE_X=350 AETHER_CONSOLE_Y=807
python3 "$TOOLS/analog-canvas-aether-capture-batch.py" \
  --root "$BUNDLE" --snapshot "$SNAPSHOT" \
  --publish-archive /path/to/report.tgz --batch-size 10
```

坐标只是示例，必须先人工核对。截图串行，每 10 个原子更新一次 comparison.html；
断点继续只处理尚无截图的电路，损坏截图会使报告失败而不会假装通过。
不要在截图期间手动切换 GUI；已打开的同名原理图会拒绝操作，防止关闭用户窗口。
截图包含完整 Aether 界面、工具栏及侧栏，16:9，不裁掉应用界面。
保留原生 PDK 标注，不额外叠加 W/L；Canvas/Aether 标题保留在图片框外。
HTML 为中文，打印样式每页两对电路，可用浏览器“打印 → 保存为 PDF”，关闭页眉页脚。
尺寸变化保留在 JSON 中，不堆到图旁。未捕获的图片不占位冒充完成。

## 支持边界

电气连接来自 Canvas canonical SPICE IR，几何来自原始 placement、rotation、mirror、
route 和 junction；两者不能互相替代。未知器件/模型、参数表达式、行为放大器、
一般子电路和非 DC 瞬态源明确拒绝，不偷换成看起来相似的器件。
MOS 源单位显式区分 SI 与 SKY130 微米，`w` 为总宽、`fw=w/nf`。
理想 R/L/C 映射到 `analog/res`、`analog/ind`、`analog/cap`，不替换成会夹值的
物理电阻或几何电容。DC 源保留 AC 幅度/相位。
含 `/` 的原生网络名使用无冲突别名并记录映射，禁止静默合并网络。

数据库读回证明的是目标数据库保存了预期结构和参数；**未证明 Aether 原生网表
导出成功或跨 PDK 仿真等价**。更换 PDK/Aether 版本后必须重新校准符号引脚与回调，
不能仅凭这批回归扩大电气结论。此次仓库迁移不重新运行 200 次 GUI 导入。
新增的图形端口坐标/方向/网络核对已在 API 边界测试，尚未重新执行原生验收；
遇到不同的原生 pin figure 表示会拒绝通过，需校准后再使用，不降级成仅检查数量。

## 回归

在 Linux 执行，无需 Aether 或线上数据库：

```bash
PYTHONPATH="$TOOLS" python3 -m unittest discover -s "$TOOLS/tests" -p 'test_*.py' -v
"$RUNTIME/node_modules/node/bin/node" --test "$TOOLS/tests/analog-canvas-aether-names.test.mjs"
python3 "$TOOLS/tests/integration.py" --canvas-source "$CANVAS" --runtime "$RUNTIME"
bash -n "$TOOLS/analog-canvas-aether-screenshot.sh"
```

integration 通过真实 Canvas 源码和仓库自带电路测试转换、预检、拒绝和防覆盖；
不调用 PyAether 或创建原生库。单元测试覆盖几何、参数、实例计数、名称、报告和路径。
输出、截图、快照、原生库、PDK、许可证和认证信息都不应提交。
