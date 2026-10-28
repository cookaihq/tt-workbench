Status: needs-triage
State: open
ID: 68485c4c-c6bb-4752-8108-e203ef724357
Input hash: b4349a3679bb56d6d6bb3c03a9acba0fa7b49e6f646defd98186474c2d103d40
Created: 2026-10-23T11:20:40.620Z
Updated: 2026-10-25T04:07:07.216Z
Labels: ["功能","Skill"]
Priority: 
Blocked by: []
Related: []

# 为 macOS、Windows 创建全局 Agent 指令安装与修复 Skill

## 目标与实施时机

创建仅在当前 tannt 仓库中发现和使用的项目级 Skill，让用户在另一台电脑取得本库后，通过 Skill 安装、检查、迁移或修复该电脑上的全局 Agent 指令入口。目标系统只包含 macOS、Windows，目标宿主为 Codex 与 Claude Code。

最初按本人要求先完成目录与入口调整，再记录本 Issue；该阶段见[直接入口迁移验收](../verification/direct-entry-migration-20261023/README.md)。后续已获准实现为 `tannt-sync-agent-config`，当前清单与流程见[配置检查清单](../../../docs/agents/agent-config-checklist.md)和[执行流程](../../../docs/agents/agent-config-sync.md)。尚未完成的实机验收继续保留于本 Issue。

## 已确定的目录与链接

正式主文件保存在本机 tannt 库的 `docs/global-agent-instructions/AGENTS.md`；场景正文保存在同目录下的 `scenarios-agent-instructions/`。真实源集中在本库，工具读取同一份正文。

| 本机用户级入口 | 直接指向的目标 |
| --- | --- |
| `~/.codex/AGENTS.md` | `<本机 tannt>/docs/global-agent-instructions/AGENTS.md` |
| `~/.claude/CLAUDE.md` | `<本机 tannt>/docs/global-agent-instructions/AGENTS.md` |
| `~/.agents/scenarios-agent-instructions/` | `<本机 tannt>/docs/global-agent-instructions/scenarios-agent-instructions/` |

`~` 表示执行电脑的用户主目录；安装程序必须从本机环境确定路径，不写死本会话的用户名、盘符或仓库位置。两个主入口直接指向源文件，Claude Code 不经 Codex 入口；不恢复 `~/.agents/global-instructions` 中间层。场景引用保持 `~/.agents/scenarios-agent-instructions/<文件>.md`。

## Skill 的源码与发现

当前入口为 `tannt-sync-agent-config`，源码在 `skills/tannt-sync-agent-config/SKILL.md`，已登记到 `skills/manifest.jsonc`，由本库 `.agents/skills/`、`.claude/skills/` 发现；不另建同功能 Skill。

复用本库既有机制：`scripts/agent-skills/install.mjs` 安装项目 Skill 入口，`scripts/global-agent-instructions/install.mjs` 安装和检查全局指令入口。优先扩展必要实现，避免在 Skill 内维护另一套安装逻辑或复制规则正文。有关流程引用[全局指令说明](../../../docs/global-agent-instructions/README.md)和[项目 Skill 接入说明](../../../docs/workbench/agent-skill-setup.md)。

首次和后续都只发送 `tannt-sync-agent-config`。尚未注册时由项目指令读取本库 Skill 源码开始检查；展示具体方案并得到许可后才建立入口。标准发现另由新会话核对；不能假定隐藏目录、符号链接或技能清单已跨设备同步，也不能把读取源码当作标准发现通过。Windows 原生仍需实测。

## 必须支持的使用场景

