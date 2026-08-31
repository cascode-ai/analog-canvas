# 连通性、走线与电气调试统一实施方案

状态：`active`（2026-08-18 更新：恢复执行与 Net 身份/作用域/电源角色收口已完成；下方保留其原始审计与后续路由、搜索、ERC、诊断范围）
优先级：`P0 foundation`
建议位置：Phase 9 之后、ERC 与全局搜索/Net 追踪之前的横向重构阶段

本文件只保留尚未排期的路线几何、搜索、ERC 策略与诊断体验后续工作。

## 1. 目标

在不丢失现有人工编辑、SPICE 导入、Agent、渲染和导出能力的前提下，统一当前分散的：

- 逻辑 Net；
- 可见 Wire/Route；
- Junction 与自由端点；
- Flightline；
- Route 中心线、角点、命中和拉伸几何；
- 跨 Cell 连通关系；
- 对象搜索、Net 高亮和诊断导航；
- 视觉诊断、SPICE 诊断和真正的 ERC。

本阶段不是推翻现有模型，也不是重新实现一个自动布线器。它采用兼容迁移：先固定现有行为，再建立统一索引与几何契约，逐个迁移消费者，最后删除被证明等价的旧逻辑。

最终用户应获得以下结果：

1. `Net`、`Wire`、`Junction`、`Flightline` 的关系清楚且稳定；
2. GUI、Agent、诊断、命中与 formal render 对同一根 Wire 使用同一份派生几何；
3. 端点直角、二度 Junction 和 Route 拆分边界不再产生视觉缺口或交互分歧；
4. `Ctrl+F` 可以搜索实例、Net、端口和属性，并跳到正确 Cell；
5. 选择 Net 后可以高亮本 Cell 与层次路径上的完整连通集合；
6. ERC 能区分未连接、尚未布线、隐藏/隐式 Pin、明确 No Connect、模型绑定失败和层次接口错误；
7. 诊断点击统一完成切换 Cell、定位、缩放、选择和高亮；
8. 现有 Project、Agent API 和正式导出在迁移期间保持可用。

## 2. 非目标

本方案明确不包含：

- 全局自动布线、A*、自动避障或自动选择 Route tree；
- 仅为了让诊断计数为零而静默改线；
- 总线、总线 tap、跨页 connector；
- SPICE 仿真器级工作点、功耗或时序检查；
- 用视觉相交推断电气连接；
- 将 Flightline、搜索索引、诊断或高亮状态写入 Project；
- 在一次提交中同时替换所有走线代码；
- 以重构为理由删除已有但实现复杂的编辑行为。

## 3. 必须冻结的术语

| 术语                | 唯一含义                                      |                    持久化 |                   改变电气语义 |
| ------------------- | --------------------------------------------- | ------------------------: | -----------------------------: |
| `Net`               | 一个 Document 内的逻辑电气等价集合            |                        是 |                             是 |
| `Wire`              | 用户看到并直接编辑的导线                      | 是，以 `RouteBranch` 存储 |     本身不一定；取决于编辑命令 |
| `RouteBranch`       | Wire 的内部存储分段，不作为主要 UI 术语       |                        是 |                             否 |
| `Junction`          | Wire 的显式连接/分支/自由端点记录             |                        是 | 作为 Route endpoint 时参与拓扑 |
| `Pin`               | Symbol 上的电气端点                           |               Symbol 定义 |                             是 |
| `Port`              | Document 层次接口端点                         |                        是 |                             是 |
| `Flightline`        | 同一逻辑 Net 中尚未被可见 Wire 覆盖的派生提示 |                        否 |                             否 |
| `Crossing`          | 几何相交但没有显式 Junction 的 Wire 交叉      |                        否 |                             否 |
| `No Connect`        | 用户明确声明某个 Pin/Port 故意不接            |                        是 |               是，属于电气意图 |
| `Guide`             | 编辑辅助线，不导出、不导电                    |     可持久化 editor state |                             否 |
| `Construction line` | 可导出的非电气绘图线                          |                        是 |                             否 |

对用户只使用 `Wire`。`Route`、`RouteBranch`、`segmentModes` 是内部工程词汇；Flightline 永远不是可删除的电气对象。

## 4. 当前实现审计

### 4.1 已经合理且必须保留的基础

1. `Net` 持有 terminals/ports，Route 只引用 Net，不以几何决定 Net。
2. terminal/port 在一个 Document 内最多属于一个 Net。
3. Route endpoint 必须属于对应 Net；Junction 与 Route 的 `netId` 必须一致。
4. Crossing 不自动创建 Junction，也不自动合并 Net。
5. Hidden/implicit MOS bulk 保留电气 membership，但不生成可见 Flightline。
6. 相同电气 Net-label 可以把两个独立可见 stub 视为已完成的标号连接。
7. Flightline 是稳定、确定性的派生 MST，不进入保存文件或 formal export。
8. 所有写操作通过 Edit Engine transaction、revision、undo/redo 和原子验证。
9. `cut_connection` 已区分完全布线本地 Net、部分布线/SPICE Net、全局 Net 和空自由线。
10. `locked`/`trunk` segment 拒绝不安全修改。
11. 每个 Document 有独立 undo history；切换 Cell 不丢失编辑历史。
12. Agent route-tree expander 是 transient helper，不成为持久化 Layout Intent 或自动路由器。

这些是新架构的输入约束，不是待清理的历史包袱。

### 4.2 看起来 confusing、但背后有真实需求的逻辑

