# 用户 README 与完整 ZIP 实施记录

- 日期：2026-10-29。
- 授权：用户确认了[提案](proposal.md)中的用户 README、手动与 Agent 两种安装入口、完整 ZIP 打包流程；本轮未包含 Git 提交、推送或 GitHub Release 发布。
- 基线：工作区已有改名迁移、运行目录设置等其他修改，当前软件版本为 `0.25.0`。保留这些内容；本任务没有递增版本或改动业务数据。

## 已实施

- 根 [README](../../README.md) 改为用途、两种安装方式、首次使用、可选 Skill、更新、帮助反馈与开发文档入口。给出正确解压层级、最低 Obsidian 版本、完整包要求和可直接复制的 Agent 提示词；基础安装无需克隆、Node.js 或构建。
- 新增[安装说明](../../docs/workbench/installation.md)，记录目标知识库、同版附件与清单核验、首次安装和已有插件处理。保留旧 `tannt-workbench` 的迁移入口，Skill 注册和个人规则继续单独操作。
- 新增[开发说明](../../docs/workbench/development.md)，承接构建、测试、源码安装、发布与历史维护信息。同步修正插件 README 的旧安装步骤与“没有远端”表述，更新发布文档的三个附件要求。
- [构建脚本](../../scripts/workbench/build.mjs) 新增 `dist/tt-workbench.zip`，由[ZIP 编码模块](../../scripts/workbench/zip.mjs)生成。仅使用 Node.js 标准库；UTF-8 文件名、DEFLATE 压缩、固定 ZIP 时间。包内仅有顶层 `tt-workbench/`，包含完整资源及 `release.json`，与现有 gzip 更新包来自同一个内存清单。
- 新增[ZIP 回归测试](../../apps/workbench/tests/zip.test.cjs)，使用独立系统解压工具覆盖中文、隐藏、空文件、二进制资源、解压后的清单识别与后续升级。

## 验证

- 最终 `npm test`：250 项，243 通过，0 失败，0 取消，7 项缺少 `TEST_FNS_BUNDLE` 的可选 FNS 集成测试跳过；新增的系统 ZIP 解压与升级回归测试通过。
- `npm run build` 成功；版本 `0.25.0`，334 个受管理文件，ZIP 共 335 个文件条目（含清单），14 个含非 ASCII 文件名。
- 最终 ZIP 大小 685281 字节；SHA-256：`06c3320dc32038c106578d063e8dc05c409bf18f4b000338c7ca1e6ff564a8b5`。
- Python 标准 `zipfile` 独立验证 ZIP CRC、完整条目集合、唯一顶层目录和全部 SHA-256；ZIP、`dist/plugin/`、gzip 更新包及独立 `release.json` 的内容一致。
- Windows `Expand-Archive` 在两个新建隔离库成功解压，分别使用 `.obsidian` 和 `custom-settings`。安装后文件读回一致；安装器 `--check` 识别为同版且无差异；安装副本的独立文件 CLI 可在没有源码依赖的目标库目录运行。
- 两个隔离库均通过安装副本更新模块读取模拟 Release，从 `0.25.0` 升级到合成 `0.25.1`。验证新版本、原有 `data.json`、业务笔记和旧目录恢复副本；额外 ZIP 附件不影响现有更新器选择清单与 gzip 包。该步骤使用的初次 ZIP 与最终包仅差 README 链接及开发文档测试说明，最终文件全量一致性已重新核验。
- 根 README、安装/开发/更新/Skill/Git 文档的本地文件链接与章节锚点核验通过；本次修改文件 `git diff --check` 通过。

测试日志与合成隔离库位于忽略的 `tmp/workbench-user-readme-tests.log`、`tmp/workbench-user-readme-qa/`，无用户真实笔记或个人账号数据。

## 发布与验证边界

本轮生成本地安装成品，没有公开发布 Release。README 明确标注调研时公开 Releases 尚无版本，不把不存在的附件写成可下载；首次发布时须同步移除或更新该状态，并回读真实附件。

本轮实际核验文件安装和模拟更新，没有启动真实 Obsidian 或新的外部 Agent 会话执行完整安装，也未验证 macOS/Linux 的系统解压、线上下载或跨设备加载。截图不在本轮交付范围。
