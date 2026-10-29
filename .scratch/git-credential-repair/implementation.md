# 普通 Git 推送认证修复

日期：2026-10-29。本文所有路径以 `tt-workbench` 项目根为基准。

## 目标与原因

用户已选择 GitHub `cookaihq/tt-workbench` 为本项目主仓，并明确授权修复普通 Git／Orca 推送按钮的认证。git-setup Skill 的通用改造由另一个 `skill-dev` 会话负责。

按钮执行 `git push --set-upstream origin HEAD`，此前报 `Cannot prompt because user interactivity has been disabled` 和 `unable to get password from user`。Agent 的按次鉴权会读取项目 Token，但普通 Git 当时只有系统 Credential Manager，没有连接到该来源。选择默认远端本身没有解决这个差异。

## 实施

- `scripts/git/credential-helper.mjs`：本项目独立 helper；精确匹配 HTTPS 主机、仓库路径与用户名，核对检出关系、忽略状态、链接和私有权限，每次从已选文件读取当前 Token。拒绝异常来源；`store`／`erase` 不修改文件。
- 仓库 common Git 配置：仅为本目标的带／不带 `.git` 两个 HTTPS URL 清空继承 helper 并接入本脚本，启用 `useHttpPath`、固定用户名、禁用交互和重定向，清空目标额外 HTTP 头。命令中的 Node 与主检出路径按本设备解析；全局配置没有修改。
- `scripts/git/credential-helper.test.mjs`：使用虚构 Token 与隔离临时仓库验证真实 Git credential 协议；`scripts/workbench/test.mjs` 纳入该测试入口。
- `docs/agents/git-access-commit-and-release.md`：记录普通 Git 接入、其他设备重建方法及验证边界；保留 Agent 按次身份核验与发布约束。沿用根 `AGENTS.md` 的 Git 操作必读入口，无新增入口。

唯一真实来源仍为 `.credentials/repositories/cookaihq--tt%2Dworkbench.github-token`。未复制或写入 Token；源文件与两个父目录仍由当前用户私有 ACL 保护，来源未跟踪且被忽略。

## 验证

本机：Windows，Node.js 24.21.0，Git 2.53.0.windows.1。

- 专项测试 7 组全部通过：普通 Git 读取与轮换、错误目标及重复身份字段、store／erase、格式／跟踪／忽略／硬链接、关联 Worktree 与独立仓拒绝、目录链接与权限、来源或运行时缺失时阻断后续 helper。
- 普通 `git credential fill` 的输出仅在内存中与原文件比较，一致；未向日志输出凭证。
- 使用普通 Git 提供的凭据调用 GitHub 身份接口，返回 `cookaihq`。
- 在禁用提示、没有临时 helper／Token 环境注入的环境执行 `git push --dry-run --set-upstream origin HEAD`，退出码 0。
- 随后普通 Git 回读远端 `main` 为 `f59f7e5cd74d294cb916ceb1e2efed93d9dafafe`；本地 HEAD 仍为 `883a8d893c961e5fc71c713a442060ce9e8878b2`。本次没有提交或真实推送。
- `npm test`：291 项，284 通过、7 项可选集成测试跳过、0 失败，退出码 0。日志在已忽略的 `tmp/git-credential-repair/npm-test.log`。文本差异与根 Agent 入口的本地 Markdown 引用检查也已通过。

未修改插件、CLI 业务或分发产物，因此未构建或安装插件。未实际点击会写远端的 UI 按钮；推送预演不代表未来提交必然通过服务器端策略。macOS 与其他设备尚未实测。

## 路径与维护

其他设备需要保持项目根下 `scripts/git/credential-helper.mjs` 与 `.credentials/repositories/cookaihq--tt%2Dworkbench.github-token` 的相对位置，并各自完成凭证准备及 Git 本机接入。Git 本机配置不会随 clone 同步；主检出或 Node 位置变更后需要重新配置命令路径。Agent 规则仍由根入口读取 `docs/agents/git-access-commit-and-release.md`；本次只验证本机正文、引用与 Git 行为，没有进行其他宿主的新会话加载验收。

原本机 Git 配置恢复副本位于已忽略的 `tmp/git-credential-repair/config.before`。早期测试失败留下 `tmp/git-credential-repair/test-SymC5E/` 与 `test-Y5pZbC/`，只含虚构测试凭证；自动审批拒绝递归清理，返回 `blocked by policy`，未给出更具体原因，故保留。后续通过的测试会清理其自行创建的目录。