| 当前逻辑                                                             | 形成原因                                          | 迁移时必须保留的行为                                              |
| -------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------- |
| `buildManualWirePath()` 直接终止于 Pin 原点                          | 人工走线要求无隐藏 escape、任意拐点可控           | Pin 原点仍是电气 endpoint；人工 Wire 不被偷偷延长 10/20 单位      |
| `buildOrthogonalEscapeRoute()`                                       | Agent 需要明确、可验证的 outward escape           | Agent escape 方向、grid、segment mode 和错误代码保持稳定          |
| Renderer 的 terminal miter bridge                                    | 两个独立 SVG stroke 在 Pin 直角处会产生抗锯齿缝隙 | 视觉上无缺口，但不得改 Route topology 或保存额外点                |
| route-anchor miter bridge                                            | 一根可见 Wire 可能因存储/编辑被拆成两条 Route     | 二度 route-anchor 视觉上是连续无点导线                            |
| `route-anchor` 与 legacy degree-one branch 的兼容                    | 早期文件没有 Junction role                        | 老文件的自由端、拖线和删除仍正常                                  |
| `proposeWireSegmentDrag()` 跨多 Route 传播                           | 可见连续线不能因存储分段而拖坏某个锚点            | 一段可见导线的拖动不受 Route 分区影响                             |
| `proposeLocalStretch()`、`proposeGroupMove()` 和 Engine move stretch | 单器件、群组、Agent transaction 的入口不同        | Move 不断线、不生成斜线；内部 Wire/Junction/label 同步移动        |
| route marker remap                                                   | segment 插入、归一化、拆分会改变 segmentIndex     | 电流/电压标记按物理位置跟随，不跳到另一根导线                     |
| Wire input plane 与 hit priority                                     | annotation/instance 曾遮挡 Pin 或 Route           | Wire 模式下文字和器件框不能抢走布线点击                           |
| route tap 的宽容命中与多 conductor 拒绝                              | 屏幕像素误差和 Crossing 歧义同时存在              | 靠近单根线可以 tap；同点命中多根 conductor 必须拒绝猜测           |
| Flightline 点击开始/完成 Wire                                        | Flightline 是布线建议而不是错误对象               | 点击提示可布线，但不能选择并删除 Flightline                       |
| SPICE 文档只显示选中 Net Flightline                                  | 大型导入电路全量飞线不可读                        | 未选择时不制造全屏噪声，选中后完整显示对应 Net                    |
| GUI `Delete wire` 的自适应语义                                       | 人工局部 Net 与 SPICE 原始 membership 不同        | 明确可拆时拆 Net；部分/SPICE/global Net 删除几何后保留 membership |
| 端点可见性与 conditional bulk                                        | 教材三端显示不能破坏四端电气真相                  | hidden bulk 不显示，异常 body-bias 仍可被 ERC 发现                |
| Net label union                                                      | 教材图经常用同名标号代替长 Wire                   | 标号连接继续工作，但必须作为 typed virtual edge 暴露给追踪/ERC    |

不得先删除这些实现，再依靠人工测试“看起来差不多”。每项必须先被新契约表达并通过对照测试。

### 4.3 当前真正的问题

1. **没有一个统一的连通性读模型。** Schema、Derived、Edit Engine、App 和 Agent 分别查找 endpoint-to-Net、Route component 和层次关系。
2. **没有一个统一的 Route 几何结果。** 存储中心线、人工 path、Agent escape、stretch、Renderer bridge、hit target 和诊断看到的几何不完全相同。
3. **App 仍承担过多领域编排。** Route tap、Flightline 交互、Delete、Junction 删除、selection 和导航在组件中直接拼 transaction。
4. **诊断协议割裂。** `VisualDiagnostic` 有当前 Document 的 objectIds；`SpiceDiagnostic` 有 source span；两者都不能完整定位跨 Cell 对象。
5. **层次栈不表达实例路径。** 目前主要记录 Document ID；同一 child Cell 被多个实例调用时无法说明经过哪个实例。
6. **对象 ID 不是 Project 级定位符。** 不同 Document 可以出现同名/同 ID 对象，单独 `objectId` 不足以导航。
7. **缺少正式 No Connect。** 普通 annotation 不能替代电气意图。
8. **模型绑定证据不足。** Project 重开后不能仅靠 `spice.target` 可靠判断 model 缺失、未知或只是不支持显示。
9. **Symbol pin role 可用于 gate/bulk 检查，但没有统一的 ERC policy。** `role` 是开放字符串，需要规范化映射与 unknown fallback。
10. **现有结构验证与 ERC 未分层。** Schema 会拒绝非法引用，但不会生成适合用户修复的电气诊断。

## 5. 目标架构

### 5.1 持久化事实层

继续由 `packages/model` 拥有：

```text
CircuitProject
  Documents
    Instances / Ports / Nets
    Routes / Junctions
    NoConnects              # 新增，需 schema migration
    Annotations / Drafting
    Source binding facts    # 仅稳定、必要的绑定证据
```

持久化层不包含：

- routed components；
- Flightlines；
- search token；
- highlight state；
- ERC 结果；
- hierarchy path；
- resolved route geometry；
- SVG bridge path。

### 5.2 项目级连通性索引

由 `packages/derived` 建立单一只读入口：

```ts
interface ProjectConnectivityIndex {
  projectId: string;
  documents: ReadonlyMap<string, DocumentConnectivityIndex>;
  hierarchy: HierarchyConnectivityIndex;
  objectIndex: ProjectObjectIndex;
}

interface DocumentConnectivityIndex {
  documentId: string;
  endpointToNet: ReadonlyMap<EndpointKey, string>;
  nets: ReadonlyMap<string, NetConnectivityRecord>;
  routeGeometry: ReadonlyMap<string, ResolvedRouteGeometry>;
}

interface NetConnectivityRecord {
  logicalEndpoints: readonly EndpointRef[];
  visibleEndpoints: readonly EndpointRef[];
  routedComponents: readonly RoutedComponent[];
  routes: readonly string[];
  junctions: readonly string[];
  virtualEdges: readonly VirtualConnectivityEdge[];
  flightlines: readonly Flightline[];
}
```

索引必须同时表达三层事实：

1. **Logical membership**：SPICE/人工定义的 Net terminals 与 ports；
2. **Visible routed graph**：Route、Junction 和可见 Pin 形成的可见分量；
3. **Virtual connection**：Net label、power label、层次 port 映射等非连续 Wire 边。

