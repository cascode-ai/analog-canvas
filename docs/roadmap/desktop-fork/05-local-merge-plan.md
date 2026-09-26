# Fork 迁移与首版本地合并计划

本计划收敛此前四份报告，作为首批实施范围和读取源码的入口。**以当前 upstream 为底座，有出处地迁入 fork 的独立能力；完成一个可在本机验证的 Windows desktop 版本，并保持现有 Web 行为。** 当前已完成部分 upstream 准备，并开始最小桌面预览外壳迁入；具体进度及反馈边界见下节。

“迁入”指按功能适配源码，不是将 fork 整条分支合并。首轮本地预览循环已完成；当前交付范围扩展到 PR、合并队列、Web Production 验证，以及由已合并提交生成 Windows ZIP 预发布包。安装器、签名、自动更新与正式桌面发行仍延期。初版文档已通过 [PR #1125](https://github.com/cascode-ai/analog-canvas/pull/1125) 发布；功能交付执行仓库现有 Delivery 门禁，已交付部分见第 0 节。

<a id="feedback-alignment"></a>

## 0. 2026-09-26 反馈对齐与当前进度

本节依据 [LXY 的最新回复](https://github.com/cascode-ai/analog-canvas/issues/1003#issuecomment-5842705867)、Arcadia 的 [#1121 服务装配提案](https://github.com/cascode-ai/analog-canvas/issues/1121)和 [#1119 桌面任务](https://github.com/cascode-ai/analog-canvas/issues/1119)修订。下表区分作者已明确的输入、我们的实施取舍与待共同确认的决定；不将 Issue 提案视为已合并规格。

| 议题 | 调整后的计划 | 状态/边界 |
| --- | --- | --- |
| 宿主装配 | U-A 与 #1121 第一步采用同一套服务装配边界、能力工厂和注入接口，不另造一套平行宿主框架。检查账号、Cloud 初始/聚焦刷新、Gallery/拓扑轮询、Agent、模拟、analytics、service worker 的真实启动路径 | 对齐方向；接口名称和逐步拆分在实现前核对当前主线 |
| Web 本地保存 | 本批 Web Save 仍指向 Cloud。#1121 的 Web file-bound Save、首次保存选择 Cloud/文件及浏览器原位写入另作独立目标 | 存在范围差异，待共同确认；不能随重构变更现行持久化契约 |
| Visio 顺序 | 保持 V-A 适配主线模型、暂不带入跳线/线宽字段；保留链式导线、glue、拐点和 round cap 修复 | 作者最新回复已澄清先前顺序顾虑；空 jumps 的源码路径支持该拆分，仍须真实 Visio 验收 |
| 外链 | 保留明确的系统外链策略接口；本计划的严格离线构建禁用外部打开。帮助入口提供本地内容或禁用说明，不留下无反馈的点击 | 待实现/共同确认策略；调用系统浏览器与应用自身请求分开观测，均纳入离线工作流边界 |
| 基线与样例 | 5231840f 保留为迁入基线；不追随 fork main 自动更新。后续 UI/bugfix 单独审查并记录追加来源。作者计划提供合成 fixtures 和踩坑记录 | 冻结的是新增持久化字段，不是全部开发；样例尚待取得和核验，不标记为已收到 |
| 维护责任与用户需求 | 主项目安排桌面长期负责人；作者提供样例、经验和答疑。跳线、GaN/IGBT/LDMOS、Q 表单优先进入后续讨论 | 作者明确不承担长期维护；这三项仍待契约决策，首批完成不等于已替代其日常 fork 工作流 |
| 桌面验收 | 区分 M1 本地功能验收与 M2 可分发桌面版验收，后者承接 #1119 的产物、文件关联和 Windows CI 等要求 | M1 完成不能直接关闭 #1119；正式发行仍单独安排 |

**已完成：**[PR #1126](https://github.com/cascode-ai/analog-canvas/pull/1126)（main 提交 [b0c3264f](https://github.com/cascode-ai/analog-canvas/commit/b0c3264fc294491edcbb34e604a91ec491437538)）交付 U-C 导出交付接口与 U-B 共享保存协调。它们抽取 upstream 现有实现，未迁入 fork 代码；验证与交付证据随该 PR/提交保存。Native 存储/关闭接入、U-A 和桌面闭环未完成。

**当前授权目标：**先完成内部 Windows 预览包的“启动 → 绘图 → 导出项目 → 关闭 → 重新启动并导入 → 内容一致”循环。第一批 upstream 抽离继续沿用；最小外壳按固定 fork 源码适配。完整 Native 存储/关闭接入和其他 fork 功能仍延期。

**预览交付扩展：**在上述循环基础上增加 Windows CI 打包与真实 `.exe` 验收，并将结果纳入合并队列的必需 Core contracts 检查。合并后通过手动发布工作流从指定主线提交重建、验收并发布完整 ZIP；用户解压后运行，无需开发环境，不能只取单个 `.exe`。包内附对应源码、原许可/NOTICE、来源对照和验收记录。最终 squash 同时保留 LXY-freshman 的原实现贡献与 Arcadia-1 的方案讨论贡献。操作与边界见 [desktop README](../../../apps/desktop/README.md#preview-distribution)。

**U-A 第一批本地实现：**现有 Web 路由/预加载/统计和 service worker 装配移到 `entries/web.tsx`；懒加载的 `entries/web-editor.tsx` 创建稳定的 Web 服务，通过同一 `EditorServices` 注入身份查询、Cloud 存储和已有导出交付。App 和文件生命周期消费这些依赖，前台/后台保存共用一个 Cloud store，保留 revision、conflict、publication 与恢复语义。构建预加载跟随 Web 装配入口，Gallery 首屏仍不提前加载 editor。此批仅抽取 upstream 代码，尚未交付 Production；验证与限制记录在实现提交。

| 启动/订阅路径 | 本批处理 | U-A 后续边界 |
| --- | --- | --- |
| Gallery landing preload、Web 路由、访问统计 | 归入 Web entry，保留原请求时机、过滤和统计规则 | Desktop 不使用这个 Web entry；尚未实现 Desktop 构建 |
| service worker 注册/开发态注销 | Web 启动函数明确管理，保留 base path 与注销后重载规则 | Desktop 接入时验证不注册 |
| App 身份查询、Cloud 初始/聚焦刷新、列表/打开/保存/删除 | 使用宿主注入的 identity / Cloud projectStore；原 effects 的时机与清理保留 | 尚未把 identity/Cloud 缺席作为可运行的配置，也未引入 Native store |
| AccountMenu、Gallery 页面及发布/版本 UI | 现有自身加载行为保留；身份查询仍与原 account 模块共享缓存 | 后续整组装配其 UI、请求和订阅，不能认为 App 注入已覆盖所有账号调用 |
| GalleryTopologyTaskNotice / gallery-topology-task | 原订阅与后台轮询保持 | 需在 community 缺席时同时处理挂载、订阅与模块初始化 |
| WorkspaceAgentProvider / useAgentSession | 保持跨路由恢复与共享会话；未配对 Gallery 保持懒加载 | Agent transport 及恢复入口尚未改成可缺席能力 |
| BrowserSimulationSession / shared component library | 本批不改变其执行与加载方式 | 后续对齐 simulation/community 能力工厂与 UI |

这份清单是未完成范围，不是 offline 验收记录；U-A 整体仍未完成。Web 本地正式保存和 fork 实现复用仍遵守上述边界。

**内部预览实施边界：**新增独立 desktop entry 和构建目录；`EditorServices` 允许 identity / Cloud store 缺席，集中控制 community、Agent、simulation 和外链。Web 的默认能力与 Cloud Save 不变。预览以原生对话框确认的文件导出完成第一次数据闭环，Ctrl+S 也明确执行导出；不建立路径绑定，不把它称作原位 Save。能力关闭时不挂载账号/社区入口、不订阅拓扑轮询、不恢复 Agent 会话。共享 App 中仍有休眠的在线模块和内存对象，完整的构建期模块分离不在这一预览中宣称完成。

**预览验收：**已用实际 Windows 可执行文件完成绘图、取消/失败保护、原生导出、关闭、全新用户数据目录重启并导入，规范化项目内容一致；SVG/PNG/PDF 实际写盘、同一数据目录下手动恢复、外链提示和网络拦截均有本地自动化证据。重启后的恢复通过 File → Recover Unsaved Work 检查，不承诺所有标签页自动重开。Web 单元、绘图/属性/文件浏览器回归及构建预算、生产预览检查随提交记录。此验收只对应内部预览，不替代 D-A/M1/M2。

**本次贡献边界：**用户已授权最小预览循环，包括按源代码适配必要外壳。实际采用前已形成 [逐文件/函数来源与改写对照](../../../apps/desktop/SOURCES.md)，首次采用提交记录 LXY-freshman 共同作者、原提交和复用范围，保留原 NOTICE。后续 squash 仍需核验；这不自动批准其他 fork 功能迁入，也不以代码量小为由省略来源。预览运行/构建说明见 [desktop README](../../../apps/desktop/README.md)。


## 1. 任何时候都能找到原代码

### 已固定的身份

| 角色                | 固定提交                                                                                                      | 用途                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Fork 最终参考       | [`5231840f`](https://github.com/LXY-freshman/schematic-draft/tree/5231840f31b551f231441976efc0d18e6f9e5f80)   | 读取完成后的代码和修复                                     |
| Fork 最早双构建接入 | [`c15d9f2d`](https://github.com/LXY-freshman/schematic-draft/commit/c15d9f2db22cfbf19bdbc84d743460f5a384b7f6) | 当时尚未删除在线代码，参考外壳接线；不把早期行为当最终实现 |
| Upstream 分析基线   | [`117ca625`](https://github.com/cascode-ai/analog-canvas/tree/117ca625cd896e2bfeff4bedcb10ba7e480e23b4)       | 迁入时必须保留的当前产品契约                               |
| 共同起点            | `dbdd9499659b7606ffbc8cbbe641d2d91f2ffada`                                                                    | 区分 fork 主动修改与主线尚未同步的演进                     |

初次编写计划时，两个远程 main 已核对为上表快照。此后 upstream 已推进；每次开始实现仍记录最新 upstream 目标 base，并复审相关路径的新增差异。根据作者冻结新增持久化字段的决定，不再要求每个目标都跟随 fork main；固定参考保持 5231840f，另行采用后续修复时核对完整提交和适用范围，不改写历史基线。

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

以上为 **M1：本地功能验收**。**M2：可分发桌面版验收**另行覆盖可安装/解压产物、项目文件双击启动与关联、Windows 产物构建、打包后的完整零外部请求流程，以及必要的安装/升级/卸载行为；它承接 #1119，不因 M1 完成而自动完成。#1119 当前明确不包含代码签名，正式签名和更广发行政策另定。可提前设计 M2 检查，但不将其全部实现混入 M1；宿主与持久化规格/ADR 在对应实现接入前更新，不拖到 M2。

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
| U-A 宿主装配 | [U0 当前入口](migration-references.md#u0)、[R0 原始双构建](migration-references.md#r0)、[#1121](https://github.com/cascode-ai/analog-canvas/issues/1121) | `apps/editor/src/main.tsx`、`app/`、`vite.config.ts`，必要的新 `entries/`、`services/` | 先抽 upstream Web 装配，再接 Desktop；统一能力工厂和注入接口。初始化、订阅和 UI 一起受控。Web 子目标验证 Gallery/editor/Agent workspace；Desktop 接入后另验无在线初始化，不能只藏按钮 |
| U-B 保存协调 | [U1 上游 lifecycle/workspace](migration-references.md#u1)、[R1 原生文件/关闭](migration-references.md#r1) | `apps/editor/src/document/`、现有 Cloud Project 调用接线；必要的新宿主存储接口      | 抽 Cloud/Native 存储实现，但共享快照、dirty、草稿提交、标签页和晚返回处理；先让 Web 行为回归通过，再接 Native。保留 `cloudBinding` revision、publication/export 的不同含义 |
| U-C 导出交付 | [U2 上游命令](migration-references.md#u2)、[R3 fork 文件交付增量](migration-references.md#r3)             | `features/editor-shell/editor-export-commands.ts`、`editor-file-commands.ts` 及接线 | 统一产物字节/名称/类型/提示，分别由浏览器下载与桌面另存为交付；不改实际网表生成和检查规则                                                                                  |

U-A 同时为 desktop-first 功能提供有限的入口配置：Visio/文件导出命令、色板选择、粗网格开关。不建设通用插件市场或第二个全局状态容器，也不在所有业务文件里散布独立 `isDesktop` 判断。

U-B 必须保留上游这些具体问题的处理：保存中继续编辑；切换/关闭标签页后的异步完成；未提交 Properties/文本缓冲；恢复；Cloud conflict。fork 的 `close-guard` 是单窗口 Project 摘要，接入我方 workspace 时需要汇总所有不安全标签页，不能原封不动读一个 active Project。

与 #1121 的存储提案对接时保留 Cloud revision/conflict 和文件授权绑定的完整信息，不直接以示例中的简化 `{kind, id}` 替换现有状态。Web 本地正式保存不属于本批；后续若接纳，应先更新 persistence 规格/ADR，并明确浏览器下载请求与已确认原位写入的不同结果。Desktop 正式保存接入前也须按宿主范围更新相关规格/ADR，保留现行 Web 语义。

U-C 的特别约束：上游 `editor-file-commands` 已传 `netlistRootDocumentId` 并处理 `netlistConfigurationError`。fork 的旧文件不能覆盖这些能力。文件导出与已有复制必须使用同一个生成计划及相同拒绝条件。

## 5. Fork 首批迁入目标

### D-A：最小桌面宿主与本地文件闭环

**来源：**[R2 Electron 最终实现](migration-references.md#r2)、[R1 文件和关闭](migration-references.md#r1)。先读 fork 的 `main.ts`、`app-protocol.ts`、`project-files.ts`、`close-guard.ts`，再参照原始及修复提交。**前置：**U-A、U-B、U-C。

**迁入：**`app://` 本地资源、隔离窗口、安全偏好、原生文件对话框、基本标题/快捷键、关闭决策，以及 esbuild 主进程构建模式。新增 `apps/desktop/`，复用共享 editor 的 desktop 入口。

**必要适配：**使用官方文件协议和产品身份；文件由主进程授权的绑定控制，保存采用原子替换/外部变化检测；关闭状态接 U-B 的所有标签页摘要。禁用自动文件关联与安装相关启动逻辑。原 fork 的 `shell.openExternal` 把 HTTPS 交给系统浏览器，窗口自身仍禁止外部导航；保留可审查的外链策略接口，本计划的严格离线构建禁用外部打开。帮助入口改用本地内容或明确的禁用说明。应用请求和系统浏览器交接分别测试；将来允许白名单的配置需另行定义离线承诺，不能靠通用运行时开关放宽严格离线构建。

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
2. 适配 page/text/wire 转换。保留最终 `wire-chain`、glue、拐点节点和 round cap 修复；根据 U3 对接主线公式/标签接口。移除对尚未接纳的 fork `deriveRouteLineJumps`、`lineJumpRadius` 和 Instance/Route `strokeScale` 的依赖，不能把它们的 schema 顺带带入。`planWireChain(centerline, jumps = [])` 支持空跳线列表，其文件不导入跳线派生函数；适配 `page.ts` 调用即可保留普通折线链，后续共享跳线落地再接入。不得退回会自动重布线的 connector 或丢失可拖拐点的单一线段。需要的导出内部结构可以留在 exporter 内，但不得成为第二套持久化电路模型。
3. 接 Desktop 导出菜单与 U-C 文件交付，Web 不装配入口。输出当前 Document 的 `.vsdx`，附已有保真度提示；`.vssx` 为附属能力，不以仅完成 stencil 代替完成电路导出。

验证原 package 契约、现有上游器件/标签/公式样例和确定性；复用 `visio-open-check.ps1` 及导出契约，做真实 Visio 的文字编辑、移动器件和线端跟随。导出可如实提示原实现已有的格式损失，但不得为了通过测试改变 Project 源事实。

**成本界定：**OPC/固定符号基础较低，完整 `.vsdx` 是中等适配目标。因此安排在宿主和小功能之后做完整验收，不把它包装成一个零冲突的目录复制。

## 6. 执行顺序、分支与本地完成条件

```text
已完成：固定参考、三向差异、来源索引；U-C 与 U-B 共享保存协调（#1126）
    ↓
现在可做：U-A Web 侧装配抽离与回归；各迁入目标的来源对照
    ↓ 贡献处理方式敲定后，首次实际复用同步记录来源、声明和署名
U-A Desktop 装配 → U-B Native 存储/关闭接入（复用已有协调与 U-C）
    ↓
D-A Desktop 新建/打开/保存/关闭闭环
    ↓
F-A 网表存文件 → F-B 色板 → F-C 粗网格
    ↓
V-A Visio 完整适配与桌面验收
    ↓
本地整合验证、独立提交、演示与待讨论清单
    ↓ M1 完成后另行安排
M2 可分发桌面版验收（#1119）；正式发行事项另定
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

按作者最新的实际使用输入，下一轮优先讨论 **跳线、GaN/IGBT/LDMOS 功率器件、Q 属性表单**；MOS body、AGND/DGND、逐段点击连线为较低优先级输入。优先级不代表已接受其模型或已排入首批。样例和踩坑记录到位后再核对转换/导出风险；由主项目明确桌面长期负责人，不能将作者的答疑支持当作维护承诺。

## 8. 计划执行后的交付清单

- 一条干净、可审查的本地批次分支，来源和适配理由随提交保存。
- 同源 Web 构建与可本机运行的 Windows desktop；主线编辑能力保留。
- 网表存文件、色板、粗网格、Visio 的 Desktop 入口，及相关验收结果。
- 官方项目的跨端往返证据、本地保存/关闭/恢复证据、实际离线出口检查结果。
- 未完成的真实 Visio/其他环境验收如实列明；第 7 节延期项不混入本批次。

本计划的实际进度以第 0 节及相应实现 PR 为准；未完成的 Desktop、fork 功能和验收不能由 upstream 准备的合并替代。
