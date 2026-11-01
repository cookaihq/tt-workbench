# 工作台安装说明

手动安装步骤、可复制的 Agent 提示词与 macOS / Windows 安装命令见 [README](../../README.md#安装)。本文补充安装核验、已有插件处理和常见问题。

## 选择正确的安装包

从官方仓库 [`cookaihq/tt-workbench`](https://github.com/cookaihq/tt-workbench/releases) 的最新正式工作台 `v<版本>` Release 下载 `tt-workbench.zip`。`skills-…` 是独立 Skill 批次，不是工作台安装包。ZIP 包含一个顶层 `tt-workbench/` 文件夹，内部为完整插件和配套资源。自动生成的 `Source code` 是源码；`tt-workbench.bundle.json.gz` 供更新器和命令安装脚本读取，均不能代替可解压安装的 ZIP。

需要桌面版 Obsidian，最低版本以包内 `manifest.json` 的 `minAppVersion` 为准。基础安装不需要 Node.js、Git 或构建工具。没有正式版本或完整附件时，请报告尚不可下载，不用克隆构建替代用户安装。

## 命令安装

README 的命令从官方仓库 `main` 分支取得脚本，然后在本机执行；插件文件来自执行时选定的最新正式 Release。macOS 使用系统自带 Bash、JavaScript for Automation 和命令行工具；Windows 使用 PowerShell 5.1 / 7 与 .NET，不需要安装额外运行时或永久修改 PowerShell 执行策略。

两套脚本位于 `scripts/install/`。README 命令不需要填写路径：执行后，按提示将 Obsidian 知识库文件夹拖入终端并按回车，也可粘贴完整路径。脚本识别 macOS 终端的反斜杠转义、单 / 双引号，以及 Windows 的路径引号；输入仅作为路径处理，不执行其中的命令。

知识库绝对路径由本次输入明确指定，配置目录须已存在（默认 `.obsidian`）。自动化调用仍可使用 `--vault` / `-Vault` 参数跳过提示；可用 `--help` / `-Help` 查看参数。脚本不会从当前目录推断知识库，也不会创建新知识库。

如使用自定义配置目录，在 README 的 macOS 命令末尾加上 `-- --config-dir "你的配置目录"`，Windows 命令末尾加上 `-ConfigDir '你的配置目录'`。之后仍按提示拖入知识库文件夹。

脚本固定一次 Release 查询结果，下载同版 `release.json` 和 `tt-workbench.bundle.json.gz`，检查清单、路径、文件数量、大小、SHA-256、插件 ID 与版本，再安装并读回校验。只写 `<配置目录>/plugins/`，不改笔记、启用列表、设置或 Skill 入口。输出会提示插件要求的最低 Obsidian 版本；实际启用和兼容性需在 Obsidian 中确认。

下载与准备文件放在 `<配置目录>/plugins/tt-workbench-recovery/command-<随机标识>/`，正常退出时清理；使用现有的 `tt-workbench.install-lock` 路径避免同机安装器并发。下载、校验失败时不会写入正式插件目录；若在最终移动后读回失败，保留已安装目录并报告错误。进程被强制结束后，可能留下准备目录、锁或已移动的插件；先核对现场，再处理遗留项，不能直接重新覆盖。

如需离线安装，在另一台能联网的电脑上下载两套脚本中对应的一套，以及**同一正式 Release** 的 `release.json` 和 `tt-workbench.bundle.json.gz`，将这三个文件放到同一目录。在该目录打开终端，使用本机文件安装，例如：

```bash
bash ./install-macos.sh --package-dir "$PWD"
```

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-windows.ps1 -PackageDirectory $PWD.Path
```

运行后同样按提示拖入知识库文件夹并按回车。这里的 `-ExecutionPolicy Bypass` 只作用于本次 PowerShell 进程；组织策略仍可能限制执行。离线安装保留同样的校验与已有安装保护。

网络失败、GitHub 限流或 Release 缺少附件时，脚本会报错退出，可在网络恢复后重试，或使用离线方式。已有插件请按下文更新或迁移，不能通过删除原目录来跳过保护。

## Agent 安装核验

1. **核对目标**：使用用户明确给出的知识库绝对路径和 Obsidian 配置目录；默认目录名为 `.obsidian`，如用户已自定义则使用实际目录。缺少信息时询问，不从源码目录或当前工作目录推断目标。确认知识库已存在，读取其适用 Agent 规则，并让用户退出 Obsidian 后再写入插件。
2. **固定版本**：选定官方最新正式 Release，下载该版本的 `tt-workbench.zip` 与 `release.json`；两个文件必须来自同一 Release，不在下载途中重新选择 latest。记录版本及下载来源。
3. **核验完整性**：在临时目录检查 ZIP，拒绝绝对路径、`..` 越界、链接、重复路径及大小写冲突；所有条目应位于唯一顶层 `tt-workbench/` 内。包内 `release.json` 应与同版独立清单一致，清单 ID 为 `tt-workbench`。逐文件核对清单中的 SHA-256，除清单本身及普通目录条目外不得有未登记文件；缺失或不符即停止。核对 `manifest.json` 的 ID、版本与最低 Obsidian 版本。清单用于校验文件一致性，不是独立的发布者签名，下载来源仍应为上述官方仓库。
4. **区分首次安装与更新**：检查实际 `<配置目录>/plugins/` 中是否存在 `tt-workbench` 或旧 `tannt-workbench`，并核对目标路径不经过链接。首次安装才将已核验的完整目录放入 `plugins/tt-workbench/`；写入前重新确认目标未出现已有内容，不覆盖并发创建的目录。已有安装按下节处理。
5. **读回结果**：在最终位置重新核对文件清单和版本。安装只写插件及内置资源，不修改业务笔记、Skill 发现入口、FNS 配置或个人全局规则，也不改 Obsidian 的启用列表。报告实际版本、安装位置、校验结果，并指导用户重开 Obsidian、启用「tt 工作台」、执行「打开工作台」。文件安装成功与 Obsidian 实际加载分别报告。

## 已有工作台

- **已安装 `tt-workbench`**：优先在工作台点击右上角版本号，按[更新说明](updates.md)检查并安装，保留 `data.json` 等本机文件。不要直接解压覆盖旧目录。
- **已安装 `tannt-workbench`**：使用[改名迁移流程](updates.md#从-tannt-改名迁移)，保留插件设置与恢复材料；插件迁移后单独处理 Skill 入口。
- **无法在界面更新或需要离线处理**：可使用新包中的 `scripts/workbench/install.mjs` 与同版 `tt-workbench.bundle.json.gz`，显式传入目标库和配置目录。这是需要 Node.js 22 或更新版本的维护入口，参数见[开发说明](development.md#安装开发版本)与安装器 `--help`，不要求从源码构建。

缺少校验清单、本机受管理文件被修改、同名冲突或未知链接时保留现场并说明原因。不要删除锁、恢复目录或用户文件来强行继续；恢复与迁移材料按当前设备约定处理。

独立 Skill 更新后，已安装目录由各自的 `skill-package.json` 核验，不再用工作台最初交付的 Skill 哈希判为本机损坏。工作台安装器会保留这些独立包；检查现有安装时分别核验核心清单与各 Skill 清单。原始 ZIP 本身仍须完整匹配发布清单。带 `skillSource.kind: development` 的包只供明确的隔离开发测试，不能作为正式安装来源。

## 目标库规则与初始化

安装和升级都保留目标库自己的 Agent 入口、规则及概念。软件规则随插件交付供核对能力；是否采用其默认业务模型，由目标库明确选择。新库需要规则时，按[明确采用默认规则](../agents/package-layout.md#新目标库采用默认规则)在获授权的初始化工作中维护入口和所需正文；安装器不提供自动导入规则的命令。个人全局规则另由所选规则源维护与接入。

## 常见问题

**找不到 `.obsidian` 文件夹。** 在系统文件管理器中开启显示隐藏文件；使用自定义配置目录时查找相应目录。若尚未创建知识库，先在 Obsidian 中创建并打开它。

**已解压，但第三方插件列表没有工作台。** 检查 `manifest.json` 是否直接位于 `<知识库>/<配置目录>/plugins/tt-workbench/`，而非多嵌套一层文件夹；保留所有文件，确认使用桌面版且版本满足要求，再重启 Obsidian。

**启用后找不到入口。** 在命令面板搜索「tt 工作台」，执行「打开工作台」，或点击左侧工作台图标。

**是否必须使用 FNS 或安装全部 Skill？** 基础笔记功能不要求 FNS 或 Agent。Skill 按需在「系统 → Skill 安装」中设置；使用 FNS 时先按[同步排除说明](updates.md#fns-与恢复材料)配置本机排除。