Flightline 只由同一 `NetConnectivityRecord` 中 logical membership 与 routed/virtual components 的差异派生。

### 5.3 统一 Route 几何

新增单一派生结果：

```ts
interface ResolvedRouteGeometry {
  routeId: string;
  netId: string;
  centerline: readonly Point[];
  segments: readonly ResolvedRouteSegment[];
  vertices: readonly ResolvedRouteVertex[];
  endpointJoins: readonly EndpointJoin[];
  hitGeometry: readonly HitSegment[];
  bounds: Rect;
}
```

其中：

- `centerline` 仍严格终止在真实 Pin/Port/Junction 原点；
- `endpointJoins` 正式表达 terminal miter bridge 和 route-anchor miter bridge；
- `segments` 为 marker attachment、drag handle 和诊断提供稳定 segment identity；
- `hitGeometry` 允许屏幕容差，但不改变电气中心线；
- `bounds` 由同一结果生成，不由消费者各自估算。

Renderer、editor hit testing、segment drag、marker attachment、visual diagnostics、Net highlight 和 formal export 必须逐步改为消费它。迁移完成后，Renderer 不再私有计算 terminal/route-anchor bridge。

### 5.4 写操作与 planner 边界

Edit Engine 继续是唯一写边界。新增或整理纯 planner，但不增加第二套 mutation API：

```ts
planWireCommit(...): SchematicEdit[]
planWireTap(...): SchematicEdit[]
planWireDelete(...): SchematicEdit[]
planSegmentDrag(...): SchematicEdit[]
planInstanceMoveWithStretch(...): SchematicEdit[]
planJunctionMove(...): SchematicEdit[]
```

规则：

- planner 可以读取统一索引和几何；
- planner 不直接修改 Document；
- GUI 和 Agent 可以使用不同 routing policy，但输出相同 typed edits；
- Agent-local RouteTreeDecision 继续留在 `packages/agent-routing`；
- Edit Engine 独立验证，不信任 planner；
- App 只维护 gesture/session/selection，不再手工推导 Net partition 或 edit 顺序。

### 5.5 统一定位协议

搜索、Net trace、ERC、视觉诊断和 SPICE source diagnostic 共享：

```ts
interface ObjectLocator {
  documentId: string;
  hierarchyPath: readonly HierarchyFrame[];
  kind:
    | "document"
    | "instance"
    | "net"
    | "route"
    | "junction"
    | "terminal"
    | "port"
    | "annotation";
  objectId: string;
  endpoint?: EndpointRef;
  sourceRef?: SourceSpan;
}

interface HierarchyFrame {
  parentDocumentId: string;
  instanceId: string;
  childDocumentId: string;
}
```

统一导航命令：

```ts
navigateTo(locator, {
  select: true,
  reveal: true,
  zoom: "fit-object" | "fit-net" | "keep",
  highlightNet: boolean,
});
```

它负责切 Cell、恢复调用实例路径、缩放、选择和高亮。当前只存 Document ID 的导航栈迁移为 frame stack；同一 child Cell 的多个实例路径不得合并为一个含糊位置。

### 5.6 统一诊断外壳

保留不同诊断引擎，但输出统一 envelope：

```ts
interface Diagnostic {
  id: string;
  domain: "schema" | "spice" | "erc" | "routing" | "visual";
  code: string;
  severity: "error" | "warning" | "info";
  confidence: "high" | "medium" | "low";
  gateEligible: boolean;
  message: string;
  primary: ObjectLocator;
  related: readonly ObjectLocator[];
  parameters: Readonly<Record<string, string | number | boolean>>;
}
```

Schema validation仍可拒绝无效文件；SPICE parser/compiler仍返回 source diagnostics；visual diagnostics仍不等同 ERC。Adapter 将它们包装为统一 envelope，而不是把所有规则塞进 `visual.ts`。

## 6. 数据协议决定

### 6.1 No Connect

新增独立电气记录，不使用 annotation：

```ts
interface NoConnect {
  id: string;
  endpoint: TerminalEndpoint | PortEndpoint;
  reason?: string;
}
```

冻结规则：

- endpoint 不得同时属于 Net、Route 或另一个 NoConnect；
- hidden/implicit Pin 不能因为不可见而自动成为 NoConnect；
- SPICE 中名为 `NC`、`N/C`、`0` 的 Net 不自动解释为 NoConnect；
- GUI 提供显式 Place/Remove No Connect；
- No Connect 在 formal schematic 中使用固定 Razavi 标记并参与导出；
- ERC 对明确 No Connect 不报未连接，但仍检查非法同时连接；
- Project schema migration 为旧文件补空数组，不推断任何 NoConnect。

### 6.2 模型与层次绑定证据

不要依赖重新读取源文件或解析 `spice.target` 字符串。导入时持久化最小稳定事实：

```ts
interface SourceBindingEvidence {
  kind: "primitive" | "model" | "subcircuit" | "opaque";
  name: string;
  status: "resolved" | "missing" | "unsupported";
  modelType?: string;
  childDocumentId?: string;
  sourceRef?: SourceSpan;
}
```

实现可以先继续通过 `Instance.properties` 兼容旧文件，但规范目标是 typed record。迁移不得丢失现有：

- `spice.name`；
- `spice.target`；
- `spice.pin.*`；
- `spice.param.*`；
- `spice.childDocumentId`。

### 6.3 层次端口映射

Parent subcircuit instance pin 与 child Document port 的映射以导入时的端口顺序和名称证据为准。索引必须同时检查：

- child Document 是否存在；
- parent pin 数量是否等于 child ports；
- pin/port 名称映射是否仍一致；
- child interface 修改后所有 caller 是否同步；
- implicit supply variant 只改变显示，不删除映射。

## 7. 现有功能保留矩阵

