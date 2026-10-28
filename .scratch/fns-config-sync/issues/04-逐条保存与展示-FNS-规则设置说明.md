Status: ready-for-agent
State: completed
ID: e049ca93-38a0-407b-b268-17665e3c2e55
Input hash: e6dbd3f994a46c260aabfa5f32782c7f867be185b970b270efe782b265cbfc97
Created: 2026-10-28T01:42:07.435Z
Updated: 2026-10-28T01:55:51.484Z
Labels: ["功能"]
Priority: medium
Blocked by: []
Related: ["docs/rules/fns-config-sync.md","docs/workbench/fns-config-sync.md"]

# 逐条保存与展示 FNS 规则设置说明

本人希望在权威版本每条规则右侧看到设置目的和原因。当前版本没有说明字段。实现工作台逐条编辑、持久化本机草稿、随明确发布传递说明并展示对应版本；保留旧发布读取能力。

- [x] 说明绑定字段组、规则与大小写选项；不修改 FNS 配置正文
- [x] 工作台和独立程序支持草稿保存与版本冲突检查
- [x] 发布预览说明变化，重试固定同一次发布；接收与展示对应版本
- [x] 右侧显示说明，空值有填写入口，宽窄窗口可读
- [x] 测试、安装与实际入口验收，记录未验证范围

## Comments

<!-- tannt-comment:{"id":"bd701bc0-4478-4cc9-8c06-527047fdd71d","author":"Agent","created":"2026-10-28T01:55:51.484Z"} -->
已实现并安装、加载工作台 v0.20.0。说明草稿保存在 state.json；已发布说明随 authority.jsonc schema 2 固定到版本，仍读取旧 schema 1。27 项 FNS 服务测试全部通过；真实 Obsidian 入口、1280/420 布局及说明编辑/失败保留/继续输入/预览经过界面夹具验证。证据：.scratch/fns-config-sync/verification/notes/native.json、verification.json 与截图。未向真实远端发布新版本；真实两台设备和 Windows 原生仍由原验收 Issue 跟进，未自动代填任何设置原因。
<!-- /tannt-comment -->

## Activity

- 2026-10-28T01:42:07.435Z · Agent：创建 Issue。

- 2026-10-28T01:55:51.298Z · Agent：更新属性：分诊=可交给 Agent；关联=["docs/rules/fns-config-sync.md","docs/workbench/fns-config-sync.md"]。

- 2026-10-28T01:55:51.355Z · Agent：勾选验收项：说明绑定字段组、规则与大小写选项；不修改 FNS 配置正文。

- 2026-10-28T01:55:51.378Z · Agent：勾选验收项：工作台和独立程序支持草稿保存与版本冲突检查。

- 2026-10-28T01:55:51.404Z · Agent：勾选验收项：发布预览说明变化，重试固定同一次发布；接收与展示对应版本。

- 2026-10-28T01:55:51.431Z · Agent：勾选验收项：右侧显示说明，空值有填写入口，宽窄窗口可读。

- 2026-10-28T01:55:51.458Z · Agent：勾选验收项：测试、安装与实际入口验收，记录未验证范围。

- 2026-10-28T01:55:51.484Z · Agent：关闭 Issue（已完成）；已实现并安装、加载工作台 v0.20.0。说明草稿保存在 state.json；已发布说明随 authority.jsonc schema 2 固定到版本，仍读取旧 schema 1。27 项 FNS 服务测试全部通过；真实 Obsidian 入口、1280/420 布局及说明编辑/失败保留/继续输入/预览经过界面夹具验证。证据：.scratch/fns-config-sync/verification/notes/native.json、verification.json 与截图。未向真实远端发布新版本；真实两台设备和 Windows 原生仍由原验收 Issue 跟进，未自动代填任何设置原因。。

