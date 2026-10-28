# FNS 按设备配置验收：2026-10-25

## 当前设备

- macOS / Node.js 22.23.1 / Obsidian 1.14.4 / FNS 2.4.0，当前 Agent 为 Codex。
- 设备标识：`darwin-7e5ebf051ba90582`；仅保存机器标识摘要，不输出原始机器标识或 Token。
- 插件入口：`.obsidian/plugins/fast-note-sync/data.json`。
- 相对链接目标：`../../../.fns-config/darwin-7e5ebf051ba90582/data.json`。
- 在实际设置界面关闭 FNS，核对启用清单后执行 `--apply`。返回 `linked`、`changed: true`、`contentPreserved: true`，迁移过程整份字节不变。随后在设置界面重新启用并核对启用状态。
- 本机入口已由 `.gitignore` 排除，设备配置可由 Git 跟踪；未提交或推送 Git。
- `--check` 返回 `linked`，重复 `--apply` 返回 `changed: false`。迁移前后的 `apiToken` 在内存中比较相等，不保存其值到报告。

迁移恢复记录：`apps/workbench/data/fns-device-config/d3c55003-340c-4b93-9e7f-c1af9ff1ead5/`。其中源配置只留在已排除 Git/FNS 的本机运行目录。

本轮同时存在另一项网盘目标迁移，相关文档改为 `config/cloud-storage-targets.json`，FNS 旧补丁退役工具随后更新了本机配置。保留这些并行改动；实际退役后设备配置链接仍在、Token 仍相等。不会把迁移前的旧同步目录恢复回去。

## 代码与入口

`node --test scripts/fns/device-config.test.mjs scripts/fns/env-sync-support.test.mjs`：25 项通过。包括普通文件迁移、保留完整配置、设备身份、不同设备 Token 隔离、已存在相同/不同目标、缺配置与已有 Git 配置不自动借用、断链、其他设备链接、插件未停用、无效 JSON 不泄漏内容、目录链接、Git 已跟踪入口、维护更新与恢复保留链接。

`node scripts/agent-skills/install.mjs --agent codex --check`：活动入口通过，当前 `.agents/skills/tannt-sync-agent-config` 直接指向已更新正式源。项目入口、Skill、清单、配置流程及 FNS 维护流程对本次文档和脚本的引用已核对。

## 本次隐藏项检查

新增 `.fns-config/`，含 1 个配置文件，按已确认方案只经 Git 传递，不加入 FNS。新增恢复副本中的 `.gitignore`（1 文件）和 `.scratch/`（1 文件）位于 `apps/workbench/data/fns-device-config-development/2026-10-25T18-58-13.066Z/`，继续沿用运行数据不参与同步的规则。测试夹具已清理。

其他既存未纳入或待核验项共 4 个目录、4 个独立隐藏文件；本轮不改变它们的同步设置：

| 路径 | 类型 | 检查状态 | 文件数 |
| --- | --- | --- | ---: |
| `.agents/` | 目录 | 含链接，待核验 | 0（不跟随链接） |
| `.claude/` | 目录 | 含链接，待核验 | 0（不跟随链接） |
| `.git/` | 目录 | 未纳入 FNS | 15 |
| `.scratch/` | 目录 | 含链接，待核验 | 843 |
| `.DS_Store` | 文件 | 未纳入 FNS | 1 |
| `.gitignore` | 文件 | 未纳入 FNS | 1 |
| `.obsidian/.DS_Store` | 文件 | 未纳入 FNS | 1 |
| `docs/prototypes/.DS_Store` | 文件 | 未纳入 FNS | 1 |

完整只读报告在本机 `apps/workbench/data/fns-device-config-development/hidden-audit-final.json`，只包含路径与状态。

## 验证边界

Windows 原生建链、权限不足及插件保存行为仍须目标设备现场验证。未进行 Git 跨设备推拉或 FNS 服务端到达验证；未把这些结果标为完成。FNS 设置界面直接编辑并保存未单独测试，当前已验证实际迁移、重载后链接保持、维护脚本实际更新及普通文件写入通过链接抵达目标。

## 移至 config/fns-config：同日续验

用户随后指定普通目录 `config/fns-config/`。上面的旧路径和验证边界保留为第一次迁移的历史记录，当前结果如下：

- 当前完整配置：`config/fns-config/darwin-7e5ebf051ba90582/data.json`。
- 本机入口仍为符号链接，目标为 `../../../config/fns-config/darwin-7e5ebf051ba90582/data.json`；旧 `.fns-config/` 已清理。
- 在 Obsidian 实际界面停用 FNS，确认启用清单已更新后迁移，再从界面恢复原启用状态。没有仅改磁盘启用列表。
- 与本次迁移前的即时副本比较，`apiToken` 相等，唯一变化字段为 `syncExcludeFolders`：原规则保留并追加 `^config/fns-config(?:/|$)`。该新增规则不匹配 `config/cloud-storage-targets.jsonc` 或 `config/fns-config-backup/`。
- 重载后的 FNS 设置界面已显示新增规则。在此字段重新输入相同规则并移出焦点触发保存后，链接仍在，Token 与其余设置值保持不变，补齐了前次未单独测试的界面保存路径。
- `--check` 返回 `linked`、`fnsExcluded: true`；重复 `--apply` 返回 `changed: false`。Git 忽略本机入口，新目录内的完整配置未被忽略；本次未提交或推送。
- `node --test --test-reporter=dot scripts/fns/device-config.test.mjs scripts/fns/env-sync-support.test.mjs scripts/fns-hidden-audit.test.mjs`：46 项通过。Windows 与真实跨设备拉取仍待各设备现场验证。

本次即时恢复副本及收据：`apps/workbench/data/fns-device-config/006b56b1-b800-4519-890e-9a181c447c5f/`。迁移使用执行前的最新配置，未用较早备份覆盖期间其他操作产生的设置。

测试产生的临时隐藏夹具已清理；复用本次基线检查，新增隐藏项为 0。其他既存未纳入或待核验项为 5 个目录、5 个独立文件，未调整其同步范围：

| 路径 | 类型 | 状态 | 文件数 |
| --- | --- | --- | ---: |
| `.agents/` | 目录 | 含链接，待核验 | 0 |
| `.claude/` | 目录 | 含链接，待核验 | 0 |
| `.git/` | 目录 | 未纳入 | 1416 |
| `.scratch/` | 目录 | 含链接，待核验 | 851 |
| `apps/workbench/data/fns-device-config-development/2026-10-25T18-58-13.066Z/.scratch/` | 目录 | 未纳入，既存恢复记录 | 1 |
| `.DS_Store` | 文件 | 未纳入 | 1 |
| `.gitignore` | 文件 | 未纳入 | 1 |
| `.obsidian/.DS_Store` | 文件 | 未纳入 | 1 |
| `docs/prototypes/.DS_Store` | 文件 | 未纳入 | 1 |
| `apps/workbench/data/fns-device-config-development/2026-10-25T18-58-13.066Z/.gitignore` | 文件 | 未纳入，既存恢复副本 | 1 |

报告为检查不完整（退出码 2），原因是既存符号链接及基线中的同类扫描警告，不表示全部同步完成。完整路径报告保存在本次恢复目录的 `hidden-audit.json`。