1. **首次安装**：识别当前操作系统、本机用户目录、本库真实位置、所需运行时和当前宿主；核对正式源及场景文件，获准后只建立当前宿主的主入口与共用场景入口。检查、安装和复查显式使用同一 `--agent codex` 或 `--agent claude` 范围。
2. **只读检查**：报告每个入口是否存在、链接类型、直接目标、最终源文件及场景可读性；只检查时不创建、改写、迁移或删除任何入口。
3. **旧布局迁移**：识别仍经过 `~/.agents/global-instructions`、Claude 仍指向 Codex 等旧链接；先核对来源并保留恢复依据，完成直连和场景入口验证后再移除属于本配置的旧链接。
4. **失效链接修复**：处理换电脑或移动仓库后失效的入口。以用户指定或当前明确打开的 tannt 为目标，核对真实规则文件和旧配置，报告拟替换的对象；多个来源或旧来源无法确认时保留现状并说明具体冲突，不凭同名目录猜测。
5. **重复执行**：已正确的入口保持原样；不产生重复规则副本，不重新迁移已经完成的对象。
6. **冲突与部分失败**：普通文件、其他仓库链接、未知目录或其他生效指令占用目标时，先列出内容、差异、拟备份位置和影响，再取得针对该冲突的处理决定。执行失败须报告已完成项与未完成项，保留恢复材料；恢复本次修改时不能覆盖后来发生的外部改动。

7. **已有指令内容接入**：按[全局指令说明](../../../docs/global-agent-instructions/README.md)先逐条评估旧正文、覆盖文件及必要引用，展示每条要求的去向、拟改正文、备份与入口操作；说明共享源变化对其他设备的影响。获准后先备份、整理内容，再切换入口和验证。未决条款会因切换失效时保留原入口及相关场景，继续其他独立项。

入口安装本身不授权改写规则含义；内容调整、迁入项目或退出旧条款须覆盖于具体批准方案。已有授权内的检查和正常安装无需重复确认。安装器继续只负责链接，Agent 按批准方案完成内容整理和旧普通文件归档；不得把链接安装静默降为复制一份规则文件。

## macOS 与 Windows

- macOS 按文件和目录符号链接核验真实目标。
- Windows 需实际验证文件链接与目录链接的创建方式、权限要求，以及中文、空格、不同盘符的路径处理；不能仅把 macOS 命令改成 Windows 路径便宣称支持。权限不足时提供与实际失败相符的操作说明，不能声称安装完成。
- 不要求两台电脑的 tannt 使用相同绝对路径；每台设备的入口都连接该设备的真实源。
- 默认支持两个工具的默认用户配置目录。检测到自定义 `CODEX_HOME`、`CLAUDE_CONFIG_DIR` 时明确报告，不忽略实际配置后向默认目录写入；扩展自定义目录支持需明确范围。
- 缺少 Node 或目标宿主时，说明缺少什么、已经验证什么及尚不能验证什么。未安装某个宿主不能用另一个宿主的检查结果代替其加载验收。

## 验收标准

- [ ] Skill 只通过本库项目级入口发现；macOS、Windows 分别有首次接入步骤和真实发现证据，直接读取源码不计为发现通过。
- [ ] 在不同本机仓库路径下分别选择 Codex、Claude Code 完成安装，两个主入口均直接指向同一源文件，场景目录入口指向本机正式场景目录；主文件与场景可读，未选宿主的入口不被擅自调整。
- [ ] 已有普通文件、场景目录及独有／冲突条款均先形成逐条方案；只批准部分内容时不切换会停用未决条款的入口，完整获准后可核对备份、内容迁移、入口切换和失败恢复。
- [ ] 只读检查前后入口及源文件不变；重复安装不改变正确链接、不创建副本。
- [ ] 已知旧布局迁移完成后，旧中间目录链接被移除，所有生效引用使用新路径；保留恢复清单与原始链接信息。
- [ ] 源目录移动后的失效链接能够在核对来源和授权后修复；来源不明、普通文件或其他目标冲突不会被静默覆盖。
- [ ] 权限不足、宿主缺失、写入中断和恢复冲突分别给出真实结果；没有完成安装的场景明确标为未完成或未验证。
- [ ] macOS、Windows 各自从本库之外检查 Codex 与 Claude Code 的真实加载入口，确认不会带入 tannt 项目指令；记录系统、宿主版本、工作目录、比较基准及未验证范围。
- [ ] 更新受影响的脚本、项目入口、清单和说明，规则正文集中维护；旧对话是否刷新与新会话加载分别说明，不将本机结果推广到另一台电脑。

