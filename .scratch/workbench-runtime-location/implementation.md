# 可配置运行数据位置实施记录

2026-10-29，现有 `feat/skill-installation` 检出；需求见 [spec.md](spec.md)。本任务未创建分支、Worktree 或会话，未提交、推送或发布。

## 软件实现

- 默认位置改为所属实例根下 `.system/.workbench-runtime/`。位置配置固定在 `.system/workbench/runtime.jsonc`，保留 JSONC 注释和未知字段，不依赖 Obsidian 的 `data.json`。
- 工作台顶部和命令面板提供「运行数据位置」：选择知识库或实际 developmentRoot、查看绝对位置、预览、迁移并保存、恢复默认、续做或恢复。输入相对于选定实例根；拒绝越界、链接、特殊文件及业务/软件/配置目录重叠。
- `lib/runtime/storage.cjs` 为工作台、独立 CLI 和 Skill 工具提供同一解析和写入租约；已打开的使用方每次读取当前设置。Issue 记录继续属于实际 developmentRoot。
- 迁移使用固定协调目录、源目标锁、模块锁与租约；外部独立备份，SHA-256 核验后清理源并提交位置。失败保留 journal，阻止继续写入；续做/恢复核验原实例、进程、备份及后续变化。历史回执保持原字节，已知恢复路径通过位置历史解析。
- 旧 `.workbench-runtime/` 和 `apps/workbench/data/` 显式迁移；安装、升级与只读检查不隐式迁移。新旧运行路径及位置配置分别排除 Git/FNS，不排除整个 `.system/`。
- 先更新写入规则，再同步文件操作、FNS、Issue、Skill、安装说明。模板没有运行路径，无需修改。补正隐藏项审计说明的命令参数顺序。
- 保留并行会话的 `tt` 改名、Git 接入、README 等修改。最终软件版本为 0.25.0，完整包 332 个文件。

## 自动验证

- `npm test`：249/249 通过，无失败或跳过。通过 `TEST_FNS_BUNDLE` 使用目标实例的 FNS 2.4.0 扫描器验证；日志 `tmp/runtime-location/full-tests-final.log`。
- 运行目录定向测试 20/20 通过，涵盖默认/自定义、多实例、旧历史、租约、目标冲突、陈旧预览、复制/清理失败、进程硬退出、继续/恢复、JSONC 和 Git/FNS 隔离。
- 完整包实际安装后由安装副本 CLI 迁移并恢复默认，历史请求仍复用；补充验证后 location 测试 8/8 通过，日志 `tmp/runtime-location/installed-migration-final.log`。
- `npm run build` 通过；`node --check lib/fns/sync.cjs` 通过。全套测试后的生产修改仅将 FNS 错误中的旧固定目录改为实际目录。
- `git diff --check` 通过；最终压缩包与当前源码逐文件 SHA-256 一致。`dist/release.json`：`0cfcbea697e4a55a587d9052b697e87a3905b54514500ff4bccaf30038301c8d`；`dist/tt-workbench.bundle.json.gz`：`085ce33a36475ffcd19fec5bd32382ee22fba8b0dda4dfd26e50b8f2306f1215`。
- 业务笔记未用作写入夹具；合成写入与冲突/中断验证位于源码忽略目录 `tmp/`。

## 实际实例与界面验收

2026-10-29，用户明确授权「升级迁移」后，已在既有知识库 `D:/zhao/tannt_vault/tannt` 完成安装、迁移和 Obsidian 1.14.5 原生验收。

