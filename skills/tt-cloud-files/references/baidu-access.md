# 百度网盘接入与本机授权

适用于配置授权和执行远端操作。先按[目标库规则读取](../../../docs/agents/package-layout.md#目标库规则读取)取得目标库的账号选择、范围及路径规则；[软件网盘契约](../../../docs/rules/cloud-files.md)用于核对支持格式与能力，不替代目标库选择。本机授权保存与检查使用软件的 `scripts/cloud-files/accounts.mjs`；登录由 Agent 引导用户在百度官方网页完成。完整传输适配器尚未封装，已有实测方法不能当作当前账号已登录或完整流程已验收。

## 已有实测依据

2026-10-22 会话“查找支持 Agent 自动下载的百度网盘 MCP”，ID `01a16439-4381-73d2-a817-54abc8ca0f10`：

- 用官方个人 OAuth 授权取得访问令牌；当时仅存于 Python 进程内存，未安装永久 MCP、未保存本机授权档案。
- 官方远程 MCP `https://mcp-pan.baidu.com/sse` 通过 Bearer 令牌连接，用于查询及结果核对。每个账号使用自己的连接与授权上下文；实际工具以当次发现结果为准。
- 实际上传走官方 API：`/temp/meeting_01.mp4`，71,871,419 字节，18 个分片。分片 MD5 均核对通过，创建成功，MCP 查到相同路径与大小。当时未完成下载回验及 YAML 托管验收，不能把历史成功直接登记为当前已托管文件。
- 下载 `/temp/VNA.mp4` 取得有效下载地址并成功接收内容，Range 请求返回 206；最终由用户停止，约完成 23.3%，不能作为完整下载及哈希验收依据。
- `/temp` 只是该次测试目录，不能用于填补本库尚未指定的父目录。

该次实际发现的 MCP 工具包含查询、用户信息、移动、改名等，但没有本地文件上传、下载或删除工具。`file_upload_by_url` 和 `file_upload_by_content` 不等于本地大视频上传能力；公布的工具清单也不能代替本次实际发现。

2026-10-25 已在当前 macOS 为首个账号完成官方个人授权、库外档案保存及独立进程重新查询身份；[实际验收](../../../.scratch/cloud-managed-files/verification/authorization-20261025.json)只保存非敏感元数据。本次权限包含 `basic,netdisk`，未返回刷新令牌。其他设备、真实多个账号及完整文件传输仍需各自验证。

## 多账号本机档案

官方 API 的请求使用各自 `access_token`，因此本机可以独立保存多个账号的授权。每个账号分别登录和授权；浏览器当前登录谁不能证明选中的授权属于谁。

本机文件方式使用 `~/.config/tannt-cloud-files/accounts.json`，以 `account_ref` 为键保存多个档案。首次通过账号接口核验后才创建，目录权限为 `0700`，文件为 `0600`；不放进`config/cloud-storage-targets.jsonc`、替代文件或同步目录。也可由本机适配器使用系统凭据存储，保持相同的别名与账号绑定。当前脚本在 macOS 验证；Windows 的凭据权限需另行核验，不将 POSIX 权限位视为 Windows ACL 验收。

默认账号和各账号父目录维护于目标库 `config/cloud-storage-targets.jsonc`，按该库选定的方式共享。共享目标不提供登录能力，也不复制其他设备的授权档案；账号 ID 继续由接口核验，并与本机档案及已有替代记录核对。

授权表的 `schema` 为 `tannt-cloud-accounts/v1`，`accounts` 为按别名索引的对象。每项记录：

| 字段 | 内容 |
| --- | --- |
| `provider` | `baidu` |
| `account_id` | 用户信息接口实际返回的 `uk` 字符串 |
| `auth_method` | 实际采用的授权方式，例如官方个人授权 `implicit` |
| `access_token` | 该账号的访问令牌，仅在本机受保护文件或凭据存储中保存 |
| `expires_at` | 由实际授权时间和返回的有效期计算；未知则为 `null`，操作前核验 |
| `refresh_token` | 仅在实际取得且有相应刷新能力时记录；否则省略 |

个人授权示例采用 `response_type=token`。官方 SDK 另有授权码及刷新令牌接口，但刷新还需要对应应用凭据；不能因此推断个人 MCP 授权必定提供 `refresh_token`，也不能保证永久免登录。失效时按实际授权流程重新授权或刷新，并重新核对 `uk`。

官方用户信息接口是 `GET https://pan.baidu.com/rest/2.0/xpan/nas?method=uinfo`，通过选定档案的访问令牌调用，返回 `uk`、网盘昵称等。账号选择和身份不匹配的处理遵守共同规则。

## 授权保存与检查工具

先运行以下只读命令。`--list` 只输出账号别名、身份及到期信息；`--check` 对指定账号重新查询百度身份，缺少、过期或不匹配时停止，不使用其他账号。

```sh
node "<软件根>/scripts/cloud-files/accounts.mjs" --vault "<库绝对路径>" --list
node "<软件根>/scripts/cloud-files/accounts.mjs" --vault "<库绝对路径>" --check --account <账号别名>
```

首次授权或同账号重新授权时：

1. 从共享目标 JSONC 确认本次别名；由用户选择要授权的百度账号。生成 32 字节随机十六进制 `state`，连同别名、时间、浏览器任务空间和页面标识存入已排除 FNS 的本机操作记录；不保存授权结果网址、令牌或 Cookie。
2. 从模块导入 `authorizationUrl(state)`，以当前官方个人授权应用打开返回的 URL，权限为 `basic,netdisk`。登录、验证码等由用户在官方页面完成，按所用浏览器工具的交接流程等待用户完成；不让用户把密码或令牌贴进对话。
3. 用户完成后，在能直接调用本机 Node 模块的浏览器执行进程中读取授权结果 URL。先检查是否到达结果页面，不能打印带令牌的 URL、页面快照或正文，也不将结果放进命令行参数。若浏览器工具无法在进程内保护凭据，先选择可行的本机输入方式，不退回对话传递令牌。
4. 在同一进程中调用 `parseAuthorizationResult(responseUrl, expectedState)`，再调用 `await saveAuthorization(accountRef, authorization, { vault: "<知识库绝对路径>" })`。解析器核对官方来源、请求 state 与到期字段；保存器重新查询百度 UK，核对已有别名绑定后才写入。返回值只含非敏感元数据，可输出给用户。不能把另一个账号覆盖到已有别名；用户要迁移身份时单独处理文件归属。
5. 调用上述 `--check --account` 验证持久化后的档案。成功后处理或关闭本次授权结果页面，清除操作记录中的待完成标记，报告实际账号及到期时间。账号授权通过不代表上传、下载或跨设备流程已经验收。

脚本保留其他账号和无关字段；使用本机锁、写入前版本比较、受保护的暂存文件及读回检查。锁已占用或档案变化时停止，不抢占遗留锁；这些机制不保护绕过约定的外部写入方。CLI 不接受访问令牌参数。业务代码通过模块在进程内处理凭据，日志只保留账号元数据与错误码。

模块测试：`node --test scripts/cloud-files/accounts.test.mjs`。测试使用虚构令牌和已有本机运行目录中的夹具，不证明某个真实账号已经授权。

## 传输接口与已知限制

复用接口前核对官方当前参数和权限，不硬编码历史上传服务器、签名地址或旧令牌。

1. 上传预创建：`POST https://pan.baidu.com/rest/2.0/xpan/file?method=precreate`，提交真实目标路径、大小与分片 MD5 列表。
2. 取得上传服务器：`GET https://d.pcs.baidu.com/rest/2.0/pcs/file?method=locateupload&appid=250528`；在实际返回的 HTTPS 服务器分片上传，参数包含 `method=upload`、`type=tmpfile`、`path`、`uploadid`、`partseq`。前次按最多 4 MiB 分片，并核对每片返回的 MD5。
3. 合并文件：`POST https://pan.baidu.com/rest/2.0/xpan/file?method=create`；前次使用 `rtype=0` 遇重名拒绝，提交 `size`、`uploadid`、`block_list`。完成后查询实际远端对象。
4. 下载：`GET https://pan.baidu.com/rest/2.0/xpan/multimedia?method=filemetas`，指定 `fsids` 和 `dlink=1`；前次对返回的链接携带访问令牌并使用 `User-Agent: pan.baidu.com`。断点恢复须校验远端版本、返回区间与总长度，完整后核对本地 SHA-256。

前次返回的文件级 `md5` 含非十六进制字符，不能当作普通完整文件 MD5。完整保留分片核对、合并成功及远端重新查询证据后，可按共同规则登记 `upload` 等级；不必立即完整下载。实际下载时核对 SHA-256，并在清理唯一已知本地原件前完成当前远端版本的严格内容核验。

调用时在进程内读取凭据，避免将令牌写入命令行参数、工具输出、签名链接日志或操作回执。核验记录只保留账号别名、账号 ID、文件位置、大小、哈希及操作结果。

## 官方依据

- [百度官方 MCP 项目与个人授权说明](https://github.com/baidu-netdisk/mcp#readme)。
- [官方 MCP 客户端连接示例](https://github.com/baidu-netdisk/mcp/blob/main/src/baidu-netdisk/client_demo/README.md)。
- [用户信息接口](https://github.com/baidu-netdisk/mcp/blob/main/src/baidu-netdisk/openapi_client/api/userinfo_api.py)及[含 uk 的响应模型](https://github.com/baidu-netdisk/mcp/blob/main/src/baidu-netdisk/openapi_client/model/uinforesponse.py)。
- [授权及刷新接口](https://github.com/baidu-netdisk/mcp/blob/main/src/baidu-netdisk/openapi_client/api/auth_api.py)。
