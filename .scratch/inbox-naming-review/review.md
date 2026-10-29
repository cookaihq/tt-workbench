# 收件箱命名与 Skill 维护复核

日期：2026-10-29。工作台分支：`main`；HEAD：`9c70193539753a7b348a6ab0af268705565dc426`。

## 请求与边界

接手 tannt 知识库关于 `0.收件箱` 与 `01.收件箱` 并存及 Skill 新命名的交接。在工作台正式源中复核，业务目标为用户明确指定的 tannt 知识库，不能把工作台源码根当作业务目标。

只处理本次收件箱命名问题。保留其他会话的未提交修改；不改知识库 AGENTS.md、交接规则、业务笔记、附件或既有暂存删除，不推送或发布。真实库只读；合成写入均在本仓已忽略的 `tmp/` 中。

已读取项目 AGENTS.md、Git 使用说明、本机全局主指令及方案评估／关联功能／临时文件场景、ADR 0001、范围与目录／收件箱／写入规则、软件路径／文件操作／Skill 安装／开发说明，以及使用方入口与交接规则。采用 diagnosing-bugs 的实际入口反馈检查；当前实现未复现命名错误，因此没有进入修复、故障根因归属或新增回归测试阶段。

## 当前结果

无需修改 Skill、规则或生产代码，也无需安装更新。

- 源码和目标库安装版本现均为 `0.25.1`。交接时的 `0.25.0` 是先前状态，本次没有执行这次升级。
- `skills/tt-capture/SKILL.md` 第 9 行指定新输入使用 `0.收件箱/`；`tt-update-note` 读取同一收件箱与目录规则，不独立指定旧根。
- `lib/vault/paths.js` 的 `ROOTS.inbox` 为 `0.收件箱`。`LEGACY_ROOTS.inbox` 为已有记录的识别和兼容维护保留 `01.收件箱`；`assertNewPath` 以 `LEGACY_WRITE` 阻止旧根新增笔记或附件。
- `lib/vault/inbox.js` 的程序录入路径和根目录创建使用 `ROOTS.inbox`；工作台 Inbox 适配器复用该实现。Skill CLI `scripts/vault/write.mjs` 与旧转发入口 `scripts/workbench/agent-request.mjs` 使用同一文件模块。
- `.agents/skills/` 和 `.claude/skills/` 中两项 Skill 的四个符号链接均解析到当前库 `.obsidian/plugins/tt-workbench/skills/`。Codex 安装器的只读检查逐项返回 `installed`。
- 完整安装检查返回 `ok: true, mode: check, changed: false, version: 0.25.1`；源码打包清单与安装清单一致，335 个受管理文件逐一 SHA-256 相等，包含插件入口、共享模块、CLI、Skill、规则和模板。
- 目标库复核前后均只存在 `0.收件箱`；用户指出的 ZIP 暂存删除仍保持原状态。

## 旧命名按用途核对

完整分发内容中，字面量 `01.收件箱` 只出现在 `lib/vault/paths.js` 的历史根定义与 `docs/workbench/numbered-directories.md` 的历史迁移表。二者均有保留用途，不做全局替换。

源码中另有历史兼容测试、迁移工具和旧验收脚本。例如 `scripts/workbench/verify-attachments.cjs`、`verify-manual-inbox.cjs` 以及 `scripts/vault/verify-workbench.cjs` 含旧路径夹具或直接写入代码；若人工在旧验收环境中调用，可能写入旧目录。它们不在当前安装包中，不属于这两个活动 Skill 的调用链，也不由 `npm test` 执行。本次未运行或改写这些历史工具，不能将“活动 Skill 不会新建旧根”扩展为“源码中的所有历史脚本都不能创建旧根”。

交接说明提供了此前迁移提交及六个空目录清理结果；本次仅独立确认当前旧根不存在。没有找到足以确定原空目录创建者的证据，不能归因于当前 Skill。

## 验证

1. `node --test --test-reporter=spec apps/workbench/tests/inbox.test.cjs apps/workbench/tests/inbox-catalog.test.cjs lib/vault/tests/architecture.test.cjs lib/vault/tests/files.test.cjs`
   - 42 项通过，0 失败，0 跳过。覆盖新命名录入、重试、已有记录兼容、独立文件更新与相关分流逻辑。
2. `node scripts/workbench/install.mjs --vault <目标库绝对路径> --check`
   - 只读比较，无安装差异；未写插件或恢复目录。
3. `node <安装根>/scripts/agent-skills/install.mjs --vault <目标库绝对路径> --agent codex --skill tt-capture --skill tt-update-note --check`
   - 两项入口均为 `installed`；未修复、重建或注册链接。
4. `node tmp/inbox-naming-audit/verify.cjs`
   - 一次性审计脚本及输出位于已忽略的 `tmp/inbox-naming-audit/`。18 组检查全部通过，包括安装字节一致、四个链接解析及源码／安装副本各六组实际写入检查。
   - 分别从源码与目标库安装副本启动独立 CLI，显式以本仓临时库为 `--vault`：保存到 `0.收件箱/YYYY-MM/<标题>/记录.md`；跨进程重试复用原记录；追加保留身份和创建时间；指定新路径创建成功；旧路径新建及附件目标均返回 `LEGACY_WRITE`；新路径附件字节读回一致。
   - 合成旧恢复记录在旧根不存在时不重建旧根；显式准备旧目录夹具后，恢复仍拒绝新增旧路径笔记。
   - 首次审计脚本误把 YAML 与正文之间的分隔空行当成输入差异；校正脚本的正文提取断言后通过。产品源码未变。
5. 工作区最后检查与接手时相同：六个既有已跟踪修改文件的 diff 统计仍为 110 行新增、26 行删除，既有未跟踪材料保留，暂存区为空，`git diff --check` 通过。

没有重跑全量 `npm test` 或生成构建产物：本次没有产品改动，相关测试、源码打包清单和安装副本已直接验证。没有在真实库创建验收笔记，没有执行 Obsidian GUI 写入或另开宿主会话验证自动发现；链接可读／安装状态与宿主新会话实际加载分别报告。

## 实际修改与安装范围

本次只新增本复核记录，以及已忽略的临时审计脚本、输出和合成库。未改正式 Skill、共同规则、生产代码、版本、安装副本或发现链接，未移动或清理真实业务内容，未提交、推送或发布。此前清理空旧目录和升级到 0.25.1 均不是本会话实施的修改。

## 关键文件 SHA-256

| 源码文件（与安装副本相同） | SHA-256 |
| --- | --- |
| `skills/tt-capture/SKILL.md` | `8e05371d30c671111c8dc8d776191323d9e2df0aa9c5cdfa265d452fb9ad9d6d` |
| `skills/tt-update-note/SKILL.md` | `ef8b95f8445923d1e965bc489f906bb1f1325aa1ad90e418223646650165c71c` |
| `lib/vault/paths.js` | `d49c94c24485b110c9f6e8deafa2a34bf1211a45ee5102b54292bfe8851e134e` |
| `lib/vault/inbox.js` | `08ead0228d354967a3ebc123b50a7a1057da1cd7ebd07d441bb7c55bf770af31` |
