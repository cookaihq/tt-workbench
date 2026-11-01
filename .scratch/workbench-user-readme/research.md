# 用户 README 调研

调研日期：2026-10-29。范围：Obsidian 插件仓库首页及其官方安装文档；使用 ego-browser 实际读取公开页面，没有安装或执行第三方插件代码。本文记录观察与建议；[README 提案](proposal.md) 是待用户确认的设计，不代表安装包已发布。

## 参考仓库与实际观察

| 项目 | 已核实的写法与简短摘录 | 可借鉴之处 |
| --- | --- | --- |
| [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) | 开头用 “Track tasks across your entire vault” 说明用途，紧接用户指南、贡献指南和更新入口。正文依次有 Screenshots、Installation、Getting Started、Documentation、Development。安装步骤是搜索 Tasks、启用、检查设置；开发章节才出现 `yarn` 和 `yarn dev`。 | 首屏说明使用结果；安装与首次使用紧邻；开发构建放在用户流程后面。示例截图配一句用途说明，避免只放装饰图片。 |
| [Templater](https://github.com/SilentVoid13/Templater) | 用一段话解释模板插件能把变量和函数结果写入笔记，随后 “Check out the complete documentation to start using Templater.” 指向[官方文档](https://silentvoid13.github.io/Templater/)。帮助与模板分享指向 Discussions；Contributing 指向独立的 `CONTRIBUTING.md`。本次首页没有单独的安装章节。 | README 可以是简洁入口，完整使用说明和贡献说明分别链接；不能把没有安装章节误说成其提供了下载解压流程。 |
| [Dataview](https://github.com/blacksmithgu/obsidian-dataview) | 开头 “Treat your Obsidian Vault as a database which you can query from.”，随后 Examples 展示查询代码和对应结果图，Usage 指向[完整参考](https://blacksmithgu.github.io/obsidian-dataview/)。`git clone`、`npm install`、`npm run dev` 位于 Contributing 下的 Local Development；`npm run build` 属于开发者向其他库安装测试版的说明。 | 用具体场景解释价值；技术步骤必须标出适用人群，开发自测步骤不应成为普通用户安装步骤。 |
| [Excalidraw](https://github.com/zsviczian/obsidian-excalidraw-plugin) | 开头说明在知识库保存、编辑、嵌入和链接绘图，提供中英文入口、Wiki、视频与课程。另有独立的 “Native CLI for coding agents” 章节，说明 Agent 功能的 Obsidian 版本和 CLI 条件，并链接 [CLI 文档](https://github.com/zsviczian/obsidian-excalidraw-plugin/blob/master/docs/CLI.md) 与 [Agent Skill](https://github.com/zsviczian/obsidian-excalidraw-plugin/blob/master/docs/AITrainingData/excalidraw-cli/SKILL.md)。 | 普通使用与 Agent 使用可以分别呈现；Agent 能力有额外条件时应在该入口说明。其当前首页很长，不建议 tt-workbench 照搬全部设置和教程。 |
| [Calendar](https://github.com/liamcain/obsidian-calendar-plugin) | 一句话说明用日历查看与跳转日记。Usage 明确告诉用户启用后右侧栏会出现日历；Compatibility 单独写最低 Obsidian 版本；Installation 写 “You can install the plugin via the Community Plugins tab within Obsidian. Just search for ‘Calendar.’”；FAQ 回答视图关闭后如何重新打开等实际问题。 | 安装步骤应以“看到了什么”为结束；环境要求简短独立，常见问题围绕用户实际卡点。 |

另外读取了 [Periodic Notes](https://github.com/liamcain/obsidian-periodic-notes)：首页以周记、月记用途、命令和设置表格为主，有 FAQ；本次没有看到安装章节。它适合参考功能说明的写法，不作为手工下载安装范例。

Tasks 的[官方安装页](https://publish.obsidian.md/tasks/Getting+Started/Installation)进一步确认：安装指引从社区插件搜索与启用开始，随后设置和快捷键；没有让普通用户克隆仓库或编译。README 所链的旧路径 `Installation/Installation` 会跳到该 Getting Started 路径。

## 对本项目的结论

最值得借鉴的是信息顺序与读者划分，不是直接照抄别人的安装途径：

1. 开头用中文说明“工作台能帮用户完成什么”，随后放一张真实工作台截图和下载、使用说明入口。
2. 安装章节明确环境条件，提供“手动下载安装”和“让 Agent 安装”两种并列路径。
3. 手动流程写清下载附件名、目标目录、完整目录层级、重启和启用步骤，并给出成功后如何打开工作台。
4. 首次使用、可选 Skill、更新和常见问题各保留简短入口；源码构建、测试、发布细节移到开发文档。

本次样本中 Tasks、Calendar 使用社区插件安装。尚未核实 tt-workbench 在社区插件市场可用，不能照搬“搜索并安装”或宣传社区市场支持。也未在这些抽样 README 中看到可复制给 Agent 的完整安装提示词；这一入口是基于本次用户要求提出的本项目设计，并非冒充参考仓库已有范式。

## 本项目安装说明的现实前提

以下是本机源码及公开页面的当前观察，不能写成已经交付的下载能力：

- [插件 manifest](../../apps/workbench/manifest.json) 指定插件 ID 为 `tt-workbench`，当前版本 `0.24.0`，最低 Obsidian `1.8.7`，仅支持桌面端。
- [构建脚本](../../scripts/workbench/build.mjs) 目前生成 `dist/plugin/`、`dist/release.json`、`dist/tt-workbench.bundle.json.gz`，没有生成普通用户可直接解压的 ZIP。`.bundle.json.gz` 是程序读取的更新包，不能把它描述成解压后即可使用的插件目录。
- [更新说明](../../docs/workbench/updates.md) 明确插件包含共享模块、工具和规则，完整安装不能只取 `main.js`、`manifest.json`、`styles.css`。未来面向用户的 ZIP 必须包含完整资源和 `release.json`，还要验证解压后目录层级与更新器兼容。
- 实际打开 [tt-workbench Releases](https://github.com/cookaihq/tt-workbench/releases) 时，公开页面标题正常，正文明确显示 **“There aren’t any releases here”**。这说明本次访问没有可供用户下载的公开 Release；不是从访问错误或 404 推断而来。访问未使用仓库凭据。
- “下载完整 ZIP → 解压安装”目前是待落地方案。正式 README 使用该流程前，需要生成、验证并在授权范围内发布相应附件。GitHub 自动生成的 Source code ZIP 不等同于完整插件安装包。

## Agent 安装提示词应覆盖的约束

提示词正文宜保持可复制，详细异常处理可链接独立安装文档。应包含：

- 指定仓库和官方 Release 来源，优先最新正式发布的完整插件安装包；下载不可用时如实报告，不擅自克隆构建来替代用户安装。
- 让用户填写目标知识库的绝对路径，以及适用的 Obsidian 配置目录；未提供时先询问，不把源码目录或当前工作目录当知识库。
- 安装完整目录到 `<知识库>/<配置目录>/plugins/tt-workbench/`，防止多嵌套一级 `tt-workbench`；最低 Obsidian 版本、插件 ID 和发布版本应核实。
- 用户基础安装不需要 Node.js 或 npm。只有后续明确使用外部 CLI 时，才按相应工具说明处理运行环境。
- 已有插件目录时，保留设置与用户内容，按项目既有更新方式处理；不直接用解压覆盖冒充安全更新。遇到缺少清单、本地改动或未知链接时报告具体情况。
- 插件安装只安装插件文件及内置资源；Skill 注册、FNS 配置、业务笔记初始化与个人全局规则接入是单独操作，不能隐含在插件安装内。
- 完成后报告实际版本和安装目录，并指导用户重启 Obsidian、启用「tt 工作台」、打开工作台；没有实际启用或加载验证时不要宣称已验证成功。

## 证据与边界

原始页面正文、标题和链接提取保存在本机临时目录 `tmp/readme-research-20261029/`，不作为正式产品文件。浏览器任务已关闭。部分 GitHub 导航等待 `load` 超时，但页面已进入 `interactive`；继续读取同一页面确认了标题和完整 README 正文。本次仅核实文档内容与公开 Releases 可见状态，没有验证其他插件安装、tt-workbench 跨平台安装或真实发布下载。
