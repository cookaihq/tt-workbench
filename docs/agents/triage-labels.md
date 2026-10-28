# Triage Labels

技能要求分诊或关闭开发 Issue 时，先读取 [共同 Issue 规则](../rules/issues.md) 的分诊表与操作语义。

`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human` 保持同名映射，写入普通实施 Issue 或规格文件的 `Status:`。普通实施 Issue 的关闭结果由独立 `State:` 保存。

技能要求 `wontfix` 时，关闭为 `State: not-planned` 并记录原因；不再写入旧的 `Status: wontfix`。既有文件只在明确迁移时转换，读取不能自动改写。

wayfinding 决策任务继续按 [Issue tracker](issue-tracker.md) 使用 `claimed`／`resolved`，不能套用普通分诊操作。
