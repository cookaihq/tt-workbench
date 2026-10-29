# tt 工作台

在 Obsidian 中收集笔记、管理项目与任务，并通过配套 Skill 与 Agent 协作。内容保存在知识库的 Markdown 文件中，可以继续使用 Obsidian 阅读和编辑。

[安装](#安装) · [开始使用](#开始使用) · [Agent Skill](#agent-skill) · [更新](#更新) · [使用说明](apps/workbench/README.md)

## 能做什么

- **收集与整理**：记录想法、文字和链接，将收件箱内容整理到项目、任务、领域或资源。
- **推进项目与任务**：记录目标、完成条件、进展和下一步，按状态查看工作，归档或恢复已有内容。
- **阅读与编辑**：浏览和搜索知识库笔记，查看关联内容与附件，打开原笔记继续编辑。
- **与 Agent 协作**：为 Codex、Claude Code 安装配套 Skill，让 Agent 保存新内容、更新笔记、检查配置和整理规则。

工作台按 `0.收件箱`、`1.项目`、`2.领域`、`3.资源`、`4.存档` 组织内容，知识库名称和位置不限。目录约定见[知识库结构](docs/rules/scope-and-directories.md)。

## 安装

需要 **桌面版 Obsidian 1.8.7 或更新版本**，以及一个已经创建的知识库。安装工作台无需克隆源码、安装 Node.js 或执行构建命令。

> 完整安装包请从 [最新正式 Release](https://github.com/cookaihq/tt-workbench/releases/latest) 下载 `tt-workbench.zip`；同版 `release.json` 提供文件校验清单。

### 方式一：下载并解压

以下步骤用于首次安装。已有工作台请看[更新](#更新)；旧版 `tannt-workbench` 用户请看[改名迁移说明](docs/workbench/updates.md#从-tannt-改名迁移)。

1. 打开 [Releases 下载页](https://github.com/cookaihq/tt-workbench/releases)，在最新正式版本的 **Assets（附件）** 中下载 **`tt-workbench.zip`**。页面自动生成的 `Source code` 是源码压缩包，不用于安装。
2. 退出 Obsidian，解压安装包，将里面的整个 **`tt-workbench` 文件夹**放入知识库的 `.obsidian/plugins/` 目录；没有 `plugins` 文件夹时创建它。
3. 确认目录如下，并保留包内全部文件与子目录：

   ```text
   你的知识库/
   └── .obsidian/
       └── plugins/
           └── tt-workbench/
               ├── manifest.json
               ├── main.js
               ├── styles.css
               ├── release.json
               └── …其余文件与资源目录
   ```

4. 重新打开 Obsidian，在「设置 → 第三方插件」中允许使用第三方插件，然后启用 **「tt 工作台」**。
5. 点击左侧工作台图标，或在命令面板中搜索「tt 工作台」并执行「打开工作台」。

`.obsidian` 通常是隐藏文件夹，可在文件管理器中开启显示隐藏文件。如果使用了自定义 Obsidian 配置目录，将上面的 `.obsidian` 换成自己的目录名。

### 方式二：让 Agent 帮忙安装

将下面的提示词复制给能够操作本机文件的 Agent，例如 Codex 或 Claude Code，并填写知识库的绝对路径。

```text
请帮我安装 Obsidian 插件 tt-workbench：
https://github.com/cookaihq/tt-workbench

知识库绝对路径：<填写我的知识库路径>
Obsidian 配置目录：.obsidian（如有自定义，请替换）

先阅读仓库当前 README 和 docs/workbench/installation.md，
下载最新正式 Release 的 tt-workbench.zip 及同版 release.json，
核验后按用户安装说明安装，无需克隆源码或构建。
如果没有可用发布包，请说明情况。

先核对知识库与配置目录，缺少必要信息时询问我。
若已有插件（包括旧 tannt-workbench），按更新或迁移说明处理，
保留设置与本机文件，遇到冲突先报告。

本次仅安装插件，不修改笔记、同步配置、Skill 入口或个人规则。
完成后报告版本、安装位置与校验结果，并指导我启用和打开工作台。
```

## 开始使用

1. 打开工作台，用「随手记」保存一条想法或链接；保存后可以在收件箱中找到它。
2. 需要推进一项工作时创建项目，再为项目添加任务，记录完成条件和下一步。
3. 需要 Agent 帮忙保存或整理内容时，再按下方步骤安装 Skill。

插件安装只添加工作台及内置资源。笔记由你在使用时创建，Skill、账号和个人规则按需设置。基础笔记功能无需 FNS；使用 FNS 同步时，请先按[同步排除说明](docs/workbench/updates.md#fns-与恢复材料)设置本机排除目录。

更多操作见[使用说明](apps/workbench/README.md)、[项目与任务](docs/workbench/work-records.md)和[浏览器剪藏](docs/workbench/browser-capture.md)。

## Agent Skill

在「系统 → Skill 安装」中选择 **Codex** 或 **Claude Code**，安装单项或全部未安装的 Skill：

| Skill | 用途 |
| --- | --- |
| `tt-capture` | 保存想法、文字和链接 |
| `tt-update-note` | 补充笔记、整理收件箱、归档或恢复 |
| `tt-cloud-files` | 管理网盘中的托管文件 |
| `tt-sync-agent-config` | 按知识库清单检查 Agent 配置 |
| `tt-organize-agent-rules` | 整理规则并接入选定的规则源 |

安装后，在目标知识库中新开 Agent 会话，检查 Skill 是否可用。外部 Agent 调用配套命令行工具需要 Node.js 22 或更新版本；网盘账号等服务按对应 Skill 的指引单独配置。详见[Skill 安装与使用](docs/workbench/agent-skill-setup.md)。

## 更新

点击工作台右上角的版本号。首次使用时，将更新来源设为 **`cookaihq/tt-workbench`**，然后检查更新；有新版本时点击安装，完成后按提示重启 Obsidian。

内置更新保留插件设置。若提示文件被修改或发生冲突，请查看[更新与恢复说明](docs/workbench/updates.md)。

## 帮助与反馈

- 插件没有出现：确认 `manifest.json` 直接位于 `.obsidian/plugins/tt-workbench/`，没有多套一层目录；检查 Obsidian 版本并重启应用。
- 找不到工作台：在命令面板中搜索「tt 工作台」，执行「打开工作台」。
- 安装或校验遇到问题：查看[安装说明](docs/workbench/installation.md)。
- 反馈问题或建议：前往 [GitHub Issues](https://github.com/cookaihq/tt-workbench/issues)，附上插件版本、Obsidian 版本和复现步骤。

## 开发与贡献

源码构建、测试、本地安装和发布流程见[开发说明](docs/workbench/development.md)。
