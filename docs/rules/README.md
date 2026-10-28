# tannt 共同规则

本目录是当前 `tannt` 库业务规则的正文位置，供本人、Agent、工作台、模板及其他录入工具共同使用。术语仍由 [GLOSSARY](../../GLOSSARY.md) 定义；设计依据见 [ADR 0001](../adr/0001-shared-rules-and-scenario-skills.md)。实现不能把自身限制转化为全库规则。

| 操作 | 必须读取 |
| --- | --- |
| 首次处理本库内容或选择存放位置 | [范围与目录](scope-and-directories.md) |
| 保存、归纳、复用材料或整理经验 | [内容与来源](content-and-sources.md) |
| 新建或整理收件箱记录 | [收件箱](docs/rules/inbox.md) |
| 创建项目、任务，迁入专属资料，或更新状态、进度、引用 | [项目与任务](projects-and-tasks.md) |
| 归档或恢复项目、领域记录与资源 | [存档与恢复](scope-and-directories.md#存档与恢复)及[写入与变更](writing-and-changes.md) |
| 新建或修改功能开发 Issue、评论、分诊、关闭状态和依赖 | [开发 Issue](issues.md) |
| 设计、维护或执行 FNS 跨设备规则发布、接收与应用 | [FNS 配置同步](fns-config-sync.md)及[设备配置规则](../agents/fns-device-config.md) |
| 保存原文件、附件或登记库外资料 | [附件](attachments.md) |
| 管理网盘托管文件、替代文件，或移动与改名其所在目录 | [网盘托管](cloud-files.md) |
| 写入任何业务文件或修改共同规则 | [写入与变更](writing-and-changes.md) |
| 编辑或移动 `3.资源/飞书知识库/` 同步单元，或确认后回传飞书；迁移期间旧位置同样适用 | [飞书知识库编辑与同步](lark-wiki-sync.md) |

规则正文在对应主题中维护。`AGENTS.md` 和 Skill 提供触发入口；`docs/agents/` 说明 Agent 的工具与步骤；`docs/workbench/` 说明工作台实现。历史规格、原型和验收保留当时语境，不作为现行规则副本。迁移记录见[条款迁移表](../../.scratch/vault-rules-and-skills/rule-migration.md)。
