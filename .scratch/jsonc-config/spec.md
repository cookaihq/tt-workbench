# 自有配置支持 JSONC 注释

2026-10-25，用户希望项目中使用 JSON 的地方采用能写注释的格式。按读取方约束迁移自有的人工配置；Obsidian、FNS、包元数据、接口、机器记录与历史证据保留标准 JSON。格式约定集中于 [写入与变更](../../docs/rules/writing-and-changes.md#项目配置格式)。

## 实施范围

- 网盘共享目标迁入 `config/cloud-storage-targets.jsonc`，原账号和父目录不变。
- 活动与退役 Skill 清单迁入 `skills/manifest.jsonc`，活动项和退役项不变。
- 两个读取入口共用严格 JSONC 解析器，支持两种注释，拒绝重复键、无效语法及 JSON5 扩展；校验不改写原文件。
- 同步当前规则、Skill、安装说明和路径引用；历史快照及验收 JSON 保留。

## 验收与恢复

迁移前源文件和源／目标清单位于 `verification/`。在目标内容与引用核对后移除旧配置，不保留第二份活动配置或静默回退。

本机迁移已完成：13 项解析与网盘配置测试、1 项旧安装命令保护测试通过；两个配置值与迁移前一致，真实读取入口通过且不改写注释或时间戳，本机 FNS 过滤函数允许新路径。详见[验收记录](../../local-evidence/.scratch/jsonc-config/verification/README.md)。实际双设备传输不在本机验收范围内。
