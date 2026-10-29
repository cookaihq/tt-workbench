---
name: tt-update-note
description: 在明确的知识库中追加或修改明确指定的已有笔记、补充来源和附件、更新获授权的状态进度、分流收件箱，或按明确范围归档与恢复。新建无关内容使用 tt-capture。
---

先读取 `<软件根>/docs/agents/package-layout.md`。从本 Skill 的真实路径（解析发现链接后）向上两级得到 `<软件根>`；下文 `docs/`、`scripts/` 等指软件资源，业务路径和 `config/` 指用户明确的目标知识库。读取目标库实际 Agent 入口，命令显式传 `--vault "<库绝对路径>"`，不以软件目录推断目标库。

1. 确定目标笔记和本次获授权的变化，读取 `docs/rules/scope-and-directories.md`、`writing-and-changes.md`。从实际文件读取完整原文；目标不唯一时先搜索与辨认，不猜测路径，不要求打开 Obsidian。
2. 按操作补读规则：收件箱分流与状态用 `docs/rules/inbox.md`；项目任务属性用 `projects-and-tasks.md`；资料和判断用 `content-and-sources.md`；附件用 `attachments.md`；归档与恢复用 `scope-and-directories.md` 的“存档与恢复”。均位于 `docs/rules/`。涉及网盘托管文件、YAML 替代文件或其所在目录的移动、改名时，另读 `cloud-files.md`，由本库 `tt-cloud-files` 维护远端与本地对应关系；飞书同步单元先执行 `lark-wiki-sync.md`。
3. 只修改已授权内容。可用 `node "<软件根>/scripts/vault/write.mjs" --vault "<库绝对路径>"` 的 `update` 或 `attach`；调用字段、正文替换与重试流程见 `docs/agents/vault-file-operations.md`。提交刚读取的完整原文作为 `expected`，不要在命令行拼接正文。
4. 更新后直接读回文件，核对指定变化、未涉及属性、创建时间及正文。附件还需核对原字节与链接。多记录操作分别报告结果，不联动其他记录状态。
5. 检测到原文变化时保留拟写内容并指出冲突位置，不替换原文快照强制重试。没有成功更新原笔记就报告未完成；另存副本、附件已复制或工作台能显示，都不能替代原操作结果。

用户明确要求从收件箱创建或归入任务时，另读 `docs/rules/projects-and-tasks.md` 的“任务资料归属”和附件规则。使用 `docs/agents/vault-file-operations.md` 的 `create-task`（确需新建时）与 `transfer-to-task` 流程，将原记录和专属资料一并迁入，核对附件字节、来源身份与时间、任务中的实际链接及源文件移除结果。共享资料引用与资料迁移分别报告。迁移失败时沿用恢复记录及已建任务；不能用普通 `update` 改类型、只加链接或保留分散副本来代替迁移。本 Skill 不自行决定创建任务或启动研究。

分流到项目、领域或资源，以及归档或恢复整包内容时，先按文件操作说明核对实际可用入口和字段；未覆盖的操作使用符合相同规则的迁移工具，不猜测命令。每个新任务必须指定项目，项目与任务完成或暂停均不自动归档。保留源/目标清单、原版本和恢复位置，读回文件并核对附件与引用后才报告完成；普通迁移不能绕过网盘、飞书同步或共享附件检查。
