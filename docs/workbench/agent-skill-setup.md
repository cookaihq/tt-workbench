# 场景 Skill 的项目级接入

五个活动 Skill 由 `skills/manifest.jsonc` 管理，服务用户明确指定的知识库，库名不限。源码在工作台仓库，日常发现入口指向知识库内已安装插件的 Skill。规则、工具和目标库的解析见[路径约定](../agents/package-layout.md)。

## 独立注册

先安装完整插件，再使用安装副本内的工具。以下路径需按实际配置目录替换：

```text
node "<库>/.obsidian/plugins/tannt-workbench/scripts/agent-skills/install.mjs" --vault "<库绝对路径>" --agent codex --check
node "<库>/.obsidian/plugins/tannt-workbench/scripts/agent-skills/install.mjs" --vault "<库绝对路径>" --agent codex
```

Claude Code 使用 `--agent claude`，明确需要两者时使用 `--agent all`。`--check` 与 `--help` 只读。安装器预检所选全部入口，创建相对目录链接；普通文件、不同来源的链接或来源不明的退役项不会覆盖。迁移已核实旧链接时另传 `--migrate-from "<旧 skills 绝对目录>"`，不能用于任意覆盖。

Codex 入口为 `<库>/.agents/skills/`，Claude Code 为 `<库>/.claude/skills/`。两者都是各设备生成的发现入口，应排除 Git，并在各设备分别建立。插件安装、Skill 注册与全局 Agent 规则接入是三个独立动作。

## 实际使用

在目标知识库根新开会话，核对宿主列出的 Skill，再进行实际调用。读取 Skill 文件只能证明文件可读，不能证明标准发现或行为正确。独立 CLI 不要求 Obsidian 运行。

`tannt-capture` 保存新输入；`tannt-update-note` 更新明确的笔记、分流和授权归档；`tannt-cloud-files` 处理托管文件流程；`tannt-sync-agent-config` 根据实例清单核对当前 Agent；`tannt-organize-agent-rules` 检查旧全局规则、提出方案并在获准后整理和修复入口。后两者不会互相隐式调用。

全局规则整理使用经过确认的可写正式仓库；安装包资源用于查看和比较，不能直接当作可编辑正式源。现有全局文件与资源不一致时先形成具体方案，保留既有授权边界。

## 验证范围

本轮迁移的安装和路径检查见[迁仓记录](../../.scratch/workbench-repository-extraction/spec.md)。各设备的标准发现、实际调用和全局规则加载分别验证；历史证据保存在开发仓库的本机 `local-evidence/`，不计为当前安装已通过。Skill 安装 UI 在迁仓后进行需求和原型确认，尚未实现。
