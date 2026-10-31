# Skill 安装与使用

本文中的 `<运行目录>` 按[本机运行记录](../rules/writing-and-changes.md#本机运行记录)解析，默认 `.system/.workbench-runtime/`；自定义位置从所属实例的 `.system/workbench/runtime.jsonc` 读取。

工作台「系统 → Skill 安装」采用列表与详情并排的 A 页面。页面显示当前知识库的名称及绝对路径，选择 Codex 或 Claude Code 后可安装单项或全部未安装项。清单、中文用途、示例与后续指引来自 `skills/manifest.jsonc`；各 Skill 有自己的独立版本，页面从实际安装的 `SKILL.md` 元数据读取。

点击「检查 Skill 更新」查询正式完整清单，查看各项可用版本、更新说明及兼容要求，再点击对应「更新至 v…」。两个已注册宿主共用同一安装包；更新未注册资源不会擅自注册入口。查询失败保留当前资源并显示未能确定结果，不显示“最新”。发布仓库沿用工作台版本设置。

## 状态与操作

首次打开及「重新检查」只读取。已安装表示本机发现入口直接指向当前插件资源且 `SKILL.md` 可读；宿主是否发现、是否实际执行及服务是否配置要分别核验。

| 状态 | 操作 |
| --- | --- |
| 未安装 | 安装到所选宿主 |
| 已安装 | 查看使用说明；确认宿主、名称和路径后移除 |
| 入口损坏 | 安装记录或本次明确指定的旧源证明归属时单独修复 |
| 同名冲突 | 保留普通文件、目录与陌生链接，处理后重新检查 |
| 检查失败 | 展示具体原因，禁止依赖该结果的写操作 |

批量安装仅处理未安装项；存在损坏、冲突或读取错误时先展示计划，由用户选择安装其余项。每项分别报告成功、保持、失败或跳过，并重新读取实际状态。修复不混入普通安装。移除只处理重新核实的所选入口，保留内置资源、笔记、服务配置、其他宿主和全局规则。

## 位置与独立 CLI

在工作台页面管理 Skill 无需单独安装 Node.js；通过外部 Agent 或终端运行下面的安装器及配套文件工具时，需要 Node.js 22 或更新版本。

Codex 使用 `<库>/.agents/skills/<名称>`，Claude Code 使用 `<库>/.claude/skills/<名称>`，相对链接指向当前库安装插件的 `skills/<名称>`。自定义 Obsidian 配置目录由当前插件提供；CLI 使用安装副本并显式传 `--vault` 和适用的 `--config-dir`，不依赖开发检出或 Obsidian 进程。

该 Skill 目录中的 `runtime/` 包含其确定版本的工具与参考文档。调用时按 SKILL.md 的路径规则定位，向用户提示“正在使用 <名称> v<版本>”；同一版本号仅在 SKILL.md 中人工维护，包清单和页面均由它生成或读取。

```text
node "<插件目录>/scripts/agent-skills/install.mjs" --vault "<库绝对路径>" --agent codex --check
node "<插件目录>/scripts/agent-skills/install.mjs" --vault "<库绝对路径>" --agent codex --skill tt-capture
node "<插件目录>/scripts/agent-skills/install.mjs" --vault "<库绝对路径>" --agent claude
node "<插件目录>/scripts/agent-skills/install.mjs" --vault "<库绝对路径>" --agent codex --action repair --skill tt-capture
node "<插件目录>/scripts/agent-skills/install.mjs" --vault "<库绝对路径>" --agent codex --action remove --skill tt-capture
node "<插件目录>/scripts/agent-skills/install.mjs" --vault "<库绝对路径>" --agent codex --check-updates
node "<插件目录>/scripts/agent-skills/install.mjs" --vault "<库绝对路径>" --agent codex --action update --skill tt-capture
```

`--agent all` 明确处理两宿主；重复 `--skill` 可选多项，省略时安装活动清单。修复和移除必须指定名称。旧源迁接使用 `--action repair --skill <名称> --migrate-from "<已核实旧 skills 绝对目录>"`；该参数是操作者对具体旧来源的确认，不能用于任意覆盖。退役名称仅记录历史，普通安装不会清理清单外入口。

`--check` 与 `--help` 只读。结果为逐宿主、逐项 JSON；有失败或跳过时退出码为 1，检查时只有所选项目全部已安装才为 0。检查结果另列 Git/FNS 隔离状态，已安装不等于允许下一次写入。

`--check-updates` 也只读，可用 `--repository owner/repo` 明确仓库，否则读取工作台设置。更新选择单个检查宿主并明确 `--skill`，磁盘包仍由两宿主共用。更新前核验插件、恢复目录及安装锁的本机隔离，安装器不自动改 Git/FNS 配置。

## 旧前缀迁移

五个活动 Skill 使用 `tt-` 前缀。`skills/manifest.jsonc` 的 `renamedFrom` 记录原 `tannt-` 名称；旧名称保留为迁移依据，不作为活动 Skill 分发。

扫描发现已登记的旧链接时显示待修复，页面提供「迁移为新名称」。选择新名称执行修复，先核验旧入口与当前资源，建立并读回新入口，再更新安装记录并移除已核实的旧链接。新入口已正确安装时可单独完成旧链接清理；普通安装会跳过待迁移项。

```text
node "<插件目录>/scripts/agent-skills/install.mjs" --vault "<库绝对路径>" --agent codex --action repair --skill tt-capture
```

缺少安装记录时先核实旧链接实际指向的 `skills` 绝对目录，再追加 `--migrate-from "<旧 skills 绝对目录>"`，包括插件改名前的位置；目录已迁走时仍使用链接记录的原路径。普通文件、目录和未知来源链接会保留并显示冲突。Codex 与 Claude Code 分别迁移，完成后从目标库根目录新开会话核对 `tt-` Skill 列表。

## 本机隔离与失败恢复

发现入口和 `<运行目录>/agent-skills/` 属于设备本地接入。创建前检查目标库的 Git 忽略及已跟踪文件；有 FNS 配置时验证对应发现目录和运行记录的明确排除，白名单不能覆盖。页面还核对当前运行 FNS 的设置。缺项时展示原因，用户在各自流程修正；安装不改 Git/FNS 配置。其他设备分别注册入口，不能同步本机链接代替安装。

共享模块使用本机操作锁协调 CLI 与 UI，以入口身份、链接目标、资源内容和页面令牌识别变化。新建链接使用独占创建；移除／修复先暂存并核验旧入口，遇到并发新内容时保留双方。恢复记录保存在现有运行目录，不改变运行目录归属。外部编辑器、Git 和 FNS 不参与该锁，反复检查不能保证全局原子事务。

操作记录失败与入口状态分开报告。已建立且读回正确的入口可能显示已安装，同时结果仍为失败，提示记录尚未完整保存；后续项重新读取磁盘记录，不沿用失败的内存修改。操作被中断时先核对 `operation.lock` 的进程、对应 JSON 记录及 `.link` 恢复材料；确认原进程退出且现场去向清楚后人工恢复，再移除遗留锁。不要直接删恢复目录，也不要把已有普通内容当作工作台入口。

## 安装后

在目标知识库根新开宿主会话，核对宿主列出的 Skill，再提供真实目标和内容调用。读取文件不等于宿主标准发现。网盘账号按 Skill 流程单独配置；配置检查使用当前库自己的清单；个人规则由用户选择的规则仓库维护，在「Agent 规则」页面核对来源和入口后再处理。

五个 Skill 都先执行[目标库规则读取](../agents/package-layout.md#目标库规则读取)：从发现链接解析软件工具位置，沿目标库实际 Agent 入口读取本次业务／场景正文。目标库可独立维护自己的规则；同名软件文档不自动覆盖它。缺项或工具能力冲突时先说明，安装或注册成功不等于规则已被宿主加载。

更新插件保留已有发现入口，新 Skill 仍需显式安装。资源缺失时显示检查失败；先恢复完整插件资源再检查。实现与本机验收范围见[功能记录](../../.scratch/workbench-skill-installation/implementation.md)。

采用独立版本后，更新工作台会核验并保留已经安装的 Skill，不用工作台附带版本覆盖或降级。旧无版本安装第一次升级时，先按原发布清单核验，再采用新版工作台附带的初始独立包。新会话中的调用提示应与页面已安装版本一致；旧会话可能保留旧指令，需要重新加载或新开会话。

Skill 下载或普通替换失败保留/恢复此前可用版本。若进程在切换中退出，页面显示「恢复上次更新」，原进程退出后可核验回退；CLI 用 `--recover <操作标识> --agent codex`，明确接续新版则追加 `--finish-update`。恢复材料位于插件恢复目录 `tt-workbench-recovery/skill-<操作标识>/`。外部变化或活跃进程会阻止覆盖，保留具体材料供核对；不要求用户删除锁或恢复目录。发布和包管理契约见 [Skill 版本与发布](skill-releases.md)。
