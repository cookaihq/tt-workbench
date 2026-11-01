# FNS 本机配置与旧链接迁回

本文中的 `<运行目录>` 按[本机运行记录](../rules/writing-and-changes.md#本机运行记录)解析，默认 `.system/.workbench-runtime/`；自定义位置从所属实例的 `.system/workbench/runtime.jsonc` 读取。

在执行 `tt-sync-agent-config`、维护 FNS 配置文件位置或通过脚本写入 FNS 配置前，必须读取并遵守本文。入口是项目 Skill、配置检查流程及 FNS 维护流程。

设计、维护或执行 FNS 跨设备规则发布、接收及应用前，还必须读取并遵守[共享规则发布与应用](../rules/fns-config-sync.md)。工作台与独立程序入口见[操作说明](../workbench/fns-config-sync.md)。迁回不代表发布权威版本或覆盖本机四组规则的许可。

## 已确认的行为

2026-10-28，用户确认取消运行配置外移及符号链接。每台设备直接使用 `<库>/<Obsidian 配置目录>/plugins/fast-note-sync/data.json` 普通文件；默认配置目录为 `.obsidian`。不再把普通配置移到设备目录，不再创建配置链接，取代 2026-10-25 的自动归位建链流程。

本机运行文件加入 Git 忽略。工作台发布时读取完整配置，在独立传输分支生成固定快照；2026-10-25 允许完整配置（含各设备自己的 Token）进入 Git 的决定仍适用于发布快照。快照不是运行文件，不从普通分支拉取配置来替换本机，不复制另一设备的 Token 初始化本机，不清空已有 Token。普通工作分支不再实时跟踪本机设置变化。

设备标识仍由系统类型及本机稳定机器标识的 SHA-256 前 16 位组成，用于发布来源、回执与旧配置归属。macOS 读取 IOPlatformUUID，Windows 原生读取 MachineGuid；不以主机名猜选配置。无法确认身份或旧文件归属时保留现场。

## 检查与迁回

1. 运行 `node "<软件根>/scripts/fns/device-config.mjs" --vault "<库绝对路径>" --check`；自定义 Obsidian 配置目录加 `--config-dir <实际目录>`。只读检查不写文件。普通有效 JSON 文件返回 `ready`，不要求创建外部配置目录，也不比较旧目录里遗留文件来决定本机设置。
2. 缺少本机 `data.json` 时提示先安装并完成 FNS 本机设置；不生成空配置，不从 Git 快照或其他设备文件补造运行配置。
3. 旧链接仅当直接指向本机 `config/fns-config/<设备标识>/data.json` 或旧 `.fns-config/<设备标识>/data.json` 的普通文件时允许迁回。断链、错设备、库外链接、目录链接、无效 JSON 均保留现场，不猜测另一个来源。
4. 获准迁回后，工作台「迁回本机配置」实际暂停 FNS，核对启用状态。独立程序使用 `--apply` 前必须在 Obsidian 中实际停用 FNS，不能只编辑磁盘启用列表。
5. 在已排除 Git、FNS 的 `<运行目录>/fns-device-config/` 保存完整原文及源/目标/原链接和指纹记录；核对本机入口未被 Git 跟踪并加入忽略。用相同字节的普通文件替换已核对的旧链接，读回验证后才移除对应旧源文件及空设备目录。保留其他设备文件和其他目录内容，不修改配置值、不自动提交或推送。
6. 恢复原启用状态，验证 FNS 重新加载和再次保存后的普通文件、四组规则及设备设置。重复执行不搬动普通文件。迁移不是跨文件事务；中断后以记录核对已完成阶段，配置或旧源发生后续修改时停止清理，保留恢复材料。

单独调用配置检查 Skill 只检查；旧自动外移、建链及补规则授权已退出。当前会话明确授权的迁回可直接执行，其他设备通过同一入口按其授权迁回。没有可用的应用控制能力时完成独立检查，明确尚缺实际暂停、迁回及加载验证。

## 后续写入与验收

工作台及维护脚本仅写本机插件目录的普通配置，写前核对路径与原文，暂停 FNS，保存恢复材料，仅更新获准字段，恢复并验证实际加载。遗留链接须先走上述迁回，不能被普通设置写入隐式转换或沿链接修改。

`config/fns-config/` 仍是 Git 发布对象内的路径；只有本机实际存在的旧设备目录才构成本机保护要求。新实例不为纯 Git 对象路径新增排除。已有旧规则保留，不因本机目录消失自动删除；本机运行数据仍排除 Git、FNS。目录与文件均相对于目标知识库根目录，各设备可使用不同绝对根及明确配置的运行位置。

核对本机文件排除时使用工作台「FNS 配置同步 → 本机检查」，或按[独立程序说明](../workbench/fns-config-sync.md#独立程序入口)调用 `local-check`；该入口不依赖发布记录或 Git 远端。获准补齐后使用 `configure-local`，CLI 仍须先实际停用 FNS。完整发布流程与本机修复分开，安装不隐式补规则。界面、错误及日志不输出 Token 或完整配置。

Windows 不再需要为 FNS 创建文件符号链接。身份识别、文件替换、暂停与恢复仍须在原生环境验收；macOS 通过不代表其他设备已完成。

测试：`node --test scripts/fns/device-config.test.mjs scripts/fns/env-sync-support.test.mjs lib/fns/tests/sync.test.cjs lib/fns/tests/local-protection.test.cjs`。本轮规格与验收见[本机文件排除](../../.scratch/fns-local-protection/spec.md)；[历史实施记录](../../local-evidence/.scratch/fns-config-sync/verification/implementation.md)仅供本机回查，不随软件分发。