| 功能                            | 当前证据/模块                         | 新所有者                           | 迁移验收                                             |
| ------------------------------- | ------------------------------------- | ---------------------------------- | ---------------------------------------------------- |
| Pin/Port/Junction endpoint 解析 | `derived/endpoint.ts`                 | Connectivity Index                 | 旧 fixture endpoint key/point 完全一致               |
| hidden/implicit/conditional Pin | Symbol Resolver + endpoint visibility | Index + ERC policy                 | 三端 MOS 不生成 bulk Flightline，B membership 保留   |
| Flightline MST                  | `derived/connectivity.ts`             | Index/flightlines                  | ID、endpoint、排序与现有 golden 一致                 |
| Net-label virtual connection    | `deriveNetConnectivity()`             | typed virtual edge                 | 相同 label stub 无 Flightline，trace 显示 label edge |
| Crossing 不连接                 | `derived/routes.ts`                   | routing/crossings                  | X/T 无 Junction 不合并 Net                           |
| 单 conductor route tap          | App + route anchor planner            | routing planner                    | 容差内建立一个 Junction 并原子 split                 |
| 多 conductor 歧义拒绝           | App hit logic                         | planner preflight                  | Crossing 点不猜测目标 conductor                      |
| 自由 Wire 任意结束              | Wire session + route-anchor           | planner                            | dangling endpoint 可再次引线、移动、删除             |
| 人工 bend 和 Backspace/Escape   | App Wire state                        | editor session                     | 未提交状态不写 revision，取消完全恢复                |
| Pin 直角无缝                    | renderer terminal bridge              | endpointJoin geometry              | SVG/PNG 与 GUI 无缺口，topology 不变                 |
| 二度 route-anchor 连续          | renderer anchor bridge                | endpointJoin geometry              | 存储一/两 Route 的绘制结果等价                       |
| 单线段拖动                      | `moveRouteSegment`                    | routing planner                    | 正交 dogleg 和 locked 拒绝保持                       |
| 跨 Route 连续线拖动             | `proposeWireSegmentDrag`              | routing planner                    | 不因 Route partition 锚住一端                        |
| 单器件 move stretch             | Edit Engine/Derived                   | shared planner + Engine validation | endpoint identity、Net 和正交性不变                  |
| 群组带内部线移动                | `proposeGroupMove`                    | shared planner                     | 内部 Route/Junction/label 同 delta                   |
| Copy/Paste routed subgraph      | clipboard                             | editor feature + index query       | 只复制选择内部 Net/Route/Junction                    |
| Rotate/Mirror connected device  | Edit Engine                           | shared planner + Engine            | escape/outward 与 label attachment 正确              |
| Route marker 跟随               | marker remap/attachment               | resolved segment identity          | split/normalize/stretch 后物理位置稳定               |
| Delete wire                     | `cut_connection`                      | Engine semantic                    | local split、partial/global retain、empty cleanup    |
| Flightline 点击布线             | editor overlay                        | trace/flightline view              | 仍可启动/完成 Wire，不能删除 Flightline              |
| Wire 模式不被 annotation 遮挡   | input plane/hit resolver              | editor interaction                 | label/instance hit 不抢 Wire click                   |
| Snap 屏幕容差                   | Snap Engine                           | unchanged consumer of geometry     | zoom 下固定 px，Alt suppression 保留                 |
| 独立 Cell undo history          | Document controller                   | navigation service/controller      | 搜索跳转不清空每个 Cell history                      |
| Agent raw typed edits           | Agent Adapter/Edit Engine             | unchanged                          | API schema兼容，resolved geometry 来自统一结果       |
| Agent route-tree expander       | `packages/agent-routing`              | unchanged policy, shared geometry  | 不持久化、不自动 reroute、冲突结果保持               |
| Formal export 不含 overlay      | render/export                         | render consumes geometry           | Flightline/highlight/diagnostic 不导出               |
| Recovery/save/reopen            | persistence/controller                | unchanged                          | 新 schema migration 后 undo/save/reopen 正常         |

每一行在旧实现删除前必须至少有一个 deterministic regression；只靠肉眼验收不允许删除兼容分支。

## 7.1 2026-08-12 实施状态与恢复波次

本路线图的 R0–R10 曾产生一批 **additive prototype** 提交。它们是后续
重构可复用的基础，但不等同于各原始工作包的退出条件已经满足；历史 target
plan 中的 `completed` 仅表示该 target 自己声明的窄范围工作结束，不能作为本
路线图的验收结论。不得重写或删除这些历史记录，而应由本节的状态和恢复波次
表达当前事实。

| 原工作包 | 已交付的可保留基础 | 当前状态与尚缺退出条件 |
| --- | --- | --- |
| R0 characterization | 现状/特征测试 | **active**：需补齐保留矩阵和迁移前后的行为证据。 |
| R1 ADR/spec | ADR 0013–0015 初稿 | **active**：已接受的目标契约仍有效，但须以 amendment 纠正实现状态。 |
| R2 connectivity index | 可查询的 additive index 原型 | **active**：缺 route geometry、revision cache 和单次 flightline 派生。 |
| R3 geometry | centerline、bridge 与 anchor-join ingredients | **active**：缺 revision-scoped segment ref、remap、统一 document geometry 和消费者迁移。 |
| R4 routing planners | route-tap 提取 | **active**：Wire/Delete/Junction/group 尚未统一到 planner。 |
| R5 search/navigation | 项目搜索 backend | **active**：缺 `HierarchyFrame`、公共 locator 与 `navigateTo()`/Ctrl+F。 |
| R6 net trace | 单层向下 trace 原型 | **active**：缺递归双向层次路径、完整高亮和 GUI 消费。 |
| R7 NoConnect | schema v3 及少量验证 | **active**：缺 edit 生命周期、clipboard/render/export/Agent/topology 闭环。 |
| R8 ERC | 四条基础规则 | **active**：缺模型、层次、gate/bulk、pin mapping 等规则和完整 fixtures。 |
| R9 diagnostics | 跨 domain 的数据聚合 | **active**：缺诊断 UI 与导航。 |
| R10 migration/cleanup | deletion parity tests | **blocked by consumers**：不得删 compatibility logic，直至所有消费者迁移并有性能基线。 |

