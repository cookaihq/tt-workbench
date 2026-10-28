# Lark CLI 与 Hermes 飞书通道配置的区分

适用条件：为 Lark CLI 查找、选择、导入或修复飞书配置与凭证，处理其认证失败，或判断已发现的飞书配置能否供 Lark CLI 使用。开始查找或选用配置前读取本场景。

## 识别配置归属

Hermes 的飞书消息通道配置用于其消息网关。按配置来源和已确认用途识别，不能仅凭 `FEISHU_APP_ID`、`FEISHU_APP_SECRET` 等字段存在，就认定它们是 Lark CLI 应使用的凭证。

| Hermes 配置位置 | 识别依据 |
| --- | --- |
| 默认数据目录 `~/.hermes/.env` | 飞书应用凭证及通道相关的 `FEISHU_*` 配置项 |
| 默认数据目录 `~/.hermes/config.yaml` | `platforms.feishu` 等飞书通道设置 |
| `~/.hermes/profiles/<名称>/` 下的 `.env`、`config.yaml` | 对应 Hermes profile 的配置，仍属于 Hermes |
| 自定义数据目录下的相应文件 | 依据实际 `HERMES_HOME`、所选 profile 或启动配置确定目录，不能只排除默认路径 |

这些路径用于识别来源；已有明确的 Lark CLI 配置来源时直接沿用，无需为每次操作扫描 Hermes 目录。核对时只呈现路径、配置项名称和必要身份信息，不输出密钥或令牌。

## 为 Lark CLI 选择配置与排错

1. 从 Lark CLI 自身已配置的 profile、配置目录，以及本人指定或此前确认的来源开始。依据当前 CLI 的帮助和适用 Skill 核对用法，通过配置、身份查询确认实际生效的 profile、应用和 user／bot 身份；不凭文件名、字段名或鉴权成功判断归属。
2. 发现配置来自 Hermes 飞书通道时，将其排除出自动选用的候选。未经下节所述授权，不为补齐 Lark CLI 配置而读取、复制、`source`、导出或注入 Hermes 凭证，也不自动执行 `lark-cli config bind --source hermes` 或省略来源后自动识别 Hermes 的绑定。
3. Lark CLI 配置缺失、失效或认证失败时，按其自身的配置与授权流程处理。来源仍不明确时，说明缺少哪项信息并请本人指定；不以搜索 Hermes 飞书通道凭证作为兜底。在 Hermes 会话中运行、环境中存在 `HERMES_HOME`／`FEISHU_*`，或 CLI 能识别 Hermes 来源，都不构成复用授权。

## 本人明确指定复用时

只有本人在当前对话或既有明确约定中指定复用 Hermes 的相应应用／凭证，或将某个 Hermes profile 的飞书应用绑定到 Lark CLI 时，才按已授权的对象、用途和方式操作。核对 CLI 要求的绑定及身份选择；已有明确授权且范围未变时不重复确认。普通的“配置 Lark CLI”或“修复飞书认证”不等于授权借用 Hermes 通道配置。

复用后通过 Lark CLI 核对实际生效的配置来源、profile、应用和 user／bot 身份与已确认用途一致，再继续业务操作；不能以“发现了配置”或“能够登录”代替此项核验。
