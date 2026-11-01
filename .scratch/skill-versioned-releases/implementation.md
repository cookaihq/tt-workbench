# Skill 独立版本与批次发布：实施记录

2026-10-31。已按[已确认规格](spec.md)修改正式源，完成本机测试、构建、隔离安装和两宿主新会话验收。按用户确认的工作台与 Skill 同次更新共用 Tag 要求，已于 14:34:22（Asia/Shanghai）正式发布 [v0.26.0](https://github.com/cookaihq/tt-workbench/releases/tag/v0.26.0)，Tag 固定到 `4e26ba17a3315f33ee28d94a58d17a5bf4fcc5f3`。工作台 0.26.0 和五项 Skill 1.0.0 在同一 Release 交付，公开附件与正式包安装已核验。tannt 日常安装保持 0.25.1；实际验证范围及限制见下文。

## 发布范围与工作区

| 对象 | 本次发布 |
| --- | --- |
| 工作台 | `0.26.0` |
| 联合发布 Tag | `v0.26.0`（不另发 `skills-20261031.1`） |
| 选中 Skill | `tt-capture`、`tt-update-note`、`tt-cloud-files`、`tt-sync-agent-config`、`tt-organize-agent-rules` |
| 五项初始行为版本 | 各自 `1.0.0` |

开发检出保持 `main`，接手及验收基线 HEAD 为 `70aff73867efda63e88920f50c9324373b695713`。本机验收阶段未暂存、提交、创建分支／Worktree 或推送。接手时已有的 Git 凭据修复记录、Git/发布文档及其入口修改均保留；共享文档只增加本功能所需的发布和联动说明。发布提交纳入必要共享文档，独立的 `.scratch/git-credential-repair/implementation.md` 修改和 `.scratch/release-knowledge-docs/` 记录留在工作区。未整理或回滚其他会话的文件。

验收阶段未提交文件的内容摘要保存在 `tmp/skill-versioned-releases/source-snapshot-combined.json`，其中明确包含接手前修改，不能把整个工作区差异都归为本功能。此前 `source-snapshot.json` 保留为旧候选过程证据。已按审阅文件清单形成发布提交，具体提交和真实发布结果见末节。

## 实现与关联调整

- `skills/*/SKILL.md`：以 `metadata.version` 为唯一行为版本源，元数据同时提供兼容要求和更新说明。正文要求报告本次实际加载的名称与版本。独立包从自身真实目录定位 `runtime/`，不依赖调用工作目录。
- `lib/agent-skills/package.cjs`、`releases.cjs`：生成和核验独立包、完整批次清单、固定附件与内容摘要；显式选择本批变更项，其余逐项继承原正式来源。`v<工作台版本>` 和 `skills-*` 共用递增 `sequence` 及上批摘要链；核验完整继承链，出现分叉停止判断，不用两类 Tag 字符串或发布时间比较先后。阻止相同版本不同内容、版本倒退、缺项、包不一致和过期基线。
- `lib/agent-skills/install.cjs`、`updates.cjs`、`manager.cjs`：统一管理实际版本、发现入口、查询、安装和恢复。下载后再次校验检查令牌；共享工作台安装锁，按阶段记录目录切换；普通失败回退，中断保留同一操作标识。已结束的失败可在原 Obsidian 进程中恢复，恢复自身再次中断也能核对原进程后接续。用户文件和外部改动保留。
- `lib/workbench/package.cjs`：工作台清单声明独立 Skill 管理边界。首次从旧无版本安装迁移仍校验旧工作台全部受管内容；后续工作台升级核验并保留已采用的独立包，即使核心附带的 Skill 版本不同，也不覆盖或降级。核心文件继续受哈希保护。
- `lib/github/`、`apps/workbench/updates.js`：分页区分工作台与 Skill 的正式 Release，不依赖仓库 latest。检查使用短总预算，失败不声称最新；较新批次损坏时明确报告检查不完整。下载限流后保留冷却时间，不能通过再次检查提前发请求。
- `apps/workbench/skill-installation-ui.js`、`main.js`、`scripts/agent-skills/install.mjs`：页面与 CLI 共用安装/更新服务，显示实际安装版本、可用版本、说明、兼容状态、失败结果和恢复入口；稳定链接继续指向插件 `skills/<名称>`，两个宿主共用磁盘版本。
- `scripts/agent-skills/{build-release,assemble-release,publish-release}.mjs`、`.github/workflows/skill-releases.yml`：本地构建不联网；联合发布先构建 Skill 清单与选中包，再由同一清单组装工作台三个附件。手动工作流串行执行，固定提交，将适用的全部附件上传同一草稿，下载核验、复查基线后一次公开。仅 Skill 发布 `make_latest: false`，联合发布 `true`。未知写入结果先查同一资源，不盲目重发。发布请求共用总预算和持久冷却记录；工作流缓存及 Artifact 保存截止时间。缓存丢失或跨分支续跑需要按文档核对上次证据。
- `scripts/workbench/build.mjs`：默认标记开发候选；正式装配从给定清单和固定附件生成，在线更新器拒绝仍带开发 Skill 来源的核心包。
- Git/FNS 隔离与运行目录继续复用原机制。未配置且未运行 FNS 时不阻止 Skill 更新；独立包和恢复资料位于已有插件排除范围。安装、发现注册、规则接入与业务初始化保持各自的显式入口。

术语、决策和维护入口已同步至 `GLOSSARY.md`、[ADR 0006](../../docs/adr/0006-independent-skill-releases.md)、[Skill 发布说明](../../docs/workbench/skill-releases.md)、安装/更新/开发说明、软件位置规则、Git 发布规则和发布设计文档场景。Skill 普通升版不再要求工作台机械升版。新选择规则正文位于 `docs/agents/git-access-commit-and-release.md` 的“发布范围与 Tag 选择”；根 `AGENTS.md` 入口现覆盖准备工作台或 Skill 发布，`CLAUDE.md` 继续导入同一入口。联合发布记录合写在所选工作台 Tag 下。

## 验收结果

本机环境：Windows 原生，Node.js `24.21.0`，Obsidian `1.14.5`，Codex CLI `0.165.0`，Claude Code `2.1.312`。宿主均沿用已配置的默认模型，未覆盖模型或降低宿主隔离条件。

| 层级 | 入口与结果 |
| --- | --- |
| 全量工程测试 | 最终 `npm test`：321 项，314 通过、7 跳过、0 失败。7 项是原有需外部 FNS bundle 的可选集成测试；最新日志 `tmp/skill-versioned-releases/npm-test-combined-final.log`。 |
| 联合发布针对测试 | 清单、发布协议、Skill 更新和工作台更新共 31 项通过，覆盖联合/独立/联合继承、错误顺序和分叉、同一草稿全部附件核验、Latest 分流以及两种更新器从同一 Release 升级。 |
| 发布/安装回归 | 覆盖选中多项和未选项继承、跨批次、缺附件/不完整清单、重复版本异内容、草稿上传不明后核对、发布基线争用；覆盖两种升级顺序、独立版本保留、旧无版本迁移、双宿主入口、未注册/冲突、用户文件、故障回退及进程在两处切换点退出。 |
| 网络/保护回归 | 覆盖分页、草稿/预发布过滤、总预算、秒和 HTTP 日期形式的完整冷却、持久冷却恢复、写入不重放、重定向不转发凭据、下载校验与不兼容版本。 |
| 构建 | `npm run build` 成功；以 `--batch v0.26.0` 一次构建五项包、完整清单和三个工作台附件成功，共 1803 个受管文件。ZIP 1804 项，Python `zipfile.testzip()` 无损坏项并包含中文路径。此处是发布流程的本地候选，不是已取得正式 Release 的证据。 |
| 最终包安装及工具 | 联合候选安装到忽略目录下的 `combined acceptance vault jaDC02`；双宿主注册后五项均为 v1.0.0，两个真实更新服务均识别合成远端的同一联合 Release。逐个执行各自 runtime 的真实 `write.mjs --vault <隔离库>` 只读 `info` 调用成功。此前完整路径及主要入口 `--help` 检查保留原证据。 |
| 实际发现与调用 | 在 `acceptance vault` 显式注册两个宿主。Codex、Claude Code 的新会话实际调用 `tt-update-note`，均提示 v1.0.0，读取合成笔记与目标库规则并给出正确预览。通过生产更新服务安装仅用于验收的合成 v1.0.1 后，再开两个新会话，均提示 v1.0.1 并完成相同预览；原笔记未写入。 |
| Obsidian 实际页面 | 打开真实 Skill 安装命令，页面显示五项已安装 v1.0.0。独立更新后点击“重新检查”，仅 `tt-update-note` 显示 v1.0.1，其余四项仍为 v1.0.0，与两个新会话一致。核对未配置发布仓库提示及窄/宽窗口布局。 |
| 补充 GUI 场景 | 经用户授权新建 Ego 空间 26，仅访问回环测试服务。独立页面加载生产 `SkillInstallationUI` 和 CSS，连接真实管理/更新/恢复模块及合成发布数据。实际点击更新至 v1.0.1 成功；不兼容项显示所需工作台版本且不提供更新按钮；查询失败保留安装版本、不显示“已是最新”；模拟磁盘切换失败后点击恢复，tt-capture 回到 v1.0.0，已更新的 tt-update-note 保持 v1.0.1，两个宿主入口均有效。 |
| tannt 日常安装 | 保持 v0.25.1。重新取得官方 `v0.25.1/release.json`，8 个 Skill 相关安装文件全部匹配。直接 HTTPS 请求超时后，通过已存在的本机代理只读下载成功；未改变代理配置或安装内容。 |

宿主提示、正文预览和加载路径的原始证据为 `codex-before/after.jsonl`、`claude-before/after.jsonl`。Claude 的可选 Bash 读取被验收权限集拒绝后，使用允许的 Read 完成任务；不把该拒绝写成宿主调用失败。合成 v1.0.1 仅位于验收库，正式源码及本次候选五项均为 v1.0.0。

补充 GUI 验收发现中断条目会显示内部缺文件错误并被误标为“旧版资源”；已在生产页面改为“待恢复 / 更新未完成”，隐藏这时不成立的更新判断，复验恢复成功。截图与状态证据在 `gui-20261031/`，其中 `interrupted-final.png`、`recovered-final.png`、`query-failed-styled.png`、`incompatible-styled.png` 为修正后的关键画面。

本次 Tag 联动不改变已验证的 SKILL.md 正文、发现和调用流程，也不修改 GUI 控件；这些范围沿用此前实际宿主与 GUI 证据。新的发布和发现逻辑由新增回归覆盖，最终包工具由重新隔离安装覆盖。上述 GUI 证据、Obsidian 截图 `ui-installed.png`、更新后可访问性记录 `ui-after.txt` 与旧 `delivery-verification-final.json` 均位于 `tmp/skill-versioned-releases/`，联合候选最新证据为 `combined-verification.json`。

第一次联合版本全量测试有 1 项原有运行目录恢复用例失败：`hard exit after pointer commit resumes with fixed gate and refuses foreign backup` 报 `RUNTIME_BUSY`（迁移进程仍在运行），日志 `npm-test-combined.log`。该组单独复验 8 项通过（`runtime-location-recheck.log`），之后完整 `npm test` 重跑通过；本轮未修改运行目录迁移模块，未将一次复验通过宣称为该偶发原因已修复。

## 最终候选产物

最终产物统一位于 `tmp/skill-versioned-releases/combined-v0.26.0/`，包含同一 Release 所需的九个附件。前序 `artifacts-final/`、`batch-delivery/`、`artifacts/`、`artifacts-delivery/` 和 `batch-candidate/` 保留为旧拆分方案的过程证据，不作为最终发布输入。早期无 `sequence` 的本地清单已被替代，没有正式发布兼容迁移。

| 文件 | SHA-256 |
| --- | --- |
| `release.json` | `4e28217aeebf453cdf2393a36e4dd71e9e92780895acbe7fe40d7989ec0d0094` |
| `tt-workbench.bundle.json.gz` | `f6d9fe85ec67ec8854b083f6c431c3fc0e1a7500be44d9b029c02997f6ce84cc` |
| `tt-workbench.zip` | `d2298f11a2c5b6fa94a154ee9ca22a93a4af0134fdfa205604ed22ed459589dc` |
| `skills-release.json` | `3d887970d96a58df9df0e985dffd5462aeefd4d8b09276bce3e0d426b21f850f` |

清单登记了五项的版本、固定附件名称、大小、包摘要与完整内容摘要。上述摘要是提交前本机候选的历史证据；正式提交经过 LF 规范化，CI 使用 Node.js 22 构建，最终公开附件的摘要见末节，不能混用候选压缩字节与正式附件。

## 目标库文档与跨设备入口

已使用 tannt 自己的 `AGENTS.md`、业务规则及已安装的 `tt-capture` / `tt-update-note` 流程，局部维护以下内容，保留已有属性、ID、创建时间和无关段落：

- 本次记录统一到 `1.项目/仓库设计/版本记录/v0.26.0.md`，包含工作台与五项 Skill 版本。原 `版本记录/skills-20261031.1.md` 已标记“已并入 v0.26.0，未发布”，保留历史依据；该“未发布”仅指已取消的拆分 Tag，版本索引登记实际发布的 v0.26.0。
- 更新 `Skill/内置Skill.md`、`工作台功能/系统与集成.md`、`设计与灵感/讨论索引.md`、`版本记录/版本索引.md`。
- 更新目标库 `docs/agents/workbench-tools.md`，区分完整插件根与独立 Skill 的 runtime，说明新会话实际加载核验。沿用原有 Agent 入口，不另建重复规则源。

上述相对路径以 tannt 的项目根或已指明的「仓库设计」目录为基准。此前 57 个链接检查及 `knowledge-docs.json` 保留历史证据；本轮六份记录的修改前后摘要见 `combined-knowledge-docs.json`，最新入口和本地链接检查见 `combined-verification.json`。未写真实业务任务或远端服务。

其他设备根目录可以不同，须保持源码根 `AGENTS.md` → `docs/agents/git-access-commit-and-release.md` / `release-knowledge-docs.md`、目标库 `docs/agents/workbench-tools.md`、插件 `skills/<名称>/runtime/`、Codex `.agents/skills/<名称>` 与 Claude `.claude/skills/<名称>` 的引用关系；不能把 Windows 绝对路径复制为跨设备约定。本轮规则验证为本机文本和路径检查，未新开宿主验证发布场景选择，也未验证其他设备到达。

## 验证限制与收尾

- GitHub Actions、同一草稿上传与公开、远端附件回读均已执行通过。真实 CI 执行了冷却缓存恢复／保存步骤；本次没有触发发布限流，跨 Runner 恢复一个尚未结束的冷却窗口仍只有合成测试证据。
- 真实 Obsidian 验证安装版本和刷新结果；更新按钮、说明、查询失败、兼容不足及中断恢复在独立 GUI 夹具完成。该夹具提供轻量 Obsidian DOM 适配，不能代表真实 Obsidian 的全部外围集成和弹窗。DevTools 粘贴保护未绕过；原 Ego 空间 25 消失后，先完成独立工作并取得用户明确授权，再新建空间 26 补验，最后 `finish({keep: []})` 成功，未保留页面。
- 实际新会话验收覆盖 `tt-update-note`；其余四项完成包结构、引用、工具及注册检查，没有分别执行真实业务或隐式触发反例。旧 Agent 会话可能缓存旧指令，未声称已自动切换。
- 本机 GUI、安装及宿主验证在 Windows 执行，CI 在 Linux / Node.js 22 执行工程测试和发布。macOS/Linux 图形客户端、其他宿主和其他设备未实测；Linux CI 不代表这些用户入口已经通过。
- 本机限流/恢复回归通过不意味着忽略锁的第三方程序也被互斥约束；安装与发布保护范围遵守正式文档。
- 本次验收服务只监听回环地址，已停止。隔离库与日志保留在已忽略的 `tmp/skill-versioned-releases/`，不发布到软件仓库；未删除其他会话资源。

用户已授权提交、推送和公开发布 `v0.26.0` 的一个联合 Release 和五项独立 1.0.0；本次授权不包含 tannt 正式升级。发布前已用本仓唯一 Token 核验账号 `cookaihq`、远端 main 与上述基线相同，当时最新正式版为 `v0.25.2`，没有本次同名 Tag 或 Release。Git 直连 TLS 失败后按项目规则使用既有本机代理，未改变持久网络配置。已通过手动工作流在同一草稿上传并核验全部附件、一次公开；证据保存在 `tmp/release/v0.26.0/`。没有创建 `skills-20261031.1`，也未将开发试装写成 tannt 已采用正式版。

## 发布执行记录

- 已将明确审阅的 49 个文件提交为 `24cb94145704ca43617534bae66c00d038c5a023`，保持 `main`；接手前两份独立开发记录留在工作区。新引用的全部可达历史审查覆盖 734 个 blob、5,182,497 字节，无跳过和已知秘密／大文件发现；该扫描不证明不存在全部秘密。
- 从固定提交导出 452 个文件，逐项核对 Git blob 字节及完整路径集合。Windows 自带 tar 最初把部分中文模板名解码错误，那个导出及产物已标记废弃；重新在空目录用 Python tarfile 解包后，文件集合与提交完全相同。没有修改正式源码来适配这一工具问题。
- 固定提交的有效构建为 `tmp/release/v0.26.0/artifacts-committed/`，共九个附件、1803 个受管文件。与此前已测试候选的路径集合完全一致，实际文本变化仅来自 Git 的 LF 规范化及派生 Skill 清单摘要。重新完成隔离安装、双宿主注册、两个更新服务识别及五项 runtime 只读命令；证据为 `source-exact-verification.json`、`candidate-comparison.json` 和 `committed-install-verification.json`。
- 首次推送因项目 Token 缺少工作流写权限被 GitHub 拒绝；用户补齐后成功推送 `24cb941` 并回读。首次 dispatch 又被明确报告缺少 `actions=write`；用户补齐同一 Token 的 Actions 权限后启动成功，没有改用其他凭据。GitHub dispatch 不接受完整 SHA 作为 ref，改用已核验指向目标提交的 `main`，并核对实际运行的 `head_sha`；工作流 checkout 仍固定 `github.sha`。失败证据保留在 `push-diagnostic.json`、`last-api-failure.json` 与首轮记录中。
- 首轮 [CI 41176649543](https://github.com/cookaihq/tt-workbench/actions/runs/41176649543) 在测试阶段停止，未执行发布。旧 FNS CLI 测试在 Linux 上要求 Windows/macOS 稳定身份，313 项通过、1 项失败、7 项跳过。提交 `4e26ba1` 仅修正该测试：支持的平台继续验证正常流程，其余平台断言明确拒绝并保留配置。本机相关 11 项通过，生产 FNS 行为未改变；最终提交的九个附件与前一个提交的本机构建逐字节一致。
- 最终 [CI 41177108137](https://github.com/cookaihq/tt-workbench/actions/runs/41177108137) 在 Linux / Node.js 22 上运行 321 项测试，314 通过、7 项原有可选 FNS 测试跳过、0 失败。随后完成构建、草稿全部附件上传与下载核验、公开、正式附件回读；发布 Tag 为 `v0.26.0`，提交 `4e26ba17a3315f33ee28d94a58d17a5bf4fcc5f3`，Release ID 为 `429766401`，已核验为 Latest。完整 job 日志已保存；CI Artifact 保留在 GitHub，额外下载该归档两次超时，本机另存了所有九个正式 Release 附件。
- 公开下载九个附件均核对大小和 GitHub SHA-256 digest，清单序号 1、五项 1.0.0、包内内容和固定提交一致。ZIP 1804 项逐文件与更新包完全一致，未发现损坏。Node.js 22 / 24 压缩字节不同，未将不同 gzip 摘要误判为 Skill 内容改变；包内 manifest、内容摘要与文件字节一致。
- 正式下载包在隔离库再次安装，双宿主入口、五项版本及五项 runtime 只读命令通过。匿名 API 查询触发 GitHub 限流，两个生产更新器保持当前资源并提示冷却至 2026-10-31 15:07:49（Asia/Shanghai）；没有提前重试。另通过本仓授权 Token 的临时请求适配器读取真实 GitHub，两个生产更新服务分别识别工作台 0.26.0 与同一 Release 的完整 Skill 清单。这不等于匿名查询已恢复，也没有向产品添加个人凭据。
- tannt 六份仓库设计文档已补齐正式版本、发布日期、提交、链接、文档对应和实际验证范围，原 YAML、ID、创建时间保留；证据 `published-knowledge-docs.json`。日常安装仍为 0.25.1，未升级或改写其 Skill 资源。
- 没有创建发布分支或 Worktree。清理本次 `source/`、`source-exact/`、`source-final/` 三个临时源码导出目录时，自动执行策略返回 `blocked by policy`，未给出更具体原因；未执行删除，目录保留在已忽略的 `tmp/release/v0.26.0/`。两个有效导出重新核对与对应提交完全一致；最初的 Windows tar 错误导出保留为废弃过程材料，不用作发布输入。产物、日志和校验记录均在这些导出目录之外。

| 正式附件 | SHA-256 |
| --- | --- |
| `release.json` | `fa2d677c59fd69ef8130553c962da62038be765a3567f8a95dbb39f47e6fc75b` |
| `tt-workbench.bundle.json.gz` | `9d1c96a93aa940912d58c3449bdb0ece2d53474c90d00be9e0c4f46079fcbd2b` |
| `tt-workbench.zip` | `1524900379d7c73259f36716196cc3b4cebfb9740f34cc71e46af400477d69c8` |
| `skills-release.json` | `d73938266521ab925b92af5baa39908e40d77703c1926e3e394e6a785d873036` |

所有九项摘要见 `published-release.json`；CI 证据见 `ci-verification.json` / `ci-final-job.log`，正式安装及联网验证见 `published-install-verification.json`，ZIP 字节核验见 `published-zip-verification.json`，临时目录保留状态见 `cleanup-status.json`。发布收尾记录另行提交到 main，正式 Tag 保持指向上述发布源码提交。
