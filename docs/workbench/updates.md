# 工作台版本与更新

工作台源码在独立软件仓库，知识库使用完整安装包。顶部版本号表示当前运行版本；启动后及定时检查新版本，点击版本号可配置公开 GitHub 的 `owner/repository` 并手动检查。地址未配置时显示未配置且不联网，不使用知识库的 Git origin。

首次安装使用完整 `tt-workbench.zip`，手动步骤与 Agent 安装提示词见 [README](../../README.md#安装)。ZIP 包含原始 `release.json`，解压安装后可使用下述更新流程。不要直接解压覆盖已有插件目录。

## 检查与安装

更新器读取 GitHub 最新正式 Release，取得 `release.json` 与 `tt-workbench.bundle.json.gz` 两个附件。只有包版本高于运行版本才提示安装。检查使用 HTTPS，无需本机 Git 或 GitHub 凭据；网络失败、缺包与配置错误分别显示为未能检查，不冒充最新版。

用户点击安装后，使用检查时固定的附件 ID 下载包，核对大小、路径及每个文件的 SHA-256，并核对插件版本和最低 Obsidian 版本。本机受管理文件被修改、未知同名文件、符号链接、并发安装或下载损坏会停止替换。

安装保留本机 `data.json` 等非分发文件；准备目录和旧版恢复目录位于 `<配置目录>/plugins/tt-workbench-recovery/`。同机并发使用 `<配置目录>/plugins/tt-workbench.install-lock`。普通替换失败尝试恢复旧目录；进程在切换间被强制结束时需要依据锁、恢复目录及目标现状人工核对，不能直接删除锁或恢复目录。

安装成功后提示重启 Obsidian；重启前的运行版本保持原值。软件更新不操作知识库 Git、业务笔记、Skill 注册或用户级规则入口。正确指向插件内 Skill 的链接在插件路径保持时继续指向更新后的资源。

## 从 tannt 改名迁移

工作台显示名称为 `tt 工作台`，插件 ID、安装目录与构建包分别为 `tt-workbench`、`<配置目录>/plugins/tt-workbench/`、`tt-workbench.bundle.json.gz`。已有 `tannt-workbench` 安装通过一次显式迁移接续，旧更新器不能直接安装新 ID 的包。

1. 关闭目标库的 Obsidian，使用新版本工具执行 `node scripts/workbench/install.mjs --vault "<库绝对路径>" --check`。自定义配置目录继续传 `--config-dir`；离线安装可传 `--bundle "dist/tt-workbench.bundle.json.gz"`。检查只报告迁移位置，不写文件。
2. 核对目标后用相同参数去掉 `--check`、加上 `--migrate-legacy`。安装器验证旧 `release.json` 和受管理文件，保留 `data.json` 等本机文件；旧目录存入返回的 `recovery`，新旧目录共存、来源缺少基线或本机改动均停止并保留现场。
3. 重启 Obsidian，在第三方插件中启用「tt 工作台」。安装器只写插件目录，不改启用列表、快捷键或工作区文件；自定义快捷键需在 Obsidian 中重新绑定。新插件识别旧工作台页面类型和 `obsidian://tannt-capture` 剪藏链接，新建页面和书签使用 `tt` 标识。
4. 在「Skill 安装」对已核实的旧名称点击「迁移为新名称」，或按[Skill 迁移说明](agent-skill-setup.md#旧前缀迁移)使用 CLI。两种宿主分别执行，插件安装本身不注册或移除 Skill。

改名保留既有业务数据协议：网盘 `tannt-cloud-*` schema、本机授权档案位置、网盘 `tannt` 目录、Issue 评论标记和 FNS Git 引用继续兼容原数据；知识库名称及个人规则源路径由实例决定。

## 发布

1. 更新源码及 `package.json`、`apps/workbench/manifest.json` 的同一版本。
2. 执行 `npm test`、`npm run build`，验证完整包在隔离库可安装及受影响功能。
3. 在明确的发布授权内创建 GitHub Release，同时上传 `dist/tt-workbench.zip`、`dist/release.json` 和 `dist/tt-workbench.bundle.json.gz`。ZIP 用于用户首次安装，更新器继续读取后两个附件；它们必须来自同一次构建。`dist/plugin/` 是展开的完整安装目录，不能只取三个 Obsidian 常见入口文件。详细产物及验收要求见[开发说明](development.md)。

源码远端已接入 `https://github.com/cookaihq/tt-workbench.git`，凭证与发布范围见[项目 Git 使用说明](../agents/git.md)。本次接入只验证 Git 读取；自动化测试使用模拟的发布响应和真实本地文件安装，不代表真实 Release 发布或线上下载已验证。

## FNS 与恢复材料

使用 FNS 时排除 `<配置目录>/plugins/tt-workbench`、`<配置目录>/plugins/tt-workbench-recovery` 与实例实际运行目录及迁移控制目录；旧 `tannt-workbench` 和 `tannt-workbench-recovery` 的排除同样保留。界面逐项显示实际路径和覆盖状态，已被父目录排除同样有效。配置按钮是独立的本机操作，插件安装不自动调用；本机配置与插件已加载状态分别核验。

知识库 Git 与 FNS 完整配置快照仍服务知识库实例，可能含设备凭据，不能改用公开软件仓库。代码源码在库外，不再要求 FNS 同步开发文件。
