# 迁入清单与验收顺序

本文件是完整候选清单。首版本地批次已在 [05-local-merge-plan.md](05-local-merge-plan.md) 收敛范围，Properties、schema 等延期项不因出现在本清单中而自动进入首版。

本文件是分析后的后续实施边界。当前没有迁入代码，也没有声称下列测试已经通过。关键源码与提交见[固定源码索引](migration-references.md)，完整历史可按[参考环境说明](README.md)读取；每个后续目标开始前还需检查最新主线及工作区改动归属。

## 1. 先保存参考，再从主线开目标

fork/main/base 已固定，源码和原始提交可随时从[参考入口](README.md)读取，并可建立独立副本、保存 bundle、复现三向 diff。后续功能适配从已核对的 upstream main 开始，不把 fork 整条 65 提交历史推给主项目。

来源提交只用于追踪意图，不作为必须原样 cherry-pick 的指令。优先读取 source commit 的完整 diff、随后的修复和测试，再针对当前契约实现。需要吸收对方代码时记录来源和作者，不把第三方实现称作本次原创。

## 2. 功能轨道

| 目标             | 起点/后续修复                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 明确边界                                                                            | 核心验收                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| F1a 基础 Visio   | [`d178a081`](https://github.com/LXY-freshman/schematic-draft/commit/d178a081ecc351b293ecf79b62a4f99f3ec18083) 到 [`fe285ee1`](https://github.com/LXY-freshman/schematic-draft/commit/fe285ee18e6617750f774a831cefff9243c1decc)，连线后续 [`496fa612`](https://github.com/LXY-freshman/schematic-draft/commit/496fa6125130dd95705997acd423502a9d9f4e57)、[`35803f38`](https://github.com/LXY-freshman/schematic-draft/commit/35803f388b656a9807e5b299caf9c685d1af72c1)、[`593244b2`](https://github.com/LXY-freshman/schematic-draft/commit/593244b2b479fb939ca929a10d953093746770a7)                                                                                                     | OPC、masters、当前模型的 page/text/wire 转换、导出 UI；初次不顺带引入跳线/新 schema | 包结构/确定性、当前 Symbol/公式/标签、真实 Visio 打开编辑及移动线端；报告未支持对象                      |
| F2 属性表单      | [`853c5679`](https://github.com/LXY-freshman/schematic-draft/commit/853c56798c13dc8e047ce35724c59e5700685358)、[`2526fa1a`](https://github.com/LXY-freshman/schematic-draft/commit/2526fa1ac3b78cad1621dda95f5bc673dc94ad36)、[`4ba2d14d`](https://github.com/LXY-freshman/schematic-draft/commit/4ba2d14df9651bd357260b776851e1c4ddfb0e00)、[`1808d8fa`](https://github.com/LXY-freshman/schematic-draft/commit/1808d8fa151026d73f7e81f8932a7fc92d1c3586)                                                                                                                                                                                                                               | 当前主线的 Component/Route/Annotation 契约上加表单；继续共用 parser/planner         | UI/JSON 同值同结果；拒绝不改模型；Enter/blur 一次事务、Escape 放弃；Undo；切选中对象；主线新属性仍可编辑 |
| F5 色板/粗网格   | [`8d2792d5`](https://github.com/LXY-freshman/schematic-draft/commit/8d2792d5f7110ad043b1ddf5886363cb2b60b44b)、[`63614d6f`](https://github.com/LXY-freshman/schematic-draft/commit/63614d6f6f28b90db122c6c353a36e652b8c8ab6)、[`d08705e0`](https://github.com/LXY-freshman/schematic-draft/commit/d08705e057b45b7bda05fec787af3a6609ac7fda)                                                                                                                                                                                                                                                                                                                                              | 纯显示设置，不改网格坐标与电气事实                                                  | 平移/缩放/窗口大小、设置循环、导出不带背景网格、原有键盘操作                                             |
| F3/F4 跳线与线宽 | [`30ced96b`](https://github.com/LXY-freshman/schematic-draft/commit/30ced96b63710f5be3ae0d9e4bdea10c62d23c19)、[`6671e54e`](https://github.com/LXY-freshman/schematic-draft/commit/6671e54ee3fb679fe0e91e9cafa5ea3cf2c94651)、[`fce5f040`](https://github.com/LXY-freshman/schematic-draft/commit/fce5f0403c2134e27a18f065ca2bb1304050dba3)、[`7d480ef2`](https://github.com/LXY-freshman/schematic-draft/commit/7d480ef2b95ba9dae6a2df07f3d5f7eedc4b6391)、[`8ed248ee`](https://github.com/LXY-freshman/schematic-draft/commit/8ed248ee43d15dcb667771685255480123879827)、[`6e80494b`](https://github.com/LXY-freshman/schematic-draft/commit/6e80494b52e2633b7f86527f1b0d4256cb34bb88) | 每个跨层目标统一 model/codec/edit/derived/render/UI；Visio 适配随功能后补           | crossing 与 junction、端点/折点附近、两条都标记、netlist 不变、高亮与导出一致、格式往返、默认值兼容      |
| F6 MOS body      | [`f6732d98`](https://github.com/LXY-freshman/schematic-draft/commit/f6732d9829eeaa0295bba39fe75562c23306159d)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 借用 variant UI，保留现有 bulk net/默认连接/隐藏 pin 契约                           | 有线与无线 B、3/4 terminal 切换、拒绝/Undo、拷贝、层次和导出                                             |
| F7 功率器件      | [`4afcc1d2`](https://github.com/LXY-freshman/schematic-draft/commit/4afcc1d2c1b2c2a50d0efadf943a0939df1c7d27)、[`b3f5773b`](https://github.com/LXY-freshman/schematic-draft/commit/b3f5773b995b98d15a0d583e28fc9ff5ddf5d6f4)、[`5e926c00`](https://github.com/LXY-freshman/schematic-draft/commit/5e926c004799a61e8e48a312feb2c16de43ffbac)                                                                                                                                                                                                                                                                                                                                              | canonical 定义、pin 顺序、生成资产、目录与 netlist target                           | 符号/生成检查、放置旋转、导入导出；没有模型时明确不可仿真，不能从图形证明电气正确                        |
| F8 AGND/DGND     | [`d8c8c00b`](https://github.com/LXY-freshman/schematic-draft/commit/d8c8c00b0a73e30212a3ed7a8c856aa136e2fcc3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 单独 Net 身份目标，不并入纯图形变更                                                 | Net 合并/拒绝、0 与有名地的区分、层次、复制、网表与 Gallery census                                       |
| F9 连线点击策略  | [`5ae72fcc`](https://github.com/LXY-freshman/schematic-draft/commit/5ae72fcc397d48bd3b28c0c6ccd26e76de1f0d0d)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 等产品选择后单独做；不附带在其他目标中                                              | 连续点击、终点、取消、双击、回退、既有 wire contract                                                     |

F1a 与 F2 都不依赖完整桌面架构，可先做；不要求它们先吸收所有新增 schema 字段。依赖扩展字段的表单控件或导出功能，等对应共享功能落地再开放。

代码进入主线不要求 Web 同时开放入口。Visio、属性表单等可以在 Desktop 先发布；其共享接口、持久化结果和维护责任按 [功能共用报告](04-feature-sharing.md) 执行。纯导出模块可以先迁入和验证；让桌面用户实际使用则仍依赖可运行的 desktop 宿主。

## 3. 服务轨道

### S1 保存协调和宿主能力接缝

从当前主线 `use-project-file-lifecycle`、ProjectTabs/workspace/recovery 入手，先保留 hosted 行为，抽取保存目标及文件交付接口。fork 的 file bridge 是具体参考，不能替换主线整个 lifecycle。

验收：原有 Cloud Save/revision conflict、portable import/export、publication、refresh/recovery、后台 Project 身份和打开标签页不回退。冻结编辑后快照、保存失败/取消、保存中继续编辑、跨标签页晚返回均有测试。只隐藏菜单但仍初始化云服务不算完成。

### S2 Desktop 最小闭环

来源包括 [`c15d9f2d`](https://github.com/LXY-freshman/schematic-draft/commit/c15d9f2db22cfbf19bdbc84d743460f5a384b7f6)、[`e6c6eca7`](https://github.com/LXY-freshman/schematic-draft/commit/e6c6eca7d7f6dee52a223211a69b005067625de1)、[`ee05c6fd`](https://github.com/LXY-freshman/schematic-draft/commit/ee05c6fdb7839c6316df3c4a29f60e9b8b2f436c)、[`78b056ce`](https://github.com/LXY-freshman/schematic-draft/commit/78b056ceb8bc06ee3362e7bccaa73ba3c24c75ab)、[`98f01c70`](https://github.com/LXY-freshman/schematic-draft/commit/98f01c70418695b961d8e2063bf4689a21d74764)、[`54179d29`](https://github.com/LXY-freshman/schematic-draft/commit/54179d29be1c04f17d20fd22deaf98418fc9ff5e)、[`21bc76f0`](https://github.com/LXY-freshman/schematic-draft/commit/21bc76f01b2cd58fd877f4c63e6c3a927964ff3f)。落地 `apps/desktop` 和 desktop entry，完成新建/打开/保存/另存为/关闭/恢复，保留共享编辑器。

验收：真实 Electron 窗口、首次保存取消、已有文件覆盖、保存失败、未保存关闭、双击文件、重复启动、授权句柄、原子保存、外部文件变化。Web 入口不得加载 Electron 或 native API；desktop 不发账号/Gallery/Agent/模拟请求。

### S3 严格离线与安装发布

参考 [`04f01dfb`](https://github.com/LXY-freshman/schematic-draft/commit/04f01dfbb75598c510d4c94e8f41fa42916c75c6)、[`67a755b8`](https://github.com/LXY-freshman/schematic-draft/commit/67a755b8bfe210f324a870f0e393b29227707f44)、[`2d1309d2`](https://github.com/LXY-freshman/schematic-draft/commit/2d1309d2b7b35084b6b0b05d4c525072b240f3da)、[`bf4ec5c0`](https://github.com/LXY-freshman/schematic-draft/commit/bf4ec5c0404024ed8b69881557c9c15ccb2577ed)、[`ff061150`](https://github.com/LXY-freshman/schematic-draft/commit/ff06115071212e8b3b4006cbc12dbeebaaf24cdd)，在新宿主边界上重新验收。

测试针对实际打包产物：加载资源、fetch/XHR、WebSocket、图片/字体、导航/新窗口、外部 URL 打开、更新/遥测、主进程和子进程出口。明确允许的本地资源/IPC 范围，使用可观测接收端或系统网络观测确认禁止请求未发出；只断开网线、请求返回错误不构成拦截证据。

另外测试 installer/portable、保存目录权限回退、文件关联、升级与卸载保留项目。为 desktop source 变化配置必需 Windows 检查；发布 workflow 使用 `desktop-v*`，源提交必须已在 main。

首版先 Windows x64；macOS/Linux 和联网 desktop 不随本目标默认承诺。

## 4. 契约轨道：旧 fork 文件转换

这条轨道应最先确定规则，具体 reader 可以在取得真实样例后实现：

1. 冻结 fork 57–60 的来源事实，保留样例原始字节和预期语义。
2. 提供独立导入入口，按明确来源运行 fork reader，而非把 numeric version 送给官方 reader 猜测。
3. 转成当前主线模型，明确映射新增元件、样式、bulk variant、网名/标签、实例引用和连接事实。
4. 未落地的跳线/线宽字段不能静默丢弃；可暂拒绝该样例，并清楚给出待支持字段。
5. 不覆盖原文件，转换后保存使用正式主线协议；验证重开、连通性和导出。

验收样例包括不含新功能的旧文件、含每个新字段的文件、空项目、层次电路、AGND/DGND、新功率器件、格式号相同但形状不同的文件，以及来源无法辨别的拒绝案例。

## 5. 主线保护

- 每个实现目标重新运行 gate plan，按实际路径选择 focused tests；shared-core/协议/生成资产变化按仓库政策承担 full-delivery。
- GUI 与 JSON/Agent 仍共用事务。主线修复过的标签、复制、端口、body pin 和后台 Project 行为不能被旧 fork 文件覆盖。
- 涉及复制、放置、实例标签、netlist 的目标按 AGENTS 运行最新私有 Gallery census；本次分析没改产品，因此未读取私有 Gallery。
- 组件几何变化遵守现有参考和资产规则，不额外承诺修复所有历史布局。
- 正式提交保留意图、来源、测试影响和限制；PR/merge queue/Production 验证照旧。本目录是审查与迁入方案，不代替实现提交中的交付记录。

## 6. 完成准备阶段的标准

本阶段提供可继续研究的固定源码和架构建议：能定位原实现、能开修改副本、能区分服务/功能/共享契约、能从主线拆出有验收边界的目标。是否接受某个功能、是否达到保密要求和是否能发布安装包，分别由后续目标的实现与证据决定。
