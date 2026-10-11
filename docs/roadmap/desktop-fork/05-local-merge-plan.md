# Fork 后续迁入约束与待决分叉

当前离线产品完善范围与完成标准由[06 完善方案](06-desktop-completion-plan.md)统一持有。
本文保留后续实际复用所需的固定源码、迁入规则和未决分叉，不是新的执行批次。
首轮阶段决策与交付记录可查阅[固定 Git 版本](https://github.com/cascode-ai/analog-canvas/blob/37bccd4012764dce53b34927fa606c6f430296a2/docs/roadmap/desktop-fork/05-local-merge-plan.md)。

<a id="feedback-alignment"></a>

## 待完成的反馈对齐

- 能力装配及离线构建按 [#1121](https://github.com/cascode-ai/analog-canvas/issues/1121) 继续收口；Web 文件正式保存仍为独立产品决定。
- [#1119](https://github.com/cascode-ai/analog-canvas/issues/1119) 的文件关联、完整绘图和实际产物零请求验收已纳入 06，不能再按旧计划延期。
- [作者反馈](https://github.com/cascode-ai/analog-canvas/issues/1003#issuecomment-5842705867)中的合成 fixtures 和踩坑记录须实际取得并核验，不将计划提供写成已收到。
- 主项目应明确桌面长期负责人；作者提供答疑不等于承担维护。跳线、GaN/IGBT/LDMOS、Q 表单仍需契约讨论。
- 后续实际复用的作者、原提交、范围和许可声明随 [SOURCES](../../../apps/desktop/SOURCES.md) 更新，并核验最终 squash 署名。

## 固定源码入口

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

## 迁移方法：复用原实现，改动有理由

每个目标开始前完成以下步骤：

1. 阅读本目标来源组的**最终代码、原始功能提交、后续修复和测试**，再读上游接入处。只有起始提交不够，尤其不能漏掉 Visio wire-chain 和粗网格 viewport 的修复。
2. 写清迁移对照：哪些原文件/函数原样复用；哪些因上游接口变化而适配；哪些明确不带入及原因。保留上游原有版权/许可证信息，按来源记录作者归属。
3. 能提取的局部增量就提取；测试迁移其行为断言而非照搬旧 fixture。fork 的 App、lifecycle、共享 schema、generated 组件文件和 lockfile 不整份覆盖主线。
4. 新接口只用于衔接真实依赖。例如 Native 保存适配器是必要的新接缝；重写一套未对照 fork 的 Electron 外壳或 Visio writer 不在计划内。
5. 本地提交记录来源完整 commit URL、复用范围、必要改写、刻意不迁入的差异、验证和 `Test-Impact:`。修改实现但没有新测试时，按仓库规则提供既有保护证据。

如果实际代码与来源表不符、所需接口不存在或必须触及延期契约，先补充目标边界和来源证据。不能通过臆造兼容字段、复制旧核心包或忽略类型错误让它“看起来接上了”。

## 网表存文件的来源约束（本轮纳入）

**来源：**[R3 原始提交及源码](migration-references.md#r3)、[U2 当前生成规则](migration-references.md#u2)。**接入：**使用现有宿主交付模块，随 06 的 L4 验收。

提取 [`c14ae0c5`](https://github.com/LXY-freshman/schematic-draft/commit/c14ae0c58568c75b6685519ba180d0837f559282) 中 file delivery、命令与提示的增量，保留当前 netlist root、profile、命名及诊断。Desktop 增加存文件入口，Web 当前入口不变。

验证同一配置下“复制”和“文件”内容一致；blocked 条件一致；保存取消不提示成功；选定 root Cell 生效。主要复用 `editor-export-commands.test.ts` 及 `netlist-workflows.spec.ts`，不改 `packages/netlist`。

## 后续特性（本轮不纳入）

### F-B：MATLAB 色板

**来源：**[R4 色值和原提交](migration-references.md#r4)。**接入：**使用主线能力装配和既有颜色控件。

复用 fork 的具体色值及既有颜色控件。颜色仍写现有 hex 字段；Desktop 配置提供新色板，Web 保持当前色板。原提交还含 caption 大小、RGB 边框等 CSS 调整，本目标不带入。

验证已有对象颜色显示、选择/自定义颜色、撤销和跨端再保存；纯静态色值不单独写“数组等于数组”的测试，复用控件行为和现有颜色契约。

### F-C：每七格粗网格

**来源：**[R5 粗点与 viewport 后续修复](migration-references.md#r5)。**接入：**使用主线能力装配和现有视图状态。

提取 overlay、模式状态与状态栏交互，保持视图偏好；不新增 Project 字段、不改 snap 间距。先对照主线 camera/viewport，再决定如何吸收 [`d08705e0`](https://github.com/LXY-freshman/schematic-draft/commit/d08705e057b45b7bda05fec787af3a6609ac7fda) 的修复。目标是保留修复后的覆盖行为，不是原样覆盖 `camera-runtime.ts`。

验证粗细点同原点、缩放和平移、面板调整和 fit-view 后无空白；Desktop 模式循环正确；Web 原模式不变；SVG/PDF 导出不带画布背景。复用 overlay 单测、camera-runtime 测试与 auto-fit 浏览器用例中的相关行为。若实现必须改变连线或坐标语义，超出此目标，停止扩张并列入讨论。

### V-A：主线数据模型上的 Visio 导出

**来源：**[R6 打包/符号基础](migration-references.md#r6)、[R7 最终页面/文字/连线](migration-references.md#r7)、[U3 当前主线文本和文件契约](migration-references.md#u3)。**接入：**模块适配可独立开展；菜单/文件交付复用现有宿主模块，实际桌面验收随该特性交付。

这是一个独立功能目标，内部按以下三步落地；支持性提交不另算功能数量：

1. 迁入 OPC/XML、units、geometry、masters/stencil 等原实现及测试。由主线当前 Symbol 定义生成，不携带 fork 的旧生成器目录快照。
2. 适配 page/text/wire 转换。保留最终 `wire-chain`、glue、拐点节点和 round cap 修复；根据 U3 对接主线公式/标签接口。移除对尚未接纳的 fork `deriveRouteLineJumps`、`lineJumpRadius` 和 Instance/Route `strokeScale` 的依赖，不能把它们的 schema 顺带带入。`planWireChain(centerline, jumps = [])` 支持空跳线列表，其文件不导入跳线派生函数；适配 `page.ts` 调用即可保留普通折线链，后续共享跳线落地再接入。不得退回会自动重布线的 connector 或丢失可拖拐点的单一线段。需要的导出内部结构可以留在 exporter 内，但不得成为第二套持久化电路模型。
3. 接 Desktop 导出菜单与现有文件交付，Web 不装配入口。输出当前 Document 的 `.vsdx`，附已有保真度提示；`.vssx` 为附属能力，不以仅完成 stencil 代替完成电路导出。

验证原 package 契约、现有上游器件/标签/公式样例和确定性；复用 `visio-open-check.ps1` 及导出契约，做真实 Visio 的文字编辑、移动器件和线端跟随。导出可如实提示原实现已有的格式损失，但不得为了通过测试改变 Project 源事实。

**成本界定：**OPC/固定符号基础较低，完整 `.vsdx` 是中等适配目标。因此作为后续独立目标做完整验收，不把它包装成一个零冲突的目录复制。

## 待决分叉与解锁条件

| 延期内容         | 当前处理                                                                 | 下一轮需要回答的问题                                                                                            |
| ---------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Q 表单           | 继续主线当前 Properties                                                  | 是否接受表单默认布局；如何消费主线新字段；共用 parser/planner 的迁入范围。来源 [H0](migration-references.md#h0) |
| 跳线/线宽/半径   | 不新增字段，不迁 fork 版本号                                             | 字段、默认值、迁移与跨端读取/显示/再保存，SVG/高亮/Visio 一致性                                                 |
| Fork 文件转换    | 只承诺官方文件兼容范围；不提供 `.schdraft` 导入，不靠改扩展名/版本号导入 | 取得真实样例、来源判别、不可表达字段如何处理；兼容的历史官方文件照常走现有 reader                               |
| MOS body、新器件 | 保留当前器件定义和 UI                                                    | 引脚/variant/bulk/netlist 契约，几何与模型依据，旧图影响                                                        |
| AGND/DGND        | 不迁新的 power-marker 表                                                 | 与 SPICE 0 的区别、作用域、复制和层次连接                                                                       |
| 逐段点击连线     | 保持现有手势                                                             | 产品是否采纳；是否能只改变输入策略而共用连接和事务                                                              |
| 桌面在线能力     | 不初始化云、Agent、模拟服务                                              | 权限/登录与网络策略，双保存目的地，本地与远端执行边界                                                           |

已知 fork 扩展文件不能通过删未知字段“修成可打开”。若发现当前 reader 接受但损失信息，应先记录可复现样例并建立明确拒绝边界；不要在本轮临时写一套完整转换器。

按作者最新的实际使用输入，下一轮优先讨论 **跳线、GaN/IGBT/LDMOS 功率器件、Q 属性表单**；MOS body、AGND/DGND、逐段点击连线为较低优先级输入。优先级不代表已接受其模型或已排入本轮。样例和踩坑记录到位后再核对转换/导出风险；由主项目明确桌面长期负责人，不能将作者的答疑支持当作维护承诺。

签名、安装器、自动更新及跨平台发行另期决定；文件关联、ZIP 升级和本轮发布已经属于 06 完善方案。
