Status: ready-for-agent
State: completed
ID: 6f132b41-0f88-49f9-9af8-ae911a065db2
Input hash: 23260568f1d27286cb5264923cb78b36afeefd9e969b2bb9c757f83522f1dd9d
Created: 2026-10-28T11:14:24.481Z
Updated: 2026-10-28T12:08:33.516Z
Labels: ["功能","FNS"]
Priority: medium
Blocked by: []
Related: []

# 取消 FNS 运行配置外移与符号链接

用户于 2026-10-28 确认取消这层。完整运行配置留在插件目录作为普通文件，发布继续生成独立 Git 快照；现有本机链接迁回并验证 FNS 实际读写。

关联评估：设备身份、发布快照、四字段应用、暂停/恢复和回执仍保留；取消普通配置自动外移、建链与链接权限要求。设备检查、工作台 UI、配置检查 Skill、维护脚本和有效文档须一起调整，历史证据保持原范围。

- [x] 普通文件直接发布、接收、应用与恢复，保持其他字段
- [x] 旧链接迁回保留完整内容、恢复材料及冲突保护
- [x] 更新规则、Skill 和工作台入口，防止重新外移
- [x] 安装并完成 macOS 本机迁回、加载和再次保存验证

Windows 原生与真实双机验证继续由原设备验收 Issue 跟踪。

## Comments

<!-- tannt-comment:{"id":"e5fa241f-26b4-45fe-b16f-ab7d796a991f","author":"Codex","created":"2026-10-28T12:08:33.422Z"} -->
已安装工作台 0.21.0；81 项相关测试通过，214 个安装文件与正式源码及清单一致。当前 Mac 的旧链接已通过工作台暂停/迁回/恢复流程改为插件目录普通文件，迁回回执 complete；FNS 再次保存并重载后 Token、设备设置和四组规则保持原值。说明编辑状态已恢复。验收中旧缓存模块误写历史记录及恢复来源、原生断言中断和后续通过结果，均记录于 ../verification/local-config-20261028/README.md。未发布权威版本、未提交或推送 Git。Windows 原生与真实双机继续由 Issue 03 跟踪。
<!-- /tannt-comment -->

<!-- tannt-comment:{"id":"9fb5adae-5296-4b10-b6f8-f0682ae6fd9e","author":"Codex","created":"2026-10-28T12:08:33.516Z"} -->
取消运行配置外移及符号链接的实现、规则、Skill、安装和本机迁回验证已完成。验收：../verification/local-config-20261028/README.md。
<!-- /tannt-comment -->

## Activity

- 2026-10-28T11:14:24.481Z · Codex：创建 Issue。

- 2026-10-28T11:40:33.683Z · Codex：更新属性：分诊=可交给 Agent。

- 2026-10-28T12:08:33.123Z · Codex：勾选验收项：普通文件直接发布、接收、应用与恢复，保持其他字段。

- 2026-10-28T12:08:33.207Z · Codex：勾选验收项：旧链接迁回保留完整内容、恢复材料及冲突保护。

- 2026-10-28T12:08:33.277Z · Codex：勾选验收项：更新规则、Skill 和工作台入口，防止重新外移。

- 2026-10-28T12:08:33.345Z · Codex：勾选验收项：安装并完成 macOS 本机迁回、加载和再次保存验证。

- 2026-10-28T12:08:33.422Z · Codex：添加评论。

- 2026-10-28T12:08:33.516Z · Codex：关闭 Issue（已完成）；取消运行配置外移及符号链接的实现、规则、Skill、安装和本机迁回验证已完成。验收：../verification/local-config-20261028/README.md。。

