# Git 仓库接入、提交与版本发布

适用于工作台源码仓库的 Git 接入、读取、分支、Worktree、提交与发布。路径均相对源码仓库根；知识库实例的 Git、FNS 配置传输及凭据由实例自己的规则管理。

## 仓库与操作范围

远端 `origin` 的读取与推送地址均为 `https://github.com/cookaihq/tt-workbench.git`。2026-10-29 使用仓库独立 Token 完成接入及读取回读；GitHub 返回账号为 `cookaihq`，远端默认分支为 `main`，当次可见提交为 `6bf7342a8063ab77295a07ffc463d8ba120da518`。

本次只验证身份、实际 remote 配置和 `ls-remote` 可见引用，未 fetch、合并、提交或推送；本地与远端历史关系、推送权限及 Release 均未验证。后续发布前重新读取远端并检查历史，不能把这次接入当作历史已同步。

本仓是独立仓库；与原 tannt 仓库的关系见 [ADR 0005](../adr/0005-independent-workbench-repository.md)。目录嵌套、相同 URL 或相邻目录不证明管理关系。初检只有主检出，没有登记子仓或子模块。每次操作先核对实际检出：

```powershell
git rev-parse --show-toplevel
git status --short --branch
git worktree list --porcelain
git remote -v
git config --show-origin --get user.name
git config --show-origin --get user.email
```

遇到带凭证的旧 remote 时只报告脱敏地址，先处理原配置。读取和推送 URL、URL 重写、分支跟踪及 `remote.pushDefault` 均以本次实际配置为准。Worktree 共享 common Git 配置，变更前核对受影响检出；凭证来源以已核实主检出为准，不复制到每个 Worktree。

初检分支为 `feat/skill-installation`，HEAD 为 `c5976e1ab63778b4d0c9f4e743d988920cba5dd2`，没有 upstream。提交作者从本机全局 Git 配置继承 `t <zhoan@163.com>`；它与 GitHub 鉴权账号分别核对。其他设备使用自己的已确认作者，不照搬本机身份。

接入 URL 只授权本次配置和读取。创建分支、Worktree、提交、推送与 Release 按具体任务授权执行，沿用本次已经明确的决定。本仓未规定自动推送分支、标签或同步目标；发布时明确完整引用及目标，不从当前分支或 remote 名称推断发布范围。保留暂存区和其他会话修改，按审阅过的文件清单提交。

## 凭证来源

用户明确选择本仓独立 Token，方式为 `github-token`。唯一来源是主检出的 `.credentials/repositories/cookaihq--tt%2Dworkbench.github-token`，目标仅为 `https://github.com/cookaihq/tt-workbench.git`。后续调用直接读取该文件当前值，不使用本机 `gh` 登录、环境 Token 或全局 helper；来源缺失或失效时修复此文件，不自动切换。

文件内容只能是单行 Token 原文，不加引号、变量名或 URL，允许一个末尾换行。2026-10-29 用户填写并明确回复后已完成验证；通过本机 `.git/info/exclude` 忽略该精确路径，文件及两个父目录的 Windows ACL 仅允许当前用户访问，已禁用继承。每次使用前核对未跟踪、被 Git 忽略且为无链接的普通文件；其他设备分别核验 Windows 私有 ACL 或 Unix 目录 700、文件 600。新设备首次准备文件后也须等待用户明确已填写才读取。Token 不进入对话、参数、remote、规则或日志。

本机确有来源差异需要记录时，使用主检出的 `.credentials/repositories/sources.local.md`，保持未跟踪且被忽略。唯一 JSON fenced array 只记录 `{url, method, account}` 或 `{url, method, file}`，文件路径相对主检出，不记录秘密、验证状态或 Token 指纹。没有记录时沿用本节已经明确的来源，不能从活动账号、其他仓库或全局 helper 补选。能从本节重建时无需另存记录。

当前没有 CNB 远端或 GitHub/CNB 同步策略。今后明确接入 CNB 时，先单独选择来源；CNB 文件保存一行带身份字段的 HTTPS 仓库 URL：主机为 `cnb.cool`，路径为完整仓库路径，用户名固定为 `cnb`，密码字段为 Token，Token 的 URL 特殊字符须编码。不得借用知识库的凭证或传输仓库。

## 按次鉴权，不依赖安装本 Skill

普通终端、IDE、CI 继续使用各自既有鉴权，不会自动读取自定义凭证目录。Agent 使用下面的过程构造本次 Git 子进程环境；仅在已忽略的 `tmp/git-setup/` 放置必要短期 helper，文件不含 Token。无需安装持久 helper 或复制 Skill 实现。

