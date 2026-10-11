# Desktop fork 来源与离线版完善方案

当前产品目标见[离线桌面版完善方案](06-desktop-completion-plan.md)：在现有桌面预览基础上，
补齐默认项目库、独立副本、项目管理、历史恢复、完整绘图验收和 Windows 发布机制。
这里记录待实施目标，不代表功能已经发布。“机制同步线上”指共用模型和项目操作规则，
用户数据保留在本机。

[后续迁入约束](05-local-merge-plan.md)保留原作者反馈、固定参考、适配要求和未决分叉。
色板、粗网格、Visio 及其他 fork 特性继续后置，不自动进入本轮。
[首轮计划的 Git 版本](https://github.com/cascode-ai/analog-canvas/blob/37bccd4012764dce53b34927fa606c6f430296a2/docs/roadmap/desktop-fork/05-local-merge-plan.md)保存阶段决策；
当前运行行为见 [desktop README](../../../apps/desktop/README.md) 和主线规格。

以下源码索引与差异分析的参考快照固定于 2026-09-26。每次正式迁入仍须核对执行时的主线，
不能把旧上游快照或历史统计当作当前实现状态。

## 阅读顺序

| 文档                                                | 用途                                                |
| --------------------------------------------------- | --------------------------------------------------- |
| [离线桌面版完善方案](06-desktop-completion-plan.md) | 当前目标：本地项目库、共享操作规则、完整验收与发布  |
| [后续迁入约束](05-local-merge-plan.md)              | 固定来源、适配要求与仍待讨论的分叉                  |
| [固定源码索引](migration-references.md)             | 13 组、76 个文件，以及原始功能和后续修复提交        |
| [分叉分析](01-divergence.md)                        | 服务、功能、文件协议、测试与交付的真实差异          |
| [目标架构](02-target-architecture.md)               | 建议的共用边界、宿主、保存语义、仓库和发布方式      |
| [完整迁入候选与验收](03-integration-plan.md)        | 首批之外的候选及其验收要求                          |
| [功能分叉的保留与共用](04-feature-sharing.md)       | 哪些可以先仅 Desktop 提供，哪些不同步会增加维护成本 |

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

当前产品行为由[主线规格](../../specs/README.md)持有；来源报告和待实施方案不能覆盖现行契约。
每次采用固定参考代码，都要核对现有调用方，并在目标提交/PR 中记录验证、限制与贡献。
本轮交付验收统一见 [06 完善方案](06-desktop-completion-plan.md#9-本阶段完成标准)。
