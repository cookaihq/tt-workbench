# Triage Labels

本表适用于 `cookaihq/tt-workbench` 的 GitHub Issues。技能使用五个标准分诊角色，均映射为同名标签。

| Label in mattpocock/skills | Label in our tracker | 含义 |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | 等待维护者评估 |
| `needs-info` | `needs-info` | 等待补充信息 |
| `ready-for-agent` | `ready-for-agent` | 需求明确，可交给 Agent 实施 |
| `ready-for-human` | `ready-for-human` | 需要人工实施 |
| `wontfix` | `wontfix` | 不计划实施 |

应用新的分诊角色时移除旧的标准分诊标签，保留其他分类标签。
标签不代表 Agent 已启动或工作已完成；执行仍取决于授权和前置条件。
`wontfix` 同时记录原因并以 `not planned` 关闭 Issue；具体命令见 [Issue tracker](issue-tracker.md)。

明确维护既有本地 Markdown 时，按 [共同 Issue 规则](../rules/issues.md) 处理：
前四个角色写入 `Status:`，`wontfix` 表示关闭为 `State: not-planned` 并记录原因。
本地 wayfinding 决策任务继续使用 `claimed`／`resolved`，步骤见 [Issue tracker](issue-tracker.md#existing-local-markdown-records)。
