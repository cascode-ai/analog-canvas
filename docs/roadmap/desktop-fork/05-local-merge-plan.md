# Fork 迁移与首版本地合并计划

本计划收敛此前四份报告，作为首批实施范围和读取源码的入口。**以当前 upstream 为底座，有出处地迁入 fork 的独立能力；完成一个可在本机验证的 Windows desktop 版本，并保持现有 Web 行为。** 本次发布的是审查文档、固定源码索引与计划，尚未开始产品代码迁入。

“迁入”指按功能适配源码，不是将 fork 整条分支合并。这里的功能实现终点是本地工作树中的实现、解释性提交和验证记录；不包含功能代码的推送、PR、Production 部署、Release、安装器发布。本轮文档本身通过 PR 合并发布。后续若要求交付功能代码，继续执行仓库现有 Delivery 门禁。

## 1. 任何时候都能找到原代码

### 已固定的身份

| 角色                | 固定提交                                                                                                      | 用途                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Fork 最终参考       | [`5231840f`](https://github.com/LXY-freshman/schematic-draft/tree/5231840f31b551f231441976efc0d18e6f9e5f80)   | 读取完成后的代码和修复                                     |
| Fork 最早双构建接入 | [`c15d9f2d`](https://github.com/LXY-freshman/schematic-draft/commit/c15d9f2db22cfbf19bdbc84d743460f5a384b7f6) | 当时尚未删除在线代码，参考外壳接线；不把早期行为当最终实现 |
| Upstream 分析基线   | [`117ca625`](https://github.com/cascode-ai/analog-canvas/tree/117ca625cd896e2bfeff4bedcb10ba7e480e23b4)       | 迁入时必须保留的当前产品契约                               |
| 共同起点            | `dbdd9499659b7606ffbc8cbbe641d2d91f2ffada`                                                                    | 区分 fork 主动修改与主线尚未同步的演进                     |

本次计划编写时再次通过 `git ls-remote` 核对：两个远程 main 仍等于上表固定快照。真正开始实现前再核对一次；若上游推进，记录新的目标 base，并只复审相关路径的新增差异，不偷偷改动这份参考基线。

### 阅读入口

- [源码索引](migration-references.md)：13 组、76 个文件，全部链接到完整 SHA；原始功能和后续修复提交也逐项可点开。
- [建立固定参考、可编辑副本和离线 bundle](README.md#reference-workflow)：使用标准 Git 命令，不依赖某台机器的目录或未发布脚本。
- [三向 diff 的复现方法](README.md#reproduce-diff)：区分 fork 自己的增量、主线演进以及当前两个产品的差异。

例如在上述参考仓库中运行，读取 Visio 最终代码和网表保存的原始改动：

```powershell
git show 5231840f31b551f231441976efc0d18e6f9e5f80:packages/visio/src/page.ts
git show c14ae0c58568c75b6685519ba180d0837f559282
git show c15d9f2db22cfbf19bdbc84d743460f5a384b7f6:apps/editor/src/desktop/desktop-mode.ts
```

这些命令只读固定 Git 对象。迁入时必须阅读实际源码和修复，不能以本报告的文字摘要代替。

## 2. 首版范围与终点

### 初版纳入

1. Upstream 必要准备：宿主装配、保存协调与导出交付接缝，保留一套编辑器。
2. Windows Electron 本地闭环：打开/保存/另存为官方项目、未保存关闭保护、本地恢复、窗口基本行为。
3. Desktop 先开放：网表存文件、MATLAB 色板、每七格粗网格。
4. 主线当前格式的 Visio `.vsdx` 导出，带保真度提示；`.vssx` 作为同一 exporter 的附属输出。

### 初版明确不纳入

- Fork schema 58–60、新跳线/单对象线宽/半径字段、`.schdraft` 格式转换。
- Q 属性表单、MOS body 新按钮、GaN/IGBT 与符号几何修改、AGND/DGND、逐段点击连线。
- 在线 desktop、桌面云同步、桌面 Agent 或模拟环境。
- 文件关联注册表、正式 NSIS 安装器、签名、自动更新、公开发布。原实现保留为后续参考。

这些不是否定功能价值，而是本批次不承担其尚未议定的共享语义。详细问题见第 7 节。

### 可检查的最终状态

同一份源码能构建现有 Web 和本地 desktop；后者使用官方 `project-protocol`，能完成新建、导入、编辑、保存、重开与导出。Web 原菜单及编辑行为保持，Desktop 的新增入口由明确配置装配。至少覆盖：

- Desktop 保存 → 同版本 Web 打开并修改 → 再保存 → Desktop 重开，电路事实保持。
- Desktop 多标签页的未保存状态、保存取消/失败和关闭保护正确；不因只检查前台项目而丢后台编辑。
- 本地资源可用，云能力未初始化，禁止的外部请求和外链被实际阻止。对该检查的结果作准确记录，不用“拔网线能画图”替代验证。
- `.vsdx` 真实打开后能编辑文字、移动器件，线端跟随；已知损失有明确提示。没有 Visio 验收时，标记该项待验，不能声称整个首版已验收。

## 3. 迁移方法：复用原实现，改动有理由

每个目标开始前完成以下步骤：

1. 阅读本目标来源组的**最终代码、原始功能提交、后续修复和测试**，再读上游接入处。只有起始提交不够，尤其不能漏掉 Visio wire-chain 和粗网格 viewport 的修复。
2. 写清迁移对照：哪些原文件/函数原样复用；哪些因上游接口变化而适配；哪些明确不带入及原因。保留上游原有版权/许可证信息，按来源记录作者归属。
3. 能提取的局部增量就提取；测试迁移其行为断言而非照搬旧 fixture。fork 的 App、lifecycle、共享 schema、generated 组件文件和 lockfile 不整份覆盖主线。
4. 新接口只用于衔接真实依赖。例如 Native 保存适配器是必要的新接缝；重写一套未对照 fork 的 Electron 外壳或 Visio writer 不在计划内。
5. 本地提交记录来源完整 commit URL、复用范围、必要改写、刻意不迁入的差异、验证和 `Test-Impact:`。修改实现但没有新测试时，按仓库规则提供既有保护证据。

如果实际代码与来源表不符、所需接口不存在或必须触及延期契约，先补充目标边界和来源证据。不能通过臆造兼容字段、复制旧核心包或忽略类型错误让它“看起来接上了”。

## 4. Upstream 准备目标

这些工作主要是对上游既有实现的抽离。参考 fork 的调用需求，不宣称 fork 已经提供了一套可直接复制的共用宿主架构。

| 目标         | 具体参考                                                                                                  | 预计拥有路径                                                                        | 完成内容与验证                                                                                                                                                             |
| ------------ | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U-A 宿主装配 | [U0 当前入口](migration-references.md#u0)、[R0 原始双构建](migration-references.md#r0)                    | `apps/editor/src/main.tsx`、`app/`、`vite.config.ts`，必要的新 `entries/`、`hosts/` | Web 保持现状；Desktop 可注入能力/入口。云服务的初始化、订阅和 UI 一起受宿主装配控制，不能只藏按钮。验证 Web Gallery/editor/Agent workspace 入口与 desktop 不初始化在线服务 |
| U-B 保存协调 | [U1 上游 lifecycle/workspace](migration-references.md#u1)、[R1 原生文件/关闭](migration-references.md#r1) | `apps/editor/src/document/`、现有 Cloud Project 调用接线；必要的新宿主存储接口      | 抽 Cloud/Native 存储实现，但共享快照、dirty、草稿提交、标签页和晚返回处理；先让 Web 行为回归通过，再接 Native。保留 `cloudBinding` revision、publication/export 的不同含义 |
| U-C 导出交付 | [U2 上游命令](migration-references.md#u2)、[R3 fork 文件交付增量](migration-references.md#r3)             | `features/editor-shell/editor-export-commands.ts`、`editor-file-commands.ts` 及接线 | 统一产物字节/名称/类型/提示，分别由浏览器下载与桌面另存为交付；不改实际网表生成和检查规则                                                                                  |

U-A 同时为 desktop-first 功能提供有限的入口配置：Visio/文件导出命令、色板选择、粗网格开关。不建设通用插件市场或第二个全局状态容器，也不在所有业务文件里散布独立 `isDesktop` 判断。

U-B 必须保留上游这些具体问题的处理：保存中继续编辑；切换/关闭标签页后的异步完成；未提交 Properties/文本缓冲；恢复；Cloud conflict。fork 的 `close-guard` 是单窗口 Project 摘要，接入我方 workspace 时需要汇总所有不安全标签页，不能原封不动读一个 active Project。

U-C 的特别约束：上游 `editor-file-commands` 已传 `netlistRootDocumentId` 并处理 `netlistConfigurationError`。fork 的旧文件不能覆盖这些能力。文件导出与已有复制必须使用同一个生成计划及相同拒绝条件。

## 5. Fork 首批迁入目标

### D-A：最小桌面宿主与本地文件闭环

**来源：**[R2 Electron 最终实现](migration-references.md#r2)、[R1 文件和关闭](migration-references.md#r1)。先读 fork 的 `main.ts`、`app-protocol.ts`、`project-files.ts`、`close-guard.ts`，再参照原始及修复提交。**前置：**U-A、U-B、U-C。

**迁入：**`app://` 本地资源、隔离窗口、安全偏好、原生文件对话框、基本标题/快捷键、关闭决策，以及 esbuild 主进程构建模式。新增 `apps/desktop/`，复用共享 editor 的 desktop 入口。

**必要适配：**使用官方文件协议和产品身份；文件由主进程授权的绑定控制，保存采用原子替换/外部变化检测；关闭状态接 U-B 的所有标签页摘要。禁用自动文件关联与安装相关启动逻辑；原 fork 的任意 HTTPS `shell.openExternal` 也不作为离线模式默认能力迁入。

**验证：**复用 `local-shell.test.ts`、`close-guard.test.ts` 的有效断言和真实窗口检查思路；补当前 workspace 的保存、取消、失败、关闭/恢复、多标签页用例。开发版 `electron .` 或本地未打包目录能够运行即可，不以 Windows 注册表变更作为首版前提。产物网络检查覆盖实际出口，本批次不把“已有拦截函数”当作已通过检查。

### F-A：网表保存到文件

**来源：**[R3 原始提交及源码](migration-references.md#r3)、[U2 当前生成规则](migration-references.md#u2)。**前置：**U-A、U-C；原生交付验收在 D-A 后。

提取 [`c14ae0c5`](https://github.com/LXY-freshman/schematic-draft/commit/c14ae0c58568c75b6685519ba180d0837f559282) 中 file delivery、命令与提示的增量，保留当前 netlist root、profile、命名及诊断。Desktop 增加存文件入口，Web 当前入口不变。

验证同一配置下“复制”和“文件”内容一致；blocked 条件一致；保存取消不提示成功；选定 root Cell 生效。主要复用 `editor-export-commands.test.ts` 及 `netlist-workflows.spec.ts`，不改 `packages/netlist`。

### F-B：MATLAB 色板

**来源：**[R4 色值和原提交](migration-references.md#r4)。**前置：**U-A 的入口配置。

复用 fork 的具体色值及既有颜色控件。颜色仍写现有 hex 字段；Desktop 配置提供新色板，Web 保持当前色板。原提交还含 caption 大小、RGB 边框等 CSS 调整，本目标不带入。

验证已有对象颜色显示、选择/自定义颜色、撤销和跨端再保存；纯静态色值不单独写“数组等于数组”的测试，复用控件行为和现有颜色契约。

### F-C：每七格粗网格

**来源：**[R5 粗点与 viewport 后续修复](migration-references.md#r5)。**前置：**U-A。

提取 overlay、模式状态与状态栏交互，保持视图偏好；不新增 Project 字段、不改 snap 间距。先对照主线 camera/viewport，再决定如何吸收 [`d08705e0`](https://github.com/LXY-freshman/schematic-draft/commit/d08705e057b45b7bda05fec787af3a6609ac7fda) 的修复。目标是保留修复后的覆盖行为，不是原样覆盖 `camera-runtime.ts`。

验证粗细点同原点、缩放和平移、面板调整和 fit-view 后无空白；Desktop 模式循环正确；Web 原模式不变；SVG/PDF 导出不带画布背景。复用 overlay 单测、camera-runtime 测试与 auto-fit 浏览器用例中的相关行为。若实现必须改变连线或坐标语义，超出此目标，停止扩张并列入讨论。

### V-A：主线数据模型上的 Visio 导出

**来源：**[R6 打包/符号基础](migration-references.md#r6)、[R7 最终页面/文字/连线](migration-references.md#r7)、[U3 当前主线文本和文件契约](migration-references.md#u3)。**前置：**模块适配可独立开展；菜单/文件交付依赖 U-A、U-C，实际桌面验收依赖 D-A。

这是一个独立功能目标，内部按以下三步落地；支持性提交不另算功能数量：

1. 迁入 OPC/XML、units、geometry、masters/stencil 等原实现及测试。由主线当前 Symbol 定义生成，不携带 fork 的旧生成器目录快照。
2. 适配 page/text/wire 转换。保留最终 `wire-chain`、glue 和拐点修复；根据 U3 对接主线公式/标签接口。移除对尚未接纳的 fork `deriveRouteLineJumps`、`lineJumpRadius` 和 Instance/Route `strokeScale` 的依赖，不能把它们的 schema 顺带带入。需要的导出内部结构可以留在 exporter 内，但不得成为第二套持久化电路模型。
3. 接 Desktop 导出菜单与 U-C 文件交付，Web 不装配入口。输出当前 Document 的 `.vsdx`，附已有保真度提示；`.vssx` 为附属能力，不以仅完成 stencil 代替完成电路导出。

验证原 package 契约、现有上游器件/标签/公式样例和确定性；复用 `visio-open-check.ps1` 及导出契约，做真实 Visio 的文字编辑、移动器件和线端跟随。导出可如实提示原实现已有的格式损失，但不得为了通过测试改变 Project 源事实。

**成本界定：**OPC/固定符号基础较低，完整 `.vsdx` 是中等适配目标。因此安排在宿主和小功能之后做完整验收，不把它包装成一个零冲突的目录复制。

## 6. 执行顺序、分支与本地完成条件

```text
已完成：固定参考、三向差异、来源索引
    ↓
U-A 宿主装配 → U-B 保存协调 → U-C 导出交付
    ↓
D-A Desktop 新建/打开/保存/关闭闭环
    ↓
F-A 网表存文件 → F-B 色板 → F-C 粗网格
    ↓
V-A Visio 完整适配与桌面验收
    ↓
本地整合验证、独立提交、演示与待讨论清单
```

这是依赖和推荐评审顺序，不要求纯 exporter 代码等待所有 UI 工作才能阅读或适配。按仓库规则，每个所有权与验证边界清楚的目标保留独立解释性提交。

正式实现从已核对的 upstream main 建立隔离工作树，按仓库规则继续本地批次或新建 `codex/local-batch`，把实际 branch/base 写入该工作树的 `plan/local-batch.md`。参考副本用于来源研究和试验；正式目标要核对最新上游与工作区所有权，进入实现批次的改动必须经过上述对照与验证。

### 预先核对的门禁义务

已按固定主线的 gate planner 核对预计路径：宿主/保存/新依赖组合，以及 Visio 包/lockfile 组合选出 full-delivery；色板/粗网格路径选出 static、Test-Impact、workspace unit 及映射 browser gates。

这些只是规划结果，**不是测试通过记录**。正式门禁以当前[工作规则](../../../AGENTS.md)和[测试说明](../../testing/README.md)为准。开始目标时使用实际 commit base，执行 `pnpm gate:plan -- --path <预计路径>`；提交前根据实际 diff 用 `pnpm gate:plan -- --base <target-base>` 重新规划。不能把固定快照上的选择当成未来永久不变的门禁。

局部循环按风险先跑 `pnpm test:local <相关测试>` / `pnpm test:e2e:local <相关spec>`。在选定 affected/build/release gate 前跑 `gate:preflight -- --base <target-base>`，提交后核对 Test-Impact。新增 Electron 实窗检查的正式命令在 D-A 实现时定义，不能把 fork 脚本在主线已经可运行当作事实。

该批次跨 editor、文件会话、exporter、原生宿主和依赖，完成所有目标后安排一次 `pnpm verify:branch`，再做 Desktop 和跨端文件流的集成验收；它不代替将来 Delivery 的 required checks。本地阶段不因 gate plan 出现 full-delivery 就反复跑完整 Delivery；公开交付时按 AGENTS/merge queue 执行。真正风险要求更广本地证据时再扩展。

如果实际 diff 扩到复制/放置、实例标签或 `packages/netlist`，按仓库规则补 Gallery census。首版功能不以修改这些共享规则为前提；没有触及时不额外读取私有 Gallery。

每个目标结束必须检查 diff、dirty ownership、`git diff --check`，只提交本目标路径。首版本地批次最后记录：已完成目标、来源提交、测试结果、未验项目和延期问题，不把未完成项用“本地可运行”掩盖。

## 7. 留待讨论的分叉与解锁条件

| 延期内容         | 首版处理                                                                 | 下一轮需要回答的问题                                                                                            |
| ---------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Q 表单           | 继续主线当前 Properties                                                  | 是否接受表单默认布局；如何消费主线新字段；共用 parser/planner 的迁入范围。来源 [H0](migration-references.md#h0) |
| 跳线/线宽/半径   | 不新增字段，不迁 fork 版本号                                             | 字段、默认值、迁移与跨端读取/显示/再保存，SVG/高亮/Visio 一致性                                                 |
| Fork 文件转换    | 只承诺官方文件兼容范围；不提供 `.schdraft` 导入，不靠改扩展名/版本号导入 | 取得真实样例、来源判别、不可表达字段如何处理；兼容的历史官方文件照常走现有 reader                               |
| MOS body、新器件 | 保留当前器件定义和 UI                                                    | 引脚/variant/bulk/netlist 契约，几何与模型依据，旧图影响                                                        |
| AGND/DGND        | 不迁新的 power-marker 表                                                 | 与 SPICE 0 的区别、作用域、复制和层次连接                                                                       |
| 逐段点击连线     | 保持现有手势                                                             | 产品是否采纳；是否能只改变输入策略而共用连接和事务                                                              |
| 桌面在线能力     | 不初始化云、Agent、模拟服务                                              | 权限/登录与网络策略，双保存目的地，本地与远端执行边界                                                           |
| 安装/发行        | 本地运行即可，不注册文件关联                                             | 产品身份、文件关联、卸载保留、签名、负责人和 `desktop-v*` 发布                                                  |

已知 fork 扩展文件不能通过删未知字段“修成可打开”。若发现当前 reader 接受但损失信息，应先记录可复现样例并建立明确拒绝边界；不要在本批次临时写一套完整转换器。

## 8. 计划执行后的交付清单

- 一条干净、可审查的本地批次分支，来源和适配理由随提交保存。
- 同源 Web 构建与可本机运行的 Windows desktop；主线编辑能力保留。
- 网表存文件、色板、粗网格、Visio 的 Desktop 入口，及相关验收结果。
- 官方项目的跨端往返证据、本地保存/关闭/恢复证据、实际离线出口检查结果。
- 未完成的真实 Visio/其他环境验收如实列明；第 7 节延期项不混入本批次。

本计划没有启动以上实现。当前提供的是可审查的目标边界、固定源码索引、可复现的参考环境和验收要求。
