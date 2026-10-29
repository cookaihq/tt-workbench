# 浏览器剪藏

本机验收环境是 Chrome 155.0.8059.82、Obsidian 1.14.4、当前 `tannt` 库。验证使用独立 Chrome 用户目录，未修改日常 Chrome 的书签。其他浏览器与移动端尚未验证。

用 Chrome 打开 `apps/workbench/browser-clipper.html`，把“保存到 tannt”拖到书签栏，或按页面展开说明手动添加书签。之后在网页选中文字，点击书签；未选择文字时采用当前 URL。浏览器提示时选择打开 Obsidian，在工作台弹窗中核对内容并点击“保存到收件箱”。

书签读取页面标题、真实选区与地址，通过 `obsidian://tt-capture` 交给当前库插件。Obsidian 的 `vault` 参数负责选库；插件用独立的 `target` 字段核对目标。空格按 `%20` 编码，避免该版本 Obsidian 把 `+` 保留成文字。插件先等待工作台视图加载，再填写弹窗；没有点击保存就不会写文件。

每次保存新建一个 Inbox，即使 URL 相同也不自动覆盖。字段与时间遵循[共同格式](inbox-format.md)，录入入口为 `capture_entry: browser`。当前工作台还有未保存输入时，剪藏不会替换它；先保存或清空已有输入，再从网页重新发起。

这是一份纯文字/链接剪藏。不会下载网页图片、视频或整页 HTML。文字中的图片 URL仍为文字链接，不能据此报告本地附件已保存。选区超过 12,000 字符或 URI 超过 24,000 字符时拒绝本次剪藏，提示分段，不静默截断。

生成入口：`node scripts/workbench/build-clipper.mjs`。修改脚本后重新生成安装页，并更新已安装书签。实际选区、重复保存、无选区 URL 及重载读回证据见[浏览器验收](../../local-evidence/docs/workbench/verification/09-browser-capture.json)。
