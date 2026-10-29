# Agent 业务文件操作

本文中的 `<运行目录>` 按[本机运行记录](../rules/writing-and-changes.md#本机运行记录)解析，默认 `.system/.workbench-runtime/`；自定义位置从所属实例的 `.system/workbench/runtime.jsonc` 读取。

从已安装包或源码仓库调用 `node "<软件根>/scripts/vault/write.mjs" --vault "<知识库绝对路径>"`，通过 stdin 传一个 JSON 对象。自定义配置目录追加 `--config-dir "<实际目录>"`；软件位置与目标库见[路径约定](package-layout.md)。脚本直接读写文件，无需 Obsidian。其他工具可按[共同规则](../rules/README.md)执行同一任务。

写入前判断用户授权和隐私范围。每次新操作用 `crypto.randomUUID()` 生成 `request_id`，设置 `privacy: "ordinary"`；相同输入重试保留 ID，修改输入后更换。JSON 不通过 shell 参数拼接正文。CLI 设置 UTF-8 流解码，中文跨字节块也不拆坏。

## 读取与新建

| action | 输入 | 结果 |
| --- | --- | --- |
| `info` | 可选 `list: true` | 实际库路径、设备时区；需要时列业务笔记 |
| `read` | `path` 为库内 Markdown 相对路径 | 完整 `content` 与 `sha256` |
| `capture` | `content`，可选 `title`、`sources`（逐行 URL）、`timezone` | 新 Inbox 路径、完成状态 |
| `create-note` | `path`、`content` | 指定业务位置的新笔记，按需建立父目录 |
| `create-project` | `name`、`goal`，可选 `area`、`directions`（字符串数组）、`timezone` | 在 `1.项目/<项目名>/` 新建项目说明，领域可选 |
| `create-task` | `name`、`goal`、所属项目的 `projectPath`，可选 `timezone` | 新建项目内任务，返回说明笔记路径；不启动研究 |

`content` 是正文；原始文件按附件复制，避免给原文件添加另一套属性。`ai_summary`、`judgment` 可分别保存 AI 归纳与本人已表达的判断。

每个任务必须属于项目，新建时须提供有效 `projectPath`；项目集中在 `1.项目/`，不通过旧独立任务入口创建无归属工作。旧数据按获授权清单迁移，保留原身份、正文与附件。五目录及新增操作的代码、安装和入口验证范围以[实施记录](../../.scratch/information-architecture-workflow/spec.md)为准。

新建时可传 `files: [{source: "/已获授权的原文件绝对路径", directory: "明确指定的库内目录"}]`。省略 `directory` 就读取本库附件设置；任务专属附件的最终位置必须位于任务内，设置指向任务外时使用任务的 `attachments/`。逐文件完成后返回 `files`；主笔记已保存而部分附件失败时返回 `ok: false`、`partial: true`、实际路径和 `failures`。

## 从收件箱迁入任务

用户明确要求创建或归入任务后，先按[任务资料归属](../rules/projects-and-tasks.md#任务资料归属)检查原记录、附件与共享引用。新任务先调用 `create-task`，记录返回的 `path`；已有任务不重复创建。读取源记录和任务说明的完整原文，再提交：

迁移清单含网盘托管文件或其 YAML 替代文件时，先读[网盘托管规则](../rules/cloud-files.md)，使用 `tt-cloud-files` 协调完整迁移。下面的普通 `transfer-to-task` 尚未接入网盘移动与记录维护，不可单独用于托管资料迁移。通用 `read`、`update` 仅支持业务 Markdown，不用于读写托管 YAML。

```json
{
  "action": "transfer-to-task",
  "request_id": "实际生成的 UUID",
  "privacy": "ordinary",
  "path": "原收件箱记录的库内路径",
  "expected": "刚读取的源记录完整原文",
  "target": "目标任务说明的库内路径",
  "target_expected": "刚读取的任务说明完整原文"
}
```

`lib/vault/task-transfer.js` 生成迁移清单，把条目目录或手写记录及登记附件复制到 `<任务目录>/资料/<原记录标题>/`，读回核对后更新业务笔记链接，最后移除源文件。返回 `sourcePath`、`directory`、`moved`（源/目标路径、字节数、SHA-256）和 `updatedLinks`。原记录成为 `type: note`，`capture_origin` 保存原路径、原类型和迁移时间，原身份、创建时间与整理状态保留。

独立课程等共享来源保持原位。迁移候选附件被其他业务笔记引用时返回 `SHARED_MATERIAL`，列明文件及引用者；先确认归属，不把引用操作当作迁移完成。只更新主记录与相关业务笔记中的 Markdown/wiki 链接和 `attachments` 属性；代码示例、原始附件中的历史文本及库外内容不改写。无效 YAML、独立记录混入或符号链接会阻止迁移。

迁移过程的原请求、文件清单、哈希、修改前后版本及当前阶段保存在 `<运行目录>/vault-io/transfers/<request_id>.json`。失败返回 `partial` 和 `recoveryPath`；核对后使用恢复记录中的完整 `input` 重试。任务已创建时保留并继续该任务，不再调用新建。`TRANSFER_PENDING` 表示同一来源已有未完成操作，不能换 ID 另做一次。已完成文件发生变化时拒绝覆盖。恢复清单完成后仍保留供核验和重试；它是本机运行记录，不是可编辑业务资料副本。

## 分流到项目、领域或资源

`transfer-inbox` 使用与上述迁移相同的 `path`、`expected`、`target`、`target_expected`、`request_id` 和 `privacy`。目标必须是已存在的项目/任务说明，或 `2.领域/`、`3.资源/` 中的实际笔记；工具将输入包保存到目标笔记所在目录的 `资料/<原记录标题>/` 并建立引用，不推断其他目标或创建工作承诺。需要新建项目时先明确目标并执行 `create-project`，任务须指定所属项目。

原文、专属附件、共享引用、失败恢复与重试要求同上。只把状态改为已整理不等于分流成功。已归档项目须先恢复，再接收新的任务或输入。

## 归档与恢复

先读取[存档规则](../rules/scope-and-directories.md#存档与恢复)，核对用户明确的整包范围及原说明全文。以下入口不改变业务完成状态，也不根据完成、暂停或取消自动执行。

| action | 必需输入（另附 `request_id`、`privacy`） | 路径行为 |
| --- | --- | --- |
| `archive-project` | `path` 为项目说明，`expected` 为刚读原文 | `1.项目/<项目>/` 整包移入 `4.存档/项目/<项目>/` |
| `restore-project` | `path` 为存档项目说明，`expected` | 整包恢复到 `1.项目/<项目>/` |
| `archive-material` | `path` 为包内主说明，`directory` 为明确的领域或资源包目录，`expected` | 移入 `4.存档/领域/` 或 `4.存档/资源/`，保留原根目录内相对层级 |
| `restore-material` | `path` 为存档包主说明，`directory` 为明确的存档包目录，`expected` | 按相对层级恢复到 `2.领域/` 或 `3.资源/` |

材料入口不接受整个业务根目录，不推断单文件的附件范围。任务不单独归档，随项目保留归属；项目存档期间的任务创建、资料迁入及工作状态进度更新入口要求先恢复项目。目标目录已存在时返回冲突，不合并或覆盖。

归档与恢复复用迁移的清单、源版本、文件哈希、引用更新与阶段恢复记录。执行后读回主说明，核对全部材料和引用；中断按实际恢复记录继续，不重新创建对象。普通入口拒绝网盘托管替代文件和飞书同步单元，分别交由对应 Skill 与同步流程处理；不能因普通入口受限就直接文件搬移绕过联动。以上为当前源码接口，安装与实际宿主验证范围见[本轮实施记录](../../.scratch/information-architecture-workflow/spec.md)。

## 修改已有记录

先 `read`，再提交原样 `expected`。`update` 支持：

- `append`：在正文末尾增加带实际时间的补充段落。
- `fields`：只改这些 YAML 属性；未知属性、注释和无关正文保留。类型、创建时间和身份不由普通更新改变。状态编码见相应[业务规则](../rules/README.md)。
- `body`：明确获授权替换正文时提供完整的新正文，保留原 YAML；不要因只改一个段落而省略其余正文。

```json
{
  "action": "update",
  "request_id": "实际生成的 UUID",
  "privacy": "ordinary",
  "path": "0.收件箱/目标.md",
  "expected": "刚读取的完整 content",
  "append": "本次明确要求追加的文字"
}
```

`attach` 提交 `path`、`expected` 与 `source`，或者提交原始 `filename` 与 `base64`。可显式指定 `directory`。本机原文件没有旧接口的扩展名白名单或 8 MiB 上限；大文件保留方式仍按[附件规则](../rules/attachments.md)。复制后更新主笔记的 `attachments` 与真实链接；返回字节数和文件哈希。

`append`、`review`、`work-update` 作为简短操作名仍可调用同一模块，但新 Skill 不依赖旧 HTTP 协议。`scripts/workbench/agent-request.mjs` 仅转发至新文件命令，供已有脚本过渡。

## 可选的局部用途记录

用途可直接写在内容或使用方的正文中；需要工作台逐项编辑时，可使用所在笔记的 `output_uses` 数组。它只记录本笔记相关用途，不创建成果本体，也不成为其他内容的保存前提。

每条结构化用途有唯一字符串 `id`，其余字段均为字符串：`title`（用途名称）、`artifact`（关联内容）、`version`（实际采用版本或交付位置）、`audience`、`purpose`、`status`、`date`、`note`。表单要求 `title` 和 `status`；状态为 `planned`、`used` 或 `cancelled`，其中 `used` 还须提供可回查的 `version`。其他字段按需填写，不能凭计划推断已使用。

更新时先读回整个笔记，保留其他用途和未知字段；修改一项用途不结束其他用途。此入口不自动生成版本快照或对外发布，实际版本是否存在仍须核验。工作台可点击版本链接回看，源码位置为 `apps/workbench/work-items.js`；实际宿主验收见本轮实施记录。

## 完成、冲突与重试

只在 `ok: true` 且写入结果 `saved: true` 后报告完成，再读回核验；不能把接口返回路径当作附件原文已经保存的证明。

- `CONFLICT`：原文已变化；返回原笔记和冲突副本路径。核对双方，不能偷偷更新 `expected` 强行重试。
- `PARTIAL_WRITE` 或 `partial: true`：逐个检查已保存笔记、附件及未完成步骤。相同请求重试会核对完成结果，不整批重新建立。
- `REQUEST_CHANGED`：同一请求 ID 收到了不同输入，或已保存附件的来源文件内容变化/无法读回；核对请求，新增或改变的内容使用新 ID。
- `REPLAY_CHANGED`：已完成或部分完成的文件又发生变化。先读回并确认实际结果，再对缺少步骤建立新请求，不能覆盖变化。
- `LOCKED`：参与同一协议的写入仍持锁，或进程中断留下锁。核对返回的锁记录、进程与恢复文件，不自动删除锁重试。
- `WRITE_FAILED`：读回尚未确认；按返回的 `recoveryPath` 检查原文与拟写版本。

共用模块为每个文件建立本机锁，暂存拟写版本后原子替换并读回。原生编辑器与 FNS 不参与该锁，最终检查到写入之间仍有外部并发窗口；此实现不提供跨设备事务。运行记录位置和生命周期见[写入规则](../rules/writing-and-changes.md)。

更新恢复目录内的 `before.txt`、`after.txt` 分别保留完整原文和拟写内容，`operation.json` 记录目标与哈希。快照使用 `.txt`，避免被 Obsidian 作为 Markdown 笔记排队扫描；正文内容仍按原字节保留。旧失败记录可能使用 `.md` 扩展名，核对恢复材料时一并检查。

收件箱在写正文前保存选定目录与拟写内容；重启后仍检查同一目标，不覆盖中断留下的部分文件。附件若复制或链接已写入但回执尚未完成，重试可能返回冲突；应核对返回路径与原笔记，确认后只对缺少步骤建立新请求。
