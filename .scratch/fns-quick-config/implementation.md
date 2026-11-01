# FNS 提示条快捷配置实施记录

2026-10-29，按 [规格](spec.md) 完成源码修改。开发基线为 `main` 的 `9c70193539753a7b348a6ab0af268705565dc426` 加上已有工作区改动；本轮沿用既有本机补齐能力，保留其他会话修改，未提交或发布。

## 实现

- `apps/workbench/fns-ui.js`：应用因本机文件排除要求受阻时，另外读取本机排除状态。在提示条直接提供「补齐本机排除」，复用 `configureLocalProtection()` 的暂停、恢复材料、写入与加载核验，执行期间禁用操作并在结束后重新检查。开始操作时使旧异步检查失效，避免覆盖新结果。
- 本机已齐全时显示「比较并发布」，进入现有预览和确认；未加载、待推送及检查不可用分别显示。失败保留原因与可重试入口。远端真实异常不提供这一快捷操作；原「本机检查」继续独立可用。
- 旧权威版本不会因本机补齐而改变，也不会自动发布或应用。保留不可应用校验，将原来矛盾的「有版本可应用」状态显示为「此版本暂不可应用」。原始原因保存在可展开的详情中。
- `apps/workbench/styles.css`：提示条内的小按钮在宽窗口靠右，在窄窗口换行；沿用已有颜色与按钮样式。
- `docs/workbench/fns-config-sync.md`：补充实际快捷流程。本轮没有改变共同规则、术语、CLI、同步协议、Skill、模板、初始化或安装行为，无需修改目标库业务规则。

## 验证

| 项目 | 结果与范围 |
| --- | --- |
| `npm test` | 284 项，277 通过，0 失败，7 跳过。跳过项需要外部 `TEST_FNS_BUNDLE`。日志在 `tmp/fns-quick-config/tests.log`。 |
| 最终界面回归 | 状态文案与异步检查调整后，`node --test apps/workbench/tests/fns-local-ui.test.cjs` 再次通过全部 7 项；覆盖直接补齐、防重复执行、失败重试、发布预览而非自动发布、旧版本应用禁用、待加载、待推送与检查失败。 |
| 浏览器交互 | 用正式 UI 模块和合成服务验证 1280、420 宽度；补齐后按钮切换，点击进入实际发布预览，取消不发布，旧版应用按钮仍禁用。文档宽度没有超出视口。截图：`tmp/fns-quick-config/wide-before.png`、`wide-after.png`、`narrow-after.png`。这不代表 Obsidian 宿主或真实 FNS 验收。 |
| `npm run build` | 生成版本 `0.25.1` 的完整 ZIP、更新包、展开目录和清单，339 个受管理文件。未发布新版本。 |
| 正常隔离安装 | `npm run install-plugin -- --vault D:\zhao\tt-workbench\tmp\fns-quick-config\installed-vault --config-dir obsidian-settings --bundle dist/tt-workbench.bundle.json.gz` 成功；同参数加 `--check` 回读 `ok: true, changed: false`。 |
| 安装文件 | `fns-ui.js` 与 `styles.css` 的源码和安装副本 SHA-256 分别一致，见下方；版本 `0.25.1`。 |
| 修改检查 | `git diff --check` 通过。 |

安装后软件根为隔离库的 `obsidian-settings/plugins/tt-workbench/`；真实设备配置目录可能不同，功能使用当前实例配置，不固定该测试路径。

- `fns-ui.js`：`bda0dbd40c01c2aa48b46182002eb33c6b7bf6f661204509d8808cd16f18513a`
- `styles.css`：`9b2bd4642a5e0797441cccd24e631881fc7bb4f20142517a96897bfa87b197c4`

首次交付时尚未定位截图对应的真实知识库，因此只完成源码与隔离验收。真实安装的后续结果如下；其余设备未验收。

## 用户续令「执行」后的真实安装

通过 Obsidian 登记中唯一打开的 tannt 库、实际窗口和截图中的 FNS 设备及 v2 提示，核对当前目标。执行前读取目标库的 `AGENTS.md`、`docs/agents/workbench-tools.md`、`docs/agents/fns-device-config.md`、`docs/rules/fns-config-sync.md` 及安装包中的安装说明；软件根使用本仓，实例配置目录为 `.obsidian`。

安装前本机检查确认运行目录、位置配置、插件目录、恢复目录和启用列表已有排除；新旧工作台的安装锁文件仍待设置。通过正常关闭窗口退出 Obsidian，并以无 Obsidian 进程作为写入前置，避免安装期间 FNS 运行。使用前次已核验的 `dist/tt-workbench.bundle.json.gz` 完整安装，未修改 FNS 配置。

- 固定包：`0.25.1`，SHA-256 为 `1ea194ad3703a88710273d480995f943317fed4bda7ef15a107061ba6a944d04`。
- 安装目录：目标库的 `.obsidian/plugins/tt-workbench/`。
- 旧版恢复目录：目标库的 `.obsidian/plugins/tt-workbench-recovery/4054ce41-cb67-47d8-8999-782a2ae389af/`。
- 正常安装返回 `ok: true, changed: true`；随后 `--check` 返回 `ok: true, changed: false`。`fns-ui.js`、`styles.css` 与前述源码哈希一致。
- 安装前后工作台 `data.json` 和 FNS `data.json` 原文哈希保持一致。
- 重开真实 Obsidian 后，原 tannt 库自动恢复到 FNS 页面。实际界面已显示提示条右侧的「补齐本机排除」、展开原因入口，以及「此版本暂不可应用」状态，FNS 显示服务已连接。

本次完成真实安装与宿主加载验证，保留按钮供用户直接执行补齐。未以安装验收为由写入 FNS 规则或发布修正版；真实补齐写入及跨设备发布仍不是本次安装结果。
