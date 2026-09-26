# 功能分叉的保留与共用：Desktop 可以先有，哪些契约必须一起演进

下文分析各功能的共用边界；首批实施取舍和明确来源见 [首版本地合并计划](05-local-merge-plan.md)。可以分阶段开放不等于已经排入首批。

**结论：允许 desktop 先开放功能，但让它运行在主线当前的同一套模型、事务和文件协议上。** 只读导出、局部 UI、系统集成可以保留产品差异；会改变保存文件、器件身份或编辑含义的能力，需要先确定共享规则。

本报告补充 [分叉分析](01-divergence.md) 和 [目标架构](02-target-architecture.md)，回答“哪些可低成本先接 desktop，哪些不同步会造成长期维护成本”。固定源码仍为 fork [`5231840f`](https://github.com/LXY-freshman/schematic-draft/commit/5231840f31b551f231441976efc0d18e6f9e5f80)、upstream [`117ca625`](https://github.com/cascode-ai/analog-canvas/commit/117ca625cd896e2bfeff4bedcb10ba7e480e23b4)。成本是基于源码依赖的相对判断，尚未经过编译迁入或工时测量；不把“独立目录”当作“复制即可用”。

## 1. 分开三个决策，避免把功能差异变成代码分叉

| 决策                 | 允许怎么不同                                      | 应保持什么一致                                      |
| -------------------- | ------------------------------------------------- | --------------------------------------------------- |
| 用户能否看到入口     | Visio 菜单只在 desktop 出现；Web 继续现有导出菜单 | 仍由同一仓库的模块实现，不复制一套 editor           |
| 用户能否创建某种内容 | Desktop 先提供跳线按钮，Web 暂不提供              | 在支持该文件版本的 Web 中仍能读取、显示、保留该内容 |
| 内容本身如何解释     | 云保存与本地保存可有不同存储实现                  | 相同器件、线路、参数、标签与文件字段具有同一含义    |

“共用代码”不要求“Web 同一天上线所有按钮”；“暂时 desktop-only”也不应意味着复制 model、codec 或 property planner。

下文的“同步”指共享规则和实现随同一主线演进，不要求旧版已安装桌面包跟随网站每次发布。旧版本打不开未来文件时按既有协议明确拒绝，不能伪装兼容。

## 2. 功能处置总表

“维护成本”指按推荐边界接入之后的持续成本。宿主功能的低成本以桌面入口和桥接已就绪为前提；第一次搭建 desktop 的成本不能藏在这些小功能里。

| 功能                                   | 首次迁入成本       | 可先仅 Desktop 提供                 | 后续维护成本                      | 推荐边界与需要讨论的事项                                                                                          |
| -------------------------------------- | ------------------ | ----------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Visio OPC/XML 打包、几何工具           | 低                 | 可以，作为内部模块先迁入            | 低                                | 输出 `.vsdx/.vssx` 字节，不碰项目存储；单独抽取所需源文件与导出，不能因旧 barrel 一次带入全部依赖                 |
| Visio 固定符号库 `.vssx`               | 低至中             | 可以                                | 低至中                            | 读取主线当前 Symbol 定义生成 stencil；确认不支持的动态公式图形。库增加/变体变化时 exporter 测试跟进               |
| 当前电路 `.vsdx` 导出                  | 中                 | **很适合先只开放 Desktop**          | 中，可限定在 exporter 维护        | 适配主线 Document/resolver/文本接口；不写回项目、不建 Visio 专属电路 schema。完整移入 fork 全部表现增强不是低成本 |
| 网表“保存到文件”                       | 低                 | 可以                                | 低                                | 复用现有网表生成与诊断；只新增文件交付。不能为 desktop 放宽网表拒绝条件                                           |
| MATLAB 色板                            | 低                 | 可以                                | 低                                | 写入现有 hex color 字段，不存 palette index/desktop 枚举；Web 继续正确显示颜色                                    |
| 每七格粗点、局部显示偏好               | 低至中             | 可以                                | 低                                | 保持画布/用户偏好，不改坐标、snap 与项目 schema。主线和 fork 均修改过 canvas，仍需适配                            |
| 菜单、窗口标题、尺寸、快捷键、文件关联 | 低至中，需宿主接缝 | 可以长期仅 Desktop                  | 低，Windows 行为独立维护          | 留在桌面宿主；编辑命令和未保存状态从共享会话读取                                                                  |
| Component/Route/Annotation 属性表单    | 中                 | 可以先开放 UI                       | 共用提交链时中；复制提交链后高    | UI 可分阶段，字段词汇、校验、planner 和 Undo 必须共用；先覆盖主线已有字段                                         |
| MOS body 显示按钮                      | 中                 | 按钮可以                            | 若 bulk 语义分叉则高              | 共用 Symbol variant、bulk binding、隐藏端口和 netlist 规则；Web 不显示按钮也要正确处理保存结果                    |
| 跳线、单对象线宽、跳线半径             | 中至高             | **只能先限创作入口**                | 共用模型时中；两套模型时很高      | schema/codec/事务/派生/SVG/高亮一起进入共享层；先议定字段、缺省值和渲染语义                                       |
| GaN/IGBT、符号变体与引脚位置           | 中至高             | 可以先限 Library 入口               | 两套器件库会高                    | 主线组件定义、resolver、pin order、netlist target 必须认识它；不带入独立旧目录生成物                              |
| AGND/DGND、电源网身份                  | 高                 | 不适合作为纯 Desktop 私有能力先迁入 | 不统一会很高                      | 名字、全局作用域、SPICE 0、复制与网表规则先讨论，再做一个共享功能目标                                             |
| 逐段点击连线                           | 中至高             | 手势策略可不同，需先定边界          | 独立 controller/连接算法后高      | 可把手势作为输入策略；最终连接、取消、事务和撤销语义仍共用，不复制 wiring 子系统                                  |
| `.schdraft` 导入/Schema 分支           | 高                 | 专用导入菜单可只在 Desktop          | 无限延续两套 writer/reader 会很高 | fork reader 只用于有界转换；正常保存回官方统一格式，不在官方桌面继续递增 fork schema                              |
| 本地 Save/Save As、恢复、关闭保护      | 中至高             | 原生存储可仅 Desktop                | 两套 lifecycle 会高               | I/O 可不同，快照/dirty/异步完成/标签页绑定共用；需要先定义保存状态接口                                            |

前三项 Visio 成本按子范围分列：仅迁入底层包不是交付了完整电路导出；`.vssx` 可成为较小的首个可见功能，但不能拿它替代用户要求的 `.vsdx`。

## 3. 为什么 Visio 可以先仅 Desktop，而不能按“零成本平移”处理

### 已具备的低耦合条件

- [drawing.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/packages/visio/src/drawing.ts) 的公共入口接收 drawing 描述并返回 `Uint8Array`，不操作文件，也不要求安装 Visio。
- [stencil.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/packages/visio/src/stencil.ts) 可以接收 Symbol 定义，输出 stencil。固定符号库导出不需要把正在编辑的 Project 换成另一套模型。
- [editor-export-commands.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/apps/editor/src/features/editor-shell/editor-export-commands.ts) 已区分 artifact 内容与交付，适合让宿主负责下载或原生“另存为”。
- [导出契约](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/docs/specs/export.md) 明确它是单向输出：Visio 编辑结果不导回 Canvas，因此不需要在正式项目中持久化一套 Visio 编辑状态。

这使 Visio 的发布差异可以稳定地停留在导出菜单和模块装配层。以后给 Web 增加入口，不需要迁移用户保存的 `.icproj.json`。

### 必须完成的一次适配

最新 fork [page.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/packages/visio/src/page.ts) 读取 `deriveRouteLineJumps`、`lineJumpRadius`、Route/Instance `strokeScale`；[formula-text.ts](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/packages/visio/src/formula-text.ts) 使用 fork 的 `parseSignalFlowFormulaSegments`。主线文本布局已演进到不同的 [signal-flow-layout](https://github.com/cascode-ai/analog-canvas/blob/117ca625cd896e2bfeff4bedcb10ba7e480e23b4/packages/symbols/src/signal-flow-layout.ts) 和富文本格式。

所以“先仅 Desktop”不能消除这些源码依赖。推荐先做**主线当前数据能力对应的 Visio exporter**：当前主线没有的跳线/线宽功能不从 fork 带入，其相关导出等共享功能落地后再补。主线已经有的数据和文本语义则必须适配，不能拿旧公式解析器替换新实现。

原 fork 已明确的限制也要如实交付：当前 Document 单页导出、公式可能转为源码文本、部分装饰不支持、单实例颜色/线宽会报告损失等。通过 caveat 告知导出保真度，不把“能写 XML”当成“所有内容完全保真”。

### 推荐接入形态

```text
共享 Project / Document / SymbolResolver
                  ↓ 只读
        packages/visio（主线持续编译、测试）
                  ↓ 导出字节 + 保真度提示
        desktop 导出入口 → 原生文件交付
        web 导出入口暂不装配
```

`packages/visio` 不必立刻增加公共 npm 发行，也不必先造一套通用 Export 插件框架。给 desktop 明确的导出能力/命令即可；Web 构建不引用入口，避免无意增加网站初始包体或暴露未验收菜单。

维护上由 exporter 负责人跟随主线契约调整：涉及它输入的 model/symbol/text/routing 变化时跑对应 exporter 契约测试；包本身不能因 Web 无入口而在 CI 中失去编译和测试。真实 Visio 的打开、文字编辑和线端跟随是发布验收，Web 无须同步增加同一菜单的浏览器测试。

## 4. 最容易误分叉的 Properties：页面可以不同，编辑规则不能不同

[component-property-form.tsx](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/apps/editor/src/features/properties/component-property-form.tsx) 和 [route-property-form.tsx](https://github.com/LXY-freshman/schematic-draft/blob/5231840f31b551f231441976efc0d18e6f9e5f80/apps/editor/src/features/properties/route-property-form.tsx) 已复用 JSON 的投影/解析与 `onApply`。这是可利用的共用基础。

允许的过渡方式：Desktop 默认表单 + JSON，Web 暂保留当前界面。两端读取同一个字段描述、同一个 property value，经主线现有 planner 提交同样的事务。需要新增字段时只改一处规则，表单是否出现由产品配置控制。

不能保留的分叉：桌面使用一份旧 `component-property-code.ts` 和旧 planner，Web 继续维护另一份。主线已经增加过 displayName/电气名分离、逻辑门输入数量、参数显示和 Symbol body text；这种复制会让“改一次属性”在两端产生不同模型，维护成本随字段数量增加。

建议先迁入主线已有属性的表单，再逐项讨论 fork 的跳线、线宽、body variant 控件。表单提供字段不是接受该字段持久化语义的理由。

## 5. 必须提前讨论并统一的六组规则

### 5.1 文件格式、版本与跨端再保存

要明确：官方桌面用同一协议，旧 fork 格式通过专用转换；新增字段的默认值、迁移、未来版本拒绝和转换损失如何处理。不能继续让双方各自分配数值版本。

必须验证的场景不是“Web 能打开 Desktop 文件”这一半，而是：**Desktop 创建 → Web 打开并编辑其他内容 → Web 保存 → Desktop 重开，原有信息仍在。** 只读后保留在内存、序列化时丢字段，同样是协议失败。

### 5.2 跳线、线宽、标签等持久化表现

可以不同步开放编辑控件，但当前版本的 model、codec、派生计算和主 renderer 必须共同支持已接纳的字段。Net 高亮、SVG/PDF 等既有出口也要保持一致。只在 Desktop renderer 画跳线，Web 既不认识字段也不保留，会把可见功能差异变成数据损坏路径。

### 5.3 器件、引脚、bulk 与网名

新器件可以暂不出现在 Web Library，但共用 resolver/定义必须能解释文件中的器件，或者明确拒绝不支持的版本；不能将未知器件猜成相近元件。MOS body 显示不能另行定义 B 端连接。AGND/DGND 是否为有名全局网、和 SPICE 0 如何区分，必须在复制、层次和 netlist 中一致。

### 5.4 事务、连接和撤销

表单、JSON、鼠标手势、Agent 可以不同，但都应生成主线同一事务。连线逐段点击可以是 UI 策略；连接/拒绝/切网/取消/Undo 规则不能分成两套。不应以“桌面没有 Agent”为由复制或简化 edit-engine。

### 5.5 正式保存与工作区状态

Cloud revision 和本地文件句柄可以不同；会话身份、快照时机、dirty 判定、未提交文本、跨标签页异步返回和关闭保护需要同一个协调协议。否则每次主线修复保存竞争条件，都要在桌面第二份 lifecycle 重写一遍。

这不要求强行把“浏览器下载请求”和“磁盘写入成功”视为相同结果，也不要求本地路径进入电路模型。

### 5.6 电气检查和网表输出

不需要同步网站与桌面的模拟执行环境，但对同一电路的结构事实、引脚顺序、名称编码、网表生成和拒绝条件应相同。新器件图形可先有，仿真模型的可用性要另行明确；不能为了让桌面导出成功而私自替换模型或放宽电气约束。

## 6. Desktop-first 的实际支持矩阵

下表描述采用共享契约后的可行发行状态；不是当前产品已经支持这些能力。

| 功能                   | Desktop                | 同一代协议的 Web                               | 能否长期保留差异                   |
| ---------------------- | ---------------------- | ---------------------------------------------- | ---------------------------------- |
| Visio 导出             | 提供菜单并生成文件     | 无菜单；项目读写不受影响                       | 可以，只有出口不同                 |
| 属性表单               | 表单与 JSON            | 现有 UI/JSON，处理相同值                       | 可以；共同字段/事务不能分开        |
| 色板、粗网格           | 提供更多选择           | 现有选择；正确显示已保存颜色                   | 可以；偏好和颜色含义不变           |
| 跳线/线宽              | 创建、修改、显示、保存 | 可暂不提供创建按钮，但读取、显示、保存必须保真 | 可以保留入口差异，不能保留模型差异 |
| 新器件                 | Library 可放置         | 可暂不列出，仍认识定义、连接和持久化结果       | 有条件可以；库和电气契约共用       |
| 原生打开/保存/文件关联 | 系统功能               | 浏览器/云对应功能                              | 可以长期不同                       |
| 旧 `.schdraft` 转换    | 专用导入并另存官方格式 | 可暂不提供专用导入入口                         | 可以；转换后的官方格式须兼容       |

如果明确决定两个产品完全不交换文件，可以选择独立模型；代价就是正式维护独立产品。本次目标是共用编辑器和文件，因此不采用这条路线。

## 7. 直接可执行的功能取舍建议

### 可先开放的低耦合能力（实际首批以 05 计划为准）

1. Visio：先完成当前主线能力范围的 `.vsdx`，可以按 OPC/符号库/页面转换分本地目标，最终交付可用的电路导出；Web 菜单暂不开。
2. 网表保存到文件：沿用现有生成结果和诊断。
3. MATLAB 色板、粗网格：作为共享 UI 的 desktop 配置/入口，不新增私有持久化字段。
4. 窗口标题、尺寸等原生体验：在宿主闭环中实现；文件关联属于后续发行范围。

这些功能不应被解释为原封不动 cherry-pick；其中 Visio 完整页面导出仍需要一次中等规模的适配。

### 先确定共用规则的能力（不是批次顺序）

- Properties：字段与事务共用；表单可 Desktop 先上。
- MOS body：先确认现有 variant/bulk 契约，再开放按钮。
- 保存生命周期：已纳入首批 upstream 准备，先抽共用协调，后接原生文件桥接。
- 旧文件导入：先固定来源和转换规则，再提供 Desktop 专用入口。

### 留待共同核心功能讨论

- 跳线、单对象线宽及其 schema/renderer 改动。
- 新器件的电气接口、AGND/DGND 和 netlist 语义。
- 连线逐段点击若涉及连接/事务规则变更。

## 8. 控制持续维护成本的约定

每项暂时仅 Desktop 的功能记录四件事：入口归属、读/写哪些持久化字段、依赖哪组共享接口、由谁维护对应测试。负责人未明确前可做试验，正式发布前应明确责任。

可长期保留的分叉应是产品入口、交付方式或平台 API。出现以下任一情况，就应重新评估边界：复制 model/codec/planner；保存同一电路得到不同含义；核心改动要分别手工修两份；为了编译 exporter 把 fork 的旧共享包一起带回来。

“暂时”无需规定必须多久给 Web 开菜单。需要约束的是共享接口一旦变化，依赖它的 desktop 功能在同一个 PR 或明确阻塞该发布的修复中保持可用，不能靠无人维护的长期分支积累适配工作。

本报告只确定代码与产品差异的允许范围。真实 Visio 验收、Desktop 宿主行为和既有协议迁移验证仍按 [迁入清单](03-integration-plan.md) 执行。
