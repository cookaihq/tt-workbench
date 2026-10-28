# 全局 Agent 指令

独立工作台仓库中的本目录是跨项目 Agent 指令的正式维护位置。安装包里的同目录是版本化资源；编辑前定位已确认的可写正式仓库，见[路径约定](../agents/package-layout.md)。本人或获授权的 Agent 编辑这里的源文件，Codex 和 Claude Code 通过用户级加载入口读取同一份正文。全局场景指令也在这里维护；各项目自己的主指令和场景指令保存在各自项目。

## 文件与使用范围

| 文件 | 用途 |
| --- | --- |
| [AGENTS.md](AGENTS.md) | 每个新会话读取的全局主指令，以及全局场景指令的触发入口 |
| [scenarios-agent-instructions/proposing-and-evaluating-plans.md](scenarios-agent-instructions/proposing-and-evaluating-plans.md) | 提出或评估方案、整理供执行的流程，或依据用户纠正修订这类回答前读取 |
| [scenarios-agent-instructions/reviewing-related-features.md](scenarios-agent-instructions/reviewing-related-features.md) | 设计、开发新功能或修改已有功能前读取，主动评估关联功能的必要性、优化机会与必要调整 |
| [scenarios-agent-instructions/maintaining-agent-instructions-and-project-rules.md](scenarios-agent-instructions/maintaining-agent-instructions-and-project-rules.md) | 新增、修改、拆分、迁移全局或项目 Agent 指令、项目规则，或维护其读取与加载入口前读取 |
| [scenarios-agent-instructions/temporary-files-and-reusable-scripts.md](scenarios-agent-instructions/temporary-files-and-reusable-scripts.md) | 创建临时文件（含一次性脚本）、新增复用脚本，或迁移这两类文件前读取 |
| [scenarios-agent-instructions/lark-cli-and-hermes-feishu-config.md](scenarios-agent-instructions/lark-cli-and-hermes-feishu-config.md) | 为 Lark CLI 查找、选择、导入、修复飞书配置与凭证，处理认证失败或判断已发现配置能否使用前读取 |

本目录与目标知识库的 `AGENTS.md`、`docs/agents/`、`docs/rules/` 分别维护。后三者说明该目标知识库的具体使用约定；本目录说明本人在不同项目使用 Agent 时的共同要求。新增场景只依据已经确认的需要，不预建各项目专属规则或 Skill 副本。

## 本机加载

以下为使用默认用户配置目录的 Codex 和 Claude Code 的目标加载布局。既有真实入口已在 macOS 验证；2026-10-28 在 Windows 原生隔离样例中分别验证两宿主建链及库外新会话加载，见[本轮验收](../../local-evidence/.scratch/agent-rules-workflow/verification/skill-implementation.md)。隔离结果不代表真实用户入口已迁移，也不替代其他设备验收：

```text
~/.codex/AGENTS.md → <工作台规则仓库>/docs/global-agent-instructions/AGENTS.md
~/.claude/CLAUDE.md → <工作台规则仓库>/docs/global-agent-instructions/AGENTS.md
~/.agents/scenarios-agent-instructions → <工作台规则仓库>/docs/global-agent-instructions/scenarios-agent-instructions/
```

Codex 启动新会话时从用户目录读取主文件；Claude Code 从自己的用户入口读取同一文件。主文件指示 Agent 在符合条件时读取 `~/.agents/scenarios-agent-instructions/` 下的场景文件，不依赖会话工作目录，也不使用 Claude 专属的自动导入语法。

源文件是普通文件，取得正式仓库后每台设备建立自己的用户级链接。编辑源文件后，新会话读取新内容；已经打开的会话不以文件保存成功作为重新加载的证据，验证时启动新会话或使用宿主的加载诊断。

共享规则正文在一处获准修改后，通过该规则仓库或明确采用的版本到达各设备；公开软件仓库不参与知识库 FNS 配置传输。主指令在新会话中读取，场景在后续按需读取时使用已到达的内容；不要求各设备先运行配置 Skill 或再次批准同一正文。已有会话可能仍保留旧主指令，不能因此声称所有会话已经切换。安装、链接替换、登录及启用等本机主动调整，仍按该设备的具体方案和授权执行。

