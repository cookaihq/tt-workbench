# 可配置运行数据位置

用户授权默认位置为所属实例根下的 .system/.workbench-runtime，并在工作台提供修改位置入口。本任务在现有 feat/skill-installation 检出实施，不创建 Worktree、不再次交接、不提交或发布。

- 固定位置配置：.system/workbench/runtime.jsonc，JSONC 局部修改并保留注释与无关字段。
- 实例内相对目录，知识库与 developmentRoot 独立；全部生产写入方按实例解析。
- 工作台预览、迁移并保存、恢复默认、续做和恢复；CLI 共用协议，不依赖 Obsidian。
- 旧 .workbench-runtime 与 apps/workbench/data 显式迁移，保留历史字节和恢复路径映射。
- 固定协调状态、源目标锁、活动租约、冲突/链接/未知项检查；有备份、核验和失败恢复。
- 精确 Git/FNS 排除，不更改 .system 中其他内容策略；安装与运行迁移分别执行。

验收：默认、自定义、重启和独立进程、实例隔离、历史重试、活动锁、冲突、中断恢复、安装保留，以及原生界面和全套测试。实际对象 D:/zhao/tannt_vault/tannt；开发记录属于 D:/zhao/tt-workbench。