- 将旧 `tannt-workbench` 0.24.0 显式迁接为 `tt-workbench` 0.25.0，启用新插件并清理启用列表中的旧 ID。重启后仍正常加载；原插件 `data.json` 与升级前逐字节一致。
- 本次部署包含 334 个受管理文件，逐文件 SHA-256 核验通过；固定包 SHA-256 为 `ac04ac684457e5023753c923a9293e2e0f177a77f38fd90abb8f74d17bc3cc7b`。包保存在下述升级备份目录的 `installed.bundle.json.gz`，最终安装器 `--check` 返回 `ok: true, changed: false`。本节为实际部署证据；上节 332 文件及构建哈希保留为实现阶段历史。
- 停止 Obsidian/FNS 后，使用安装副本的迁移协议，将知识库 9 份和实际开发仓库 `D:/zhao/tt-workbench` 的 36 份历史运行文件分别迁至各自 `.system/.workbench-runtime/`。原始字节、迁移备份和目标的 SHA-256 全部一致；两个实例的检查均为 `ready`，旧运行目录未再出现。
- 两个实例均生成 `.system/workbench/runtime.jsonc`，记录默认位置及旧路径历史。Git 忽略覆盖新旧运行目录与位置配置；知识库 FNS 仅修改 `syncExcludeFolders`，追加实际运行目录、位置配置、新插件与恢复目录、两个 Skill 发现目录的必要排除。重启后页面确认「已设置 · 已生效」，并明确当前运行 FNS 已加载这些排除。
- Codex 与 Claude Code 各 5 个发现链接迁为 `tt-` 名称，10/10 成功；安装副本 CLI 与原生页面均确认 5/5 已安装及资源可读，Git/FNS 隔离检查通过。Codex 新进程的标准发现结果已验证；Claude Code 验证到发现链接和页面状态，尚未运行新宿主会话的实际 Skill 调用。
- 原生界面显示当前运行 v0.25.0；「运行数据位置」弹窗在重启后显示知识库的实际新路径及可编辑相对目录。安装副本独立 CLI `info`、当前进程连接服务的只读 `info` 均成功。实际知识库未用作业务写入测试。
- 升级初始 384 份备份文件全部复核通过。安装器生成的两份恢复目录共 665 个文件已核验后移入统一升级备份目录 `installer-recovery/`；原有其他恢复目录保留。
- 重启验收观察到已退出 Obsidian 进程的租约残留；逐条核对 PID、原字节和备份后归档清理，最终仅保留当前活跃进程的租约。退出时异步清理的时序尚未修复；后续迁移遇到残留仍按协议核对进程与恢复材料，不能直接抢占。

隐藏项检查使用本次创建前基线：新增 `.system/` 在检查时包含 25 个文件，其中运行目录 24 个、位置配置 1 个，均按已明确的本机运行用途精确排除，没有排除整个 `.system/`。其他既存未完整纳入项共 4 个目录和 1 个独立隐藏文件：`.git/` 228 个文件未纳入、`.credentials/` 1 个文件已排除、`.agents/` 与 `.claude/` 各 0 个普通文件及 5 个链接（扫描器不跟随链接，两个 Skill 子目录的排除已独立核验）、`.gitignore` 1 个文件未纳入。审计因链接跳过而不完整，并保留既存 `.env` 登记目标不存在的提示；没有据此修改其他内容的同步策略。

详细本机证据保存在升级备份目录：`deployment-verification.json`、`skill-final-check.json`、`codex-discovery.json`、`hidden-audit.json`、两个 `runtime-*/manifest.json`、`native-*.txt` 与 `finalization-report.json`。本次部署未修改软件生产源码，因此沿用实现阶段自动测试，并执行安装哈希、数据完整性、入口和原生界面的定向验证。

## 备份与范围

统一备份目录：`D:/zhao/tmp/workbench-runtime-location-20261029095000`。`source-before/` 保存实现前的相关现存源码和旧运行实现。包含配置的实例备份仅保留在本机，不进入公开源码或输出。

本次实际升级、实例迁移及部署记录的统一备份目录：`D:/zhao/tmp/tt-workbench-upgrade-20261029-114809`。其中 `runtime-vault/` 与 `runtime-development/` 为 schema 2 迁移备份，`installer-recovery/` 为核验后的安装恢复副本，`implementation-before-deployment.md` 保留本记录更新前版本。

仅验证 Windows 本机；未验证其他设备、手机或真实双设备同步。旧 schema 1 迁移备份按原版本工具核对；本版续做/恢复使用 schema 2。

## 0.25.1：退出清理与启动顺序补正

