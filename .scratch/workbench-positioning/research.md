# 工作台定位：成熟产品做法调研

- 查阅日期：2026-10-28。
- 状态：研究材料与待讨论提案，不是已确认的产品规格或实现任务。
- 范围：Obsidian、Notion、Linear、Sunsama、Readwise Reader、Heptabase 的官方文档与官方方法案例。
- 方法：实际打开官方网页核对功能与工作流程；搜索引擎仅用于定位原始来源。未登录这些产品开展完整操作测试，未验证各套餐、各设备或当前 tannt 安装版本的实际可用性。官方自述证明其公开设计与文档内容，不证明对本人的效果。

## 用户已经表达的判断

当前工作台直接将 Obsidian 的五个一级目录作为菜单，重复浏览这些目录的意义不大。用户希望重新讨论工作台的作用和定位，并要求先调查网上成熟做法，再进入反问与设计讨论。本次没有确认新菜单、产品范围、目录迁移或实现方案。

## 核心研究判断

以下是依据样本作出的研究判断，尚未成为本库共识：

1. **应先确定一次打开工作台要完成什么，再讨论菜单。** 有参考价值的样本分别服务于找出需要关注的工作、处理新输入、选择可投入的工作、回顾调整、重新遇到材料、围绕问题形成理解。不同产品没有一套统一的最佳菜单。
2. **仅将目录改成跨目录表格、卡片或统计，仍不足以说明自建价值。** Obsidian Bases 已经提供属性编辑、排序、过滤与多视图，数据仍在本地 Markdown 中。[S1] 如果需求到此为止，使用原生能力和少量入口可能更合算；这个选择应保留。
3. **自建工作台更有希望提供的价值，是缩短具体工作的操作链。** 例如从发现待澄清输入，到做出处理决定并正确写回；从找到正在推进的工作，到恢复上下文并继续；从每周检查，到调整下一步与投入。是否能缩短这些操作、所需维护成本是否值得，仍应由本人真实场景验证。
4. **知识工作不能只用任务清单来表达。** Heptabase 的案例把来源、概念、问题和表达联结起来；Reader 让材料重新进入注意范围。这些提供了学习、研究、创作方向的不同候选，但不等于必须自建白板、阅读器或知识复习系统。[S8–S10,S12]
5. **AI 可以帮助整理上下文和提出建议，不能据此自动认定真实工作状态。** Sunsama 当前自动规划文档明确标为 beta，并提供逐项审阅和撤销；不能将其宣传或 beta 行为视为成熟成效，也不能将其自动化权限直接移植到 tannt。[S11]

## 七种可区分的做法

| 做法 | 官方可观察事实 | 它服务的具体问题 | 对 tannt 的借鉴与边界 |
| --- | --- | --- | --- |
| 原文件上的多视图 | Bases 可以查看、编辑、排序、过滤文件及属性；同一 base 可有多个视图，数据保留在 Markdown 中。[S1] | 同一批笔记需要不同看法，不必复制内容 | 用作“原生能力是否已经够用”的比较基线；仅换视觉样式不构成自建理由。文档能力不代表本机版本都已启用。 |
| 跨来源的个人关注视图 | Notion My Tasks 聚合多个 Task 数据库中的任务，并可原地查看上下文和更新；Linear My issues 按需要关注的工作分类，已开始事项在同类中靠前。[S3,S4] | 每次开工都要逐项目寻找自己接下来做什么 | 可以探索少量当前关注工作与恢复上下文入口；不照搬团队指派、SLA、冲刺。排序依据应解释得清楚，不能让“最近改过”冒充“最重要”。 |
| 输入澄清与处理队列 | Linear Triage 在工作进入团队流程前提供审查、更新和优先级处理，动作包括接受、拒绝、重复合并、稍后处理。[S5] | 输入已收集，但处理方式没有决定 | 借鉴“每条输入有明确处理出口”的交互。tannt 收件箱也包括可保留为资源的材料，不能把每条输入都变成任务；Linear 的拒绝/取消含义也不能直接移用。 |
| 按容量选择工作 | Sunsama 的手动 daily planning 先回顾、选任务，再核对估时总和与容量，允许推迟；日历 timeboxing 是可选步骤。[S6] | 有很多可做事项，却没有做投入取舍 | 可以借鉴开工时选择少量重点；不能直接推出必须估时、每天填表、日历化或自动排程。估时与会议数据不完整时，其容量预测也不可靠。 |
| 有步骤的回顾 | Sunsama Weekly Review 依次回顾目标、已完成工作和时间分配、反思；没设置目标时跳过该步，日记步骤可以永久跳过，也可以与下周规划合并。[S7] | 系统积累了状态，却没有定期纠偏 | 可探索围绕投入、卡点和下一步的短回顾；不强制工作日记、工时统计或成果登记。借鉴的是产生调整的流程，而不是增加一个只显示统计的页面。 |
| 材料重新进入视野 | Reader 支持按保存日期、阅读长度、标注数等条件组织视图；Daily Digest 从 Feed 与 Saved for Later 中呈现部分文档，帮助处理与重新发现，也可关闭。[S8,S9] | 保存很多东西后，很少再遇到对当前问题有用的材料 | 可探索围绕当前问题展示已有关联资料，或由本人选择是否启用轻量回顾。不能把所有资料做成阅读债务，也不能将 Reader 的阅读状态/Archive 等同 tannt 的整包归档。 |
| 围绕问题构建理解 | Heptabase 官方案例从来源中提取概念、连接和分组，再把概念复用于新的研究白板，最终重组为文章或工作计划。[S10] | 有来源资料，却缺少能用于研究、写作的理解结构 | 可探索当前问题、已有认识、证据、尚未解决的问题和相关材料共同出现的工作上下文。重点是理解与使用，不是再列资源目录；是否需要自建视图，应与 Obsidian 内的笔记、链接和现有工具比较。 |

