# Issue #1003：Desktop fork 审查与迁入方案

本目录集中保存 [Issue #1003](https://github.com/cascode-ai/analog-canvas/issues/1003) 的五份审查与计划，以及可随时查阅的固定源码索引。分析基线固定于 2026-09-26；文档不代表讨论参与者已共同确认全部架构和发行选择。U-C 导出交付与 U-B 的共享保存协调已通过 [PR #1126](https://github.com/cascode-ai/analog-canvas/pull/1126) 合并；尚未迁入 fork 实现，也未完成桌面宿主。

当前拟按三部分推进：

1. **Upstream 准备**：抽出宿主装配、保存协调、导出交付接口，保留现有 Web 行为。
2. **首批本地迁入**：最小桌面文件闭环、网表存文件、MATLAB 色板、粗网格，以及适配主线模型的 Visio 导出。
3. **留待讨论**：属性表单、fork Schema/文件转换、跳线与线宽、MOS body、新器件、AGND/DGND、连线手势和正式发行。

首批以[首版本地合并计划](05-local-merge-plan.md)为准。早期报告中的完整候选清单、最终部署形态及“可以 Desktop 先开放”的能力，不自动进入首批。建议共用主线模型、事务和文件协议，Desktop 可以先开放功能入口；迁入按功能适配，不整体合并 fork 的删除或旧共享核心。

## 2026-09-26 反馈后的执行边界

- U-A 对齐 [#1121](https://github.com/cascode-ai/analog-canvas/issues/1121) 的服务装配第一步，共用一套入口、能力工厂和依赖接口。下一步可先抽离 upstream 现有 Web 装配；实际 fork 代码、测试迁入仍等待贡献处理方式敲定。
- 本批保留 Web 的 Cloud Save 语义。#1121 提出的 Web 本地文件正式保存另作产品/规格决策，不随桌面准备默认接受。
- [#1119](https://github.com/cascode-ai/analog-canvas/issues/1119) 的可分发桌面产物验收晚于本计划的本地功能验收；安装、文件关联及完整发行工作不因此自动进入首批。
- [作者最新回复](https://github.com/cascode-ai/analog-canvas/issues/1003#issuecomment-5842705867)确认固定格式基线、提供样例与踩坑记录，但不承担桌面长期维护；负责人仍须由主项目安排。跳线、功率器件和 Q 表单优先讨论，尚未进入实施范围。

逐项反馈、待确认选择与当前进度统一记录在 [05 计划的第 0 节](05-local-merge-plan.md#feedback-alignment)，下述源码快照及历史统计保持不变。

## 阅读顺序

| 文档                                          | 用途                                                |
| --------------------------------------------- | --------------------------------------------------- |
| [首版本地合并计划](05-local-merge-plan.md)    | Upstream 准备、首批目标、顺序、验收与延期条件       |
| [固定源码索引](migration-references.md)       | 13 组、76 个文件，以及原始功能和后续修复提交        |
| [分叉分析](01-divergence.md)                  | 服务、功能、文件协议、测试与交付的真实差异          |
| [目标架构](02-target-architecture.md)         | 建议的共用边界、宿主、保存语义、仓库和发布方式      |
| [完整迁入候选与验收](03-integration-plan.md)  | 首批之外的候选及其验收要求                          |
| [功能分叉的保留与共用](04-feature-sharing.md) | 哪些可以先仅 Desktop 提供，哪些不同步会增加维护成本 |

## 固定源码身份

| 角色                   | 固定提交                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Schematic Draft fork   | [`5231840f31b551f231441976efc0d18e6f9e5f80`](https://github.com/LXY-freshman/schematic-draft/tree/5231840f31b551f231441976efc0d18e6f9e5f80) |
| Analog Canvas upstream | [`117ca625cd896e2bfeff4bedcb10ba7e480e23b4`](https://github.com/cascode-ai/analog-canvas/tree/117ca625cd896e2bfeff4bedcb10ba7e480e23b4)     |
| 共同起点               | [`dbdd9499659b7606ffbc8cbbe641d2d91f2ffada`](https://github.com/cascode-ai/analog-canvas/commit/dbdd9499659b7606ffbc8cbbe641d2d91f2ffada)   |

对方在 GitHub 元数据上是独立仓库，但保留了共同 Git 历史，因此可以计算真实 merge-base。源码链接固定到完整 SHA；后续 main 推进不会悄悄改变引用内容。实现前另行记录最新 upstream 目标基线，复审相关路径的新增变化。

<a id="reference-workflow"></a>

## 建立本地参考和可编辑副本

下列 PowerShell 命令在自选研究目录中建立独立参考仓库；目录和分支已存在时应使用新的名字，避免覆盖已有试验。完整 clone/fetch 保留历史，不使用 shallow clone。

```powershell
git clone https://github.com/cascode-ai/analog-canvas.git schematic-reference
git -C schematic-reference remote rename origin upstream
git -C schematic-reference remote add fork https://github.com/LXY-freshman/schematic-draft.git
git -C schematic-reference fetch fork
git -C schematic-reference remote set-url --push upstream DISABLED
git -C schematic-reference remote set-url --push fork DISABLED

git -C schematic-reference update-ref refs/issue1003/upstream 117ca625cd896e2bfeff4bedcb10ba7e480e23b4
git -C schematic-reference update-ref refs/issue1003/fork 5231840f31b551f231441976efc0d18e6f9e5f80
git -C schematic-reference update-ref refs/issue1003/base dbdd9499659b7606ffbc8cbbe641d2d91f2ffada

git -C schematic-reference worktree add --detach ../fork-reference refs/issue1003/fork
git -C schematic-reference worktree add --detach ../upstream-reference refs/issue1003/upstream
git -C schematic-reference worktree add -b codex/issue1003-fork-lab ../fork-lab refs/issue1003/fork
git -C schematic-reference worktree add -b codex/issue1003-upstream-adapt ../upstream-adapt refs/issue1003/upstream
```

`fork-reference` 和 `upstream-reference` 约定只读，便于对照；detached worktree 本身不强制禁止修改。两个带分支的副本可以自由试验，正式实现仍从核对后的最新 upstream 开始。这里没有执行依赖安装、安装器或文件关联注册。

在 `schematic-reference` 中，可以直接读取固定 Git 对象，内容不受工作副本修改影响：

```powershell
git show refs/issue1003/fork:packages/visio/src/page.ts
git show c14ae0c58568c75b6685519ba180d0837f559282
git log --oneline refs/issue1003/base..refs/issue1003/fork
```

固定网页链接便于在线查阅；要在来源仓库不可访问时也能读取，请在首次获取后封存 bundle：

```powershell
git bundle create ../issue1003-reference.bundle refs/issue1003/base refs/issue1003/fork refs/issue1003/upstream
git bundle verify ../issue1003-reference.bundle
```

在 bundle 所在目录，恢复到一个新的空仓库：

```powershell
git init restored-reference
git -C restored-reference fetch ../issue1003-reference.bundle 'refs/issue1003/*:refs/issue1003/*'
git -C restored-reference switch -c codex/fork-review refs/issue1003/fork
```

bundle 包含三个固定引用的可达历史，不包含之后新增的试验提交。复制单个 worktree 文件夹不能复制它依赖的 Git 数据；跨机器携带时使用 bundle。文档目录不提交源码副本、二进制 bundle 或本机研究脚本。

<a id="reproduce-diff"></a>

## 复现三向 diff

在上述参考仓库内运行：

```powershell
git merge-base refs/issue1003/upstream refs/issue1003/fork
git rev-list --count refs/issue1003/base..refs/issue1003/upstream
git rev-list --count refs/issue1003/base..refs/issue1003/fork

git diff --no-renames --name-status refs/issue1003/base refs/issue1003/fork
git diff --no-renames --name-status refs/issue1003/base refs/issue1003/upstream
git diff --no-renames --name-status refs/issue1003/upstream refs/issue1003/fork
git diff --shortstat refs/issue1003/base refs/issue1003/fork

# 只在独立参考库预演，不修改产品工作树；固定基线预期返回冲突。
git merge-tree --write-tree refs/issue1003/upstream refs/issue1003/fork
```

前三个命令应分别给出上述共同起点、214 和 65。三个不识别 rename 的路径列表分别有 1,218、1,190 和 1,863 条；前两个列表的路径交集为 518。默认 rename 检测的 shortstat 使用不同口径，不混用文件数。两边当前快照的差异并不全是 fork 的贡献：主线分开后新增的文件也会出现在比较中。

完整 patch 可用同一 `git diff` 去掉 `--name-status` 后读取；还可用 `-- <path>` 限定关注模块。统计和隔离合并预演的解释见[分叉分析](01-divergence.md)。

## 验证边界

本轮完成的是源码、历史、依赖与边界审查；固定来源已核对，独立 bundle 的恢复经过验证。尚未运行迁入后的产品测试，也未完成真实 Visio、桌面产物网络、安装升级或跨端文件往返验收。报告中的成本是源码依赖判断，不是已经测得的工时或兼容性承诺。

当前产品行为仍以[主线规格](../../specs/README.md)为准；这些待实现设计不能覆盖现行契约。执行过程、验证结果和交付记录应留在相应实现提交与 PR 中。
