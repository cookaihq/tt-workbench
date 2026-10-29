# 项目规则归属与目标库规则读取

用户已于 2026-10-29 在 tannt 会话确认范围，并交由工作台 main 会话实施。工作台源码与目标知识库各自维护需要的业务／场景规则及概念；项目内部一份正式正文，跨项目共同含义变化联动更新。个人全局正文仍归 tannt 的 `docs/global-agent-instructions/`，不进入软件包。

## 交付范围

- 工作台：五个活动 Skill 的规则读取链、规则及场景、Agent 入口、概念与 ADR、必要实现、测试、构建及指定 tannt 库的正常安装验收。
- tannt 主会话：该库正式入口、README、概念、业务／场景规则、ADR 和配置清单。工作台会话只向该库 `tmp/rule-ownership/workbench-result.md` 写交付结果。
- 不切换分支，不代提交、不推送、不发布，不改业务笔记、凭据、FNS 或全局 Agent 接入。

## 基准与发现

起点为 main，HEAD `9c70193539753a7b348a6ab0af268705565dc426`。已有修改为 `.gitignore`、`apps/workbench/agent-bridge.js`、`apps/workbench/main.js`、`apps/workbench/manifest.json`、`lib/runtime/storage.cjs`、`package.json`，另有未跟踪的 `.scratch/` 与 `apps/workbench/tests/agent-bridge.test.cjs`；本任务保留这些内容，不替其提交。

五个 Skill 的公共前言把 `docs/` 固定到软件根，业务步骤随后读取软件 `docs/rules/`；目标库入口即使已读取，也未用于选择规则正文。附带网盘设置还固定了 tannt 的远端目录与个人扩展名。配置同步说明误称安装器 `--check`／`--help` 会写入。打包器已排除个人全局正文；安装器已只更新插件目录；Agent 规则页面已使用显式规则源，这些机制应保留。

## 实施选择

在现有 `docs/agents/package-layout.md` 集中维护规则读取算法，五个 Skill 按操作主题读取目标库入口指明的实际正文。软件的同名文档是产品模型、格式和能力契约；不能根据同名文件自动回退，也不能把 Markdown 当作程序配置。沿用显式初始化／配置流程，不新增规则位置配置或 Markdown 解析器。

新增工作台变更联动场景，调整 ADR 0001、0005 的当前解释并保留历史，保留软件所需独立概念及规则。网盘实例选择从目标库规则取得，旧 schema 名称继续兼容。安装／更新只交付软件资源。

## 验收条件

1. 五个 Skill 从真实安装源定位工具，并按目标库实际 Agent 入口和逐级引用选择业务／场景规则；覆盖自定义路径、缺项、冲突、未采用默认规则等分支。
2. 检查受影响文档的可达入口和引用；软件开发 Issue 规则不套入业务 Project／Task。
3. 验证安装及升级保留目标库入口和自有规则、不打包个人全局正文；完整 `npm test`、`npm run build` 记录结果及外部集成跳过范围。
4. 通过正常安装器更新明确的 tannt 库，核对安装清单、版本、哈希、五个发现链接与实际规则路径。文件读取与宿主新会话发现／行为验证分别报告。
5. 正式证据写入本目录；临时脚本和日志在 `tmp/project-rule-ownership/`。本目录父项 `.scratch/` 已存在，新建普通功能子目录不触发隐藏项创建。
