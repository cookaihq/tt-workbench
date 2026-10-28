# tt-workbench 开发入口

本仓库维护可独立安装的桌面 Obsidian 工作台、共用文件模块、CLI、Skill、模板和规则。术语见 `GLOSSARY.md`，拆仓决定见 `docs/adr/0005-independent-workbench-repository.md`。

- `apps/workbench/` 是插件源码，`lib/` 是共享实现，`scripts/` 是工具，`skills/manifest.jsonc` 是活动 Skill 清单。安装副本由打包安装流程生成；修改正式源。
- 知识库由用户明确指定。CLI 使用 `--vault <绝对路径>`；源码目录和当前工作目录不能自动充当目标知识库。业务模型与写入协议按 `docs/rules/` 的适用主题读取。
- 插件安装仅写插件目录。业务初始化、配置、Skill 发现注册和全局规则接入由明确操作执行，不能成为安装副作用。
- 维护个人全局 Agent 规则前，读取已确认规则源中的 `README.md` 与 `scenarios-agent-instructions/maintaining-agent-instructions-and-project-rules.md`。本机正式源为 `D:/zhao/tannt_vault/tannt/docs/global-agent-instructions/`，由 Obsidian 仓库管理；工作台提供读取和接入工具，项目开发规则继续留在本仓。
- 修改配置读取前读 `docs/rules/writing-and-changes.md` 的 JSONC 约定。修改文件操作、FNS、网盘或 Issue 时，读取对应规则并测试受影响入口。
- 功能规格与实施证据在 `.scratch/<功能>/`；临时文件在已忽略的 `tmp/<用途>/`。`local-evidence/` 保存迁入的本机历史证据，不纳入公开 Git。
- 用户笔记、账号凭据、FNS 设备快照及知识库运行记录属于目标实例。FNS 配置传输使用目标知识库自己的仓库，不能改用公开的软件仓库。
- 迁移或删除前核对源版本，先验证目标和引用。保留其他会话修改。备份遵循当前设备的全局约定。
- 使用 `npm test`、`npm run build` 与 `npm run install-plugin -- --vault <目标库>`；命令帮助说明具体参数。历史迁移脚本仅用于回查当时操作，不作为新库初始化流程。

迁仓完成后再开展 Skill 安装 UI 需求和原型，用户确认原型后实施，见 `.scratch/workbench-skill-installation/spec.md`。
