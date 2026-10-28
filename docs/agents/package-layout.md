# 软件位置与目标知识库

`<软件根>` 是工作台源码仓库根，或完整安装包根（通常为 `<库>/<配置目录>/plugins/tannt-workbench`）。通过发现链接读取 Skill 时，先解析 Skill 目录的真实路径，再从 `skills/<名称>/` 回到软件根。软件根包含 `skills/manifest.jsonc`、`lib/`、`scripts/`、`docs/` 和 `templates/`。

`<库>` 是用户明确操作的知识库绝对路径，名称不限。本文档集中的 `docs/`、`scripts/`、`lib/`、`skills/`、`templates/` 和 `GLOSSARY.md` 相对于软件根；业务路径、`config/`、`.agents/`、`.claude/`、Obsidian 配置和 `apps/workbench/data/` 相对于目标库。先读取该库实际 Agent 入口及本次适用约定；插件和源码目录不能推断为业务目标。

命令从任意工作目录运行，使用软件的绝对路径并显式传 `--vault "<库>"`。自定义 Obsidian 配置目录另传 `--config-dir "<库内相对目录>"`。缺少目标库就停止该命令，不回落到源码库。

目标库的个性化配置清单为 `config/agent-config-checklist.md`；产品提供流程和模板，不替所有用户决定启用 FNS、飞书、网盘等集成。未建立清单时仅报告缺项，用户确定期望后再保存。

个人全局规则由用户明确选择的知识库或规则仓库维护，工作台公开仓库及安装包不包含个人正文。`<规则源>` 指已确认、包含 `AGENTS.md`、`README.md` 和 `scenarios-agent-instructions/` 的绝对目录；它独立于软件根和当前目标库。规则页面显式选择该目录，接入工具必须传 `--source "<规则源>"`。采用、合并及本机入口替换沿用具体授权边界。本机正式源由 tannt 知识库的 `docs/global-agent-instructions/` 管理。

功能历史和 `.scratch/` 属于开发仓库。历史验证文件迁入本机 `local-evidence/`，不在分发包中；文档中的历史链接不能视为安装缺失或已在当前设备验证。凭据与 FNS 运行配置不包含在公开源码及安装包中。
