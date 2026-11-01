# 工作台规则与默认业务模型

本目录维护工作台开发、Skill、模板和工具所需的规则、默认业务模型与文件契约，术语由本项目 [GLOSSARY](../../GLOSSARY.md) 定义。各页“本库”指采用相应模型的目标实例，不能据此认定任意目标库已经采用；工作台源码仓库不是业务库。操作目标库必须先执行[目标库规则读取](../agents/package-layout.md#目标库规则读取)，其实际 Agent 入口决定业务／场景正文；软件文档用于核对能力和兼容性。

每个项目内部同一规则一处正式正文。工作台和 tannt 分别保留需要的 `docs/rules/`、`docs/agents/`、`GLOSSARY.md` 和 ADR，可独立使用；共同含义变化按[变更联动](../agents/workbench-change-coordination.md)协调。个人全局正文归所选规则源，不装入工作台软件包。背景与当前解释见 [ADR 0001](../adr/0001-shared-rules-and-scenario-skills.md) 和 [ADR 0005](../adr/0005-independent-workbench-repository.md)。

| 操作 | 必须读取 |
| --- | --- |
| 首次处理本库内容或选择存放位置 | [范围与目录](scope-and-directories.md) |
| 保存、归纳、复用材料或整理经验 | [内容与来源](content-and-sources.md) |
| 新建或整理收件箱记录 | [收件箱](inbox.md) |
| 创建项目、任务，迁入专属资料，或更新状态、进度、引用 | [项目与任务](projects-and-tasks.md) |
| 归档或恢复项目、领域记录与资源 | [存档与恢复](scope-and-directories.md#存档与恢复)及[写入与变更](writing-and-changes.md) |
| 新建或修改功能开发 Issue、评论、分诊、关闭状态和依赖 | [开发 Issue](issues.md) |
| 设计、维护或执行 FNS 跨设备规则发布、接收与应用 | [FNS 配置同步](fns-config-sync.md)及[设备配置规则](../agents/fns-device-config.md) |
| 保存原文件、附件或登记库外资料 | [附件](attachments.md) |
| 管理网盘托管文件、替代文件，或移动与改名其所在目录 | [网盘托管](cloud-files.md) |
| 写入任何业务文件或修改共同规则 | [写入与变更](writing-and-changes.md) |
| 编辑或移动 `3.资源/飞书知识库/` 同步单元，或确认后回传飞书；迁移期间旧位置同样适用 | [飞书知识库编辑与同步](lark-wiki-sync.md) |

上表用于维护／核对软件模型，使用目标库时按实际主题读取该库选定的规则。`AGENTS.md` 和 Skill 提供触发入口；`docs/agents/` 说明软件场景与工具步骤；`docs/workbench/` 说明实现。开发 Issue 与测试／打包流程属于工作台，不是目标库业务 Project／Task 的规则。历史规格、原型和验收保留当时语境，不作为现行规则副本。
