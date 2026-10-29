# tt 改名实施记录

日期：2026-10-29。需求范围见 [spec.md](spec.md)。

## 实现

- 工作台 manifest、标题、品牌、CSS 根类、当前文档及验收工具引用使用 `tt`。更新器、安装 CLI、发布包和生成书签同步更新。
- `skills/` 五个目录改为 `tt-`；清单 `renamedFrom` 映射旧名称，普通安装不隐式清理旧入口。单项 `repair` 核验来源、暂存旧链接、建立并读回新链接、更新注册记录后清理旧链接，失败保留恢复材料。
- 插件安装器新增 `--migrate-legacy`，校验旧包基线，协调新旧安装锁，将原目录保存到安装恢复目录后安装新 ID，保留 `data.json` 等本机文件。预检只读；同名冲突、未知基线、本机或并发修改停止替换。
- 新插件识别旧视图类型和旧剪藏 URI。实例启用列表、快捷键、笔记、网盘账号与 Git/FNS 配置不由安装器改写；迁移与启用步骤见 `docs/workbench/updates.md`。
- FNS 代码排除同时涵盖新旧插件及恢复目录，并保留其他会话引入的运行目录解析逻辑。

## 验证

- 改名前启动的全量检查：233 项，225 通过、1 失败、7 跳过；失败为 FNS 暂停后进程退出恢复测试。运行期间其他会话正在修改运行目录实现，不能视为固定源码快照的基准。日志：`tmp/tt-rename/baseline-tests.log`。
- 改名、完整安装、更新、Skill 管理和 CLI 定向测试：37 项全部通过。涵盖自定义配置目录、旧设置与恢复副本、来源冲突、双宿主隔离、创建失败和并发变化。日志：`tmp/tt-rename/focused-tests.log`。
- 五个 Skill 均通过 `skill-creator/scripts/quick_validate.py`。验证器在隔离的临时 Python 环境运行，使用 UTF-8；未修改全局 Python 环境。
- JavaScript 语法检查和 `git diff --check` 通过。
- 最终 `npm test`：249 项，242 通过、0 失败、7 项可选 FNS 上游包集成测试跳过（未提供 `TEST_FNS_BUNDLE`）。审计工具临时前缀的测试清理规则已同步修正。日志：`tmp/tt-rename/full-tests.log`。
- `npm run build` 通过：v0.25.0，332 个分发文件，生成 `dist/tt-workbench.bundle.json.gz`；旧文件名的生成包已清理。解码核验确认新 ID、显示名称和五个新 Skill，包中没有旧 Skill 资源目录。
- 将构建后的压缩包安装到隔离实例的 `custom/plugins/tt-workbench` 后，安装器 `--check` 读回一致，实例根只增加插件配置目录；测试实例已清理。最终重新采集源码与压缩包逐文件指纹一致。

改名涉及文件的前后 SHA-256 清单：`tmp/tt-rename/change-inventory.json`；并发会话修改仍保留在工作区，因此该清单不能替代对其他任务的审阅。

任务开始时备份：`D:\zhao\tmp\tt-workbench-rename-20261029-014748`，包含原工作区普通文件、SHA-256 清单和 Git 状态。后续会话并发修改不属于该时间点快照。

本次未指定实际知识库，安装与迁移验证使用 `tmp/` 下的隔离实例；真实 Obsidian 重新启用、快捷键及新 Agent 会话发现尚未执行。
