# 工作台附件实现

位置、原字节、命名、大文件及临时材料的正文见 [附件规则](../rules/attachments.md)。Agent 使用方式见 [文件操作说明](../agents/vault-file-operations.md)。

`attachments.js` 的保存调用共用 `AttachmentWriter`，从目标库 `.obsidian/app.json` 读取已保存的 `attachmentFolderPath`；显式 `directory` 只影响本次操作。文件保留原名和格式，冲突用可读序号，主笔记登记实际路径并增加 Markdown 链接。保存和链接结果分别核对，部分失败返回已有附件位置。

`AttachmentWriter` 向上检查有效的 `任务说明.md`，确定笔记是否属于一个任务。属于任务时，设置解析到任务外的目录改用该任务的 `attachments/`；显式指定任务外目录则返回 `TASK_ATTACHMENT_PATH`。已有共享来源通过链接复用。收件箱归入任务时，原专属附件由迁移操作一起移动。

CLI 的本机文件复制没有扩展名白名单或旧 8 MiB 限制。旧工作台 HTTP 接口仍有 12 MiB 请求限制，仅约束该传输入口，不约束本库文件保存；新的 Agent Skill 不调用它。

显示逻辑仍由工作台执行：PNG/JPEG/GIF/WebP 可显示图片，其他格式保留路径和正文链接；工作台内可打开业务范围内的 Markdown，其他格式从原笔记访问。HTML 与暂不支持的嵌入显示原文；合法 Markdown 链接中的尖括号是路径分隔符，不按 HTML 处理。外部图片标记未下载，不自动访问。预览不写文件，预览能力不决定保存格式。

未采用逐文件托管的库外材料继续使用 [源文件位置模板](../../templates/源文件位置.md)。逐文件托管使用 [网盘托管规则](../rules/cloud-files.md) 的 YAML 替代文件，由 `tannt-cloud-files` 处理；原文件复制、工作台预览和 `transfer-to-task` 不会自动执行百度网盘操作。移动托管资料须由 Skill 协调网盘、本地和引用，不能只执行普通文件迁移。YAML 不进入 Markdown 业务笔记列表；读取普通笔记的能力不因此改变。

FNS 的原文件排除与 YAML 同步按网盘托管规则逐设备核验。源文件位置模板或替代文件存在，均不证明远端当前可达或已经跨设备同步。

历史附件与位置验收见 [旧记录](../../local-evidence/docs/workbench/verification/12-attachments.json)，新实现证据随 [本轮任务](../../.scratch/vault-rules-and-skills/spec.md)维护。
