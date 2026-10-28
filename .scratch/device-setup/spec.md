# Agent 配置检查与同步

## 当前目标

2026-10-24，本人明确该 Skill 的两个职责：按一份用户和 Agent 都能阅读的检查清单检查当前 Agent；有未完成设置时，在用户允许的范围内完成设置。清单更新并经 FNS 到达另一台电脑后，在那台电脑重新执行 Skill，使当地配置符合相同目标。

当前名称为 `tannt-sync-agent-config`，用户首次及后续都只发送名称。名称本身默认启动检查；2026-10-25 新增已授权例外：FNS 配置归位与本机符号链接每次自动执行，见[FNS 设备配置记录](../fns-device-config/spec.md)。其他差异先给出具体修改方案，再按当前环境的既有或新取得授权应用。原 `tannt-setup-device` 退役，原来的“名称默认补齐配置”行为由本次明确要求替代。

当前执行宿主为 Codex 或 Claude Code，平台为 macOS 或 Windows 原生。只管理当前 Agent；Hermes 留待后续。工作台、FNS、飞书、网盘和浏览器剪藏按目标清单的适用条件检查，不以本机已装软件推导应同步到其他设备的全部配置。

## 正式源与入口

- `docs/agents/agent-config-checklist.md`：目标配置的统一阅读入口，包含明确条目、适用条件、目标、检查与应用方法、完成依据；具体规则及网盘账号目标引用各自唯一正式源，不重复维护，也不保存机器完成状态。
- `docs/agents/agent-config-sync.md`：检查、差异、授权、应用、复查及首次按名称读取的流程。
- `skills/tannt-sync-agent-config/SKILL.md`：项目级执行入口，登记在 `skills/manifest.jsonc`；旧名称只在 `retired` 清理记录中保留。
- 根 `AGENTS.md` 引导首次未注册时读取本库源码；根 `CLAUDE.md` 导入同一项目指令。用户无需记文档路径或选择另一套安装入口。
- 共同业务规则、全局规则和活动 Skill 各自保留唯一正式源，检查清单引用它们，不复制正文。`GLOSSARY.md` 明确“Agent 配置检查清单”与本机完成状态的区别；无须新增 ADR。

## 实现与行为边界

项目 Skill 与全局指令安装器增加 `--agent codex|claude|all`；默认 `all` 保留原维护命令，Skill 的检查、应用和复查都显式选择当前宿主。范围限制同时作用于前置检查、安装、退役链接清理和结果。全局共用场景入口仍适用于两者；共享旧中间目录仅在 `all` 时检查和清理，避免损坏未选择宿主。

单独名称不授权创建发现链接、调整 FNS 设置值或写测试样例；FNS 配置文件按设备归位与建链已有专门持续授权。应用前复读目标及相关源，变化引起的新动作须有相应许可；不能通过改目标为当前值消除差异。没有足够证据时报告无法验证，不能沿用另一台电脑的通过结果。

工作台安装器没有检查模式，即便传 `--check`／`--help` 仍会写入；检查时只比较文件。Node、Windows 链接权限、默认配置目录以外的情况按实际能力报告。FNS 负责传递共享目标及源；网盘目标 `config/cloud-storage-targets.jsonc` 通过普通文件同步，各设备独立准备授权及安装设置，本机运行数据继续排除。

## 已有全局指令的接入

2026-10-24，本人采纳“先逐条评估、确认具体方案后迁移”。规范正文集中于 `docs/global-agent-instructions/README.md` 的“已有全局指令的评估与迁移”，A03／A04、执行流程及 Skill 均要求读取。ADR 0002 区分最初源目录迁移的历史行为与其他设备已有规则的接入策略。

Agent 负责比较旧正文和必要引用，提出每条要求的保留、场景整理、项目归属或退出去向，并说明共享源修改对其他设备的影响；批准后执行备份、内容迁移、入口归档、现有安装器和加载验证。未决条款会因切换失效时保留旧入口，继续其他独立项。安装器继续只负责已明确目标的链接安装；它不判断语义、不自动接管普通文件，Skill 在具体授权范围内完成这些前置操作。

本轮更新执行规范及引用，未对真实用户级指令进行迁移。恢复快照和验证见 `verification/existing-global-instructions/`；模拟行为核对不能替代 Windows 实机的迁移、回滚或加载验收。

## 共享正文生效与网盘目标：2026-10-25

本人对本轮 Q1／Q2／Q3 回复“全部推荐”：共享规则在一处获准修改后随同步供各设备后续读取；网盘采用默认账号加按次指定、各账号独立父目录。本机安装、入口、登录和同步设置的具体修改许可继续按既有流程取得，不逐台再次审批同一共享正文。

网盘分发方式曾依次采用生成本机 `.env`、直接同步根目录 `.env` 的方案。用户随后明确将配置迁入 `config/`，当前唯一源为 `config/cloud-storage-targets.json`，脚本直接解析 JSON，不生成环境文件，不依赖单文件补丁。此前方案及测试保留为[历史验证](verification/shared-config/README.md)，不作为现行执行流程；凭据各设备单独准备。

Q4 继续采用本机文件的简易检查：缺失、冲突或检查后变化时停止受影响的修改，继续无依赖检查；不引入整批发布、远端最新版本证明或逐设备版本锁定。此流程不受网盘配置来源变更影响。

网盘目标的 FNS 普通文件同步按[维护流程](../../docs/agents/fns-cloud-targets-sync.md)逐设备核验；本机迁移见[当前记录](../../local-evidence/.scratch/cloud-managed-files/verification/config-targets-migration-20261025.md)。Windows 原生、真实两端接收及文件传输仍需分别验证。配置来源已确定，剩余授权及现场验收由执行阶段处理。

## 演进和验收

初版以“设备接入”为主题，已完成当前 Mac 的项目安装、Codex／Claude Code 标准发现、受限只读行为核对，以及首次名称的项目入口加载。历史证据保留于 `verification/`，不把旧名称或旧授权行为当作当前规范。

本次更名、目标清单、授权流程和单宿主脚本改动的恢复快照与验证保存在 `verification/config-sync/`。原目录名称保留以维持历史引用。

Windows 原生首次安装、权限不足、移动库后修复、实际宿主加载、工作台读写，以及真实两端 FNS 同步仍需目标设备验收。[global-agent-instructions#01](../global-agent-instructions/issues/01-为-macOS、Windows-创建全局-Agent-指令安装与修复-Skill.md) 与 [vault-workspace-v1#14](../vault-workspace-v1/issues/14-continue-on-second-computer.md) 保持未关闭。


## 自有配置改用 JSONC：2026-10-25

网盘目标与 Skill 清单现分别为 `config/cloud-storage-targets.jsonc`、`skills/manifest.jsonc`，账号、路径和清单项不变；读取入口与当前规则同步更新。以上历史段落中的 JSON 路径保留当时语境，当前方案及验证见[JSONC 配置记录](../jsonc-config/spec.md)。