恢复工作按下列波次进行。每一波次须有独立 target plan、可验证退出条件和提交；
不得再将“新建基础模块”误报为“原工作包完成”。

1. **C0 — 状态与契约校正：** 本节及 ADR amendment，冻结“原型 vs. 完成”的
   用语和恢复顺序。
2. **C1 — 公共 Locator/Diagnostic：** 在 `packages/derived` 建立唯一
   `ObjectLocator`、`HierarchyFrame`、`Diagnostic` 类型；迁移 index/search/ERC，
   消除私有 locator。
3. **C2 — NoConnect 最小闭环：** typed add/remove、引用清理、undo/redo、
   clipboard、topology hash、snapshot/export 与最小 renderer/hit lifecycle。
4. **C3 — 几何语义：** revision-scoped segment reference、edit remap、统一
   document routing geometry 和 endpoint/corner 连接语义。
5. **C4 — Connectivity Index：** document route geometry、按 document revision
   缓存、单次 flightline 派生与性能回归。
6. **C5 — Routing planners：** 将 Wire、Delete/Unroute、Junction、segment drag、
   group move 的 topology planning 收口；UI 只保留 session 与 interaction。
7. **C6 — 搜索与导航：** `HierarchyFrame` stack、`navigateTo()`、Ctrl+F 和诊断
   target focus。
8. **C7 — Net trace/highlight：** 递归双向层次 trace、同 Net 高亮和 editor
   selection overlay。
9. **C8 — ERC：** 完整规则集、NoConnect/hidden-pin policy、hierarchy fixtures。
10. **C9 — Diagnostics UI：** 分组面板、导航、source reference 和筛选。
11. **C10 — 消费者迁移与清理：** 仅在 compatibility/parity/performance gate 满足后
    删除旧 adapter。

## 8. 工作包与顺序

### WP-R0 — 行为基线与兼容 harness

**目标**：先证明现在实际能做什么，避免按注释或旧文档重写错误行为。

工作：

1. 建立现有行为清单和 fixture matrix；
2. 为单 Route/多 Route 等价可见导线建立 partition-invariance fixtures；
3. 保存当前 routePolyline、Flightline、crossing、resolvedRoutes、SVG path 和 hit geometry 基线；
4. 记录手工 Wire、Agent escape、move/stretch、delete、marker attachment 的 transaction 输出；
5. 将 Phase 3 中已过时的 Detach 描述标为历史，不让它覆盖当前 `Delete wire` 语义；
6. 增加“新旧实现并行比较”测试工具，不改变生产入口。

主要路径：

- `packages/derived/src/*test.ts`；
- `packages/edit-engine/src/routing.test.ts`；
- `packages/render-svg/src/render.test.ts`；
- `apps/editor/e2e/manual-editor.spec.ts`；
- `packages/agent-routing/test/integration.test.ts`。

退出条件：保留矩阵每项都有现有测试或新增 characterization test。

### WP-R1 — ADR 与规范冻结

**目标**：先接受跨模块契约，再迁移代码。

需要：

1. ADR：Project Connectivity Index 与 typed virtual edges；
2. ADR：Resolved Route Geometry 与 endpoint join；
3. ADR：ObjectLocator、HierarchyFrame 和诊断 envelope；
4. schema/model spec：NoConnect 与 binding evidence；
5. 更新 connectivity/edit/editor/agent/export specs 的消费者边界；
6. 明确旧 API 的兼容周期和删除门槛。

退出条件：所有跨 package 类型有 accepted owner、消费者和失败语义。

### WP-R2 — Document/Project Connectivity Index

**目标**：新增统一只读索引，不立即删除旧函数。

工作：

1. 建立 endpoint、Net、Route、Junction、visible component 索引；
2. 将 label connection 建模为 typed virtual edge；
3. 建立 parent instance pin → child port 的 hierarchy edge；
4. 提供 local Net trace 与 hierarchical trace；
5. 在旧 `deriveVisibleConnectivity()`、`deriveFlightlines()` 外增加兼容 adapter；
6. 对所有现有 fixture 比较旧/新 Flightline 和 component 输出；
7. 按 Project revision/Document revision 缓存，Document 修改只重建受影响索引。

退出条件：生产 Flightline 可以切到 Index，输出无非预期变化；旧函数仍可回退。

### WP-R3 — Resolved Route Geometry

**目标**：让渲染、交互和诊断使用同一几何真相。

工作：

1. 从 `routePolyline()` 演进出 `resolveRouteGeometry()`；
2. 将 terminal/route-anchor miter bridge 移为 `endpointJoins`；
3. 为每个 vertex 标注 terminal/bend/junction/route-anchor 类型；
4. 为 segment 生成稳定 identity 和 attachment remap 信息；
5. 统一 hit segment、bounds、short-segment、overlap、wire-through-symbol 输入；
6. Renderer 先双算并断言，再切换到新 geometry；
7. Editor route hit/handle/marker 依次切换；
8. 删除 Renderer 私有 bridge 前运行 SVG/PNG golden 和像素 seam regression。

退出条件：同一 Document 中 render/hit/diagnostic/drag 使用相同 centerline 与 segment identity；直接 Pin corner 与二度 anchor 无缺口。

### WP-R4 — Routing planner 与 App 瘦身

**目标**：保留手势体验，移除 App 中重复 topology/edit 编排。

工作：

1. 迁移 commit Wire、route tap、free anchor、Delete、Junction delete；
2. 合并单 segment、跨 Route segment、Junction、instance、group stretch planner 的共享部分；
3. planner 使用统一 index/geometry，返回 ordered typed edits 和预览结果；
4. App 只保留 pointer/session/preview/status；
5. Edit Engine 继续独立验证 edit，不将 planner 变成隐式权限入口；
6. 保留 Agent `route_orthogonal` 与 route-tree expander 的策略边界，只共享底层几何。