使用软件内的安装器，显式指定正式规则源：

```sh
node "<软件根>/scripts/global-agent-instructions/install.mjs" --source "<正式规则目录>"
node "<软件根>/scripts/global-agent-instructions/install.mjs" --source "<正式规则目录>" --check
```

上述维护用法默认处理两个宿主。只处理当前 Agent 时，检查、安装和复查都显式传 `--agent codex` 或 `--agent claude`，例如 `node "<软件根>/scripts/global-agent-instructions/install.mjs" --source "<正式规则目录>" --agent codex --check`。两个范围均包含共用的场景目录；另一宿主的入口、配置目录变量和 Codex 专属覆盖文件仅在其被选中时检查。共享旧 `~/.agents/global-instructions` 目录只在 `--agent all`（或省略参数）时核对、清理，单宿主操作保留它，避免断开另一宿主仍在使用的间接入口。

安装命令先核对全部目标，再创建缺失链接，或将仍解析到当前正式源的间接链接改为直接链接；已经正确的链接保持原样。确认新入口可用后，仅移除指向当前正式源的旧 `~/.agents/global-instructions` 目录链接。普通文件、其他目标或无法确认来源的失效链接占用入口，或存在非空 `~/.codex/AGENTS.override.md` 时，停止并报告，不覆盖已有内容。写入失败时尝试恢复本次已修改的链接，发现外部改动则保留并报告；不宣称跨文件原子迁移。检查模式不修改文件。首次源目录迁移记录见[验收记录](../../.scratch/global-agent-instructions/verification/README.md)。

当前不支持通过本脚本切换自定义 `CODEX_HOME`、`CLAUDE_CONFIG_DIR`，也不修改工具设置、权限规则、Skill、凭证、其他项目的指令或 FNS 配置。Codex 的 `~/.codex/rules/default.rules` 是命令执行权限配置，不属于本目录的场景指令。

## 已有全局指令的评估与迁移

整理本机已有规则或修复接入时，使用项目级 [tannt-organize-agent-rules](../../skills/tannt-organize-agent-rules/SKILL.md)，默认处理当前执行宿主，用户明确指定时才扩展范围。Skill 无需 Obsidian 或工作台运行；日常新增、编辑规则继续使用[指令维护场景](scenarios-agent-instructions/maintaining-agent-instructions-and-project-rules.md)。`tannt-sync-agent-config` 已退出规则管理，不检查后转交，也不隐式调用本 Skill。

若目标宿主已有全局主文件、覆盖文件、其他来源的链接或场景目录，先评估旧内容，给出具体整理方案，经本人允许后再迁移。已确认的工作台规则仓库继续作为统一正式源；同意采用本流程、页面复制提示词或刷新状态不等于批准某台电脑尚未展示的内容合并、停用或入口替换。用户只要求检查或候选时，停在该范围。

本节处理从已有来源迁入已确认正式源的场景：按指令维护场景解析旧入口，是为了定位待评估的来源；获准纳入共享规则的内容写入正式规则仓库的 `docs/global-agent-instructions/`，不能把旧入口所在的用户目录改认作本次目标。读取和修改范围按选定宿主限定；指令维护场景中的双入口核对在此只覆盖共用场景调整涉及的必要依赖，不因另一宿主也有入口就扩展为对它的完整检查或迁移。

### 只读核对与条款去向

先读[指令维护场景](scenarios-agent-instructions/maintaining-agent-instructions-and-project-rules.md)。核对目标宿主实际配置目录，分别记录主入口、共用场景入口、覆盖文件的类型、原链接目标、直接目标、最终真实源、内容版本及引用关系。直接符号链接、间接链接、其他目标、断链、缺失、普通文件／目录和未知分别报告；同文普通文件也不算已接入。自定义目录按实际位置检查，工具不支持时说明限制，不能用默认路径结果冒充成功。

