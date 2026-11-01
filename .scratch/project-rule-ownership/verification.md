# 规则归属实施与安装验收

2026-10-29，工作台侧源码修改、测试、构建及指定 tannt 库安装已完成。全程保留 main 检出及其他会话修改，未提交、推送或发布；没有编辑 tannt 正式文档、业务笔记、凭据、FNS 配置或全局 Agent 入口。

本文工作台路径相对于工作台根，tannt 路径明确以目标库根为基准。详细改动文件及 SHA-256 见 [source-audit.json](source-audit.json)，安装记录见 [installation.json](installation.json)，范围见 [spec.md](spec.md)，并发与使用方协调见 [coordination.md](coordination.md)。

## 最终行为与改动

- 五个活动 Skill 通过真实 Skill 路径确定软件根，先执行 `docs/agents/package-layout.md` 的目标库规则读取流程。范围、内容、收件箱、任务、附件、网盘、飞书、写入与配置等主题沿目标库实际入口读取；软件资料仅说明产品模型、格式及工具契约。
- 新增 `docs/agents/workbench-change-coordination.md`，从 `AGENTS.md`、领域文档和规则变更入口触发。工作台和使用方各自保留独立正文，项目内部保持一处，共同含义变化联动；软件开发 Issue 不套入业务 Project／Task。
- ADR 0001、0005 保留历史并补记项目归属，ADR 0003 区分 tannt 网盘选择与通用映射。软件术语表增加目标知识库、项目规则和共同模型，保留软件需要的概念。
- 软件网盘 settings 不再提供个人目录／扩展名默认值。`selectUploadTarget(targets, account, vaultDirectory)` 必须显式传入目标规则确定的单个目录段，缺项或越界拒绝；账号 JSONC 格式未变，旧 schema 及明确选择的 tannt 路径兼容。
- 修正安装器只读检查说明、Skill 普通安装不清理退役入口的说明，以及当前规则链接和历史证据位置。`write.mjs --help` 明确规则读取责任。没有引入 Markdown 执行器、规则位置配置框架或自动规则初始化命令。
- 交付前补改 `docs/agents/agent-config-sync.md` 一处及 `docs/agents/fns-hidden-item-check.md` 两处命令顺序，统一为 `fns-hidden-audit.mjs check --vault ...`。核对脚本 `main` 先读取子命令及 `--help`；当前场景中的六条可执行示例均正确，安装副本与帮助也已复核。此项只修正文档，没有修改脚本。

规则展示、初始化、打包、安装和更新的检查结果：Agent 规则页已使用显式个人规则源，无需改代码；打包器已排除个人全局正文；安装／更新已限于插件及恢复材料，本次增加真实安装升级回归，证明目标库自有入口、规则和概念保持。模板及业务读写模块的五目录模型未变，差异由 Skill 在调用前核对，不声称 Markdown 自动改变代码。

## 规则读取验收

本会话经 tannt `.agents/skills/<名称>/SKILL.md` 读取安装内容，并核对两宿主共十个链接的真实目标和文件哈希。tannt `AGENTS.md` 中 21 个业务／场景引用均可解析到该库自己的 `docs/rules/`、`docs/agents/`；没有回指插件 `docs/rules/` 的业务规则入口。

| Skill | tannt 规则链（相对于 tannt 根） | 软件资料用途 |
| --- | --- | --- |
| tt-capture | `AGENTS.md` → `docs/rules/scope-and-directories.md`、`content-and-sources.md`、`writing-and-changes.md`，按需 `inbox.md`、`attachments.md`、网盘／飞书主题 | 已安装 `docs/agents/vault-file-operations.md` 提供写入字段和能力 |
| tt-update-note | `AGENTS.md` → 范围、写入、收件箱、项目任务、内容、附件及适用迁移场景 | 核对 update／attach／transfer／archive 的实际支持范围 |
| tt-cloud-files | `AGENTS.md` → `docs/rules/cloud-files.md`、范围、附件、写入及该库同步场景 | 软件 cloud-files 文档是 schema／工具契约；实例明确 baidu、tannt 和五类托管格式 |
| tt-sync-agent-config | `AGENTS.md` → `config/agent-config-checklist.md`、`docs/agents/agent-config-sync.md` 及清单纳入的场景 | 软件配置流程与设备工具能力，不代替该库清单 |
| tt-organize-agent-rules | `AGENTS.md` → 本库维护入口 → 已确认的 `docs/global-agent-instructions/README.md` 及维护场景 | 软件只提供整理与显式来源安装工具，不包含个人正文 |

