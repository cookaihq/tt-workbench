# 并发协调记录

本记录路径相对于工作台根。目标库正式文件仍由 tannt 主会话维护，本会话仅回读。

- 已读取 tannt 的 `tmp/rule-ownership/workbench-handoff.md` 最新进度、suggested skills、`docs/adr/0006-project-owned-rules.md` 和最新 Skill 交接流程。沿用当前接收会话，不重新启动。
- tannt `docs/rules/cloud-files.md` 已明确 baidu、远端库目录 `tannt` 和 MP3/MP4/MOV/WAV/ZIP。软件新接口 `selectUploadTarget(targets, account, vaultDirectory)` 要求显式目录，测试确认传 `tannt` 时仍得到原路径，不迁移既有远端对象。若目标库维护自己的接口示例，须明确第三个参数来自该库规则；账号配置 JSONC 格式未改变。
- 工作台另一会话正在修改 FNS 本机保护（`lib/fns/`、`lib/runtime/location-migration.cjs`、FNS UI 和 `docs/rules/fns-config-sync.md` 等），本会话没有覆盖这些文件。首轮全量测试在其修改过程中运行：270 项，261 通过、2 失败、7 外部集成跳过；两个失败位于 `apps/workbench/tests/updates.test.cjs:108` 和 `:130`，涉及排除目录数量／顺序。其修正后 updates 的 11 项复验及提供 FNS 2.4.0 的全量 277 项均通过；后续 local-protection 新用例先补验 9 项，最终并发实现变更再连同 FNS UI 和更新测试补验 25 项，全部通过。完整过程保留在验收记录与日志中。
- 正式源和安装副本的哈希以最终验收记录为准；当前版本来自已有并发改动，版本号本身不能区分同版开发构建。
- 用户交付前补充的隐藏项命令顺序，已在软件两个场景中修正三处；其他当前示例、源码和 `--help` 均已核对。只改文档命令顺序，未改隐藏项脚本或运行真实扫描。最终包包含此修正，安装后的六条示例及帮助已核验。
- tannt 的 `docs/agents/agent-config-sync.md` 已由主会话修正普通安装不清理退役入口及命令顺序；本会话已读回，两个协调项均已解决。Claude 原生项目入口由主会话按本次范围保留现状，记录未验证自动加载，不新增入口或新宿主会话。
- 最终收尾期间的 `docs/agents/fns-device-config.md` 等 FNS 文档追加属于并发会话，已读回并保留。此次交付只将它们纳入当时固定的软件包，不代该会话提交或声明其全部工作完成。