读取旧正文及它引用的必要场景文件，与本目录当前正式源逐条比较。缺失、不可读或来源无法确认的部分列为待处理，不能因读不到就当成没有旧规则；单项失败保留其他独立结果。条款按对象、条件、动作和结果分析；事实先核实，含糊表述给出原文、不同解释、推荐及影响，按依赖分轮确认，沿用已确认且未变化的决定。

**仅场景入口修复：** 主入口已正确直连时保留主文件正文和链接，只核查场景目录、必要旧内容与读取依赖；确认方案后补齐或修复场景链接。仅在发现具体需要合并或澄清的条款时追加内容方案，不为修复入口重新拆分主文件。两项入口正确但被覆盖或无法读取时处理该具体问题；入口正确且内容清楚完整时如实报告，不制造改动。

| 旧内容 | 整理方案 |
| --- | --- |
| 与正式规则含义相同 | 指出对应条款并复用，不重复追加；内容相同的普通文件仍需获准后改为正式入口 |
| 需要所有会话加载的跨项目共同要求 | 提议纳入全局主文件，保留其含义与适用范围 |
| 仅在特定条件下适用的全局要求 | 不论篇幅长短，提议放入适用正式场景，并在主文件写明触发条件、读取时机、库外可解析路径与执行要求 |
| 只适用于某个项目 | 提议迁到对应项目的指令，列出目标位置；涉及其他项目的写入须在具体授权范围内 |
| 只适用于某个系统或设备 | 写明适用条件及本机路径的解析方式，不把固定盘符、用户名或设备条件推广到所有电脑 |
| 与正式规则冲突、已过时或用途不明 | 列出双方原文、行为影响和保留／替代／停用建议，由本人决定；不以新旧时间或文件所在位置自动裁决 |

呈现一份可审阅的迁移方案：每条旧要求的来源和原文、原意、拟保留或退出的行为、对应主文件或场景及拟写正文／差异、触发与引用；同时列出新增或替换的文件与链接、备份位置、恢复办法和验证方式。区分结构整理与行为变化，未获准改变的要求保留原义。仅列条目类别或说“合并旧规则”不算完整方案。

明确区分本机入口调整与共享正文修改。后者会通过 FNS 影响使用这份源的其他设备及宿主；共用场景入口的调整也可能影响本机另一宿主，须说明具体影响。只检查当前 Agent 不授权替另一个宿主迁移入口。旧文件只需归档、不再保留独有要求时，也须由本人明确选择。

本人可以一次确认完整方案，也可以只允许其中部分；未回复不算批准。若切换入口会使某条尚未决定的旧要求停止加载，保留原入口及相关场景，记录受阻动作和依赖；其他独立检查与已获准且无此依赖的动作继续。已有具体授权继续沿用，新增或变化的动作才补充确认。备份保留了内容，不代表该要求仍然生效。

### 获准后的迁移与恢复

1. 重读旧文件、链接及共享目标，核对与获准方案所依据的版本一致；出现并发修改或新冲突时保留拟写内容，停止受影响动作并重新澄清差异，其他独立获准动作可继续。版本检查不提供跨设备事务保证。
2. 按当前设备规则或用户明确位置，在不参与同步且不会被宿主自动加载的位置保存恢复材料：受影响的原文件及必要引用文件、原路径与目标路径、内容指纹、入口类型与原链接目标。先读回核验并告知备份路径；失败时保持旧入口。设备特定备份路径不推广到其他系统，不把原始设备指令作为正式规则同步到所有电脑。
3. 按获准方案编辑正式源或明确获准的项目文件，检查条款去向、场景读取入口及本机路径，读回核验。未获准的内容保留原状；不为了消除配置差异擅自改共享规则。
4. 确认所有会受入口切换影响的旧要求都有已获准的去向后，将获准替换的旧入口移出加载位置；普通文件或目录按方案归档，链接只处理入口并保留原目标源文件。覆盖文件也按方案处理，不能留有仍会遮蔽新主文件的未知入口。复用安装器时执行 `node "<软件根>/scripts/global-agent-instructions/install.mjs" --source "<正式规则目录>" --agent <选定宿主>`；该脚本只安装链接，不做语义合并，也不负责归档普通文件。自定义目录或独立的局部修复超出安装器能力时，按具体获准方案使用原生文件工具建立直接链接并逐项验证，保持其他入口和可能仍被另一宿主依赖的旧共享中间入口。
5. 安装器适用时用同一宿主范围执行 `--check`；超出其能力时，人工逐项核验原生符号链接的直接目标、真实源及可读性。随后从库外的新会话或加载诊断验证主文件及按需场景，核对获准保留的要求可读、获准退出的条款没有从旧入口再次加载。报告实际宿主、系统与未完成范围。