语义与分支审阅覆盖：目标库使用自定义规则路径时沿真实引用；入口／正文缺失时停止依赖写入；规则与工具能力冲突时指出具体限制；新库未明确采用默认规则时不推断采用。自定义 `policy/capture.md` 的安装保留由回归测试验证；这些文本分支审阅不冒充新宿主会话行为测试。

本次文档审计覆盖 36 个改动文件、191 个相对链接，当前规则／工具引用无缺失。16 个指向迁仓前 `.scratch/` 的历史链接在当前位置不可用，保留原历史语境并记录于 source-audit；它们不是当前规则读取链的前提，也未用来证明本轮验收。

## 测试与构建

| 检查 | 结果 |
| --- | --- |
| 网盘目标与完整包安装针对性测试 | 13 通过，0 失败 |
| 首轮 npm test（并发 FNS 修改期间） | 270 项：261 通过、2 失败、7 外部集成跳过；失败来自正在调整的 FNS 目录数量／顺序测试，保留日志 |
| FNS 会话更新后的 updates.test.cjs | 11 通过，0 失败 |
| 最终 npm test，提供 FNS 2.4.0 main.js 作为 TEST_FNS_BUNDLE | 277 通过，0 失败，0 跳过 |
| 全量测试后另一会话新增的 local-protection.test.cjs 用例 | 当时整份文件 9 通过，0 失败；分发代码未变 |
| 最终构建前并发 FNS 新改动的针对性复验 | local-protection、fns-local-ui、updates 三份测试共 25 通过，0 失败，0 跳过 |
| FNS 隐藏项命令顺序补改 | 源码和源码／安装版 `--help` 核对通过；本次选择以源码、帮助及安装读回验证文档修正，未因此重跑全量测试 |
| git diff --check | 通过；仅提示已有 CRLF 的规范化信息 |
| npm run build | 成功，版本 0.25.1，339 项分发资源 |

测试开始／结束记录包含 372 项软件和测试文件指纹；277 项全量测试过程中可执行代码及测试未变，只有四份 FNS 相关文档更新，均已读回核对。首次安装后的并发会话又调整 `lib/fns/workbench-scope.cjs`：FNS 配置缺失且插件仍启用／加载时，不能报告排除“不适用”；对应测试及两份受影响测试文件共 25 项已复验。随后仅有文档更新，均保留并纳入最终包。最终测试范围及与首次交付的差异见 [checks.json](checks.json) 和 [final-source-delta.json](final-source-delta.json)。未修改版本号；0.25.1 来自已有工作区，具体开发构建以清单哈希区分。

临时日志均在工作台根的 `tmp/project-rule-ownership/`：保留 `npm-test.log`、`npm-test-final.log`、`fns-post-test.log`、`build.log`、`install.log`；最终记录为 `fns-final-delta-test.log`、`fns-audit-help.log`、`build-final.log`、`install-final.log`、`verify-install-final.log`、`install-check-final.log`。测试、构建和安装的摘要与日志哈希另见 [checks.json](checks.json)。

## 指定库安装

运行正常 `npm run install-plugin -- --vault <已确认的 tannt 绝对路径> --bundle <本次固定更新包>`，仅更新插件。此前已确认 Obsidian 未运行；安装后再运行同包 `--check` 返回 `ok: true`、`changed: false`。