退出条件：人工/Agent transaction 输出通过兼容 harness；App 不再直接推导 Net partition 或手工拼复杂 Route/Junction 顺序。

### WP-R5 — Locator、层次导航与 Project Search Index

**目标**：先建立 ERC 和搜索共同使用的“找得到”基础。

工作：

1. 将 document stack 迁移为 `HierarchyFrame[]`；
2. 建立 Project Object Index；
3. 搜索字段包含实例 ID、显示名、`spice.name`、symbol、Net 名、Port 名和 properties key/value；
4. v1 使用大小写不敏感的 exact/prefix/substring，不引入不确定 fuzzy ranking；
5. 结果显示 Cell、hierarchy path、对象类型、匹配字段；
6. 实现 `navigateTo(ObjectLocator)`；
7. `Ctrl+F` 与现有 `Ctrl+K` command palette 分离；
8. 搜索跳转不修改 revision、不清空 undo、不移动对象。

退出条件：同名 child Cell 的两个调用实例可显示不同路径；点击结果进入正确 Cell、缩放并选中。

### WP-R6 — Net 高亮与跨 Cell Trace

**目标**：让用户理解 Net，而不是只看到某段 Wire。

本 Cell 高亮内容：

- Net 的所有 visible terminals/ports；
- 所有 Routes 和 Junctions；
- label/power virtual edges 的两端；
- unresolved components 间的 Flightlines；
- NoConnect 冲突点（若存在）。

跨 Cell trace：

- 通过 hierarchy pin-port edge 展开；
- 展示调用实例路径；
- 默认只展开当前选中路径，提供“所有调用路径”；
- global Net 按明确 scope/name 规则追踪，不能只靠同名字符串合并 local Net；
- 高亮为 editor overlay，不进入 formal export 或 Project。

退出条件：选择 Route、Pin、Port、Net label 或搜索结果都能得到同一 Net highlight；跨 Cell 路径可解释。

### WP-R7 — NoConnect 与 binding evidence migration

**目标**：为 ERC 补足无法可靠推导的持久化事实。

工作：

1. Project schema version migration；
2. typed NoConnect edit、undo/redo、clipboard、delete、save/reopen；
3. Razavi No Connect visual asset、hit target 和 formal export；
4. importer 写入 binding evidence；
5. 旧 `spice.*` properties 保持读取兼容；
6. Agent Snapshot/API 以 additive 字段暴露，旧客户端不需要写入；
7. 非法 endpoint 同时 Net+NoConnect 在 schema/Edit Engine 层拒绝。

退出条件：旧 Project 无推断迁移，新 Project 可明确放置/移除 NoConnect；model/hierarchy binding 在重开后仍可检查。

### WP-R8 — ERC Engine

**目标**：新增真正电气诊断，不扩张 `visual.ts`。

建议位置：`packages/derived/src/diagnostics/erc.ts`，输入 Project Connectivity Index、Symbol Resolver 和 binding evidence。

首批规则：

| Code                            | 默认级别             | 规则                                                                |
| ------------------------------- | -------------------- | ------------------------------------------------------------------- |
| `ERC_UNCONNECTED_PIN`           | warning              | visible/required Pin 无 Net 且无 NoConnect                          |
| `ERC_NO_CONNECT_CONFLICT`       | error                | endpoint 同时有 Net/Route 和 NoConnect                              |
| `ERC_MISSING_MODEL`             | error                | binding evidence 为 missing                                         |
| `ERC_UNSUPPORTED_MODEL`         | warning/error policy | 模型存在但产品没有受审 Symbol/语义映射                              |
| `ERC_DUPLICATE_INSTANCE_REFERENCE` | error             | 同 Document 的 Instance Reference 规范化后重复                     |
| `ERC_DUPLICATE_NET_NAME`        | error                | 不同 Net 使用规范化后相同名称，且没有显式 merge 关系                |
| `ERC_PORT_COUNT_MISMATCH`       | error                | parent instance pins 与 child ports 数量不同                        |
| `ERC_PORT_NAME_MISMATCH`        | error                | 已冻结接口映射与 child ports 不一致                                 |
| `ERC_HIERARCHY_TARGET_MISSING`  | error                | childDocumentId/binding target 不存在                               |
| `ERC_HIERARCHY_INTERFACE_STALE` | error                | child interface 修改后 caller evidence 未同步                       |
| `ERC_FLOATING_GATE`             | warning              | gate role Net 只有该 gate 或等价悬空状态，且无 NoConnect            |
| `ERC_FLOATING_BULK`             | warning              | bulk role 未连接，或 conditional hidden bulk 非安全 global/body Net |
| `ERC_ILLEGAL_PIN_NAME`          | error                | imported pin evidence 与 resolved Symbol pin 无法一一映射           |

策略要求：

- “有 Net membership 但没有画 Wire”不是 `UNCONNECTED_PIN`；它是尚未布线，可由 Flightline 表达；
- passive 电阻/电容端点可以未连接，但是否 warning 由 required-pin policy 决定；
- hidden Pin 不自动免除 ERC；implicit/global supply 由明确 policy 免除；
- ordinary bulk 接 VDD/VSS 可低噪声；独立 body-bias 不得静默隐藏；
- 规则必须提供 primary/related Locator 和稳定参数；
- 低置信度检查不能作为默认阻塞 gate；
- ERC 不自动修复、不自动连线、不自动创建 NoConnect。

退出条件：所有规则都有 positive、negative、NoConnect suppression、hidden-pin 和 hierarchy fixture；视觉诊断计数不再被当作电气正确性证明。

### WP-R9 — 诊断 UI 与统一导航

**目标**：把 ERC、SPICE、routing、visual 诊断放入一套可理解的调试体验。

工作：

