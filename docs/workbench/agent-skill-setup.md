# Skill 安装与使用

工作台「系统 → Skill 安装」采用列表与详情并排的 A 页面。页面显示当前知识库的名称及绝对路径，选择 Codex 或 Claude Code 后可安装单项或全部未安装项。清单、中文用途、示例与后续指引来自 `skills/manifest.jsonc`；资源版本跟随插件更新。

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

Codex 使用 `<库>/.agents/skills/<名称>`，Claude Code 使用 `<库>/.claude/skills/<名称>`，相对链接指向当前库安装插件的 `skills/<名称>`。自定义 Obsidian 配置目录由当前插件提供；CLI 使用安装副本并显式传 `--vault` 和适用的 `--config-dir`，不依赖开发检出或 Obsidian 进程。

```text
node "<插件目录>/scripts/agent-skills/install.mjs" --vault "<库绝对路径>" --agent codex --check
node "<插件目录>/scripts/agent-skills/install.mjs" --vault "<库绝对路径>" --agent codex --skill tannt-capture
node "<插件目录>/scripts/agent-skills/install.mjs" --vault "<库绝对路径>" --agent claude
node "<插件目录>/scripts/agent-skills/install.mjs" --vault "<库绝对路径>" --agent codex --action repair --skill tannt-capture
node "<插件目录>/scripts/agent-skills/install.mjs" --vault "<库绝对路径>" --agent codex --action remove --skill tannt-capture
```

`--agent all` 明确处理两宿主；重复 `--skill` 可选多项，省略时安装活动清单。修复和移除必须指定名称。旧源迁接使用 `--action repair --skill <名称> --migrate-from "<已核实旧 skills 绝对目录>"`；该参数是操作者对具体旧来源的确认，不能用于任意覆盖。退役名称仅记录历史，普通安装不会清理清单外入口。

`--check` 与 `--help` 只读。结果为逐宿主、逐项 JSON；有失败或跳过时退出码为 1，检查时只有所选项目全部已安装才为 0。检查结果另列 Git/FNS 隔离状态，已安装不等于允许下一次写入。

## 本机隔离与失败恢复

发现入口和 `apps/workbench/data/agent-skills/` 属于设备本地接入。创建前检查目标库的 Git 忽略及已跟踪文件；有 FNS 配置时验证对应发现目录和运行记录的明确排除，白名单不能覆盖。页面还核对当前运行 FNS 的设置。缺项时展示原因，用户在各自流程修正；安装不改 Git/FNS 配置。其他设备分别注册入口，不能同步本机链接代替安装。

共享模块使用本机操作锁协调 CLI 与 UI，以入口身份、链接目标、资源内容和页面令牌识别变化。新建链接使用独占创建；移除／修复先暂存并核验旧入口，遇到并发新内容时保留双方。恢复记录保存在现有运行目录，不改变运行目录归属。外部编辑器、Git 和 FNS 不参与该锁，反复检查不能保证全局原子事务。

操作记录失败与入口状态分开报告。已建立且读回正确的入口可能显示已安装，同时结果仍为失败，提示记录尚未完整保存；后续项重新读取磁盘记录，不沿用失败的内存修改。操作被中断时先核对 `operation.lock` 的进程、对应 JSON 记录及 `.link` 恢复材料；确认原进程退出且现场去向清楚后人工恢复，再移除遗留锁。不要直接删恢复目录，也不要把已有普通内容当作工作台入口。

## 安装后

在目标知识库根新开宿主会话，核对宿主列出的 Skill，再提供真实目标和内容调用。读取文件不等于宿主标准发现。网盘账号按 Skill 流程单独配置；配置检查使用当前库自己的清单；个人规则由用户选择的规则仓库维护，在「Agent 规则」页面核对来源和入口后再处理。

更新插件保留已有发现入口，新 Skill 仍需显式安装。资源缺失时显示检查失败；先恢复完整插件资源再检查。实现与本机验收范围见[功能记录](../../.scratch/workbench-skill-installation/implementation.md)。
