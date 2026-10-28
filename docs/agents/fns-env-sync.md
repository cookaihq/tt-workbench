# 根目录 .env 同步方案（已退役）

2026-10-25，用户明确要求将网盘目标迁入 `config/`，并使用能说明用途的文件名。当前唯一配置源为 `config/cloud-storage-targets.jsonc`；读取脚本直接解析 JSONC，不读取或生成根目录 `.env`。

当前设置与跨设备检查遵守[网盘目标配置同步维护](fns-cloud-targets-sync.md)。原生 FNS 的笔记和附件同步即可处理该普通文件，不需要单文件补丁。

旧方案安装及服务端验证保留于[历史验收](../../.scratch/cloud-managed-files/verification/a-env-sync-20261025.md)，不能证明当前 JSONC 已传到另一设备。`scripts/fns/env-sync-support.mjs` 仅用于识别和移除旧补丁，原 `--apply` 安装入口已退役；恢复材料保留在本机排除 FNS 的运行目录。