1. 核对选定 remote 的完整 HTTPS 地址与本节目标一致。捕获而不回显 URL 匹配后的 `http.extraHeader`；若存在 Authorization、Proxy-Authorization 或 Cookie 鉴权冲突，停止并修复原来源。
2. 构造干净的子进程环境：清除继承的 `GIT_CONFIG_*` 注入、`GIT_TRACE*`、`GIT_CURL_VERBOSE`、`GH_TOKEN`、`GITHUB_TOKEN`、企业版 Token 及旧的凭证传输变量。宿主通过进程配置声明的 `safe.directory` 仅保留具体绝对路径及清空列表的空值，合并到本次配置；不保留 `*`、递归通配或相对路径，也不修改全局信任。
3. 从上述独立文件将当前 Token 读取到内存，检查格式及完整目标；保留本次内存指纹，在每次网络操作前重读核对，同一次计划或操作中发生轮换时停止并重新核验。不保存历史 Token 指纹；下次调用直接验证文件中的新值。
4. 使用内存中的 Token 请求 `https://api.github.com/user`，取得实际 `login`；如果本次任务另有明确账号约束，核对一致。只报告身份等非敏感结果，不根据仓库 owner 推断 Token 所属账号。凭据只发送到对应 GitHub HTTPS 目标。读取成功不证明推送、Issue 或 Release 写权限。
5. 短期 helper 读取 Git credential 协议 stdin，只实现 `get`。仅收集 `protocol`、`host`、`path`、`username` 四个身份字段，重复身份字段拒绝；忽略其他字段，包括可重复的 `capability[]`、`wwwauth[]`。核对 `protocol=https`、`host=github.com`、完整路径 `cookaihq/tt-workbench`（允许末尾 `.git`）及用户名。GitHub 用户名固定 `x-access-token`，CNB 固定 `cnb`。目标不符、身份字段不合法或 Token 缺失时返回 `quit=true`；`store`、`erase` 无动作。成功时仅向 Git 管道输出 `username` 和 `password`，不向用户日志输出。
6. Token 仅以任务专用变量传入本次 Git/helper 子进程。用 `GIT_CONFIG_COUNT` 与成对的 `GIT_CONFIG_KEY_n` / `GIT_CONFIG_VALUE_n` 追加以下配置；重复的 `credential.helper` 按顺序保留：

   | 键 | 本次值 |
   | --- | --- |
   | `credential.helper` | 空值，清空继承 helper 链 |
   | `credential.helper` | 调用短期 helper 的命令，只包含程序与文件路径 |
   | `credential.useHttpPath` | `true` |
   | `credential.username` | `x-access-token` |
   | `credential.interactive` | `false` |
   | `http.extraHeader` 及本目标 URL 的 `http.<url>.extraHeader` | 空值 |
   | `http.followRedirects` 及本目标 URL 的 `http.<url>.followRedirects` | `false` |

   同时设置 `GIT_TERMINAL_PROMPT=0`、空的 `GIT_ASKPASS` 和 `SSH_ASKPASS`，阻止回退到交互登录。环境变量只作用于本次进程，不写入用户配置、仓库配置或永久环境。
7. 在该环境先执行 `git ls-remote --symref origin`；根据本次授权执行后续读取或写入。完成后释放内存凭据并清理本次 helper。来源缺失、失效或身份不符时停止，修复原来源，不切换其他账号、文件或全局 helper。

Git HTTPS 连接 GitHub 失败或超时时，若本机 `127.0.0.1:7897` 的 Clash 可用，在同一临时鉴权环境中用 `git -c http.https://github.com.proxy=http://127.0.0.1:7897 <原参数>` 重试一次，不修改全局 Git 配置；鉴权、权限或仓库不存在错误不走代理重试。

## 读取、提交与发布

`ls-remote` 验证的是当前可见引用和默认 HEAD，不会取得对象或证明本地与远端历史相连。查询成功且没有任何可见引用才能称为空仓。取得历史时按明确分支 fetch，核对快进关系后再合并；遇到分叉、独立历史或同名不同对象的标签，先说明实际差异与保留方案，禁止自动强推、mirror、重写历史或删除目标独有引用。

发布前检查拟发布引用的全部可达历史，包括已删除的秘密、大文件、LFS 指针与子模块；`.gitignore` 不会清除已提交内容。审查时禁用 Git replace/grafts，说明扫描边界，不把当前文件检查称为完整历史审查。知识库笔记、账号、设备快照和 `local-evidence/` 不属于公开软件交付；实际运行目录（默认 `.system/.workbench-runtime/`）、固定位置配置 `.system/workbench/`、旧 `.workbench-runtime/`、旧 `apps/workbench/data/` 与 `tmp/` 的忽略规则须保持生效。

用户明确授权推送后，在上述同一临时鉴权环境内：

