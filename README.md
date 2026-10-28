# tt-workbench

可独立安装的桌面 Obsidian 工作台，包含笔记与项目管理、Agent 配套工具、五个场景 Skill、模板及规则。任意名称和位置的知识库均可使用；业务内容沿用五目录与 Project／Task 约定。

## 构建与安装

需要 Node.js 22 或更新版本，不需要安装 npm 依赖。仓库自带所需 YAML 和 JSONC 解析器，其来源与许可证随源码保留。

```powershell
npm test
npm run build
npm run install-plugin -- --vault "D:\Knowledge\MyVault"
```

自定义 Obsidian 配置目录追加 `--config-dir "obsidian-settings"`。安装前可使用 `--check` 比较文件；`--help` 和 `--check` 均不执行安装。之后在 Obsidian 中启用「tannt 工作台」。插件仅支持桌面端。

安装只写插件文件和内置资源。首次安装不修改业务笔记、账号、FNS、Skill 发现入口或用户全局规则。基础笔记功能不要求 FNS；使用 FNS 时另行设置插件和运行记录排除。

构建产物为 `dist/plugin/`、`dist/release.json` 和 `dist/tannt-workbench.bundle.json.gz`。完整插件包包含共享模块、工具与规则，不能只复制 `main.js`。离线分发包可这样安装：

```powershell
node scripts/workbench/install.mjs --vault "D:\Knowledge\MyVault" --bundle "dist/tannt-workbench.bundle.json.gz"
```

已有插件缺少校验清单、安装文件被修改或目标含未知链接时会停止；先核对来源和保留恢复材料，再执行迁移，不能覆盖跳过校验。

## Skill 与 Agent 工具

Skill 安装是独立操作，使用已安装插件内的安装器，避免日常使用依赖开发仓库：

```powershell
node "D:\Knowledge\MyVault\.obsidian\plugins\tannt-workbench\scripts\agent-skills\install.mjs" --vault "D:\Knowledge\MyVault" --agent codex
```

Claude Code 使用 `--agent claude`；明确需要两个宿主时使用 `--agent all`。在目标知识库中新开会话验证发现，参见[接入说明](docs/workbench/agent-skill-setup.md)。Skill 安装 UI 尚处于需求与原型阶段，确认后实施。

独立 CLI 通过 stdin 接收 JSON，始终指定 `--vault <绝对路径>`，无需 Obsidian 运行。规则／工具的位置与目标库分别解析，见[路径约定](docs/agents/package-layout.md)及[文件操作](docs/agents/vault-file-operations.md)。

## 发布与更新

GitHub 远端尚未配置，也未公开发布。后续发布时递增 `package.json` 与插件 manifest 的版本，测试、构建，并把两个发布文件作为同一 GitHub Release 的附件上传。软件更新读取配置的公开 `owner/repository`，提示新版本后由用户点击安装；不使用知识库 Git 远端。详细行为见[更新说明](docs/workbench/updates.md)。

源码在本仓库维护；知识库笔记、账号、FNS 设置与运行记录归知识库实例。FNS 配置传输仍使用知识库自己的仓库，不可指向公开软件仓库。历史源码提交留在原 tannt 仓库；本仓从当前版本建立新历史。迁移的原始本机验收材料位于 Git 忽略的 `local-evidence/`，历史验证不能替代新版本验收。

`npm test` 可独立执行。FNS 旧扫描器的集成测试需要用户另备 FNS 2.4.0 插件，通过 `TEST_FNS_BUNDLE` 指定其 `main.js`；缺少时明确跳过这些外部集成测试。真实 GitHub 更新和其他电脑的实际加载需在相应环境另行验证。