## 容易误读的两处产品变化

**Notion 的旧 Home 页面已经变化。** 查阅时，旧的 `home-and-my-tasks` URL 重定向到 `navigate-with-the-sidebar`。该页 FAQ 明确说明 Home 已从整页变成侧栏的一部分；可定制 Recents、Favorites、Teamspaces、Agents 等，My Tasks 和 Library 仍各有入口。[S2] 因此不宜拿旧版首页截图作为当前标准。仍值得参考的是：工作入口与完整内容浏览可以各自服务不同目的；My Tasks 的聚合能力在独立指南中继续有明确说明。[S3]

**Sunsama 当前 Daily Planning 文档介绍 beta Agentic Daily Planning。** 文档明确将原手动流程放到 Legacy Daily Planning。这里用原手动流程分析成熟的选择、容量核对和排序做法；beta 只作为“自动化也需要可审阅、可调整、可撤销”的观察，不将其效果当成已验证事实。[S6,S11]

## 用于下一轮讨论的候选定位

以下不是三个必须同时建设的模块，而是需要比较的定位选择：

| 候选 | 用户打开它的主要动机 | 需要证明的额外价值 | 主要代价 |
| --- | --- | --- | --- |
| 轻量原生入口 | 找到相关内容或保存的视图 | 原生笔记、链接、Bases 加少量入口即可满足 | 特定操作可能仍要分散完成；但自建维护最少 |
| 工作推进界面 | 恢复正在推进的工作，处理输入，调整下一步 | 把跨文件/跨步骤操作连起来，减少重复寻找与状态维护 | 需要可靠的状态、处理出口与正确写回；若数据长期不更新，界面会失去可信度 |
| 研究与创作上下文 | 围绕问题理解材料、形成判断、准备表达 | 让问题、证据、认识和当前工作互相可达，并支持连续思考 | 容易重复编辑器、白板或知识库功能；如果只是关系图和资源清单，收益仍不明确 |

Agent 协作可能是上述定位中的一种交互方式，但当前研究没有证明“再建一个 Agent 管理器”适合本人的场景；也没有证明本库现在具备启动、监控或自动推进 Agent 的能力。应从具体工作中断点再决定。

建议后续用具体情境检验，而非先排列新菜单。例如：

- 隔了三天重新进入一个研究项目时，怎样找回上次的判断、证据与尚未解决的问题？
- 收件箱里的一条材料暂时不值得启动工作时，怎样完成澄清、留下可复用内容？
- 一周结束时，怎样发现投入过多、卡住或没有下一步的工作，并做一次调整？
- 准备某次培训或文章时，怎样使用已有案例和判断，而不重新遍历资源目录？

这些是测试候选定位的情境，不代表本人已经存在上述问题。应先确认最有价值的情境，再确定最小范围及其是否需要自建。

## 证据索引

全部查阅于 **2026-10-28**。引文为短定位片段，产品行为以所链接的官方文档为依据。读到的厂商方法与效果表述均保留其主体，不作为独立实证。

### S1 · Obsidian — Introduction to Bases

<https://obsidian.md/help/bases>

> “view, edit, sort, and filter files and their properties”

正文说明 Bases 是核心插件，同一 base 可有多视图；数据存于本地 Markdown 及其属性，视图可存为 `.base` 或嵌入 Markdown。支持“多视图不等于需要第二套内容数据”。

### S2 · Notion — Navigate with the sidebar