2026-10-29，用户回复「继续」后处理前述租约残留。开始时源码已在干净的 `main`，基准提交 `9c70193539753a7b348a6ab0af268705565dc426`；本次未创建分支或 Worktree，未提交、推送或发布。期间其他会话修改了 `.gitignore` 的 `.scratch/` 忽略项，该修改及既有开发记录均保留。

根因分三部分验证：同步宿主退出不等待原 `stop()` 的文件操作；实际 Obsidian 窗口退出未完成插件注册清理回调；工作台先于 FNS 加载时，原入口的一次检查会跳过连接服务。初始复现命令 `node tmp/bridge-shutdown/repro.cjs` 留下 1 条租约和连接文件；显式等待停止后消失，提前关闭 HTTP 服务仍不能消除未等待的文件操作。实际插件入口测试另外复现了依赖加载顺序及仅触发窗口卸载的场景。

- `lib/runtime/storage.cjs` 为连接服务提供少量同步标识读写，保留位置解析、迁移协调状态、旧目录、路径安全和原字节归属检查；普通 CLI 继续使用原异步租约。
- `AgentBridge` 在没有请求时同步移除自己的连接标识和租约；有请求时等待实际处理结束，包括客户端已断开但写入仍在进行的情况。重复启动、重复停止、启动中停止保持同一服务生命周期；外部替换的记录不会被删除。
- 插件同时登记自身卸载和窗口 `unload` 的停止入口；启动移至 `onLayoutReady`，并防止卸载后的延迟回调重新启动。迁移入口继续等待同一个 `stop()`，实际迁移后可在新位置重启连接服务。
- 活跃写入被强制终止时仍保留恢复标识；本修复不自动抢占历史残留租约。候选版本原生验收产生的残留已逐条确认 PID 退出、备份原字节后清理。
- 版本为 0.25.1，完整包 335 个受管理文件，包含当前主分支既有的打包、文档和界面改动。本次生产修改限于连接服务、插件生命周期入口、共享租约及两处版本号。业务规则、Skill、模板和业务笔记无需随此次生命周期修复改写。

最终验证：`npm test` 262/262 通过，无失败、跳过或取消；包含 12 项连接服务回归，使用实际安装包入口验证依赖就绪、卸载前的延迟回调、窗口退出、自定义路径、请求排空、记录被替换及迁移后重启。`TEST_FNS_BUNDLE` 使用目标实例的 FNS 2.4.0。`npm run build`、`git diff --check` 和源文件与固定安装包逐文件比较通过；最终包 SHA-256 为 `667ea7913f87b50cc07df7cb4ea9fcbe854c96bc1230334b0eea38d902f1595b`。

在真实 Obsidian 1.14.5 中完成两轮「启动 → 只读连接检查 → 正常关闭」：启动均自动建立连接，关闭后均为 0 条租约且没有连接文件。随后再次打开并保持工作台运行，只有当前活进程的 1 条租约。独立 CLI 与两宿主各 5 个 Skill 入口检查通过；335 个安装文件与固定包一致；本次升级前的 27 份历史运行文件、工作台 `data.json`、运行位置配置和启用列表均保持原字节。

FNS 在重启验收期间的配置差异仅为 `apiToken`、`autoRedirectEnabled`、`wsPreProbeEnabled`，未输出字段值，也未回写或回滚这些字段；本次安装及检查不修改 FNS 配置。原排除规则保持一致，运行数据及 Skill 目录隔离核验通过。不能把工作台设置的字节一致性扩大为 FNS 全文件一致。

本次备份及本机证据：`D:/zhao/tmp/tt-workbench-shutdown-20261029-164500`。`final.bundle.json.gz` 是最终实际安装包；`plugin-before/`、`runtime-before/`、`settings-before/` 和各安装恢复副本可回查升级前状态；`window-first-exit.json`、`window-second-exit.json`、`final-running.json`、`bridge-tests.log`、`full-tests-final.log` 记录最终结果。临时复现及部署辅助程序在源码忽略目录 `tmp/bridge-shutdown/`。本轮未改变知识库隐藏项同步策略，不重复上轮隐藏项审计。
