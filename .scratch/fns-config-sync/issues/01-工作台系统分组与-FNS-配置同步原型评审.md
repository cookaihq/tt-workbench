Status: needs-triage
State: completed
ID: c78e8936-118c-4c2f-8d62-822cd8792d41
Input hash: b9b857dc6cb1af634f234bfbdc07f5a5bcac779efb8761f6434b3c8f986100d8
Created: 2026-10-27T13:38:29.056Z
Updated: 2026-10-27T14:00:14.858Z
Labels: ["原型","工作台"]
Priority: medium
Blocked by: []
Related: []

# 工作台系统分组与 FNS 配置同步原型评审

本轮授权：先做交互原型。在工作台左侧增加“系统”分组，新入口为“FNS 配置同步”。

原型：`docs/prototypes/workbench/fns-config-sync-prototype.html`。规格：`.scratch/fns-config-sync/spec.md`。

- [x] 原型展示系统分组与 FNS 入口，沿用当前工作台样式。
- [x] 提供 A 状态总览、B 任务流程、C 差异工作区，支持 URL 与底部切换。
- [x] 用两台示例设备演示明确发布、接收、比较与应用，并覆盖首次接入、推送失败重试、两端修改及来源变化。
- [x] 检查桌面与窄窗口显示；全部操作只修改内存示例。
- [x] 用户选择或组合页面布局。

真实设备接入、Git 传输、FNS 配置读写与重载、插件安装及跨设备验收仍待后续实施。本轮不退役 tannt-sync-agent-config。原型不能作为真实功能完成的证据。

## Comments

<!-- tannt-comment:{"id":"ec27b5a8-6c89-4cb4-879f-fcd8e4379a1d","author":"Agent","created":"2026-10-27T13:41:28.189Z"} -->
交互原型已交付，默认 A 状态总览；底部可切换 B 任务流程、C 差异工作区及六种演示场景。验证记录：`.scratch/fns-config-sync/verification/README.md`。原型源码与证据保留在本地分支 `prototype/fns-config-sync-ui-20261027`，不合并主分支、不推送；当前工作区保留可直接打开的文件。

尚未确定最终布局，真实功能与跨设备验收未实施。
<!-- /tannt-comment -->

<!-- tannt-comment:{"id":"9a2bb4da-6014-454f-9e9c-b78bb5417835","author":"Agent","created":"2026-10-27T14:00:14.858Z"} -->
2026-10-27，用户明确选择 C“差异工作区”。当前原型已固定采用 C，移除 A/B 布局与布局切换入口，保留示例设备、六种场景及操作弹窗。

本 Issue 仅记录原型制作与布局评审，现已完成。正式工作台接入、Git 传输、真实 FNS 读写与两端验收仍待后续实施；不退役 tannt-sync-agent-config。原始三套候选保留于 prototype/fns-config-sync-ui-20261027 的 b43fc816cbfb，后续实现以选定的 C 为准。
<!-- /tannt-comment -->

## Activity

- 2026-10-27T13:38:29.056Z · Agent：创建 Issue。

- 2026-10-27T13:41:28.189Z · Agent：添加评论。

- 2026-10-27T14:00:14.778Z · Agent：勾选验收项：用户选择或组合页面布局。。

- 2026-10-27T14:00:14.858Z · Agent：关闭 Issue（已完成）；2026-10-27，用户明确选择 C“差异工作区”。当前原型已固定采用 C，移除 A/B 布局与布局切换入口，保留示例设备、六种场景及操作弹窗。 本 Issue 仅记录原型制作与布局评审，现已完成。正式工作台接入、Git 传输、真实 FNS 读写与两端验收仍待后续实施；不退役 tannt-sync-agent-config。原始三套候选保留于 prototype/fns-config-sync-ui-20261027 的 b43fc816cbfb，后续实现以选定的 C 为准。。