- 目标库相对安装位置：`.obsidian/plugins/tt-workbench/`。
- 恢复位置：`.obsidian/plugins/tt-workbench-recovery/61450a7a-24e9-4cbf-b390-9ce09a48c31c/`。
- 339 项分发文件逐一匹配 release 清单，包中没有 `docs/global-agent-instructions/` 个人正文。
- 两宿主十个发现链接文字目标及真实目标均保持，五个 Skill 内容与分发清单一致。
- 安装前后 39 项目标库入口、规则、概念、配置检查项（含插件设置和 FNS 设置的内容哈希及不存在的可选入口）完全一致。
- 已安装 `scripts/vault/write.mjs` 的 `info` 只读调用返回指定目标库；未执行笔记写入。
- 已安装 `selectUploadTarget` 使用合成账号父目录 `/fixture` 和 tannt 规则明确值 `tannt` 得到 `/fixture/tannt`；其他明确目录得到各自路径，省略目录拒绝。未连接真实网盘或迁移任何对象。

| 产物 | SHA-256 |
| --- | --- |
| 已安装 release.json | `19f50add60bb72c3b79a279aa62093adcf421abd379ae0671cdd8caecc51ee95` |
| 固定 bundle | `dc901a5e2fe1d467940b5f320bf94f52044d45f91c22faa9c2bcc521569f60cc` |
| 固定 ZIP | `a45dd9478f8c6e27679b73e287a37c1fdba6b76e45e8df841b06759e33830ee0` |

各 Skill 完整哈希、目标库文件指纹和读取路径在 installation.json 中。开发包与原安装版本号相同但 release 哈希不同；不要只用版本号判断是否收到本次变更。

## 验证边界与接续

本轮证明源码／文档修改、真实安装、链接和规则路径、已安装 CLI 与路径算法的结果。没有新建宿主会话，未证明自动发现刷新或完整业务执行；没有启动 Obsidian 验证界面加载，没有验证其他设备同步或真实网盘传输。

tannt 当前有 `AGENTS.md`，未发现根 `CLAUDE.md`、`CLAUDE.local.md`、`.claude/CLAUDE.md` 或 `.claude/rules/`；Claude 的五个 Skill 链接可读不等于其宿主会自动读取 AGENTS。主会话按本次范围保留现状，本会话没有创建 Claude 原生入口，也未验证其自动加载。

tannt 主会话已修正其 `docs/agents/agent-config-sync.md` 的命令顺序和退役入口说明；本会话只读回确认“普通安装不会清理清单外入口”，不改使用方正文。这两项协调已解决，整体使用方验收由主会话结合本结果完成。本轮授权内无剩余源码或安装项；上述宿主自动加载、界面及其他设备验证仍未执行。

其他设备也应保持各自项目根下 `AGENTS.md` → `docs/rules/`／`docs/agents/` 的引用关系，以及安装包内 `skills/<名称>/` → `docs/agents/package-layout.md` 的结构；绝对根可不同。软件与 tannt 无需相邻，个人全局正文仍由 tannt 根的 `docs/global-agent-instructions/` 维护并单独接入。

## 固定包与并发修改边界

本次交付以 `2026-10-29T10:27:23.222Z` 固定构建快照及本目录 [release.json](release.json) 为准；339 项资源与安装清单逐项一致。固定产物保存在工作台根的 `tmp/project-rule-ownership/build/`。上述两份场景的三处命令修正已在此包中，安装版六条示例与帮助均已核验。

用户明确要求不再追逐构建后的无关并发修改。本次只负责固定包中的本任务修正和已记录验证；其他会话后续改动保留源码，由其后续交付，不用当前 dist 或版本号代替本清单。

记录时的源码观察时间为 `2026-10-29T10:31:15.578Z`；相对固定快照发现 0 项后续变动。路径和前后哈希见 [final-source-delta.json](final-source-delta.json)。此观察只界定本次交付时点，不限制之后的并发工作。
