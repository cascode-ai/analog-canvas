# 从 Virtuoso 导出到 Analog Canvas

中文 | [English](README.en.md)

本工具把单层 Virtuoso schematic 转为可编辑的 `.icproj.json`。未映射器件默认用保留外部引脚的方框表示。不自动展开子模块，不保证仿真等价，不需要大模型或 Bridge。

## 1. 安装和构建

本工具须位于 Analog Canvas 仓库的 `tools/virtuoso` 下。需要 Node 24+、pnpm 11.16.0、Python 3.9+；菜单操作还需要 Virtuoso。Node 可以安装在个人目录，无须修改系统版本。

在 Analog Canvas 仓库根目录完成依赖安装和构建：

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @icm/virtuoso-tool test
```

如果你是在首次接入 PR 新增包，先按准备目录的 README 更新锁文件。安装依赖需要网络、公司镜像或已有缓存。

## 2. 加载 Virtuoso 菜单

工具安装目录与 Virtuoso 启动目录无关，继续在平常的电路工作目录启动 Virtuoso。下列路径都是占位符，请换成实际绝对路径。

**Virtuoso 已打开：**在 CIW 输入：

```lisp
setShellEnvVar("VC_ROOT=/实际路径/analog-canvas/tools/virtuoso")
getShellEnvVar("VC_ROOT")
load(strcat(getShellEnvVar("VC_ROOT") "/skill/virtuoso_canvas_ui.il"))
```

**Virtuoso 未启动：**先在平常的启动终端输入：

```bash
export VC_ROOT="/实际路径/analog-canvas/tools/virtuoso"
```

再按原来的方式从该终端启动 Virtuoso，随后在 CIW 执行上述 `load` 命令。要固定设置，将 `export` 行放入自己的启动脚本；已经运行的 Virtuoso 不会读取后来在其他终端设置的变量。

若 Node 24 不在系统 PATH 或默认 nvm 目录，还需设置 `VC_NODE_PATH` 为 Node 可执行文件的绝对路径；已打开的 CIW 可用 `setShellEnvVar("VC_NODE_PATH=/实际路径/bin/node")`。

## 3. 导出

1. 保存目标 schematic，从 Schematic to Canvas 菜单打开窗口。
2. 点击 Scan devices。选择需要调整的器件，再点 Edit mapping。
3. 选择 Canvas symbol，逐个指定引脚对应关系。忽略额外引脚必须明确选择，不会因为引脚数不同就自动丢弃。
4. Use this run 只用于本次；Save personal 会同时应用并保存规则，后续扫描自动复用。
5. 选择输出目录和文件名，设置选项，然后点 Export project。同名文件会询问是否覆盖。
6. 点击 Open Analog Canvas 打开本机页面，再在编辑器中打开导出的工程；按钮不会自动载入工程。

| 设置 | 含义 |
| --- | --- |
| Scale | 调整源坐标到画布坐标的比例 |
| Power / Ground nets | 用空格分隔网络名，控制电源地符号及相关简化 |
| Bus | Bundled 用一条线表示总线；不验证逐位仿真等价 |
| Disabled instances | Keep 保留禁用器件；Skip 不导出禁用器件 |
| Show instance names | 控制实例名称显示，不是禁用器件开关 |
| Isolated pins | 控制是否去掉无连线的独立 pin |

默认个人文件是 `~/.config/virtuoso-canvas/config.json` 和 `mappings.json`。要复用旧安装的个人规则，可在启动前将 `VC_PERSONAL_DIR` 设置为旧的 `personal` 目录；CIW 同样可用 `setShellEnvVar`。设置这些路径应在首次加载窗口前完成。

## CLI

先在 CIW 导出快照（库、cell、view 和输出路径均按实际情况修改）：

```lisp
load(strcat(getShellEnvVar("VC_ROOT") "/skill/export_schematic.il"))
VCExportCell("myLib" "myCell" "schematic" "/tmp/design.snapshot.json")
```

在 Analog Canvas 仓库根目录执行：

```bash
node tools/virtuoso/dist/cli/main.js prepare /tmp/design.snapshot.json --out /tmp/design-settings
```

检查生成的 `mappings.json`，调整需要修改的对应关系，然后执行：

```bash
node tools/virtuoso/dist/cli/main.js convert /tmp/design.snapshot.json --mappings /tmp/design-settings/mappings.json --out /tmp/design-canvas
```

成功输出 `project.icproj.json` 和 `report.json`；`--preview` 额外输出 SVG，`--debug` 保留调试文件。失败仅输出诊断，不发布工程或预览。用 `node tools/virtuoso/dist/cli/main.js --help` 查看完整参数。

本工具原创代码采用 [MIT](LICENSE.md)。Analog Canvas 保持自身 AGPL 和第三方许可；本工具的 MIT 授权不改变这些条款。Virtuoso 和 PDK 不随本工具分发。