## 范围边界与现有基础

Linux、Cowork、云端 Agent 不属于本 Issue 的支持目标；不安装用户级 Skill，不调整凭证或执行权限，不自动修改 FNS 设置或承诺同步已经完成。旧条款迁入其他项目时，仅操作方案明确获准的项目指令；不扩展为其他项目配置维护。

当前安装脚本已在本机 macOS 上完成直接入口迁移、只读检查、重复安装及 Codex/Claude Code 加载检查；它对无法确认来源的失效链接仍会停止。跨设备修复与 Windows 行为属于本 Issue 的实现和验收内容，不能用现有 macOS 结果宣称这些要求已完成。

## Comments

<!-- tannt-comment:{"id":"a8b273c5-b9d0-46d1-85e7-a7f83c6fbabc","author":"Agent","created":"2026-10-24T09:10:08.329Z"} -->
2026-10-24：本人采纳统一设备接入建议并要求做成 Skill。本轮已创建项目级 tannt-setup-device，首次入口、检查及安装/修复编排见 docs/agents/device-setup.md，实施记录见 .scratch/device-setup/spec.md。复用现有全局指令安装器，不另建同功能 Skill。当前 macOS 的项目发现已由 Codex 加载诊断和 Claude Code 启动清单分别确认；Windows 原生链接权限、真实全局加载、跨设备迁移和完整失效链接修复仍需继续验证，本 Issue 保持未关闭，既有验收项不据此自动勾选。
<!-- /tannt-comment -->

<!-- tannt-comment:{"id":"e44738a0-0406-4079-8f5f-560fb10c3eed","author":"Agent","created":"2026-10-25T03:28:56.334Z"} -->
2026-10-24 后续按本人明确的职责调整：当前 Skill 已更名为 tannt-sync-agent-config；共享目标清单在 docs/agents/agent-config-checklist.md，执行流程在 docs/agents/agent-config-sync.md。用户首次或清单经 FNS 更新后只发送名称，先检查当前 Agent，列出差异，得到允许后应用并复查；不再把名称本身当成补齐配置的许可。项目与全局安装器增加 --agent codex|claude|all，Skill 始终选择当前宿主。已验证两宿主分别迁移项目入口时另一方不变、只读检查不写入、重复安装不改正确链接；Windows 实机和双设备 FNS 仍待验收。此前评论中的旧名称与路径为历史记录，当前以检查清单、流程和 .scratch/device-setup/spec.md 为准。
<!-- /tannt-comment -->

<!-- tannt-comment:{"id":"c229d919-7065-4a5b-9067-cb7902c31b85","author":"Agent","created":"2026-10-25T04:07:07.216Z"} -->
本人已采纳已有全局指令“先逐条评估、确认具体方案后迁移”的策略。本轮已将规范集中到 docs/global-agent-instructions/README.md，并更新配置检查清单 A03/A04、执行流程、tannt-sync-agent-config、ADR 0002 和本 Issue 的当前描述。流程覆盖旧条款去向、共享影响、备份、入口切换、部分批准及恢复范围；安装器继续只负责链接，内容与旧普通文件由 Agent 按批准方案整理。独立只读 Windows 案例推演通过，部分批准不会触发整套入口切换；平台范围、旧来源与新正式源、当前宿主边界的文字澄清也已复核。验证记录：.scratch/device-setup/verification/existing-global-instructions/README.md。本轮未迁移真实用户级指令，Windows 现场迁移、权限、失败恢复及加载仍待验收，状态及未完成验收项保持。
<!-- /tannt-comment -->

## Activity

- 2026-10-23T11:20:40.620Z · Agent：创建 Issue。

- 2026-10-24T09:10:08.329Z · Agent：添加评论。

- 2026-10-25T03:28:56.334Z · Agent：添加评论。

- 2026-10-25T04:03:29.602Z · Agent：编辑标题或描述。

- 2026-10-25T04:07:07.216Z · Agent：添加评论。