1. 固定已审阅完整引用的对象 SHA，写前再次检查引用和远端状态没有变化。
2. 使用显式 `<SHA>:refs/heads/<目标分支>` 或已选完整标签引用，关闭隐式标签及子模块推送，使用 `--no-force`；不自动设置 upstream，不推送额外引用。
3. 逐 ref 执行 `ls-remote` 回读并比较 SHA。结果不明时先只读核对原目标，不直接重发。分支保护拒绝时使用已授权的 PR 流程或报告阻塞，不调整保护规则。

当前没有自动同步机制。若以后明确设置同步，逐个约定来源、目标和完整 refs，只从主要远端已发布引用取得对象；不混入尚未发布的本地引用。逐目标、逐 ref 验证，不能将 Git 引用一致视为 LFS、子模块、Issue、PR、Release 附件或 CI 全部同步。

## 发布工作区与收尾

默认在现有检出中准备发布，固定已审阅、已验证的提交，不为发布新建分支或 Worktree。若并发修改需要隔离，优先将固定提交导出到已忽略的 `tmp/release/<版本>/` 下进行构建与验收，并核对产物对应该提交；只有验收确实需要 Git 检出等原因无法使用导出副本时，才创建临时 Worktree。Worktree 可直接检出固定提交，无须同时创建分支；临时发布分支仅在有明确需要时创建。

发布过程中记录本次创建的临时目录、Worktree、分支及来源提交。正式 Release 的引用和附件回读验证通过后，必须完成以下收尾：

1. 将需保留的安装包、校验记录与测试日志保存到临时检出之外，例如源码根的 `tmp/release/<版本>/artifacts/`，核验复制后的文件，并更新发布记录中的证据路径。
2. 检查临时检出的暂存、未暂存、未跟踪与忽略文件，以及进程占用；确认没有独立修改或未保存成果后，用 `git worktree remove` 移除本次临时 Worktree。临时分支确认没有待保留的独有提交后清理；不清理正式版本标签、开发分支或其他会话的资源。
3. 回读 `git worktree list --porcelain`、相关引用和目录状态，确认临时资源已清理、正式标签仍指向发布提交，并在发布记录中注明结果。因占用、未知改动或执行限制无法完成时，明确记录剩余项与原因，不能把发布成功当作清理完成。

发布中断时保留必要的恢复依据，处理或交接尚未清理的临时资源；恢复发布后仍须执行上述收尾。

## 现有工具与 Release

本仓构建、测试、开发安装入口由 `package.json` 和[开发说明](../workbench/development.md)维护；[README](../../README.md)面向普通用户，提供完整 ZIP 与 Agent 安装入口。Release 步骤见[工作台版本与更新](../workbench/updates.md)。发布前按该流程执行 `npm test`、`npm run build`，核对版本并验证完整包；使用 CLI 安装时始终明确 `--vault <目标库绝对路径>`。

Release 附件为 `dist/tt-workbench.zip`、`dist/release.json` 和 `dist/tt-workbench.bundle.json.gz`，需要单独明确发布授权。当前没有专用的 GitHub 推送、PR 或 Release 上传脚本、hook 或 CI；构建成功不会自动提交、推送或发布。只修改 Git 说明时检查文本、引用和实际 Git 配置，无需重跑应用测试。

已安装 git-setup 时可调用其当前实体的 `scripts/git-setup/cli.mjs`：`check` 检查现状，`read --remote origin` 验证读取，`setup` 计划接入，`audit --ref <完整引用>` 审查历史，`publish --remote origin --ref <完整引用>` 预览发布。鉴权显式传入 `--auth-method github-token --credential-file <主检出绝对路径>/.credentials/repositories/cookaihq--tt%2Dworkbench.github-token`；设置或发布的执行使用同参数、`--apply` 和本次 `--expected-fingerprint`。脚本计划不扩大授权；未安装 Skill 时执行本文上述标准 Git 与临时鉴权过程。

## Agent 入口与验证边界

Codex 从根目录 `AGENTS.md` 的 Git 操作入口读取本文；Claude Code 的根目录 `CLAUDE.md` 使用 `@AGENTS.md` 导入同一入口。本机 WorkBuddy 5.8.3 的随附加载器按项目主文件候选顺序读取，项目未设置 `CODEBUDDY.md` 时支持 `AGENTS.md`；本仓沿用该入口，不复制另一份 Git 规则。

入口文本、路径和客户端安装代码的检查不等于新会话实际加载。当前 Codex 会话已完成独立 Token 身份核验、远端接入与读取回读，文档及引用已读回；Claude Code 与 WorkBuddy 新会话的实际加载及鉴权调用仍待分别验证，不将此结果推广到其他设备或宿主版本。