<https://www.notion.com/help/navigate-with-the-sidebar>

> “Home changed from a full-page experience to a part of your sidebar”

正文分别描述 Home、My Tasks、Library、Search、聊天和会议入口；FAQ 解释 Home 的变化。旧 URL <https://www.notion.com/help/home-and-my-tasks> 在本次访问中重定向到本页。

### S3 · Notion — Give your to-dos a home with Task databases

<https://www.notion.com/help/guides/give-your-to-dos-a-home-with-task-databases>

> “My Tasks brings together all tasks assigned to you”

指南说明从 Task 类型数据库聚合，并可查看、过滤、排序、更新任务；当前写明最多连接 10 个 Task 数据库，所需属性包含 Status、Assignee、Due date。借鉴聚合体验不意味着 tannt 需要这些字段或数据库组织方式。

### S4 · Linear — My issues

<https://linear.app/docs/my-issues>

> “My issues is a curated view that shows your most pertinent issues.”

页面包含 Assigned、Created、Subscribed、Activity 四类；Assigned 的关注顺序包括紧急工作、SLA、阻塞项、周期内工作、其他进行中工作、Triage、Backlog 与完成项，同类中已开始事项优先。属于团队 issue 场景，不是个人学习通用优先级模型。

### S5 · Linear — Triage

<https://linear.app/docs/triage>

> “review, update, and prioritize issues before they are added to your team’s workflow”

文档列出 accept、decline、mark as duplicate、snooze；重复处理会迁移附件，稍后处理会按时间或新活动重新出现。此处只借鉴输入澄清的机制，不主张复制其状态语义或自动化套餐。

### S6 · Sunsama — Legacy Daily Planning

<https://help.sunsama.com/docs/usage-guides/daily-planning/legacy/>

> “Optionally timebox them to your calendar”

流程包括回顾昨日、选择工作、检查预计工作量、排列顺序。预计工作量依赖 planned times 与会议等输入；超过容量时可推迟或移回 backlog。日历排块为可选。

### S7 · Sunsama — Weekly Review

<https://help.sunsama.com/docs/usage-guides/weekly-objectives/weekly-review/>

> “Skip this step in the future”

顺序为回顾目标、回顾本周工作、反思；未设目标时跳过目标步，可永久跳过日记步，可合并周回顾和周规划。支持“回顾可以是一段可裁剪的操作流程”。

### S8 · Readwise Reader — Organizing Content

<https://docs.readwise.io/reader/docs/organizing-content>

> “date saved, reading length, number of highlights”

Filtered Views 可按上述及其他条件组织材料。这里的价值是按使用条件切出所需材料；单凭过滤视图也不能证明自建 tannt 界面的必要性。

### S9 · Readwise Reader — Daily Digest

<https://docs.readwise.io/reader/docs/faqs/daily-digest>

> “help you triage your feed and rediscover documents you might have forgotten about”

Digest 从 Feed 和 Saved for Later 取部分文档；可关闭。移动端为可滚动的阅读形式，网页端可将同组文档加入 Home。文档只证明产品机制，不证明本人应每天使用。

### S10 · Heptabase — Learn & research a topic

<https://wiki.heptabase.com/the-best-way-to-acquire-knowledge-from-readings>

> “most of these tools put too much focus on how you store your notes”

这是创始人以自己读书与研究为例的方法说明，步骤为摘录、拆概念、建立关系、分组、与旧概念整合。案例将两本书的概念复用于 Dynamic Medium 的研究白板，并讨论再组织为可沟通的文章。它支持一种以理解和使用为目标的设计方向，不证明原子化笔记对所有人都最有效。

### S11 · Sunsama — Daily Planning（beta 观察）

<https://help.sunsama.com/docs/usage-guides/daily-planning/>

> “Agentic daily planning is currently in beta.”

该流程读连接工具、拟订每日计划，展示新增和移动动作、judgement calls，并提供调整、逐项撤销或整体撤销。这里只用于标注版本边界与审阅机制，不用来证明成熟自动化效果。

### S12 · Readwise Reader — What is Readwise Reader?

<https://docs.readwise.io/reader/docs>

> “highlight and annotate text as you read”

官方概述将不同阅读材料、标注与 Highlights library 的后续组织和回顾联系起来，说明其价值链不止于保存和分类。未实际验证其同步或导出与 tannt 的集成。

## tannt 现状与待讨论

本节依据本库规则、既有设计记录与正式工作台源码核对。外部样本不自动覆盖本库规则，也不构成实现许可。核查时源码 manifest 为 0.20.1；本轮没有重新操作 Obsidian 界面，以下“已有”表示当前源码能力，不代替已安装版本的实测。

