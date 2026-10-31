# Windows FNS 页面反复启动控制台修复

## 目标与证据边界

2026-10-31 接收已完成临时止弹的交接，负责正式源码修复、回归测试、正常构建安装和 Windows Obsidian 实际加载验收。原始本机进程证据留在目标库，不复制到公开软件包。

开发跟踪：[GitHub Issue #1](https://github.com/cookaihq/tt-workbench/issues/1)。本任务完成条件是本机交付，公开发布另按授权执行。

交接已捕获 Obsidian renderer 反复启动读取 MachineGuid 的 PowerShell；FNS 页面激活时，库事件经 `refreshList()` → `FnsUI.refresh()` → `FnsSyncService.inspect()` 进入重复身份查询。历史 888 个终端宿主缺少原始启动者证据，不能全部归因于工作台；本次不扩大调查其他项目。

修复前可重复测试：`node --test --test-timeout=5000 lib/fns/tests/device-identity.test.cjs apps/workbench/tests/fns-refresh.test.cjs`。最初 10 项测试中 9 项失败：40 个身份调用产生 40 个 OS 查询；41 次页面刷新产生 41 次并发检查；Windows 查询缺少 `windowsHide`；页面离开后操作仍启动新检查。测试替换 OS 查询以避免在用户桌面重新制造弹窗。

## 实施与关联影响

- 共享身份读取缓存验证成功的 Promise，并合并在途查询；任何拒绝（含无效机器身份）都清除缓存以允许重试。保留 MachineGuid／IOPlatformUUID 及原 SHA-256 算法。Windows PowerShell 和迁回检查的 Git 子进程显式隐藏窗口。
- FNS 页面串行处理刷新，重叠请求合并为后续检查，忽略过期结果。操作等待在途检查；离开或关闭页面取消定时及排队刷新。
- 普通笔记 create/delete/rename/metadata 事件在 FNS 页不再扫描列表或检查配置；Obsidian raw 文件事件只对实际配置目录、当前运行位置的 FNS 状态、运行位置配置及相关排除输入进行短时合并刷新。
- 插件与完整安装内的 CLI 共用修复后的模块。独立 Skill 自带固定 runtime，工作台安装沿用 v0.26.0 正式完整清单与原包；不改写既有 Skill 行为版本或说明。独立 CLI 进程本就按次退出，后续若发布该 Skill 修订，再按其独立版本流程交付共享模块变更。
- 不改变目标库模型、四组 FNS 规则、凭据、业务笔记、全局规则或 Skill 发现入口。无共同术语／协议变化，不要求目标库规则迁移。

## 验收与交付

针对性回归最终 23 项通过，包括完整 `FnsSyncService.inspect/inspectLocal` 多实例调用链、重入页面、旧结果保护、失败恢复、自定义配置和运行目录、原本机检查 UI。

- 隔离源码以 `831da111946642eaf07b6b13be39029b79cebfb2` 加本次六个产品／测试文件生成，共 454 个源文件。Windows tar 解包出现中文路径错误，旧导出弃用；最终使用 ZIP 导出，逐路径与字节核对，证据为 `source-manifest.json`。
- `npm test` 最终 **337 通过、0 失败、0 跳过**。通过 `TEST_FNS_BUNDLE` 指向本机已有 FNS 2.4.0，外部扫描器集成测试实际运行。日志：`npm-test-final.log`。
- `npm run build -- --skills-catalog <v0.26.0 正式清单> --skills-assets <同批正式附件>` 成功。本机候选基于已发布 0.26.0，未准备新的正式版本；候选由源清单和文件哈希识别，相同版本字段不能区分公开原包与本机修复。该修复尚未进入 v0.26.0 公开附件。构建日志：`build.log`。
- 使用系统 `Expand-Archive` 独立解压完整 ZIP；1,803 个分发文件与清单、gzip 包完全一致。五个独立 Skill 包与 v0.26.0 正式包摘要一致，其他会话正在修改的 Agent 规则 UI／样式／文档未混入。隔离库从正式包升级到候选包后设置保留，安装器 `--check` 通过。证据：`delivery-validation.json`。
- 在目标 tannt 关闭窗口后经正常 `npm run install-plugin -- --vault <tannt> --bundle <固定候选包>` 安装，由 0.25.1 升至 0.26.0 本机修复构建。安装器保留旧目录恢复材料；重开后 UI 显示 0.26.0，新 renderer 与旧实例区分。目标安装 `--check` 无差异。
- 实际 FNS 页显示规则内容一致、最近接收权威版本 v3；本机检查显示“本机配置正常”和“本机排除已保存并加载”，9 项路径均已排除。设备身份与已有状态记录一致，完整 FNS 配置及工作台 `data.json` 哈希保持不变。没有发布、接收或应用新 FNS 规则，不将本次加载验证说成其他设备已同步。
- FNS 页打开期间，在目标库已忽略的交接临时目录执行 30 个 JSON 临时文件的创建、修改、重命名和删除，共 120 次操作；临时文件已清除，未创建测试笔记。随后打开本机检查、离开并重新进入 FNS 页，界面正常且未观察到弹窗。证据：`file-events.json` 及本次 Windows UI 工具观测。
- 19:06:34–19:11:35 连续 496 次进程采样；19:08:56 首次进入 FNS 页记录 **1 次**身份查询，后续文件操作、本机检查及重入没有新增身份查询。OpenConsole 全程 16 个，没有新增；全机 conhost 在 68–82 间波动（起始 73、结束 76），包含其他任务，不能全归因于工作台，也不声称全机宿主数为零。证据：`process-monitor.json`。补充 tannt 进程树监测单独记录，避免用全机总数推断归属。
- 19:13:28–19:14:28 对 tannt 新 renderer 的完整进程树补充 95 次采样，没有观察到子进程。至 19:18:16 再查事件日志，首次进入 FNS 后约 9 分钟仍只有最初的 1 次身份查询。证据：`descendant-monitor.json`、`runtime-verification.json`。
- 监测结束后使用安装副本的 `scripts/fns/sync-request.cjs` 执行 `local-check`，本机身份正常、9 项排除齐全。独立 CLI 正确报告未核验应用运行时，实际加载以此前 UI 为证；该独立进程的按次身份查询不混入上述 UI 监测计数。证据：`installed-cli.json`。最终再次检查配置及工作台设置哈希，均与安装前一致（`local-after.json`）。

回归测试使用 OS 查询替身验证调用次数及失败；原生验收使用 Windows 事件 400、进程采样及实际 UI。未启用 Obsidian CLI，也未将临时观测代码注入应用或修改安装副本。macOS 身份分支为模拟回归，未宣称 macOS 实机验收或其他设备已交付。

本机临时证据放在 `tmp/windows-fns-popup/`。本次从固定 HEAD 加经过审阅的本任务文件构造隔离源码，不混入 main 上其他会话的未提交修改。公开推送、Tag、Release 不在本次本机交付授权内。
