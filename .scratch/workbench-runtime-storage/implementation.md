# 工作台运行数据目录迁移实施记录

日期：2026-10-29（Asia/Shanghai）  
Issue：[workbench-runtime-storage#01](issues/01-迁移工作台运行数据并移除知识库根目录的apps.md)  
实施版本：0.24.0；基线：`c5976e1ab63778b4d0c9f4e743d988920cba5dd2`

工作台、独立 CLI 和 Skill 配套命令现共用 `<显式实例根>/.workbench-runtime/`。已在获准知识库 `D:/zhao/tannt_vault/tannt` 安装并加载 0.24.0，核验迁移 9 个历史文件，清理空的旧 `apps`，恢复工作台与 FNS 后未再出现旧目录。测试、安装包命令和 Windows 原生界面验收结果如下。

## 目录决定与状态归属

选择实例根下的 `.workbench-runtime/`，使运行记录独立于插件安装、更新替换及 Obsidian 配置目录。独立命令必须明确传入 `--vault <绝对路径>`；自定义 `configDir` 仅定位 Obsidian/FNS 配置，不改变所属实例的运行根，也不改变各入口共用锁的位置。

| 使用方 | 所属实例及目录 |
| --- | --- |
| 笔记、捕获、更新、附件及相关 Skill 命令 | 目标知识库；`vault-io/` 下的锁、请求回执、暂存与恢复记录 |
| 开发 Issue UI / CLI | 实际 `developmentRoot`；`issues/`。本机为工作台开发仓库，不写到业务知识库 |
| FNS 本机配置迁回 | 目标知识库；`fns-device-config/` |
| FNS 规则同步、说明草稿与应用恢复 | 目标知识库；`fns-sync/`；保留设备及 `configDir` 绑定检查 |
| 工作台代码排除调整、历史 FNS 环境修复 | 目标知识库；`workbench-code-sync/`、`fns-env-support/` |
| Skill 安装登记、操作恢复 | 目标知识库；`agent-skills/` |
| Agent bridge | 目标知识库；`agent-bridge.json` 与运行租约 |
| 以后按规则创建的飞书同步运行记录 | 对应知识库；`lark-wiki-sync/`；此次不移动既有飞书同步历史 |

`lib/runtime/storage.cjs` 统一解析目录、检查普通文件路径、阻止旧目录尚存时的新写入，并通过 `writers/` 租约与模块锁协调迁移。知识库运行记录不汇入软件仓库；开发仓库自己的 Issue 回执仍属于该项目，整个运行目录被 Git 忽略。

安装包继续禁止包含运行数据，安装/升级只操作插件目录；插件 `data.json` 和实例运行记录都保留。个人全局规则仍在知识库的 `docs/global-agent-instructions/`，未修改用户级主规则。云盘目标、Agent 配置清单及既有飞书同步历史未迁移。

## 可恢复迁移

实现为 `lib/runtime/migrate.cjs` 与 `scripts/workbench/runtime-storage.mjs`，操作说明见 [package-layout](../../docs/agents/package-layout.md#运行目录迁移)。

- `--check` 只读列出源、目标、哈希、未知项、锁、冲突及将退出的父目录，不创建运行目录或隐式迁移。
- `--apply` 要求刚读取的指纹、库外独立备份路径和 `--writers-stopped`。先核验 Git/FNS 隔离，再备份、核验 SHA-256、复制、读回、逐文件核对清理；仅移除空目录。
- 新旧锁、连接记录、活跃租约、链接、未知顶层内容或不同目标版本都阻止迁移。旧程序不认识新锁，操作前须实际停用旧版工作台、CLI 和 FNS，不能只依赖命令参数。
- 中断后用原清单 `--resume`，仅在核对迁移锁归属及原进程退出后接续；`--restore` 从已核验备份恢复旧路径，只清理本次创建且字节未变的目标文件。目标有新内容时拒绝覆盖。实际库重复执行已返回无变化；中断、恢复和冲突写入在合成库验证。
- 历史 JSON 保留原始字节；已知恢复路径字段通过读取兼容映射定位到新位置。历史脚本、旧原型和迁移证据中的旧路径保留，防御性旧目录排除也保留；这些不是新版本生产写入入口。

该流程不是跨文件事务，不承诺约束不遵守本机锁的外部编辑器、旧版程序或跨设备同步。

## 本机迁移和 FNS 空父目录问题

1. 重读现场后，获准知识库旧目录有 9 个历史文件，分属 `fns-device-config`、`issues/operations`、`workbench-code-sync`，另有空 `fns-sync`；无待处理旧锁或未知内容。原 Issue 操作材料作为历史保留，不重放。
2. 通过原生界面停用工作台与 FNS，核对写入方、备份安装副本和配置，再安装新版、配置本次所需排除并迁移。工作台配置与既有 10 个 Skill 发现链接保持原样。
3. 初次恢复 FNS 后发现一个空 `apps` 重新出现。暂停 FNS、核对并只移除空目录后，工作台单独运行不再创建它。对实际 FNS 2.4.0 安装包的文件夹接收逻辑作隔离重放：旧规则排除 `apps/workbench`，仍允许接收父目录 `apps`；补充父目录排除后不再创建。
4. 据此增加 `retiringParents` 预检和指纹内容，并要求 FNS 排除确实会退出的父目录；先看到回归测试失败，再修正通过。如果 `apps` 有其他应用，迁移不会要求排除整个 `apps` 或删除其他内容。
5. 本实例最终只在 `syncExcludeFolders` 追加 `^\.workbench-runtime(?:/|$)` 和 `^apps(?:/|$)`，保留原规则；Git 追加 `/.workbench-runtime/`。重新安装最终包，通过原生界面恢复 FNS 和工作台，确认新版、已加载排除及后续操作后旧目录不再出现。

当前启用列表保留 `realclaudian`、`fast-note-sync`、`tannt-workbench`。未把临时停用状态留给用户。

配置并发核对：首次重载后的 FNS 配置相对最初备份，除排除字段外还观察到 `apiToken` 变化及 `autoRedirectEnabled`、`wsPreProbeEnabled` 消失。这些差异出现在本次补丁写入之间，具体来源未证实；每次本任务写入均核验仅修改 `syncExcludeFolders`，保留当时最新的其他字段。第二次排除修改的即时备份与最终配置相比，只有 `syncExcludeFolders` 不同。未回滚其他会话或插件产生的变化，证据中不输出凭据。

## 备份与恢复材料

统一备份目录：`D:/zhao/tmp/workbench-runtime-storage-20261029014915/`。

| 材料 | 核验与用途 |
| --- | --- |
| `plugin-before/` | 原 0.23.0 安装副本，325 个文件，逐文件哈希一致 |
| `vault-before/`、`before-manifest.json` | 原 FNS 配置、Git 忽略、库入口、停用时插件列表及迁移/发现链接清单 |
| `runtime/manifest.json`、`runtime/files/` | 9 个原始运行记录；源清单、备份和迁移目标 SHA-256 全部一致；清单阶段为 complete |
| `source-legacy-fixtures/` | 源码旧忽略目录内的合成测试残留，501 个文件及 46 个链接；迁出前后文件哈希和链接目标逐项一致。链接保留原目标，不宣称移动后仍能运行测试 |
| `installer-recovery/` | 安装器保留的旧 0.23.0 恢复副本，核验后移至统一备份位置 |
| `installer-recovery-first-0240/` | 父目录预检修正前的第一版 0.24.0 安装副本及配套哈希清单 |
| `vault-AGENTS-immediate-before.md`、`fns-before-retired-parent-exclusion.json`、`config-change.json` | 即时配置变更核对依据 |

配置和历史恢复材料可能包含凭据，保留在本机备份，不进入公开源码、日志或回复。恢复先暂停相关写入方并按正式迁移流程核对；不直接覆盖已经产生的新记录。

## 验收证据

最终 `npm test`：**233 passed、0 failed、0 skipped**，耗时约 238.7 秒。测试使用本机实际 FNS 2.4.0 bundle，新增运行目录测试 12 项；覆盖只读、全部已知历史、进程退出/接续/恢复、链接/锁/未知项/陈旧计划/目标冲突、源后续变化、Git/FNS 隔离、自定义配置目录、多实例归属以及安装升级。

最终 `npm run build` 与 `npm run install-plugin -- --vault D:/zhao/tannt_vault/tannt` 成功；0.24.0 安装包的 327 个文件逐一匹配 release 清单，安装清单与构建输出一致。

- `dist/release.json` SHA-256：`24a360c5a4aa7828dd34a742e11eb83fb963353074ad01e479e24eb68f8789b5`
- `dist/tannt-workbench.bundle.json.gz` SHA-256：`f19054f7d0f70e6899d092313cdb5856932223d491246c82eb7075eba086b6f2`

| Issue 验收 | 结果与证据 |
| --- | --- |
| 统一位置和使用方 | 上述归属表、共享模块及生产入口检索；旧历史路径保留范围已解释 |
| UI / CLI / Skill、自定义配置和多库 | 安装副本 CLI 与合成库 `custom/settings` 验证；各实例隔离，共用目标库锁 |
| Issue developmentRoot | 安装副本 CLI 添加本任务评论；原生 UI 勾选首项并读回；两者回执均位于源码仓库 `.workbench-runtime/issues/operations` |
| 历史、重试、冲突和恢复 | 实际 9 文件三方哈希相等；重复迁移无变化；异常、冲突和恢复由隔离测试验证 |
| Git / FNS 隔离 | 实际库和源码库 Git 检查通过；工作台代码排除页面显示新根、插件和恢复目录均“已设置 · 已生效”；磁盘配置与原生已加载配置分别检查 |
| 安装升级与只读 | 实际插件 `data.json` 字节、10 个发现链接保持；合成库升级保留 Skill registry；迁移 check、笔记 info、FNS check、Skill check、bridge info 前后运行清单不变 |
| 安全清理旧 apps | 清理前后核对文件清单、备份与哈希；只清理空父目录，源码旧测试残留另行完整归档 |
| 受影响操作不重建 apps | 实际笔记读取与锁获取/释放、FNS 检查与服务锁、bridge 请求、Issue CLI/UI 写入、Skill 检查完成；笔记 capture/retry/update 和 Skill install/remove 在开发仓库 tmp 合成库执行，两处无 apps |
| 测试、打包及原生入口 | 233 测试；最终包安装/327 文件哈希；原生 v0.24.0、FNS 本机配置正常、Skill 5/5 与 Issue 读写 |
| 记录和必要说明 | 本文及写入、Issue、FNS、安装升级、Skill/CLI、库入口说明已更新 |

本机详细证据保存在开发仓库已忽略的 `tmp/`：

- `runtime-storage-final-test.log`、`runtime-storage-install-final.log`
- `runtime-storage-actual-before.json`、`runtime-storage-actual-apply.json`
- `runtime-storage-installed-evidence.json`、`runtime-storage-final-audit.json`
- `runtime-storage-native-exclusion.txt`、`runtime-storage-native-device.txt`、`runtime-storage-native-skills.txt`、`runtime-storage-native-issue.txt`
- `runtime-storage-hidden-after.json` 与 `runtime-storage-hidden-baseline.txt` 指向的原始基线

2026-10-29 02:17（Asia/Shanghai）通过已安装 Issue CLI 以每次新读取的完整原文逐项保存，10/10 验收项完成，`State: completed`，保留 `Status: ready-for-agent`。关闭后读回和原生“重新读取”均确认完成；`runtime-storage-completion.json` 保存最终核对结果，`runtime-storage-native-issue-complete.txt` 保存原生状态。最终再次核验 327 个安装文件、9 个迁移记录、10 个发现链接、插件启用列表、Git/FNS 隔离与原分支/HEAD，旧目录均未出现。

## 验证边界与既有事项

此次只验收 Windows 本机的 Obsidian 1.14.5、FNS 2.4.0 与指定知识库；没有发布/推送代码或 FNS 权威配置，没有验证 macOS、Linux、手机或另一台设备，也没有执行真实双设备传输。业务笔记没有用作写入夹具。实际 Skill 列表和发现链接各为 Codex 5 个、Claude 5 个；现有 `.agents/skills`、`.claude/skills` 缺少明确 FNS 排除，实际安装/移除 UI 正确受既有隔离门禁阻止，未扩大本次配置范围修复它们。安装/移除及升级保留状态已在隔离实例通过。

本次新增 `.workbench-runtime/` 的同步意图已由用户要求和迁移规则明确为排除；磁盘和已加载配置均核验。隐藏项审计时该目录含 11 个文件（9 个历史文件、bridge 及活动租约）；审计器先检查额外目录登记，将它报告为 missing，不能据此误称应加入 FNS。其排除结果另由规则校验和原生界面确认。

其他既存隐藏项仍有 **4 个目录、1 个独立隐藏文件** 未完全纳入，保持原配置：

| 路径 | 类型 | 普通文件数 | 审计状态 |
| --- | --- | --- | --- |
| `.git` | 目录 | 228 | 未纳入 |
| `.gitignore` | 独立隐藏文件 | 1 | 未纳入 |
| `.credentials` | 目录 | 1 | 已排除 |
| `.agents` | 目录 | 0，另有 5 个链接 | 未跟随链接，未知 |
| `.claude` | 目录 | 0，另有 5 个链接 | 未跟随链接，未知 |

隐藏项审计退出码 2，因上述既有链接而不完整，并提示旧 `.env` 登记目标不存在；不将此次结果描述为全部隐藏项已同步。`.claudian` 的 2 个文件和 `.scratch` 的 1 个文件按当前配置已覆盖。

## 并行检出保护

使用现有 `feat/skill-installation` 检出，未创建或切换分支/Worktree，未再次交接，未提交、推送或发布，未设置远端或处理凭据。基线 HEAD 未变。保留其他会话的 `AGENTS.md`、`README.md`、迁仓实施记录及 Git 接入文档；`docs/agents/git.md` 仅将运行目录忽略要求补上新路径。`git diff --check` 通过。完成代码测试后仅补充验收记录和 Issue 状态，不为纯记录更新重复运行全套测试。
