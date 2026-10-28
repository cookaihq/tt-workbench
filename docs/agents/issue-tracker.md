# Issue tracker: Local Markdown

此配置仅适用于当前 tannt 笔记库。技能从 `.scratch/`
读取任务与规格，并将更新写回对应文件。
这里的文件是持续保留的任务记录，不是临时缓存。

## Conventions

读取、创建或更新 Issue 前，先读取 [共同 Issue 规则](../rules/issues.md)。目录、编号、关闭结果、分诊、评论和依赖的规范集中维护在那里。

普通实施 Issue 的 `State` 与 `Status` 分别记录关闭结果和分诊；`ready-for-agent` 不能作为已完成或已启动的证据。需要写入时优先通过 `node "<软件根>/scripts/workbench/issue-request.cjs" --vault "<库绝对路径>"` 提交结构化操作，与工作台共用版本核对和写入锁。具体请求与使用方法见 [工作台 Issue 说明](../workbench/issues.md)。

## When a skill says "publish to the issue tracker"

根据内容创建规格文件或独立任务文件，必要时创建其所属目录。

## When a skill says "fetch the relevant ticket"

读取用户指定路径对应的文件。
只有编号时，在已明确的功能目录内查找；
编号无法唯一定位文件时，先确认所属功能。

## Wayfinding operations

以下约定供 `/wayfinder` 使用。

- 总览文件：`.scratch/<effort>/map.md`，
  包含 Notes、Decisions-so-far、Fog 三个部分。
- 决策任务：`.scratch/<effort>/issues/<NN>-<slug>.md`，
  编号从 01 开始，正文记录待回答的问题。
- `Type:` 记录 research、prototype、grilling 或 task。
- 决策任务的 `Status:` 表示执行状态；
  认领后为 claimed，完成后为 resolved。
  这里不使用普通实施 Issue 的分诊值或关闭菜单。
- `Blocked by: NN, NN` 记录依赖；
  所列任务全部为 resolved 后，当前任务才可执行。
- 选择任务时，按编号取第一个未完成、未认领且依赖已完成的任务。
- 开始执行前，将状态改为 claimed 并保存。
- 完成后，在 `## Answer` 下追加答案，将状态改为 resolved，
  再把结论摘要和文件链接追加到总览文件的 Decisions-so-far。
