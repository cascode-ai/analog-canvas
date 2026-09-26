# 迁移源码索引（固定引用）

本索引包含 13 组、76 个文件，保留原审查使用的完整 commit 引用。文件和历史提交均已核对 Git 对象存在；这里的链接不会随 main 推进而切换内容。使用方式见[参考环境](README.md#reference-workflow)和[首版本地合并计划](05-local-merge-plan.md)。

<a id="u0"></a>

## U0 — 上游现有入口与组合层

以当前实现为底座抽宿主装配；保持 Web 入口行为。

固定提交：`117ca625cd896e2bfeff4bedcb10ba7e480e23b4`。

| 文件号 | GitHub 固定源码                                                                                                                                                                  |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1      | [apps/editor/src/main.tsx](https://github.com/cascode-ai/analog-canvas/blob/117ca625cd896e2bfeff4bedcb10ba7e480e23b4/apps/editor/src/main.tsx)                                   |
| 2      | [apps/editor/src/app/App.tsx](https://github.com/cascode-ai/analog-canvas/blob/117ca625cd896e2bfeff4bedcb10ba7e480e23b4/apps/editor/src/app/App.tsx)                             |
| 3      | [apps/editor/src/app/editor-app-chrome.tsx](https://github.com/cascode-ai/analog-canvas/blob/117ca625cd896e2bfeff4bedcb10ba7e480e23b4/apps/editor/src/app/editor-app-chrome.tsx) |
| 4      | [apps/editor/vite.config.ts](https://github.com/cascode-ai/analog-canvas/blob/117ca625cd896e2bfeff4bedcb10ba7e480e23b4/apps/editor/vite.config.ts)                               |

<a id="r0"></a>

## R0 — fork 最早的双构建接入，删除在线代码之前

只参考宿主接线的原始改动；不复制旧 App，也不继承随后的联网代码大删除。

固定提交：`c15d9f2db22cfbf19bdbc84d743460f5a384b7f6`。

| 文件号 | GitHub 固定源码                                                                                                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1      | [apps/editor/src/desktop/desktop-mode.ts](https://github.com/LXY-freshman/schematic-draft/blob/c15d9f2db22cfbf19bdbc84d743460f5a384b7f6/apps/editor/src/desktop/desktop-mode.ts)     |
| 2      | [apps/editor/src/main.tsx](https://github.com/LXY-freshman/schematic-draft/blob/c15d9f2db22cfbf19bdbc84d743460f5a384b7f6/apps/editor/src/main.tsx)                                   |
| 3      | [apps/editor/src/app/editor-app-chrome.tsx](https://github.com/LXY-freshman/schematic-draft/blob/c15d9f2db22cfbf19bdbc84d743460f5a384b7f6/apps/editor/src/app/editor-app-chrome.tsx) |

来源/后续修复提交（按表中顺序读取；不是批量 cherry-pick 指令）：

1. [c15d9f2d — feat(desktop): Schematic Draft, an offline Windows build of the editor](https://github.com/LXY-freshman/schematic-draft/commit/c15d9f2db22cfbf19bdbc84d743460f5a384b7f6)

<a id="u1"></a>

## U1 — 上游保存与工作区权威

保留主线的快照、保存状态、标签页和 Cloud revision；抽 Native 保存实现的接缝。

固定提交：`117ca625cd896e2bfeff4bedcb10ba7e480e23b4`。

| 文件号 | GitHub 固定源码                                                                                                                                                                                            |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1      | [apps/editor/src/document/use-project-file-lifecycle.ts](https://github.com/cascode-ai/analog-canvas/blob/117ca625cd896e2bfeff4bedcb10ba7e480e23b4/apps/editor/src/document/use-project-file-lifecycle.ts) |
| 2      | [apps/editor/src/document/project-file-service.ts](https://github.com/cascode-ai/analog-canvas/blob/117ca625cd896e2bfeff4bedcb10ba7e480e23b4/apps/editor/src/document/project-file-service.ts)             |
| 3      | [apps/editor/src/document/project-session-lifecycle.ts](https://github.com/cascode-ai/analog-canvas/blob/117ca625cd896e2bfeff4bedcb10ba7e480e23b4/apps/editor/src/document/project-session-lifecycle.ts)   |
| 4      | [apps/editor/src/document/project-workspace.ts](https://github.com/cascode-ai/analog-canvas/blob/117ca625cd896e2bfeff4bedcb10ba7e480e23b4/apps/editor/src/document/project-workspace.ts)                   |
| 5      | [apps/editor/src/document/use-project-tabs.ts](https://github.com/cascode-ai/analog-canvas/blob/117ca625cd896e2bfeff4bedcb10ba7e480e23b4/apps/editor/src/document/use-project-tabs.ts)                     |
| 6      | [apps/editor/src/document/project-workspace.test.ts](https://github.com/cascode-ai/analog-canvas/blob/117ca625cd896e2bfeff4bedcb10ba7e480e23b4/apps/editor/src/document/project-workspace.test.ts)         |
| 7      | [apps/editor/e2e/project-file.spec.ts](https://github.com/cascode-ai/analog-canvas/blob/117ca625cd896e2bfeff4bedcb10ba7e480e23b4/apps/editor/e2e/project-file.spec.ts)                                     |

<a id="r1"></a>

## R1 — fork 本地文件与关闭保护参考

迁入原生对话框和关闭决策，适配共享保存协调；不复制旧 schema、裸 path 写入及全局单项目关闭假设。

固定提交：`5231840f31b551f231441976efc0d18e6f9e5f80`。

| 文件号 | GitHub 固定源码                                                                                                                                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1      | [apps/editor/src/features/editor-shell/project-files.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/apps/editor/src/features/editor-shell/project-files.ts)           |
| 2      | [apps/editor/src/features/editor-shell/project-files.test.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/apps/editor/src/features/editor-shell/project-files.test.ts) |
| 3      | [apps/desktop/src/project-files.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/apps/desktop/src/project-files.ts)                                                     |
| 4      | [apps/desktop/src/close-guard.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/apps/desktop/src/close-guard.ts)                                                         |
| 5      | [apps/desktop/src/close-guard.test.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/apps/desktop/src/close-guard.test.ts)                                               |
| 6      | [apps/editor/src/features/editor-shell/shell-close-bridge.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/apps/editor/src/features/editor-shell/shell-close-bridge.ts) |
| 7      | [scripts/close-guard-window-check.mjs](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/scripts/close-guard-window-check.mjs)                                               |

来源/后续修复提交（按表中顺序读取；不是批量 cherry-pick 指令）：

1. [54179d29 — fix(desktop): ask before closing a window that holds unsaved work](https://github.com/LXY-freshman/schematic-draft/commit/54179d29be1c04f17d20fd22deaf98418fc9ff5e)
2. [21bc76f0 — feat(editor): open and import files through this application's own dialogs](https://github.com/LXY-freshman/schematic-draft/commit/21bc76f01b2cd58fd877f4c63e6c3a927964ff3f)

<a id="r2"></a>

## R2 — fork Electron 最小宿主

按文件/函数迁入 app://、窗口、构建和快捷键；首版不运行注册表或安装器逻辑。

固定提交：`5231840f31b551f231441976efc0d18e6f9e5f80`。

| 文件号 | GitHub 固定源码                                                                                                                                                            |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1      | [apps/desktop/src/main.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/apps/desktop/src/main.ts)                         |
| 2      | [apps/desktop/src/app-protocol.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/apps/desktop/src/app-protocol.ts)         |
| 3      | [apps/desktop/src/local-shell.test.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/apps/desktop/src/local-shell.test.ts) |
| 4      | [apps/desktop/src/open-request.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/apps/desktop/src/open-request.ts)         |
| 5      | [apps/desktop/src/window-shortcuts.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/apps/desktop/src/window-shortcuts.ts) |
| 6      | [apps/desktop/scripts/build.mjs](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/apps/desktop/scripts/build.mjs)             |
| 7      | [apps/desktop/package.json](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/apps/desktop/package.json)                       |
| 8      | [apps/desktop/tsconfig.json](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/apps/desktop/tsconfig.json)                     |

来源/后续修复提交（按表中顺序读取；不是批量 cherry-pick 指令）：

1. [c15d9f2d — feat(desktop): Schematic Draft, an offline Windows build of the editor](https://github.com/LXY-freshman/schematic-draft/commit/c15d9f2db22cfbf19bdbc84d743460f5a384b7f6)
2. [2d1309d2 — fix(desktop): keep node_modules out of the packaged app](https://github.com/LXY-freshman/schematic-draft/commit/2d1309d2b7b35084b6b0b05d4c525072b240f3da)
3. [bf4ec5c0 — feat(desktop): leave this application with one menu, the editor's own](https://github.com/LXY-freshman/schematic-draft/commit/bf4ec5c0404024ed8b69881557c9c15ccb2577ed)
4. [ff061150 — test(desktop): prove the single menu and its shortcuts in a real window](https://github.com/LXY-freshman/schematic-draft/commit/ff06115071212e8b3b4006cbc12dbeebaaf24cdd)

<a id="u2"></a>

## U2 — 上游现有导出内容和命令

保留 rootDocumentId、netlistConfigurationError、命名配置与诊断；只追加宿主交付和能力入口。

固定提交：`117ca625cd896e2bfeff4bedcb10ba7e480e23b4`。

| 文件号 | GitHub 固定源码                                                                                                                                                                                                                        |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1      | [apps/editor/src/features/editor-shell/editor-export-commands.ts](https://github.com/cascode-ai/analog-canvas/blob/117ca625cd896e2bfeff4bedcb10ba7e480e23b4/apps/editor/src/features/editor-shell/editor-export-commands.ts)           |
| 2      | [apps/editor/src/features/editor-shell/editor-export-commands.test.ts](https://github.com/cascode-ai/analog-canvas/blob/117ca625cd896e2bfeff4bedcb10ba7e480e23b4/apps/editor/src/features/editor-shell/editor-export-commands.test.ts) |
| 3      | [apps/editor/src/features/editor-shell/editor-file-commands.ts](https://github.com/cascode-ai/analog-canvas/blob/117ca625cd896e2bfeff4bedcb10ba7e480e23b4/apps/editor/src/features/editor-shell/editor-file-commands.ts)               |
| 4      | [apps/editor/e2e/netlist-workflows.spec.ts](https://github.com/cascode-ai/analog-canvas/blob/117ca625cd896e2bfeff4bedcb10ba7e480e23b4/apps/editor/e2e/netlist-workflows.spec.ts)                                                       |

<a id="r3"></a>

## R3 — fork 网表存文件

提取 file delivery 增量；不整体替换上游网表命令。

固定提交：`5231840f31b551f231441976efc0d18e6f9e5f80`。

| 文件号 | GitHub 固定源码                                                                                                                                                                                                                  |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1      | [apps/editor/src/features/editor-shell/editor-export-commands.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/apps/editor/src/features/editor-shell/editor-export-commands.ts) |
| 2      | [apps/editor/src/features/editor-shell/editor-file-commands.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/apps/editor/src/features/editor-shell/editor-file-commands.ts)     |
| 3      | [apps/editor/e2e/netlist-workflows.spec.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/apps/editor/e2e/netlist-workflows.spec.ts)                                             |

来源/后续修复提交（按表中顺序读取；不是批量 cherry-pick 指令）：

1. [c14ae0c5 — feat(editor): let the netlist be written to a file, not only copied](https://github.com/LXY-freshman/schematic-draft/commit/c14ae0c58568c75b6685519ba180d0837f559282)

<a id="r4"></a>

## R4 — fork MATLAB 色板

复用颜色值和选择行为；排除同一提交的 caption/CSS 整理，Web 保持原入口。

固定提交：`5231840f31b551f231441976efc0d18e6f9e5f80`。

| 文件号 | GitHub 固定源码                                                                                                                                                                                                                                    |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1      | [apps/editor/src/features/properties/color-presets.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/apps/editor/src/features/properties/color-presets.ts)                                         |
| 2      | [apps/editor/src/features/properties/annotation-color-properties.test.tsx](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/apps/editor/src/features/properties/annotation-color-properties.test.tsx) |

来源/后续修复提交（按表中顺序读取；不是批量 cherry-pick 指令）：

1. [8d2792d5 — feat(editor): give Appearance the MATLAB palette and one caption size](https://github.com/LXY-freshman/schematic-draft/commit/8d2792d5f7110ad043b1ddf5886363cb2b60b44b)

<a id="r5"></a>

## R5 — fork 粗网格及 viewport 修复

迁入粗点和对应回归意图；必须核对后续 viewport 修复，不直接覆盖主线 camera-runtime。

固定提交：`5231840f31b551f231441976efc0d18e6f9e5f80`。

| 文件号 | GitHub 固定源码                                                                                                                                                                                                                  |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1      | [apps/editor/src/canvas/editor-canvas-overlays.tsx](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/apps/editor/src/canvas/editor-canvas-overlays.tsx)                             |
| 2      | [apps/editor/src/canvas/editor-canvas-overlays.test.tsx](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/apps/editor/src/canvas/editor-canvas-overlays.test.tsx)                   |
| 3      | [apps/editor/src/features/editor-shell/editor-statusbar.tsx](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/apps/editor/src/features/editor-shell/editor-statusbar.tsx)           |
| 4      | [apps/editor/src/features/editor-shell/document-settings-code.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/apps/editor/src/features/editor-shell/document-settings-code.ts) |
| 5      | [apps/editor/src/canvas/camera-runtime.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/apps/editor/src/canvas/camera-runtime.ts)                                               |
| 6      | [apps/editor/src/canvas/camera-runtime.test.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/apps/editor/src/canvas/camera-runtime.test.ts)                                     |
| 7      | [apps/editor/e2e/auto-fit.spec.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/apps/editor/e2e/auto-fit.spec.ts)                                                               |

来源/后续修复提交（按表中顺序读取；不是批量 cherry-pick 指令）：

1. [63614d6f — feat(editor): give the grid a coarse dot every seventh fine one](https://github.com/LXY-freshman/schematic-draft/commit/63614d6f6f28b90db122c6c353a36e652b8c8ab6)
2. [d08705e0 — fix(editor): draw the grid across the panel, not across the camera (#36)](https://github.com/LXY-freshman/schematic-draft/commit/d08705e057b45b7bda05fec787af3a6609ac7fda)

<a id="r6"></a>

## R6 — fork Visio 打包、符号和输出基础

保留已经实现的打包/几何算法和测试，适配主线 Symbol 定义，不另写一套 exporter。

固定提交：`5231840f31b551f231441976efc0d18e6f9e5f80`。

| 文件号 | GitHub 固定源码                                                                                                                                                                    |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1      | [packages/visio/package.json](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/packages/visio/package.json)                           |
| 2      | [packages/visio/src/opc.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/packages/visio/src/opc.ts)                               |
| 3      | [packages/visio/src/drawing.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/packages/visio/src/drawing.ts)                       |
| 4      | [packages/visio/src/drawing.test.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/packages/visio/src/drawing.test.ts)             |
| 5      | [packages/visio/src/stencil.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/packages/visio/src/stencil.ts)                       |
| 6      | [packages/visio/src/stencil.test.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/packages/visio/src/stencil.test.ts)             |
| 7      | [packages/visio/src/symbol-master.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/packages/visio/src/symbol-master.ts)           |
| 8      | [packages/visio/src/symbol-master.test.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/packages/visio/src/symbol-master.test.ts) |
| 9      | [packages/visio/src/geometry.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/packages/visio/src/geometry.ts)                     |
| 10     | [packages/visio/src/geometry.test.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/packages/visio/src/geometry.test.ts)           |

来源/后续修复提交（按表中顺序读取；不是批量 cherry-pick 指令）：

1. [d178a081 — feat(visio): add @icm/visio with a deterministic .vsdx writer](https://github.com/LXY-freshman/schematic-draft/commit/d178a081ecc351b293ecf79b62a4f99f3ec18083)
2. [718610af — feat(visio): convert the symbol catalog to Visio masters and a .vssx stencil](https://github.com/LXY-freshman/schematic-draft/commit/718610afd5fc7b5061fdd7fa8f04378835c7b334)

<a id="r7"></a>

## R7 — fork Visio 页面、文字和连线最终实现

保留 wire-chain/glue 和已修复拐点逻辑；对接当前主线格式，首版不带入跳线/线宽 schema。

固定提交：`5231840f31b551f231441976efc0d18e6f9e5f80`。

| 文件号 | GitHub 固定源码                                                                                                                                                                  |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1      | [packages/visio/src/page.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/packages/visio/src/page.ts)                           |
| 2      | [packages/visio/src/page.test.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/packages/visio/src/page.test.ts)                 |
| 3      | [packages/visio/src/formula-text.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/packages/visio/src/formula-text.ts)           |
| 4      | [packages/visio/src/formula-text.test.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/packages/visio/src/formula-text.test.ts) |
| 5      | [packages/visio/src/wire.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/packages/visio/src/wire.ts)                           |
| 6      | [packages/visio/src/wire-chain.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/packages/visio/src/wire-chain.ts)               |
| 7      | [packages/visio/src/wire-chain.test.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/packages/visio/src/wire-chain.test.ts)     |
| 8      | [docs/specs/export.md](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/docs/specs/export.md)                                       |
| 9      | [scripts/visio-open-check.ps1](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/scripts/visio-open-check.ps1)                       |

来源/后续修复提交（按表中顺序读取；不是批量 cherry-pick 指令）：

1. [34f268ee — feat(visio): draw a Document as a Visio page of glued shapes](https://github.com/LXY-freshman/schematic-draft/commit/34f268eeb94d3eeff7637ac6f2513ee83252a01f)
2. [1037d97f — feat(visio): export annotations as editable Visio text](https://github.com/LXY-freshman/schematic-draft/commit/1037d97f5bec99b91d4e9120701cb1f1e93da093)
3. [224cceeb — feat(visio): write a signal-flow block's formula as Visio text](https://github.com/LXY-freshman/schematic-draft/commit/224cceeb011314ee8de96c8d56a830735532e43b)
4. [83bff2ef — feat(editor): export the open Document as a Visio drawing](https://github.com/LXY-freshman/schematic-draft/commit/83bff2ef2d312c0f419a215b1287cc4bd7e10209)
5. [fe285ee1 — test(visio): pin the Visio export as a golden and write down its contract](https://github.com/LXY-freshman/schematic-draft/commit/fe285ee18e6617750f774a831cefff9243c1decc)
6. [496fa612 — fix(visio): export a wire as a line segment instead of a connector](https://github.com/LXY-freshman/schematic-draft/commit/496fa6125130dd95705997acd423502a9d9f4e57)
7. [35803f38 — fix(visio): give a wire a handle at every corner it turns](https://github.com/LXY-freshman/schematic-draft/commit/35803f388b656a9807e5b299caf9c685d1af72c1)
8. [593244b2 — fix(visio): fill the notch a wire chain leaves at every corner (#34)](https://github.com/LXY-freshman/schematic-draft/commit/593244b2b479fb939ca929a10d953093746770a7)

<a id="u3"></a>

## U3 — 上游 Visio 需要消费的当前契约

主线接口为权威；Visio 适配接口，不用 fork 的旧核心文件覆盖这些实现。

固定提交：`117ca625cd896e2bfeff4bedcb10ba7e480e23b4`。

| 文件号 | GitHub 固定源码                                                                                                                                                                                      |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1      | [packages/symbols/src/signal-flow-layout.ts](https://github.com/cascode-ai/analog-canvas/blob/117ca625cd896e2bfeff4bedcb10ba7e480e23b4/packages/symbols/src/signal-flow-layout.ts)                   |
| 2      | [packages/derived/src/annotation-presentation.ts](https://github.com/cascode-ai/analog-canvas/blob/117ca625cd896e2bfeff4bedcb10ba7e480e23b4/packages/derived/src/annotation-presentation.ts)         |
| 3      | [packages/project-protocol/src/owned-project-file.ts](https://github.com/cascode-ai/analog-canvas/blob/117ca625cd896e2bfeff4bedcb10ba7e480e23b4/packages/project-protocol/src/owned-project-file.ts) |
| 4      | [packages/project-protocol/src/load.ts](https://github.com/cascode-ai/analog-canvas/blob/117ca625cd896e2bfeff4bedcb10ba7e480e23b4/packages/project-protocol/src/load.ts)                             |
| 5      | [packages/project-protocol/src/save.ts](https://github.com/cascode-ai/analog-canvas/blob/117ca625cd896e2bfeff4bedcb10ba7e480e23b4/packages/project-protocol/src/save.ts)                             |
| 6      | [packages/model/src/schema/common.ts](https://github.com/cascode-ai/analog-canvas/blob/117ca625cd896e2bfeff4bedcb10ba7e480e23b4/packages/model/src/schema/common.ts)                                 |

<a id="h0"></a>

## H0 — 延期讨论的属性和 schema 分叉

作为下一轮讨论证据；不在首版本地目标中写入这些新增字段或改变编辑行为。

固定提交：`5231840f31b551f231441976efc0d18e6f9e5f80`。

| 文件号 | GitHub 固定源码                                                                                                                                                                                                                    |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1      | [apps/editor/src/features/properties/component-property-form.tsx](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/apps/editor/src/features/properties/component-property-form.tsx)   |
| 2      | [apps/editor/src/features/properties/route-property-form.tsx](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/apps/editor/src/features/properties/route-property-form.tsx)           |
| 3      | [apps/editor/src/features/properties/annotation-property-form.tsx](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/apps/editor/src/features/properties/annotation-property-form.tsx) |
| 4      | [packages/project-protocol/src/load.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/packages/project-protocol/src/load.ts)                                                       |
| 5      | [packages/model/src/schema/routing.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/packages/model/src/schema/routing.ts)                                                         |
| 6      | [packages/model/src/power-marker.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/packages/model/src/power-marker.ts)                                                             |

来源/后续修复提交（按表中顺序读取；不是批量 cherry-pick 指令）：

1. [853c5679 — feat(editor): give a component's properties a form, with JSON beneath it](https://github.com/LXY-freshman/schematic-draft/commit/853c56798c13dc8e047ce35724c59e5700685358)
2. [2526fa1a — feat(editor): give a wire's properties a form, with JSON beneath it](https://github.com/LXY-freshman/schematic-draft/commit/2526fa1ac3b78cad1621dda95f5bc673dc94ad36)
3. [4ba2d14d — feat(editor): give an annotation's properties a form, with JSON beneath it](https://github.com/LXY-freshman/schematic-draft/commit/4ba2d14df9651bd357260b776851e1c4ddfb0e00)
4. [30ced96b — feat(model): carry a per-wire line-jump flag in the Project schema](https://github.com/LXY-freshman/schematic-draft/commit/30ced96b63710f5be3ae0d9e4bdea10c62d23c19)
5. [7d480ef2 — feat(editor): let one wire or component be drawn heavier than the rest](https://github.com/LXY-freshman/schematic-draft/commit/7d480ef2b95ba9dae6a2df07f3d5f7eedc4b6391)
6. [f6732d98 — feat(editor): switch a MOS between its three- and four-terminal drawing](https://github.com/LXY-freshman/schematic-draft/commit/f6732d9829eeaa0295bba39fe75562c23306159d)
7. [d8c8c00b — feat(components): add dedicated analog and digital ground rails](https://github.com/LXY-freshman/schematic-draft/commit/d8c8c00b0a73e30212a3ed7a8c856aa136e2fcc3)
8. [5ae72fcc — feat(editor): draw each wire leg on its own click](https://github.com/LXY-freshman/schematic-draft/commit/5ae72fcc397d48bd3b28c0c6ccd26e76de1f0d0d)
