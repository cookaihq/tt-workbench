# 工作台版本与更新

工作台源码在独立软件仓库，知识库使用完整安装包。顶部版本号表示当前运行版本；启动后及定时检查新版本，点击版本号可配置公开 GitHub 的 `owner/repository` 并手动检查。地址未配置时显示未配置且不联网，不使用知识库的 Git origin。

## 检查与安装

更新器读取 GitHub 最新正式 Release，取得 `release.json` 与 `tannt-workbench.bundle.json.gz` 两个附件。只有包版本高于运行版本才提示安装。检查使用 HTTPS，无需本机 Git 或 GitHub 凭据；网络失败、缺包与配置错误分别显示为未能检查，不冒充最新版。

用户点击安装后，使用检查时固定的附件 ID 下载包，核对大小、路径及每个文件的 SHA-256，并核对插件版本和最低 Obsidian 版本。本机受管理文件被修改、未知同名文件、符号链接、并发安装或下载损坏会停止替换。

安装保留本机 `data.json` 等非分发文件；准备目录和旧版恢复目录位于 `<配置目录>/plugins/tannt-workbench-recovery/`。同机并发使用 `<配置目录>/plugins/tannt-workbench.install-lock`。普通替换失败尝试恢复旧目录；进程在切换间被强制结束时需要依据锁、恢复目录及目标现状人工核对，不能直接删除锁或恢复目录。

安装成功后提示重启 Obsidian；重启前的运行版本保持原值。软件更新不操作知识库 Git、业务笔记、Skill 注册或用户级规则入口。正确指向插件内 Skill 的链接在插件路径保持时继续指向更新后的资源。

## 发布

1. 更新源码及 `package.json`、`apps/workbench/manifest.json` 的同一版本。
2. 执行 `npm test`、`npm run build`，验证完整包在隔离库可安装及受影响功能。
3. 在明确的发布授权内创建 GitHub Release，上传 `dist/release.json` 和 `dist/tannt-workbench.bundle.json.gz`。`dist/plugin/` 是展开的完整安装目录，不能只取三个 Obsidian 常见入口文件。

当前尚无 GitHub 远端或真实发布；自动化测试使用模拟的发布响应和真实本地文件安装，不代表线上下载已验证。

## FNS 与恢复材料

使用 FNS 时排除 `<配置目录>/plugins/tannt-workbench`、`<配置目录>/plugins/tannt-workbench-recovery` 与 `apps/workbench/data`。界面显示实际三个目录和覆盖状态，已被父目录排除同样有效。配置按钮是独立的本机操作，插件安装不自动调用；本机配置与插件已加载状态分别核验。

知识库 Git 与 FNS 完整配置快照仍服务知识库实例，可能含设备凭据，不能改用公开软件仓库。代码源码在库外，不再要求 FNS 同步开发文件。
