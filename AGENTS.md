# tt-workbench 开发入口

本仓库维护可独立安装的桌面 Obsidian 工作台、共用文件模块、CLI、Skill、模板和规则。术语见 `GLOSSARY.md`，拆仓决定见 `docs/adr/0005-independent-workbench-repository.md`。

本文路径相对于工作台根；目标库路径另行注明。

## 常驻要求

- `apps/workbench/` 是插件源码，`lib/` 是共享实现，`scripts/` 是工具，`skills/manifest.jsonc` 是活动 Skill 清单。安装副本由打包安装流程生成；修改正式源。
- 知识库由用户明确指定。CLI 使用 `--vault <绝对路径>`；源码目录和当前工作目录不能自动充当目标知识库。操作目标库前，按下方入口执行“目标库规则读取”，从该库实际 Agent 入口选择业务与场景规则；本仓 `docs/rules/` 维护软件所需模型与契约。
- 插件安装仅写插件目录。业务初始化、配置、Skill 发现注册和全局规则接入由明确操作执行，不能成为安装副作用。
- 修改配置读取前，读取并遵守[写入与变更](docs/rules/writing-and-changes.md)的 JSONC 约定。修改文件操作、FNS、网盘或 Issue 时，按下方场景及[软件规则索引](docs/rules/README.md)读取适用规则，并测试受影响入口。
- 功能规格与实施证据在 `.scratch/<功能>/`；临时文件在已忽略的 `tmp/<用途>/`。`local-evidence/` 保存迁入的本机历史证据，不纳入公开 Git。
- 用户笔记、账号凭据、FNS 设备快照及知识库运行记录属于目标实例。FNS 配置传输使用目标知识库自己的仓库，不能改用公开的软件仓库。
- 迁移或删除前核对源版本，先验证目标和引用。保留其他会话修改。备份遵循当前设备的全局约定。
- 使用 `npm test`、`npm run build` 与 `npm run install-plugin -- --vault <目标库>`；命令帮助说明具体参数。历史迁移脚本仅用于回查当时操作，不作为新库初始化流程。

Skill 安装 UI 已按确认的原型实施，当前证据见 `.scratch/workbench-skill-installation/implementation.md`；历史规格不代替新版本验收。

## 按需读取的项目规则

开始下列工作前，必须读取并遵守对应的现行文档；同时符合多个场景时，读取全部适用文档，并按正文的明确要求读取后续规则。退役文档仅按历史回查场景读取。新增、重命名、改变适用范围或退役 `docs/agents/` 文档时，同步更新本索引。

### 开发与协作

| 使用场景与读取时机 | 必读文档 |
| --- | --- |
| 执行本项目任何 Git 操作前，包括只读检查、分支、Worktree、提交与发布 | [Git 仓库接入、提交与版本发布](docs/agents/git-access-commit-and-release.md) |
| 探索代码、讨论领域概念、维护 `GLOSSARY.md` 或编写／修改 ADR 前 | [领域文档约定](docs/agents/domain.md) |
| 设计或修改规则、共同概念、格式、Skill、模板、CLI、读写或展示行为，或接收目标库相关交接前 | [工作台变更联动](docs/agents/workbench-change-coordination.md) |
| 跟踪本仓开发任务，读取、新建或更新 GitHub Issue、评论和依赖，或维护既有本地开发记录前 | [开发任务与 Issue 流程](docs/agents/issue-tracker.md) |
| 分诊或关闭 GitHub Issue，或维护既有本地 Issue 的分诊及关闭结果前 | [分诊标签与关闭映射](docs/agents/triage-labels.md) |

### 目标库与配置操作

本组文档说明软件契约和工具流程。实际操作目标库时，先执行“目标库规则读取”，以该库选定的规则和配置为依据；维护软件实现时读取这些文档，不自动执行实例检查或修改实例设置。

| 使用场景与读取时机 | 必读文档 |
| --- | --- |
| 使用工作台 Skill、CLI 或插件操作目标库，核对软件／目标库／规则源位置，或配置、迁移运行目录前 | [软件位置与目标库规则读取](docs/agents/package-layout.md) |
| 开发或调用业务文件的读写、新建、附件、迁移、归档与恢复工具前 | [业务文件操作](docs/agents/vault-file-operations.md) |
| 建立或修改目标库的 Agent 配置检查清单，或核对其结构与检查标准前 | [配置清单约定](docs/agents/agent-config-checklist.md) |
| 检查、同步或应用目标库清单所列 Agent／设备配置，或维护、执行 `tt-sync-agent-config` 流程前 | [配置检查与同步](docs/agents/agent-config-sync.md) |
| 检查或维护目标库 FNS 本机配置、旧链接迁回、本机文件保护，或设计、维护、执行共享规则发布、接收与应用前 | [FNS 本机配置与旧链接迁回](docs/agents/fns-device-config.md) |
| 为已明确采用 FNS 传递网盘目标的库配置、检查同步、接入新设备、迁移旧 `.env` 或退役旧补丁，或维护相应软件能力前 | [网盘目标配置的 FNS 同步维护](docs/agents/fns-cloud-targets-sync.md) |
| 维护隐藏项检查能力；在已采用该流程的目标库中准备新建点号名称文件／目录；或用户明确要求检查 FNS 隐藏项时，在执行前读取 | [FNS 隐藏项检查](docs/agents/fns-hidden-item-check.md) |

### 退役文档与历史回查

| 使用场景与读取时机 | 历史文档 |
| --- | --- |
| 回查旧根目录 `.env` 同步方案或单文件补丁的历史依据时读取；现行设置、迁移及补丁退役遵守上表的网盘目标配置流程 | [根目录 `.env` 同步方案（已退役）](docs/agents/fns-env-sync.md) |
