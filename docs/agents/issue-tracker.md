# Issue Tracker: GitHub

功能 Spec 和任务保存在本仓库 GitHub Issues，使用 gh CLI；仓库由当前 checkout
的 remote 确定。读需求时读取正文、评论、标签以及相关阻塞关系。

### Publication label

`ready-for-agent` 表示需求和验收已明确，可由 Agent 按原版方法接手。
to-spec 和 to-tickets 发布时使用该标签。该标签已在仓库建立。没有安装 triage，不额外建立其状态机或未使用标签。

### 操作绑定

- “Publish to the issue tracker”表示发布 GitHub Issue。
- “Fetch the relevant ticket”表示读取对应 Issue 全文与评论。
- 子任务和阻塞优先使用 GitHub 原生关系；不可用时正文明确 Parent / Blocked by。
- 修改共享验收时说明变化和理由，使接手者看到当前完整需求。
- 多行文本通过实际 UTF-8 文件和 `--body-file` 提交，按当前 shell 正确处理参数。
  这是 Windows/CLI 执行绑定，替代原版 seed 中不适用于 PowerShell 的 heredoc 示例。
- PRs as a request surface: no。当前没有安装 triage/wayfinder，不初始化相应标签。
- 发布、评论和关闭操作遵循本次任务的授权范围；示例命令不构成操作授权。
