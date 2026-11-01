# Issue tracker: GitHub

本配置适用于 `tt-workbench` 软件仓库。新增开发任务使用
[`cookaihq/tt-workbench` 的 GitHub Issues](https://github.com/cookaihq/tt-workbench/issues)，通过 `gh` CLI 操作。
Issue 保存目标、验收条件与规格摘要；详细规格及实施证据继续保存在 `.scratch/<功能>/`，在 Issue 中记录对应路径。

## Target and authentication

所有远端操作遵循 [Git 仓库接入、提交与版本发布](git-access-commit-and-release.md) 的凭证来源与按次鉴权要求。
从其中指定的本仓独立凭据文件读取当前 Token，核验忽略、文件类型及权限；
清除继承的 Token 与调试注入，仅将文件中读取的值以 `GH_TOKEN` 传入本次 `gh` 子进程，
固定 `GH_HOST=github.com`，禁用交互；完成后释放。身份验证使用 `gh api user --jq .login`。
凭据缺失、失效或同次操作中轮换时，按原来源修复和重新核验。

每次会话首次写入前执行 `gh repo view cookaihq/tt-workbench --json nameWithOwner,url,hasIssuesEnabled`，
核对目标与 Issues 可用性。以下 Issue 命令均显式使用 `--repo cookaihq/tt-workbench`；
仓库 URL 及鉴权配置以 `git-access-commit-and-release.md` 为准。

## Conventions

多行正文先写入已忽略的 `tmp/<用途>/` 下的 UTF-8 文件，再使用 `--body-file`。
操作前读取当前 Issue，修改时保留未涉及的正文、标签和关系，完成后回读。

| 操作 | 命令 |
| --- | --- |
| 新建 | `gh issue create --repo cookaihq/tt-workbench --title "..." --body-file <文件> --label needs-triage` |
| 读取 | `gh issue view <编号> --repo cookaihq/tt-workbench --json number,title,body,state,stateReason,labels,comments,assignees` |
| 列表 | `gh issue list --repo cookaihq/tt-workbench --state open --json number,title,body,labels,assignees`，按需增加 `--label`、`--state` 和 `--limit` |
| 更新正文 | `gh issue edit <编号> --repo cookaihq/tt-workbench --body-file <文件>` |
| 评论 | `gh issue comment <编号> --repo cookaihq/tt-workbench --body-file <文件>` |
| 分诊 | `gh issue edit <编号> --repo cookaihq/tt-workbench --add-label "<标签>" --remove-label "<原分诊标签>"`，映射见 [分诊标签](triage-labels.md) |
| 完成关闭 | 先提交结论评论，再执行 `gh issue close <编号> --repo cookaihq/tt-workbench --reason completed` |
| 不计划实施 | 先提交原因评论并应用 `wontfix`，再执行 `gh issue close <编号> --repo cookaihq/tt-workbench --reason "not planned"` |

评论和关闭分开执行，以便已经关闭的 Issue 也能保留新增说明。
标签表示分诊，Issue 的关闭状态表示结果；`ready-for-agent` 表示需求可供 Agent 实施，执行仍取决于本次授权和前置条件。

### Parent and blocking relationships

优先使用 GitHub 原生子 Issue 和依赖关系。以下命令需要 `gh` 2.94 或更新版本：

- 父子关系：创建时加 `--parent <父编号>`，或 `gh issue edit <父编号> --repo cookaihq/tt-workbench --add-sub-issue <子编号>`。
- 前置依赖：创建时加 `--blocked-by <编号>,<编号>`，或 `gh issue edit <子编号> --repo cookaihq/tt-workbench --add-blocked-by <前置编号>`。
- 查询未关闭前置：`gh api repos/cookaihq/tt-workbench/issues/<编号> --jq .issue_dependencies_summary.blocked_by`。若使用 `gh issue view --json blockedBy`，须过滤已关闭项。

旧版 CLI 可通过 `gh api` 调用原生关系接口，先用 `gh api repos/cookaihq/tt-workbench/issues/<编号> --jq .id`
取得数据库 ID：父 Issue 的 `sub_issues` 接口 POST `sub_issue_id`，子 Issue 的 `dependencies/blocked_by` 接口 POST `issue_id`；值均为数据库 ID，不是 Issue 编号。
原生关系不可用时，子 Issue 正文写 `Part of #<父编号>`，父 Issue 用任务列表维护顺序；依赖写 `Blocked by: #<编号>, #<编号>`。
开始工作前核对每个前置的关闭原因；未关闭、缺失或以不计划实施关闭的前置，均需先解决或明确修订依赖。

## Pull requests as a triage surface

**PRs as a request surface: no.**

## When a skill says "publish to the issue tracker"

创建 GitHub Issue。规格文件继续保存在 `.scratch/<功能>/spec.md`，需要跟踪的工作以 Issue 为入口。

## When a skill says "fetch the relevant ticket"

用户提供本仓 Issue 编号或 URL 时，用 `gh issue view` 读取。GitHub Issue 与 PR 共用编号空间；
必要时先用 `gh pr view <编号> --repo cookaihq/tt-workbench` 区分类型，再按用户指定对象读取。
用户明确提供本地 Markdown 路径或 `<功能>#<NN>` 时，按下方本地记录约定处理。

## Wayfinding operations

供 `/wayfinder` 使用：

- 总览为一个带 `wayfinder:map` 标签的 Issue，正文含 Notes、Decisions-so-far、Fog。
- 决策任务为总览的子 Issue，正文写清问题，使用 `wayfinder:research`、`wayfinder:prototype`、`wayfinder:grilling` 或 `wayfinder:task` 标签；这些标签在首次实际使用时按需创建。
- 依赖采用上述原生关系。按总览顺序选择第一个未关闭、未分配且前置条件已满足的任务。
- 执行前用 `gh issue edit <编号> --repo cookaihq/tt-workbench --add-assignee "@me"` 认领。
- 完成后评论记录答案，再关闭任务；重新读取总览，保留其他内容，将结论摘要和任务链接追加到 Decisions-so-far。

## Existing local Markdown records

既有 `.scratch/` 记录继续保留。明确维护本地记录时，读写同一文件，遵循 [共同 Issue 规则](../rules/issues.md)
和 [工作台 Issue 说明](../workbench/issues.md)。GitHub Issue 与本地 Issue 没有自动同步，迁移需明确范围并建立对应关系。

本地实施 Issue 使用 `.scratch/<功能>/issues/<NN>-<名称>.md`；编号仅在功能内唯一，跨功能用 `<功能>#<NN>`。
`State` 保存关闭结果，`Status` 保存分诊；本地 `wontfix` 操作按共同规则写为 `State: not-planned` 并记录原因。
写入优先使用 `node "<软件根>/scripts/workbench/issue-request.cjs" --vault "<明确的开发根绝对路径>"`，遵守原文核对和写入锁。

已有本地 wayfinding 决策任务继续采用以下流程：

- 总览：`.scratch/<effort>/map.md`，含 Notes、Decisions-so-far、Fog。
- 任务：`.scratch/<effort>/issues/<NN>-<slug>.md`；`Type:` 为 research、prototype、grilling 或 task。
- `Status:` 使用 claimed／resolved，`Blocked by: NN, NN` 记录依赖；全部依赖为 resolved 后才可执行。
- 按编号选择第一个未完成、未认领且依赖已完成的任务，执行前保存 `Status: claimed`。
- 完成后在 `## Answer` 下追加答案，保存 `Status: resolved`，再把摘要和链接追加到总览的 Decisions-so-far。