中断或失败时依据记录核对本次已完成步骤，能安全恢复的旧入口予以恢复；外部已有新修改时停止覆盖并报告。安装器只能回滚它本次改动的链接，不能自动恢复先前归档的普通文件或修改过的规则正文。共享正文可能已被其他设备读取，不把本机恢复称为跨设备撤销。重试先核对实际状态，避免重复合并或重复归档。

逐步记录跨文件操作的已完成动作及前后版本，不宣称全体原子迁移。Windows 使用原生符号链接；权限失败如实报告，不用复制、硬链接、目录联接或 WSL 冒充接入。

交付分别报告来源已读取、含义待澄清、方案待确认、候选已生成、正式源已写入、入口已接入、实际加载已验证。文本、路径和行为证据分开记录；库外新会话须实际读取触发场景，核对适用要求可用、退出条款未重新加载、tannt 项目规则未进入其他项目，注明宿主版本、系统及工作目录。候选不等于生效，链接正确不证明旧会话刷新或其他设备同步。无法完成的阶段保留为未验证。

## 迁移与恢复

移动 tannt 目录后，使用 `tannt-organize-agent-rules` 核对新源与旧入口，按选定宿主范围修复主入口及共用场景入口；无法确认的断链保持原状。2026-10-28 起本职责从配置同步 Skill 独立出来；当前实现与各环境证据见[本轮验收](../../local-evidence/.scratch/agent-rules-workflow/verification/skill-implementation.md)。[global-agent-instructions#01](../../.scratch/global-agent-instructions/issues/01-为-macOS、Windows-创建全局-Agent-指令安装与修复-Skill.md) 的未完成实机目标仍须分别验收，不把 Skill 已创建视为全部完成。

首次源目录迁移前的原文以历史证据保存在 `.scratch/global-agent-instructions/verification/global-main-before.txt`，不作为可编辑的第二份规则。需要恢复时先核对迁移后新增内容，再决定恢复哪个版本；不能用旧快照直接覆盖后来修改。

2026-10-23 按已确认草案完成精简重建：主文件只保留角色判断和两个按需读取入口，维护流程与临时文件、复用脚本规则分别放入场景。重建前主文件保存在 `.scratch/global-agent-instructions/verification/AGENTS-before-rebuild-20261022T230608-0700.txt`；其余受影响文件的恢复快照、加载检查与旧会话适用范围见[重建验收记录](../../.scratch/global-agent-instructions/verification/rebuild-20261023/README.md)。

2026-10-23 取消用户目录中的 `global-instructions` 中间层，并将源目录与用户入口中的场景目录命名为 `scenarios-agent-instructions`。本轮恢复快照与验收见[直接入口迁移记录](../../.scratch/global-agent-instructions/verification/direct-entry-migration-20261023/README.md)。

其他电脑须分别安装和验证。Windows、Claude Cowork、云端 Agent 以及独立设置了指令加载方式的宿主不在本轮实际验收范围。

设计依据见 [ADR 0002](../adr/0002-global-agent-instructions.md)。Claude Code 用户级入口及链接行为见[官方说明](https://code.claude.com/docs/en/memory#share-one-file-with-other-coding-tools)。Codex 以本机 `codex debug prompt-input` 实际输出核对加载结果。
