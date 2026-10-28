# tannt 工作台

桌面版在 Obsidian 内读写 `tannt` 的真实笔记，采用已确认的布局 A：左侧导航、并排列表与详情。当前 `0.21.0` 直接使用插件目录里的 FNS 普通配置，并提供旧链接迁回入口，发布格式保持不变。`0.20.1` 恢复「系统 → Agent 规则」的页面接入，提示词区分主文件未接入与仅场景入口未接入；独立窗口保留所选页面和 Agent。`0.20.0` 增加 [FNS 逐条规则设置说明](../../docs/workbench/fns-config-sync.md#每条规则的设置说明)，支持编辑本机草稿并随权威版本发布、接收与展示。`0.19.1` 在 Git 版本检查与安装基础上增加 FNS 排除目录说明和本机生效状态，见[版本说明](../../docs/workbench/updates.md)。`0.18.0` 增加只读 [Agent 规则页](../../docs/workbench/agent-rules.md)，沿用已确认的 A「状态总览」布局。`0.17.0` 的五目录、项目内任务和明确归档，安装及实际入口验证范围见[信息架构实施记录](../../.scratch/information-architecture-workflow/spec.md)。此前 `0.16.0` 的 Inbox 归入任务、失败重试、共享引用和重载有[历史表单验证](../../.scratch/task-materials-together/verification/README.md)，不代表新目录与新增操作已经完成验收。

共同规则、独立文件操作、两项场景 Skill 的 0.15.0 验收保留于[此前记录](../../.scratch/vault-rules-and-skills/verification/README.md)。Codex 已验证，Claude Code 仅标准发现通过。历史第 13 项新 Agent 会话查询、第 14 项双电脑 FNS 仍各自待验收，见[完整索引](../../docs/workbench/verification/README.md)。

## 打开

在当前库的 Obsidian 命令面板搜索 `tannt 工作台`，执行“打开工作台”；也可以点击左侧功能区的工作台图标。右上角“独立窗口”打开属于同一 Obsidian 库的独立窗口。宽窗口遵循布局 A，窄窗口改为上下排列并可滚动。

## 日常操作

- **随手记**：输入文字或链接，标题、多个来源选填，保存到收件箱。程序创建 `0.收件箱/YYYY-MM/<可读标题>/记录.md`，同名不同记录使用可读序号，标识保留在 YAML；既有 UUID 记录保留身份。手动记录可以直接在 `0.收件箱/` 新建 Markdown，再插入[收件箱模板](../../templates/收件箱.md)。
- **整理输入**：阅读并澄清后，将输入与专属材料分流到项目、任务、领域或资源。旧“标为已整理”只改状态时，不算完成分流。“迁入任务”与“仅添加引用”分别表达实际移动和引用，不互相替代。原身份、创建时间与来源保留，保存或迁移不启动研究。
- **项目**：填写名称、范围与推进目的，集中保存于 `1.项目/`，领域关联可选；允许长期研究和运营。不同创作方向通常分别建项目，也可按需要关联多个方向。项目状态独立维护，不因任务完成而自动结束。
- **任务**：每个任务选择所属项目，保存完成条件、状态、文字进度和下一步；任务有文件夹和 `任务说明.md`。暂未找到具体归属的工作由专门项目承接，不再创建独立任务。详情可查看任务说明、相关笔记与查询 Agent。
- **存档与恢复**：通过明确操作整包移动对象，保留原工作状态、专属材料和恢复依据；完成、暂停或取消不自动移动。项目任务一起保留，仍在复用的独立资源留在原处。各类对象的可用入口和验证范围见[文件操作说明](../../docs/agents/vault-file-operations.md)及本轮实施记录。
- **工作筛选**：活跃（待开始、进行中）、暂停、已结束但未存档、已存档分别查看。`test_fixture` 标记的验收样例默认隐藏，可显式显示；它们的状态不计作本人真实工作。存档项目的状态与进度入口只读，恢复后再继续推进。
- **用途记录**：项目、任务和普通笔记可按需要逐项登记、更新用途；实际使用时填入采用的版本链接或历史交付位置。未登记用途的内容照常保存和阅读，不产生统一成果总览，不自动生成快照或发布。
- **浏览笔记**：逐层浏览实际业务目录，在当前目录及子目录搜索标题、路径和正文。点击笔记链接在详情阅读，使用“返回”回到上一份；“编辑原笔记”进入 Obsidian 编辑器，修改后“重新读取”。
- **开发 Issue**：搜索和筛选本库功能开发事项，新建、编辑描述及评论、勾选验收条件、修改分诊/标签/优先级、关联前置事项、关闭及重开，也可复制最新 Agent 上下文。宽窗口并排显示，窄窗口通过“返回 Issue 列表”往返。文件保存在 `.scratch/<功能>/issues/`；格式与操作见[说明](../../docs/workbench/issues.md)，本机交付结果见[验收记录](../../docs/workbench/verification/issues/README.md)。
- **Agent 规则**：只读浏览正式主规则、场景及本机原文件，核对主入口与共用场景入口是否直接链接到当前项目。未接入时可复制 Skill 提示词，在 Agent 会话中梳理并确认方案；页面不编辑、不显示差异、不生成整理建议。新 Skill 本轮仍为需求，页面如实提示尚未发现。详见[页面说明](../../docs/workbench/agent-rules.md)。
- **通过 Agent 保存**：在以本库根目录为工作目录的会话中，新存内容使用 `tannt-capture`，修改已有内容使用 `tannt-update-note`。两者直接操作本库文件，不要求 Obsidian 启动、打开本库或启用工作台。Codex 与 Claude Code 的项目级入口、实际验证结果和限制见[技能接入说明](../../docs/workbench/agent-skill-setup.md)。其他 Agent 与远程环境分别验证后再声明支持。
- **浏览器剪藏**：用 Chrome 打开[书签安装页](browser-clipper.html)，将“保存到 tannt”加入书签。选中文字后调用书签，无选区时保存 URL；在 Obsidian 弹窗核对并点击保存。详见[剪藏说明](../../docs/workbench/browser-capture.md)。

创建、更新与关联都写回 Markdown。状态没有独立的可编辑 JSON 副本。查看格式、模板及复用方式：[Inbox](../../docs/workbench/inbox-format.md)、[项目与任务](../../docs/workbench/work-records.md)、[知识与成果复用](../../docs/workbench/note-reuse.md)。

## 附件与查询

[附件说明](../../docs/workbench/attachments.md)：Agent 保存普通附件时读取当时的 Obsidian 设置；任务专属附件始终保存在任务内，设置指向任务外时采用任务的 `attachments/`。明确指定的任务内目录只影响本次保存。工作台可以显示库内 PNG/JPEG/GIF/WebP；其他附件保留路径，可从原笔记打开。外部图片只显示链接，不自动下载。课程和视频原文件保持库外，在来源或任务中保存 `源文件位置.md`。

[查询 Agent](../../docs/workbench/agent-query.md)：页面在切换到查询页或点击复制时重新读取任务，生成包含真实路径和进展的 Prompt。复制后在新会话中查询。工作台不会据笔记状态判断 Agent 是否运行，也不会启动或停止 Agent。

## 保存、错误与边界

保存成功只表示当前电脑已写入。失败时保留表单输入；原文变化时不覆盖，尽可能在同目录保存 `原名-保存冲突-UUID.md`，其中包含拟写版本。先核对原文件和冲突副本，再决定如何合并。关闭视图或重载插件不会保存尚未提交的表单草稿。

资料迁移先核对原文、专属附件和共享引用，保存并核验目标后更新链接，最后移除源文件。跨文件操作不是原子事务；失败会显示已建任务和恢复记录，重试继续同一任务。具体边界及恢复方法见[项目任务实现](../../docs/workbench/work-records.md)。

领域和资源归档须输入明确的整包目录，页面显示目标与笔记数量供核对，不自动猜测单文件的附件范围。普通迁移入口拒绝托管文件和飞书同步单元，按其专门规则执行联动。

业务列表覆盖 `0.收件箱/`、`1.项目/`、`2.领域/`、`3.资源/`、`4.存档/` 的 Markdown，以及根目录普通 Markdown。知识与经验在资源中共同浏览；项目、领域与资源可由首页和按需 MOC 链接。规则文件、隐藏路径、程序与开发文档、`tmp/`、`node_modules/` 和符号链接不在业务读取范围。预览不修改原文或补写属性。当前库与私人库独立，疑似私密内容由 Skill 提醒，不转存私人库。

“开发 Issue”使用单独的文件读取范围，不改变上述业务入口。Issue 保存时核对编辑前原文，并在 `apps/workbench/data/issues/operations/` 保留恢复记录；外部编辑器和跨设备同步不服从本机写锁时，没有跨入口事务保证。页面不会按验收勾选比例自动关闭 Issue，也不会启动 Agent。

未支持的 HTML 或嵌入语法显示原文；笔记嵌入不递归读取。FNS 网页仅验证到登录页，尚未取得笔记正文；当前阅读使用 Obsidian 文件接口。没有自动采集、媒体解析、对外发布或 Agent 启动监控功能。

## 安装与更新

`0.19.0` 在右上角显示运行版本，通过本机 Git 检查私有 `origin/main` 已发布的安装包，发现新版本后提示安装；安装完成后重启 Obsidian 生效。源码及安装包不随 FNS 同步。发布步骤、私有仓库凭证、每台设备排除设置及恢复方法见[工作台版本与更新](../../docs/workbench/updates.md)。

在当前库根目录执行：

```sh
node scripts/workbench/install.mjs
```

脚本将 `apps/workbench/` 的插件模块、样式和 manifest 复制到 `.obsidian/plugins/tannt-workbench/`，将 `lib/vault/` 复制到安装目录的 `vault-lib/`，将 `lib/fns/`、`lib/config/` 复制到安装目录的 `lib/`，并生成 `release.json` 校验清单。不需要现场构建或下载依赖；YAML 解析采用随附的 `yaml 2.9.1`，版本、来源及校验值见 `lib/vault/vendor/dependencies.json`。首次安装需在 Obsidian 启用 `tannt 工作台`；更新后关闭再启用插件，或重启 Obsidian。安装脚本不改启用列表或 FNS 设置。

Agent 技能入口单独安装：在本库根目录执行 `node scripts/agent-skills/install.mjs`；加 `--check` 可只读核对。脚本按 `skills/manifest.jsonc` 为 Codex 与 Claude Code 创建清单中各 Skill 的项目级链接，并移除已知旧 Skill 的活动链接。具体使用范围及另一台设备的处理见[技能接入说明](../../docs/workbench/agent-skill-setup.md)。

旧 HTTP 接口连接信息存于 `apps/workbench/data/agent-bridge.json`，权限 0600，插件启动时重建，只监听本机随机端口。关闭库或退出应用时该文件可能遗留，文件存在不能作为服务在线的证据；后续维护项见[记录](../../.scratch/vault-rules-and-skills/backlog.md)。新 Agent CLI 不读取该文件。CLI 与工作台的文件锁、重试回执和失败恢复材料存于 `apps/workbench/data/vault-io/`，不要求有工作台进程；两种运行记录都不能复制到另一台使用，须保持 Git 忽略及本机 FNS 排除。新业务与存档路径中的 `tmp/` 排除须重新核验，不能用旧目录的[历史配置证据](../../docs/workbench/verification/root-numbering-migration.json)代替。

FNS 设备配置按[本机普通配置与旧链接迁回规则](../../docs/agents/fns-device-config.md)维护；第二台电脑的插件、启用状态、运行条件及排除规则仍须单独核验。见[第二台电脑验收步骤](../../docs/workbench/second-computer.md)。

## 实现与验证入口

用户通过 Agent 提交内容时，Skill 读取 `docs/rules/` 的适用主题，再由 `scripts/vault/write.mjs` 读取 JSON stdin，调用 `lib/vault/` 创建或修改业务 Markdown，核对真实文件后返回 JSON。此过程没有 HTTP 或 Obsidian 应用对象。旧 `agent-request.mjs` 仅转发到该文件命令。

用户通过工作台提交时，`main.js` 调度表单；收件箱、更新、附件和项目任务模块使用同一组文件、YAML、时间和路径模块。`shared.js` 在源码环境加载 `lib/vault/`，在安装环境加载复制的 `vault-lib/`。Obsidian 发现文件后，`note-reader.js` 读取业务文件与元数据，界面显示真实结果。浏览器剪藏仍通过 Obsidian URI 填充待确认表单；它的运行条件不限制独立 Agent。

共同规则入口为 [docs/rules/](../../docs/rules/README.md)。本说明记录实现和使用方式，不维护第二份业务规范。

```sh
node --test lib/vault/tests/*.test.cjs apps/workbench/tests/*.test.cjs
```

模块测试及真实 Obsidian、浏览器、系统剪贴板证据见[验收索引](../../docs/workbench/verification/README.md)。`scripts/workbench/verify-*.cjs` 在当前库的真实 Obsidian 上下文执行，会创建明确标注的验收笔记；不要在其他库执行。截图检查覆盖主窗口、独立窗口及不同宽度，不能用模块测试代替实际界面验收。
