# 工作台开发与发布

本文面向维护源码或测试开发版本的人。普通用户从 [README](../../README.md#安装) 下载完整安装包，或复制安装提示词交给 Agent，无需构建环境。

## 开发环境与测试

需要 Node.js 22 或更新版本，不需要安装 npm 依赖。仓库自带 YAML 和 JSONC 解析器，来源与许可证随源码保留。Git 接入、分支、提交与发布遵循[项目 Git 使用说明](../agents/git.md)。

```powershell
npm test
npm run build
```

`npm test` 可独立执行。FNS 旧扫描器集成测试需要另备 FNS 2.4.0 插件，通过 `TEST_FNS_BUNDLE` 指定其 `main.js`；缺少时明确跳过对应外部集成测试。真实 GitHub 下载、Obsidian 加载及其他设备需要在相应环境另行验证。

ZIP 回归测试使用 Windows PowerShell 或其他系统的 `unzip` 独立解压，验证中文、隐藏、空与二进制文件以及后续升级；缺少系统解压工具时明确跳过该测试。构建本身只需要 Node.js。

## 构建产物

一次构建从同一份文件清单生成以下产物：

| 产物 | 用途 |
| --- | --- |
| `dist/tt-workbench.zip` | 用户首次安装；解压得到完整 `tt-workbench/` 目录 |
| `dist/release.json` | 发布版本与各文件的 SHA-256 校验清单 |
| `dist/tt-workbench.bundle.json.gz` | 内置更新器与安装 CLI 读取的更新包 |
| `dist/plugin/` | 展开的完整插件文件，便于本地检查 |

ZIP 中包含 `release.json`、插件模块、共享实现、工具、Skill、模板与规则；不能只分发三个常见 Obsidian 入口文件。ZIP 使用标准 DEFLATE 和 UTF-8 文件名，无需额外打包程序。安装后保留原始目录与校验清单，使后续内置更新能够核验已有文件。

## 安装开发版本

显式指定隔离测试库的绝对路径，不把源码目录或当前工作目录当作目标知识库：

```powershell
npm run install-plugin -- --vault "D:\Knowledge\WorkbenchTest"
```

自定义 Obsidian 配置目录追加 `--config-dir "obsidian-settings"`。`--help` 和 `--check` 均不安装；`--check` 比较目标与拟安装文件，存在差异时返回非零退出码。安装器读取源码生成完整包，也可以指定已生成的更新包：

```powershell
node scripts/workbench/install.mjs --vault "D:\Knowledge\WorkbenchTest" --bundle "dist/tt-workbench.bundle.json.gz"
```

安装只写插件目录及安装恢复材料，不创建业务笔记、不注册 Skill、不设置 FNS 或个人规则。首次安装后在 Obsidian 启用「tt 工作台」；更新后重启应用。已有文件缺少校验清单、受管理文件被修改或目标包含未知链接时停止，不能覆盖跳过核验。旧 `tannt-workbench` 安装使用[改名迁移流程](updates.md#从-tannt-改名迁移)。

本地验收应包含：用系统解压工具打开 ZIP、核对中文资源文件名及完整清单、在隔离库安装、从该安装升级并保留 `data.json`。合成验收文件放在忽略的 `tmp/<用途>/`，不要在用户真实知识库创建测试笔记。

## 发布

1. 更新 `package.json` 与 `apps/workbench/manifest.json` 的同一版本。
2. 执行测试与构建，核对 ZIP、展开目录和更新包包含相同的文件及清单，并完成受影响功能的隔离验收。
3. 在明确发布授权范围内创建正式 GitHub Release，同时上传 **`tt-workbench.zip`、`release.json`、`tt-workbench.bundle.json.gz`** 三个附件。不要把 GitHub 的 `Source code` 附件当作插件安装包。
4. 回读 Release 的附件，核验版本及下载内容。首次公开发布时同步更新 README 中的发布状态提示；实际下载成功后才能将入口记为可用。

构建不自动提交、推送或创建 Release。首次安装使用 ZIP，内置更新继续读取 JSON 清单和 gzip 更新包，详细行为见[工作台版本与更新](updates.md)。

## 源码与实例

插件源码在 `apps/workbench/`，共享实现位于 `lib/`，工具位于 `scripts/`，活动 Skill 清单位于 `skills/manifest.jsonc`。安装副本由本仓生成，修改正式源。

知识库笔记、账号、FNS 设置与运行记录归目标实例。FNS 配置传输使用知识库自己的仓库，不能指向公开的软件仓库。独立 CLI 通过 stdin 接收 JSON，始终指定 `--vault <绝对路径>`，无需 Obsidian 运行；参见[软件与知识库位置](../agents/package-layout.md)和[文件操作](../agents/vault-file-operations.md)。

历史源码提交留在原 tannt 仓库；本仓建立独立历史，背景见[拆仓决定](../adr/0005-independent-workbench-repository.md)。原始本机验收材料位于 Git 忽略的 `local-evidence/`；历史验证不能替代新版本验收。
