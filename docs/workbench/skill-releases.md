# Skill 版本、批次与发布

用户安装与更新入口见 [Skill 安装与使用](agent-skill-setup.md)。本文面向维护者；发布前必须读取并遵守 [Git 与发布规则](../agents/git-access-commit-and-release.md)和[发布设计文档联动](../agents/release-knowledge-docs.md)。本机候选构建、正式 Release、设备安装和 Agent 实际加载分别记录。

## 版本与包

`skills/<名称>/SKILL.md` 的 `metadata.version` 是行为版本的唯一源，使用三段数字版本。指令、权限、触发或随包工具发生变化时，按影响提升该 Skill 版本。`workbench-min`、`node-min`、`platforms`、`hosts` 和 `release-notes` 也在 metadata 中维护为字符串，由生成器生成兼容要求和更新说明。工作台版本单独维护，不因普通 Skill 变更机械升版。

安装目录中的 `SKILL.md` 保留同一元数据，正文要求 Agent 使用本次实际加载的名称、版本提示用户。宿主不会自动执行 metadata；磁盘版本和旧会话缓存分别核验。标准字段依据见 [Agent Skills](https://agentskills.io/specification)、[Codex](https://developers.openai.com/codex/skills/)和 [Claude Code](https://code.claude.com/docs/en/skills)。

独立包使用 gzip JSON，附件名为 `<名称>-<版本>.skill.json.gz`。其 `manifest` 包含 schema 1、kind `tt-skill-package`、名称、版本、兼容要求、更新说明、逐文件 SHA-256 和规范排序后的内容摘要；`files` 保存对应 base64 字节。解包后在 `skills/<名称>/` 生成 `skill-package.json`，工具和文档位于该目录的 `runtime/`。源码中的 `lib/`、`scripts/` 仍只维护一份；分发时复制确定快照，支持 Obsidian 退出后的运行。

同名同版本固定对应相同完整内容。更新说明、兼容要求和 runtime 也属于内容；共享工具或随包文档变化可能要求选定 Skill 升版。未选定项继续使用旧包，不重新从开发目录打包。

## 完整清单

先按 [发布范围与 Tag 选择](../agents/git-access-commit-and-release.md#发布范围与-tag-选择)确定发布归属。清单的 `batch` 接受独立发布的 `skills-YYYYMMDD.N` 或联合发布的 `v<工作台版本>`，不含单项名称。每次 Skill 版本集合更新只有一个 `skills-release.json`，结构为：

| 字段 | 含义 |
| --- | --- |
| `schema` / `kind` / `complete` | `1` / `tt-skill-release` / `true` |
| `repository` / `batch` | 固定仓库与本批 tag |
| `sequence` | 同一清单继承链的序号；首批为 1，后续为上一清单加 1，与 Tag 格式及发布时间无关 |
| `previous` | 首批为 null；后续记录上批 tag 和原清单字节的 SHA-256 |
| `active` | 本批全部可用正式 Skill 名称，须与 `skills` 完全对应 |
| `changed` | 本批实际生成新包的名称 |
| `skills[]` | 名称、独立版本、内容摘要、兼容要求、更新说明、固定附件来源 |
| `skills[].artifact` | 原始批次 `batch`、附件 `name`、`sha256`、`size` |

首批包含全部活动项。两种 Tag 共用一条 `sequence` / `previous` 继承链；工作台单独发布不增加 Skill 清单序号。后续只能替换明确选择且升版的项，未变化条目原样继承；新开发但未选定的 Skill 不进入正式清单。当前协议不删除既有正式项；退役需另行定义明确的清单状态与客户端迁移。构建器拒绝相同版本不同内容、版本倒退、不完整清单和过期发布基线。

## 本地准备

```text
node scripts/agent-skills/build-release.mjs --batch skills-YYYYMMDD.N --skill tt-capture --skill tt-update-note --previous <上一正式清单文件> --output <新的输出目录>
```

首批不传 `--previous`，并明确选择所有活动名称。输出目录必须不存在；默认 `dist/skills/<Tag>/`。独立发布输出选中项的新包和完整清单，不联网、不推送。`--previous` 必须来自已核验正式 Release；示例日期和版本不表示已经发布。

联合发布使用同一命令，将 `--batch` 设为 `v<工作台版本>`；有继承项时，通过 `--previous-assets <目录>` 提供这些条目的固定附件。该命令先生成清单及选中包，再通过 `assemble-release.mjs` 从同一清单的完整包集合组装工作台，额外输出 `release.json`、`tt-workbench.bundle.json.gz` 和 `tt-workbench.zip`。Tag、`package.json` 与插件 manifest 的工作台版本须一致；全部附件准备后交给同一个 Release。

工作台普通 `npm run build` 从开发源产生候选，`release.json` 的 `skillSource.kind` 为 `development`，不能用作正式在线更新。只有工作台更新时，从上一固定正式清单取得每个条目的原始附件，并执行：

```text
npm run build -- --skills-catalog <正式 skills-release.json> --skills-assets <清单所有附件所在目录>
```

两个装配入口共用逐项包校验，核对字节数、SHA-256、版本和内容，不重新采集未选中的开发 Skill。输出记录采用的 Tag 和清单摘要。首次采用独立版本按联合发布准备，工作台和初始 Skill 包在同一 Release 一次公开；Skill 的最低工作台版本可以是该工作台版本，旧客户端会保持当前内容。`skillSource.kind: release` 表示已固定发布输入，不是远端已经公开的证据。

## 正式发布

仓库提供手动启动的 `Publish Skills or combined workbench release` GitHub Actions 工作流，文件为 `.github/workflows/skill-releases.yml`。执行前固定已审阅的提交、Tag、选定名称和目标仓库，完成测试及 tannt 仓库设计文档核对；真实推送和启动工作流仍需本次明确发布授权。工作流选择的 Git ref 必须对应已审阅提交，执行时 checkout 固定 `github.sha`。

1. 工作流通过 `skill-releases` concurrency 组串行执行，取消旧任务为 false。使用本工作流短期 `GITHUB_TOKEN` 的 contents 写权限，checkout 不持久化凭据；不读取维护者个人 Token、全局 gh 登录或知识库凭据。本机发布凭据仍执行项目 Git 规则。
2. 读取最新正式完整清单，构建选中项并继承其余条目。联合发布先从该清单组装工作台三个附件。创建 `draft: true`、`make_latest: false` 的同一草稿，上传完整清单、选中项的新包及适用的工作台附件；继承项仍引用原 Release。
3. 下载核验全部清单与附件，包括继承项；确认版本、兼容、文件哈希与内容摘要。联合发布还核验工作台三个附件一致、`skillSource` 指向本次 Tag 和清单摘要、附带的 Skill 逐项匹配。标签固定到本次完整提交 SHA。公开前再次核对上一正式清单未变化。
4. 全部通过后设置 `draft: false`、`prerelease: false`；仅 Skill 发布 `make_latest: false`，联合发布 `make_latest: true`。回读正式状态与下载字节，输出 `publication.json`；产物和记录由工作流 Artifact 保留。
5. 按发布规则更新实际 Release、标签、源码及设计文档记录；各设备正式安装及 Agent 新会话验证另行完成。

网络写入结果不明时先查询同一草稿、附件和标签；已上传且内容相同的附件复用，不覆盖同名不同内容，不盲目重发。重跑使用同一固定提交、批次和选择；已公开的相同结果只读核验。基线已变、草稿内容冲突或 tag 指向变化时保留现场，重新准备可审阅发布，不强推标签或删除附件。

请求共用 8 分钟总预算，每次请求最多 60 秒。有效 `Retry-After`（秒或 HTTP 日期）及 GitHub 限流重置时间写入 `dist/skills/request-state.json`；冷却期间结果核对也不联网。工作流通过独立缓存恢复这个不含凭据的截止时间，失败证据同时保存在 Artifact；不自动截短等待或重放写入。缓存被清理、跨分支或新 Runner 无法恢复时，维护者须从上次证据核对截止时间，完整冷却后再启动同一批次。

工作流串行约束参与该工作流的发布者；最终基线检查还会发现已发生的外部发布，但不能阻止绕过流程的第三方同时写入。维护者均须使用同一串行入口，不把本地锁或两次读取称为跨系统原子发布。

## 发现与安装边界

工作台和 Skill 都分页读取 Release 列表，不依赖整个仓库的 latest。工作台识别 `v<工作台版本>`；Skill 读取 `skills-*` 及携带 `skills-release.json` 的工作台 Release，没有该附件的纯工作台发布跳过。Skill 查询使用 15 秒总预算，按序号与上一清单摘要核验完整继承链和固定附件，再逐项比较已安装版本；继承链分叉时报告无法确定更新结果。检查时固定附件 ID；下载使用该 ID 并核验摘要，不能在安装中途重新取 latest。

较新批次损坏时可以展示最近有效完整清单，但提示检查不完整，不能称“已是最新”。网络、限流、预算耗尽与兼容不足保留当前资源。下载与应用分开，只有明确点击更新或 CLI update 才替换。

工作台清单声明独立 Skill 的管理边界。首次从旧无版本模型升级前，仍完整核验旧工作台清单；以后升级工作台时，独立 Skill 按自身清单核验并原样保留，不升降其版本。核心资源继续执行原校验。独立更新和工作台安装共用插件安装锁；用户配置保留，未受管理文件与新包冲突时停止并给出具体文件。

正常替换失败恢复此前目录；进程中断保留插件恢复目录中的阶段和哈希，由页面“恢复上次更新”或 CLI 同一操作标识核验回退/接续。已捕获并结束的失败可在同一 Obsidian 进程中恢复；恢复再次中断时核对原恢复进程已退出后继续同一记录。外部变化或操作仍活跃时保留现场，不自动抢占活跃操作。安装器不修改发现入口或服务配置；原有入口继续指向同一安装位置，新注册和移除仍是显式操作。
