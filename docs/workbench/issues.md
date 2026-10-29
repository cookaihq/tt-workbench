# 工作台开发 Issue

从左侧“开发 Issue”或命令面板“tt 工作台：打开开发 Issue”进入。该页面只服务当前库的开发记录，格式与操作语义见 [共同规则](../rules/issues.md)。

## 使用

顶部可切换未关闭、已关闭、全部或待确认，按功能、分诊、标签与优先级筛选；搜索覆盖标题、完整编号、正文与评论。支持按最近更新、功能编号或优先级排序。旧文件没有更新时间时，列表明确显示文件修改时间。

列表中的“查看规格”和功能筛选可找到仅有规格的功能。点击 Issue 显示正文、评论、关联与依赖、操作历史。宽窗口并排显示列表和详情；窄窗口点击后进入详情，用“返回 Issue 列表”回到原列表。

- “新建 Issue”选择功能或填写新功能名称，输入标题和描述；支持普通事项、缺陷和功能模板。切换模板不覆盖已经填写的描述。
- “编辑内容”修改标题与描述，支持预览；路径不变。正文中的验收框可分别勾选，完成比例不会自动关闭 Issue。
- “编辑属性”修改分诊、标签和优先级；“评论”页添加评论或修改新格式评论。
- “关联与依赖”选择前置 Issue，查看后续事项，添加规格、Issue 或验收材料路径。取消前置事项不算完成；循环依赖被拒绝。
- “关闭 Issue”选择已完成或不计划实施，也可选择重复目标和填写结论；已关闭记录可重新打开。
- “复制 Agent 上下文”读取最新内容并复制，同时显示可手动选取的文本；不启动 Agent。

读取期间发现原文件更新会提示重新读取。保存冲突或失败保留表单输入，并给出本机恢复记录路径；编辑窗口的“稍后继续”保留当前视图内草稿，“放弃未保存修改”只清除该草稿。属性、评论及关联表单提供“放弃草稿并重新读取”，清除对应未提交输入后读取最新文件。关闭工作台视图或重载插件前先保存。

## Agent 与脚本

`scripts/workbench/issue-request.cjs` 从 stdin 读取 JSON，返回 JSON。它与工作台共用文件模块，不依赖 Obsidian 运行，也不扩展原保存 Skill 或 Agent bridge 的业务笔记权限。

```json
{"action":"list"}
```

```json
{"action":"read","path":".scratch/vault-workspace-v1/issues/13-agent-query-prompt.md"}
```

创建请求使用 `{"action":"create","input":{...}}`，`input` 包含 `feature`、`title`、`description`，可选 `labels`、`priority`、`id`（UUID）和 `actor`。同一请求重试保留 `id`；正文支持实际换行。

更新请求使用 `{"action":"update","path":"...","expected":"读取得到的完整 content","input":{...}}`。不要从旧快照猜测当前原文。`input.action` 支持：

| action | 输入与结果 |
| --- | --- |
| `edit` | `title`、`description`，更新描述及标题 |
| `metadata` | 可选 `triage`、`labels`、`priority`、`blockedBy`、`related`；未提供的字段保留 |
| `check` | `index`（从 0 开始）、`done`，修改读取结果中的一项清单 |
| `comment` | `body`，追加评论 |
| `edit-comment` | `id`、`body`，编辑已读取的评论 |
| `close` | `resolution` 为 `completed` 或 `not-planned`；可选 `duplicateOf`、`conclusion` |
| `reopen` | 可选 `conclusion`；恢复未关闭并清除重复标记 |
| `initialize` | 仅用于已经明确授权的旧数据登记；`resolution` 可为 `open`、`completed`、`not-planned` |

创建只允许当前库功能目录；更新只允许对应 Issue 文件，不能修改规格、规则、业务笔记或其他库。所有写入仍须来自用户授权；工具存在不代表取得执行授权。调用方在失败时读取 `code`、`message` 和可选 `recoveryPath`，不重复提交旧快照覆盖新内容。

## 实现及验收

`main.js` 接入导航与命令，`issue-ui.js` 读取表单并展示结果，`issues.js` 扫描目录、检查关系并执行文件操作，`issue-format.js` 解析与局部更新格式。安装脚本同时复制这些模块。普通笔记读取器及原 Agent bridge 的路径范围保持原状。

模块验证：`node --test apps/workbench/tests/issues.test.cjs`。真实 Obsidian 验证脚本、实际结果和限制记录在 [验收目录](verification/issues/)。双电脑同步、批量操作、子 Issue、里程碑、负责人、看板、移动删除及 Agent 控制不属于本版。