1. 诊断面板按 domain/severity/Cell 分组；
2. 点击调用 `navigateTo(locator)`；
3. 自动进入 Cell、fit target、选择 primary、高亮相关 Net；
4. related locations 可逐个跳转；
5. SPICE sourceRef 可显示文件/行列，同时保留画布 locator；
6. Visual observation 默认与 ERC 分栏，不混成一个“错误数”；
7. 允许按 code/filter 隐藏显示，不允许静默删除诊断事实。

退出条件：跨 Cell ERC 一次点击到达；返回父层次后 path 和 viewBox 正确；诊断导航不产生 revision。

### WP-R10 — 消费者迁移、清理与性能门

**目标**：只有新接口覆盖全部消费者后才删除 confusing 旧逻辑。

迁移顺序：

1. Derived Flightline/crossing；
2. Renderer/formal export；
3. editor hit/selection/route marker；
4. segment/Junction/instance/group planners；
5. Agent Snapshot/Adapter；
6. visual diagnostics；
7. search/trace/ERC；
8. 删除兼容 adapter 和 App 私有编排。

删除门槛：

- `rg` 证明旧 helper 无生产消费者；
- 新旧 characterization fixtures 一致，或差异有明确 accepted spec；
- 全量 routing/editor/Agent/export 回归通过；
- 代表性大型 Project 的索引构建、搜索和 highlight 有测量基线；
- 不增加每次 pointer move 的全 Project 重建；
- 无需为了索引而持久化 derived cache。

## 9. 文件级迁移地图

| 当前路径                                  | 计划处理                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| `packages/model/src/schema.ts`            | 只在 WP-R7 增加 NoConnect/binding/migration；不提前改 Net/Route 基础形状 |
| `packages/derived/src/endpoint.ts`        | 保留为 endpoint primitive，成为 Index 底层唯一实现                       |
| `packages/derived/src/connectivity.ts`    | 先做 adapter，逻辑迁入 connectivity index/flightlines                    |
| `packages/derived/src/routes.ts`          | 保留 normalization/crossing primitive，增加 resolved geometry            |
| `packages/derived/src/stretch.ts`         | 将重复几何计算迁到 routing planner，保留对外兼容直到消费者迁完           |
| `packages/derived/src/visual.ts`          | 只保留 visual/routing observations，ERC 不加入该文件                     |
| `packages/render-svg/src/render.ts`       | 删除私有 bridge 计算，改消费 endpointJoins；删除前跑像素/golden          |
| `packages/edit-engine/src/transaction.ts` | 保持唯一 mutation/validation；调用共享 planner primitive但不信任 UI      |
| `apps/editor/src/features/wiring/*`       | session 留在 editor；path/topology planner 迁出或变薄 adapter            |
| `apps/editor/src/app/App.tsx`             | 分阶段移除 topology/transaction/navigation 编排，不整体重写组件          |
| `apps/editor/src/snap/*`                  | 保持统一 Snap Engine，只替换 route/endpoint candidate 来源               |
| `apps/editor/src/document/*`              | 引入 HierarchyFrame 和 navigateTo，保持 per-Cell histories               |
| `packages/spice/src/compiler.ts`          | 继续 source/bind diagnostics，输出 binding evidence                      |
| `packages/spice/src/importer.ts`          | 写入 typed evidence，不负责运行时 ERC                                    |
| `packages/agent-routing/*`                | 保留 transient、detect-not-reroute 边界，共享 resolved geometry          |
| `packages/agent-adapter/*`                | Snapshot/diagnostic additive 迁移，更新生成 artifacts                    |

## 10. 验收场景

### 10.1 人工 Wire 与 corner

```text
从 MOS Pin 开始画一段立即转角的 Wire
→ Wire centerline 精确落在 Pin 原点
→ GUI、SVG、PNG 无缺口或越界黑角
→ 命中与拖动选择同一 segment
→ 保存重开后不增加隐藏 waypoint
```

```text
一根可见闭环因 tap 被拆成多条 Route
→ 拖动任意边缩小闭环
→ 二度 route-anchor 随可见线移动
→ 不出现锚定旧节点、断口或额外 Junction dot
```

### 10.2 Crossing 与 Junction

```text
Wire 穿过另一 Net
→ Crossing，不连接、不显示 dot
→ 在单一 conductor 上结束 Wire
→ 原子 split 并创建 Junction
→ 在多 conductor 交点结束
→ 明确拒绝，不猜测连接对象
```

### 10.3 Flightline 与 Delete

```text
导入一个部分布线 SPICE Net
→ 未选择时不显示全图飞线
→ 选择该 Net 后显示剩余 Flightline
→ 删除已有 Wire
→ Wire 消失，SPICE membership 保留，Flightline 更新
```

```text
人工创建两个端点且完全布线的本地 Net
→ 删除唯一 Wire
→ 明确拆分本地 Net
→ 不留下错误 Flightline 或空 Junction
```

### 10.4 Search 与 Trace

```text
Ctrl+F 输入实例显示名、spice.name、Net 名或属性值
→ 结果显示 Cell 和调用路径
→ 点击 child Cell 中对象
→ 进入正确实例路径、缩放、选择
→ 原 Cell undo history 保留
```

```text
选择 parent Cell 的 subcircuit Pin
→ 高亮 parent Net
→ 展开 trace
→ 显示对应 child Port 和 child Net
→ 同一 child Cell 的其他实例路径不被误合并
```

### 10.5 ERC

```text
MOS gate 没有 Net、Route 或 NoConnect
→ ERC_FLOATING_GATE
→ 点击诊断定位并高亮 terminal
→ 放置 No Connect
→ gate warning 消失，No Connect 正式导出
```

```text
MOS bulk 隐藏但接普通 body-bias Net
→ 不生成 bulk Flightline
→ ERC 仍发现 conditional hidden bulk policy 风险
→ 不执行 B=S，不丢失 SPICE membership
```

```text
修改 child Cell port 列表但未同步 caller
→ ERC_HIERARCHY_INTERFACE_STALE
→ primary 定位 child Port
→ related 定位所有不一致 caller
```

