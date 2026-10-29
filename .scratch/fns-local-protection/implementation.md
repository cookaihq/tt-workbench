# FNS 发布与本机文件排除实施记录

2026-10-29，源码仓库版本 `0.25.1`。范围按[规格](spec.md)；保留工作区中其他任务的修改，未提交、推送或操作真实知识库远端。

## 实现

旧实现把接收到的发布规则按当前设备的目录要求校验，还固定要求排除 `config/fns-config/`。因此，合法旧发布缺少新运行目录排除时会被记为远端异常，并阻止发布修正版；即使旧快照目录在工作目录中不存在，也会要求添加排除。本机排除入口与软件更新检查又依赖完整发布状态，导致损坏状态影响本机修复和软件更新。

- `lib/fns/sync.cjs`：接收仍验证发布结构、来源内容、指纹、文件清单及历史；路径要求留给来源设备发布与接收设备应用校验。可接收旧版本、比较并发布修正版本；不允许直接应用不符合本机保护要求的版本。重新检查可解除旧 `PROTECTED_SCOPE` 记录，真实损坏和历史改写继续阻断。
- `lib/fns/protection.cjs`、`rules.cjs`：根据实例实际运行位置与 Obsidian 配置目录生成保护清单，区分目录和文件；旧设备目录、旧插件按实际存在情况加入。已有排除保留，上级目录覆盖有效。Git 对象内路径不等于磁盘目录。
- `lib/fns/workbench-scope.cjs`：本机读取和补齐不读取发布状态或连接远端。补齐按暂停、共享操作锁、原文核对、备份、写入、加载核验执行；已有 Git 的恢复材料仍须被忽略。首次写入失败而恢复材料未受保护时保持 FNS 停用，返回恢复位置。配置缺失但 FNS 仍启用或加载时不放行软件更新。
- `apps/workbench/fns-local-ui.js`、`fns-ui.js`：新增“本机检查 → 本机文件排除”，显示实际路径、状态和补齐按钮。发布记录损坏不影响此入口。主页面区分远端损坏与当前版本不能应用到本机。
- `apps/workbench/updates-ui.js`、`main.js`：移除版本弹窗的“代码同步设置”；软件更新只依赖本机保护检查。Skill 操作同时核验运行目录和位置配置的基础排除。
- `lib/runtime/location-migration.cjs`：复用 Git 忽略检查；没有 Git 的实例无需初始化 Git 即可补齐，已有 Git 但无法核验时停止。
- `scripts/fns/sync-request.cjs`：增加 `local-check`、`configure-local`；CLI 写入仍须明确停用 FNS，不把磁盘写入报告成实际加载。原生验收脚本和 FNS 使用、设备维护、更新说明同步调整。

完整配置快照继续保存在目标知识库自己的 `origin` 的 `tannt-fns-config` 分支中，不能使用公开软件仓库。运行配置保持普通文件；本轮没有删除传输历史、迁移设备文件或退出 `tt-sync-agent-config`。

## 验证

| 验证 | 结果与范围 |
| --- | --- |
| `npm test` | 280 项：273 通过、0 失败、7 跳过。跳过项需要外部 `TEST_FNS_BUNDLE`，不能视为真实 FNS 集成已验证。日志：源码根 `tmp/fns-local-protection/full-tests-final.log`。 |
| 旧发布回归 | 两个隔离 Git 设备与本地传输仓库验证旧 `PROTECTED_SCOPE` 可重新接收、旧版不能直接应用、可发布修正版；无本地旧目录时可发布，实际遗留目录继续受保护。 |
| 本机补齐回归 | 覆盖损坏发布状态、首次补齐、自定义位置、旧安装、无远端、缺失 FNS、白名单、并发修改、共享锁、恢复材料和加载失败；设备专属字段保留。 |
| 配置缺失且 FNS 活跃 | 定向测试先复现 `not-applicable` 错误，再修复为 `unknown` 并阻止更新。相关本机、界面、更新测试共 25 项通过，之后重新执行完整测试。 |
| 界面 | 真实 UI 模块配合合成服务在浏览器检查 1280 与 420 宽度；本机补齐后状态和按钮正确，版本弹窗无旧设置，未横向溢出。截图保存在源码根 `tmp/fns-local-protection/`。不是 Obsidian 宿主验收。 |
| `npm run build` | 生成版本 `0.25.1` 完整 ZIP、更新包及清单，339 个受管理文件。 |
| 正常安装与安装后读取 | `npm run install-plugin -- --vault <隔离测试库> --config-dir obsidian-settings --bundle dist/tt-workbench.bundle.json.gz` 成功。逐文件核验 339 个哈希；安装只写插件目录。安装后的 CLI 完成本机检查、补齐及再次读取，损坏发布状态不阻断，不创建 `config/fns-config/`，保留恢复原文和设备设置。证据：源码根 `tmp/fns-local-protection/installed-validation.json`。 |
| 修改检查 | `git diff --check` 通过；相关正式源无调试标记。 |

## 路径与交付边界

下表实例路径相对于目标知识库根；软件说明路径相对于工作台源码根或安装后的软件根。

| 用途 | 路径 |
| --- | --- |
| 本机实际 FNS 配置 | `<Obsidian 配置目录>/plugins/fast-note-sync/data.json` |
| 发布快照与权威元数据 | Git 提交内 `config/fns-config/<设备标识>/data.json`、`config/fns-config/authority.jsonc`；无需出现在工作目录中 |
| 发布状态、回执和应用恢复记录 | `<运行目录>/fns-sync/` |
| 本机补齐的恢复原文 | `<运行目录>/workbench-code-sync/<标识>/before.json` |
| 规则正文与维护入口 | `docs/rules/fns-config-sync.md`、`docs/agents/fns-device-config.md` |
| 使用与更新说明 | `docs/workbench/fns-config-sync.md`、`docs/workbench/updates.md` |

`<运行目录>` 默认 `.system/.workbench-runtime/`，从目标库的 `.system/workbench/runtime.jsonc` 解析自定义位置。其他设备的绝对根可以不同，但须保持软件文档的相对引用关系，并按各自配置目录和运行位置分别核验。

项目 Agent 入口继续要求修改 FNS 前读取对应规则；设备维护说明明确要求发布、接收、应用前读取共享规则正文。本轮已核对这些入口、引用及相应程序行为，没有修改用户级规则入口，也未声称其他宿主新会话或其他设备已加载。

未指定真实目标知识库，因此没有替换真实插件、修改实例配置或独立项目规则。目标库若保存同主题规则，其维护会话需按实际入口对照上述 FNS 两份正文：接收校验与本机应用校验分开、仅实际遗留目录继续要求保护、使用新的本机检查与补齐入口。软件安装不自动覆盖该库规则。真实 Obsidian 内的暂停、加载、跨设备传输及真实远端发布仍须在对应授权实例验收。