### 当前实现与定位的落差

- [主导航](../../apps/workbench/main.js)第 320 行直接列出五个业务根目录，另有任务、全部笔记、开发 Issue 等入口；[通用浏览器](../../apps/workbench/browse-ui.js)承接领域、资源、存档及全部笔记。后三个目录页主要仍是文件夹、文件和搜索，重复浏览的问题在源码中有明确依据。
- 项目与任务并非纯文件列表。[任务界面](../../apps/workbench/task-ui.js)已有进展、下一步、状态维护；[主界面](../../apps/workbench/main.js)已有跨项目任务及筛选；[输入关联与分流](../../apps/workbench/work-links.js)区分迁入原记录及专属附件与仅建立引用；[工作界面](../../apps/workbench/work-ui.js)已有归档、恢复和局部用途记录。这些是重新组织工作流程时可评估保留的能力。
- 当前源码未见专门承接开工选择重点、每周短回顾的流程页面。任务数量统计和状态总表不能单独说明已经支持投入取舍、卡点检查或上下文恢复。
- [查询 Agent](../../docs/workbench/agent-query.md)目前生成供新会话使用的 Prompt，不启动或持续监控 Agent。工作状态、实际执行状态与结果是否被本人接受不能混为一谈。
- Agent 规则与 FNS 等页面具有设置和核对的操作价值；是否保留这些功能与业务主导航怎样设计是两个问题，不因日常入口重设就推断需要删除它们。

### 已有决定与本次待定部分

- [术语表](../../GLOSSARY.md)的“工作台”本来就指查看和推进工作事项、管理库设置的界面，并未要求镜像目录；“工作总览”则专指一项已启动工作的目标、进展、下一步和资料，本轮不将其静默改成全库仪表盘。
- [ADR 0004](../../docs/adr/0004-project-centered-information-architecture.md)决定五目录的内容组织和根首页、按需 MOC，没有要求工作台采用一比一菜单。重设工作入口不自动意味着改动文件组织或迁移业务内容。
- 用户此前已经确认推进工作优先，以及开工选重点、每周短回顾；见[历史讨论 Q3、Q15](../information-architecture-workflow/map.md)和现行[项目与任务规则](../../docs/rules/projects-and-tasks.md)。本轮继续把它们作为已知背景，不重复询问是否需要回顾；工作台具体怎样承接仍待确定。
- 用户此前明确不设置统一成果总览或强制成果登记。收藏或购买课程不自动产生任务；资源允许没有当前工作用途。成熟产品中的工时、日历、团队任务或强制复习不能直接变成本库要求。
- [ADR 0001](../../docs/adr/0001-shared-rules-and-scenario-skills.md)要求规则先于实现，Agent 能独立操作库文件；[项目与任务规则](../../docs/rules/projects-and-tasks.md)要求各入口读写同一份说明笔记，不另设可编辑业务状态数据库。这些已有边界支持重新分配工作台、Obsidian 和 Agent 的职责。

### 第一轮建议与设计树

以下是研究建议，尚待用户回答：优先把工作台作为安排、衔接和回顾工作的入口。它帮助本人选出当前关注事项、接上已记录的上下文、处理输入并落实下一步；深度阅读和长文编写继续使用 Obsidian，研究与加工可交给获授权的 Agent。是否自建某个页面，要看它能否比现有工具更顺畅地完成具体流程，而非仅能多展示一些信息。

第一轮只讨论主定位。候选包括：以工作推进和回顾为主（推荐）、以研究创作环境为主、主要采用 Obsidian 原生视图并仅保留必要操作。尚不决定菜单、字段、自动化权限或开发范围。

```text
工作台作用与定位
└─ Q1 主定位：主要在什么情境中提供独立价值？［待回答］
   ├─ 若以工作推进和回顾为主
   │  ├─ 最值得优先改善的真实情境与中断点
   │  ├─ 工作台、Obsidian、Agent 的具体交接与操作边界
   │  └─ 最小流程及其效果、维护负担的验证办法
   ├─ 若以研究创作环境为主
   │  ├─ 问题、证据、认识、表达之间缺少的连接
   │  └─ 现有笔记、链接、Bases 或其他工具是否已足够
   └─ 若以原生能力和少量操作为主
      ├─ 哪些现有操作需要保留独立界面
      └─ 哪些重复展示可退出工作台
   各分支明确后：确定信息组织与菜单 → 记录确定的术语/必要决策 → 确认实施范围
```

本轮仅新增本研究文件。没有改工作台实现、正式规则、术语表、ADR、业务内容或现有任务状态；上述分支不表示已创建开发任务。