## 11. 确定性验证

最低验证集合：

- Model schema/migration/round-trip；
- endpoint visibility、Net membership、virtual edge 和 hierarchy edge；
- old/new connectivity与Flightline差分；
- route partition invariance；
- normalization、crossing、tap、split、delete；
- terminal/route-anchor endpointJoin SVG golden 与 seam raster；
- marker attachment/stable segment identity；
- manual Wire、free end、reuse、drag、group move、copy/paste；
- Agent escape、RouteTreeExpansion、resolvedGeometry；
- Ctrl+F ranking、ObjectLocator、multiple hierarchy paths；
- Net local/hierarchical highlight；
- 每条 ERC rule 的命中、非命中、NoConnect 和 hidden-pin case；
- diagnostic navigation Playwright；
- formal export 明确不含 Flightline/highlight/diagnostic；
- representative imported OTA、mixed-device、hierarchical fixtures；
- repository typecheck、affected builds、API artifact stale check；
- `git diff --check` 和 clean/owned worktree audit。

全量测试应在以下边界执行：

1. 切换 production Flightline 到 Index；
2. 切换 production Renderer 到 ResolvedRouteGeometry；
3. schema version migration；
4. Agent Snapshot/diagnostic schema 更新；
5. 删除旧 adapter/bridge/planner。

## 12. 性能与缓存

不能在没有测量的情况下先承诺常数时间，但必须遵循：

- Connectivity Index 以 Project/Document revision 为失效单位；
- 仅修改当前 Document 时不重建无关 child Documents；
- pointer move 不触发 Project 全量搜索索引或 ERC；
- route preview 可以使用当前 Document 的增量临时几何；
- Ctrl+F 索引在 Project 替换或相关 Document commit 后更新；
- ERC 在 commit/import/open 后 debounce，用户可手动立即重跑；
- highlight/trace 读取索引，不扫描 SVG DOM；
- derived cache 不写入 Project、recovery 或 formal export。

WP-R0 先记录现有代表性大电路的：

- Project index 构建时间；
- 单 Document 增量更新时间；
- 搜索响应；
- Net trace；
- ERC 全量运行；
- editor 首屏与交互帧。

后续预算以该基线和 `performance.md` 为准，不凭主观设置。

## 13. 提交、回滚与协作纪律

每个 WP 必须拆为独立 target plan 和可审查 commit。不得同时让多个 worker 修改同一共享契约文件。

推荐提交边界：

1. characterization tests；
2. ADR/spec；
3. additive connectivity index；
4. additive resolved geometry；
5. one-consumer-at-a-time migration；
6. locator/navigation；
7. search/trace UI；
8. NoConnect/binding schema migration；
9. ERC engine；
10. diagnostic UI；
11. compatibility cleanup。

回滚原则：

- additive 阶段保留旧 production path；
- 每次 consumer switch 用一个 feature boundary，不同时切 Renderer、Editor 和 Agent；
- 新旧结果不一致时先记录差异和决定，不在 adapter 中静默修正；
- schema migration 一旦发布不可通过回滚删除字段，只能向前兼容修复；
- 旧逻辑只有在无生产消费者、回归覆盖完整、规范接受差异后才能删除。

## 14. 风险与处理

| 风险                                | 处理                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------- |
| “统一”演变为大爆炸重写              | strangler migration；additive index/geometry；逐消费者切换              |
| 删除 confusing 代码后旧 corner 回归 | 保留矩阵、characterization、SVG/raster seam gate                        |
| ERC 把 Flightline 当断路            | 严格分开 logical membership 和 routed components                        |
| hidden bulk 被误判或静默短接        | visibility 与 ERC policy 分离；永不自动 B=S                             |
| 同名 Net 被跨 Cell 错误合并         | NetRef 必带 documentId；hierarchy edge 必须显式                         |
| 同一 child Cell 多实例路径含糊      | HierarchyFrame 包含 instanceId，不只存 Document ID                      |
| NoConnect 被当普通图形              | 独立持久化电气记录和 typed edits                                        |
| model 缺失在重开后无法判断          | 导入时持久化 binding evidence                                           |
| search 与 Ctrl+K 冲突               | Ctrl+F 只搜电路对象；Ctrl+K 继续搜命令                                  |
| highlight 污染导出                  | editor overlay；export contract negative test                           |
| Agent 与 GUI 再次产生几何漂移       | 共享 ResolvedRouteGeometry 和 Engine validation，不强制相同 tree policy |
| Index 重建拖慢大电路                | revision cache、Document 增量、性能基线和门禁                           |
| 诊断噪声过大                        | required-pin policy、confidence、domain 分组、NoConnect，不自动压制事实 |

## 15. 总退出门

只有满足以下条件，ERC 和搜索/Net 追踪 P0 才算完整，而不是若干孤立按钮：

- 单一 Project Connectivity Index 被 Flightline、trace、highlight 和 ERC 使用；
- 单一 ResolvedRouteGeometry 被 render、hit、marker、drag 和 routing diagnostics 使用；
- `ObjectLocator + HierarchyFrame` 被搜索和全部诊断导航使用；
- NoConnect 与 model/hierarchy binding evidence 可持久化、迁移、撤销和重开；
- 保留矩阵全部通过，没有以重构名义删除旧人工/Agent能力；
- current App 不再直接实现复杂 Net/Route/Junction transaction 编排；
- visual diagnostics 与 ERC 在协议和 UI 中明确分域；
- 代表性 SPICE、层次、MOS、闭环、自由 Wire、群组移动和 Agent fixtures 通过；
- formal export 无 editor overlay；
- 性能未越过已记录预算；
- specs、ADRs、Agent artifacts、user guide 与实际行为一致。

完成后系统仍然是轻量人工/Agent 协同电路画布，而不是自动 EDA 套件；区别在于 Net、Wire、Flightline、搜索与 ERC 将共享一套清晰、可验证的基础。
