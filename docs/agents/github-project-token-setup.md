# 让普通 Git 和推送按钮读取项目 GitHub Token

适用于项目已有独立 GitHub Token，希望终端、IDE 或 Orca 的推送按钮读取同一来源的情况。本文记录 `tt-workbench` 已验证的接入方法，可供其他项目按自己的目标改写。依赖 Git 和 Node.js 22 或更新版本，无须安装 git-setup Skill。

本文中的脚本、凭证与临时文件路径均以**目标仓库的主检出根目录**为基准；Markdown 链接以本文所在目录为基准。多仓项目还须在项目 Agent 规则中明确哪个仓库是主要仓库。

## 1. 为什么这样配置

原故障是 Agent 能读取项目 Token，而推送按钮执行的普通 Git 只会调用系统凭证管理器。设置 `origin` 或默认推送远端，并不会让 Git 自动发现自定义 Token 文件。

接入后的调用关系是：

```text
终端 / IDE / Orca 推送按钮
  → 普通 git push
  → 仓库级、按完整 GitHub URL 匹配的 credential.helper
  → 项目脚本校验目标与文件权限，读取原 Token 文件当前值
  → 通过 Git 凭证管道完成 HTTPS 认证
```

这里需要“文件里的 Token 换了，下次 Git 直接读新值”，所以采用读取文件的 helper。把 Token 另存进系统凭证管理器也能供普通 Git 使用，但会形成另一份来源，需要另行维护轮换；只给 Agent 子进程注入临时凭证则不能覆盖独立启动的推送按钮。

## 2. 先确定目标，区分主仓和远端

| 项目 | 本次实际值 | 其他项目需要确定的内容 |
| --- | --- | --- |
| 主要仓库 | `tt-workbench` 源码仓库 | 项目内哪个 Git 根是主仓；不能从当前目录猜测 |
| GitHub 仓库 | `cookaihq/tt-workbench` | 完整 `OWNER/REPOSITORY`，不能只写域名 |
| 主要远端 | `origin` | 已确认的 remote 名称及其 fetch、push URL |
| 默认分支 | `main` | 远端实际默认分支，以及本地分支要跟踪的远端分支 |
| 凭证文件 | `.credentials/repositories/cookaihq--tt%2Dworkbench.github-token` | 该仓已选的单行 Token 文件 |
| 已核验账号 | `cookaihq` | Token 实际身份；不能根据仓库 owner 推断 |

“项目有多个仓库时选一个主仓”是项目规则；`remote.pushDefault=origin` 只选择**某一个仓库内部**的默认推送远端。两者都要写清楚。

先读取目标项目的 Agent 规则，检查 Git 根、`git worktree list --porcelain`、remote、分支跟踪、URL 重写、有效 helper 和 HTTP 鉴权头。捕获可能含凭据的配置，只展示脱敏结果。已有目标选择沿用；未确定的仓库或凭证来源先由用户确定。

本次主仓的结果为：

```text
origin fetch/push URL = https://github.com/cookaihq/tt-workbench.git
remote.pushDefault = origin
branch.main.remote = origin
branch.main.merge = refs/heads/main
origin/HEAD -> origin/main
```

其他项目按实际目标设置。修改已有 remote、分支跟踪、fetch 或发布须在已授权范围内进行；认证接入本身不授权合并、提交或真实推送。

## 3. 准备来源及项目脚本

凭证仍放在主检出的 `.credentials/repositories/` 下。内容为 UTF-8 无 BOM 的一行 GitHub Token 原文，允许一个末尾换行；无需引号、变量名或 URL。已有文件直接沿用，不覆盖。需要新文件时先准备被忽略的空文件，用户明确已填写后才读取。

在使用前逐项核对：

- `git ls-files -- <凭证相对路径>` 无输出；`git check-ignore -v <凭证相对路径>` 确认实际被忽略。本次使用根 `.gitignore` 中的 `/.credentials/`。
- 文件及两个父目录不是符号链接或重解析点；文件是普通文件，硬链接数为 1。
- Windows：文件、`.credentials/` 和 `.credentials/repositories/` 的所有者为当前用户，禁用 ACL 继承，只向当前用户授予访问。检查元数据即可，不打印内容。
- macOS/Linux：同三个路径归当前用户所有，两个目录为 `700`、文件为 `600`。本仓脚本实现了这项检查；本次实际验收环境为 Windows。

复制本仓的 [credential-helper.mjs](../../scripts/git/credential-helper.mjs) 实体到目标主检出的 `scripts/git/credential-helper.mjs`。已有同名脚本时先检查其用途；不覆盖未知实现。脚本按其所在位置向上两层确定主检出，因而须保留这个目录层级。

**本仓脚本绑定了具体目标，直接复制不能用于另一个仓库。** 按下表修改目标副本，并搜索旧值确认无遗漏：

| 脚本中的位置 | 需要改成什么 |
| --- | --- |
| `const source` | 目标 Token 的项目相对路径 |
| `verifyWindowsPermissions()` 的路径数组 | 同一个 Token 路径；不能只修改 `const source` |
| `verifyRequest()` 中两个完整仓库路径 | `OWNER/REPOSITORY` 与 `OWNER/REPOSITORY.git` |
| 错误信息中的 `tt-workbench` | 目标项目名称，方便定位 |

保留 `.credentials/repositories/` 目录结构时只需替换文件名。保留 HTTPS、`github.com`、`x-access-token` 的检查，以及重复身份字段拒绝、检出关系、忽略状态、权限、单链接和文件格式检查。该 helper 只支持 GitHub HTTPS，不能直接套用于 SSH、CNB 或 GitHub Enterprise。

脚本只向 Git 的私有管道返回凭据；`store` 和 `erase` 无动作。目标不符、来源缺失或权限不符时返回 `quit=true`，停止尝试其他账号。本文 helper 只覆盖同一仓库及其关联 Worktree，后者复用主检出来源，不复制 Token；独立仓库按自身 Git 规则分别接入，不从“项目已有主仓”推断共享凭证。

## 4. 写入仓库级 Git 配置

分别为 `https://github.com/OWNER/REPOSITORY.git` 及省略 `.git` 的地址设置以下键。配置保存在 common Git 配置中，由主检出和关联 Worktree 共用。

| 键 | 值与用途 |
| --- | --- |
| `credential.<url>.helper`，第一个值 | 空字符串，清空该目标继承的 helper 链 |
| `credential.<url>.helper`，第二个值 | 调用本项目脚本的命令 |
| `credential.<url>.useHttpPath` | `true`，把仓库路径交给 helper 检查 |
| `credential.<url>.username` | `x-access-token` |
| `credential.<url>.interactive` | `false` |
| `http.<url>.extraHeader` | 空字符串，清空目标额外 HTTP 头 |
| `http.<url>.followRedirects` | `false`，目标变更时重新确认 |

helper 命令形态：

```sh
!f() { '<node绝对路径>' '<主检出绝对路径>/scripts/git/credential-helper.mjs' "$@" || printf 'quit=true\n\n'; }; f
```

程序及脚本路径须来自本设备；Windows 路径在 Git shell 命令中使用 `/`，单引号须按 shell 规则转义。外围 `quit=true` 用于 Node 或脚本无法启动时终止凭证获取。配置值只包含路径，不包含 Token。

下面是**首次接入模板**，使用 Node 直接传递 Git 参数，避免 Windows Shell 丢失空字符串。把 `repository` 和 `remote` 改成已确定的值；脚本副本和来源须先按上一节准备好。

先用 `git check-ignore -v tmp/git-credential-setup/` 确认临时目录被忽略。将代码保存为主检出下 `tmp/git-credential-setup/configure.mjs`，从主检出根运行 `node tmp/git-credential-setup/configure.mjs`。尚未忽略时按目标项目规则处理后再保存。模板遇到已有目标配置会停止，避免重复追加或覆盖；已接入项目应回读核对现有值。

```js
import { spawnSync } from 'node:child_process';
import { constants, copyFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

const repository = 'OWNER/REPOSITORY'; // 替换
const remote = 'origin';              // 按本项目选择
if (repository === 'OWNER/REPOSITORY' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('先填写仓库');
const root = realpathSync(process.cwd());
const target = `https://github.com/${repository}.git`;
const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '' };
for (const key of Object.keys(env)) {
  if (/^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|CONFIG|TRACE|CURL_VERBOSE)/i.test(key)
    || /^(GH_TOKEN|GITHUB_TOKEN|GH_ENTERPRISE_TOKEN|GITHUB_ENTERPRISE_TOKEN)$/i.test(key)) delete env[key];
}
function git(args, optional = false) {
  const result = spawnSync('git', ['-C', root, ...args], { env, encoding: 'utf8', windowsHide: true, timeout: 20000 });
  if (optional && result.status === 1) return null;
  if (result.status !== 0) throw new Error(`Git ${args[0]} 失败；原始输出未打印`);
  return result.stdout;
}
if (realpathSync(git(['rev-parse', '--show-toplevel']).trim()) !== root
  || realpathSync(git(['worktree', 'list', '--porcelain']).split('\n')[0].slice(9).trim()) !== root) throw new Error('须从主检出根运行');
if (git(['remote', 'get-url', '--all', remote]).trim() !== target
  || git(['remote', 'get-url', '--push', '--all', remote]).trim() !== target) throw new Error('远端与已选目标不一致');
const helper = join(root, 'scripts/git/credential-helper.mjs');
if (!existsSync(helper)) throw new Error('缺少项目 helper');
const quote = value => "'" + value.replaceAll('\\', '/').replaceAll("'", "'\\''") + "'";
const command = `!f() { ${quote(process.execPath)} ${quote(helper)} "$@" || printf 'quit=true\\n\\n'; }; f`;
const changes = [];
for (const url of [target, target.slice(0, -4)]) {
  const headers = git(['config', '--get-urlmatch', 'http.extraHeader', url], true) || '';
  if (/^\s*(authorization|proxy-authorization|cookie)\s*:/im.test(headers)) throw new Error('先处理现有鉴权头冲突');
  for (const [key, values] of Object.entries({ helper: ['', command], useHttpPath: ['true'], username: ['x-access-token'], interactive: ['false'] })) {
    changes.push([`credential.${url}.${key}`, values]);
  }
  changes.push([`http.${url}.extraHeader`, ['']], [`http.${url}.followRedirects`, ['false']]);
}
for (const [key] of changes) {
  if (git(['config', '--local', '-z', '--get-all', key], true) !== null) throw new Error('目标已有本机配置，先核对而非重复安装');
}
git(['check-ignore', '-q', '--', 'tmp/git-credential-setup/']);
const scratch = join(root, 'tmp/git-credential-setup');
mkdirSync(scratch, { recursive: true });
const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir']).trim();
copyFileSync(join(common, 'config'), join(scratch, 'config.before'), constants.COPYFILE_EXCL);
for (const [key, values] of changes) for (const value of values) git(['config', '--local', '--add', key, value]);
console.log('仓库级接入已写入；下一步验证凭证与推送预演。');
```

执行前审阅原配置，备份与 helper 均不应含 Token。写入若中断，先回读这些目标键并对照备份处理部分写入，不直接重跑。恢复时只还原本次改动的键；有后续并发修改时不能用旧 `config.before` 覆盖整份配置。

## 5. 从普通 Git 验证

不要直接把 `git credential fill` 的输出显示在终端，它会包含密码。由调用程序捕获输出，只报告检查结果。验证环境须清除继承的 Token、临时 Git 配置注入和调试输出，使用刚写入的本机 helper；否则可能误把 Agent 的临时鉴权当成按钮认证通过。

验收顺序：

1. 回读两个 URL 的配置，确认 helper 是“空值 + 项目脚本”两个有序值，路径指向本设备的主检出；配置里不含 Token。
2. 通过 stdin 向普通 `git credential fill` 传入 `protocol=https`、`host=github.com`、`path=OWNER/REPOSITORY.git` 和结束空行。捕获其输出，在内存里核对用户名是 `x-access-token`，密码等于原 Token 文件当前值，只打印“匹配／不匹配”。
3. 用返回的凭据在内存中构造 Authorization 头，请求 `https://api.github.com/user`，核对实际 `login`。Token 不放在 URL、命令行参数、报告或日志中。
4. 禁用提示，例如设置本次进程 `GIT_TERMINAL_PROMPT=0`、`GCM_INTERACTIVE=never`、空的 `GIT_ASKPASS` 和 `SSH_ASKPASS`。确认已选 remote 的实际地址后，执行 `git push --dry-run --set-upstream <已选remote> HEAD`；检查适用的 pre-push hook，避免把有外部写入副作用的 hook 当作只读验证。
5. 返回成功后，记录日期、实际账号和检查范围。预演不会发布提交，但也不能证明未来提交必然通过分支保护或服务端检查。真实推送仍按用户授权执行。

公开仓库的 `git ls-remote` 成功不足以证明 Token 被使用或有推送权限。Git 报 non-fast-forward、受保护分支或权限不足时分别处理历史和权限，不用强推来验证认证。

复制 [专项测试](../../scripts/git/credential-helper.test.mjs) 到目标项目同一路径并同步替换目标常量后，可运行 `node --test scripts/git/credential-helper.test.mjs`。该测试使用虚构 Token 和 `tmp/git-credential-repair/` 中的隔离仓库；运行前确保此临时路径被忽略。专项测试不能代替目标项目的真实身份核验与推送预演。

本仓 2026-10-29 的结果：普通 Git 返回的凭据与原文件一致，GitHub 身份为 `cookaihq`，按钮原命令加 `--dry-run` 后成功；专项测试 7 组通过。完整测试结果与证据见 [实施记录](../../.scratch/git-credential-repair/implementation.md)。实际 UI 点击与 macOS 尚未在该次修复中验收。

## 6. 留下目标项目自己的 Agent 规则

优先更新目标项目已有的 Git 规则文件；没有时可采用 `docs/agents/git-access-commit-and-release.md`。写明主仓位置、完整 GitHub URL、主要远端、分支跟踪、唯一凭证来源、helper 相对路径、失败处理及发布授权边界。配置事实只在该项目维护，不照搬本仓账号和路径值。

在目标项目实际生效的 `AGENTS.md` 或其他 Agent 入口中建立明确的按需读取要求，例如：

```markdown
路径相对于本项目根。执行本项目 Git 操作前，必须读取并遵守
[Git 仓库配置与操作](docs/agents/git-access-commit-and-release.md)。
```

若将本指南也复制过去，放在 `docs/agents/github-project-token-setup.md`，并在“配置或修复 GitHub 项目 Token 接入”时要求读取。同步复制所需脚本实体并修正本文的本仓证据链接；不能让目标项目长期依赖本仓的本机绝对路径。规则引用、文件存在与实际宿主新会话加载分别验证。

## 7. 日常维护

| 情况 | 处理方式 |
| --- | --- |
| Token 轮换 | 更新原已选文件；下次 helper 读取新值，再核验身份与预演 |
| Token 缺失、格式或权限错误 | 修复原来源；保留 `quit=true` 的停止行为 |
| 主检出或 Node 位置变化 | 按新设备实际位置重建 helper 命令并验证 |
| 新增 Worktree | 使用该仓 common 配置及主检出凭证；主检出中的脚本须仍可用 |
| 新增独立仓库或换 GitHub 仓库 | 重新明确来源和完整目标，分别适配脚本与配置 |
| clone 到另一台设备 | 保持项目相对路径，自行准备已授权 Token，并重建本机 Git 配置 |

可随项目版本保存的是脚本、测试和规则说明。`.git/config` 的本机设置及被忽略的凭证不会随 clone 到达。其他设备的绝对项目根可以不同，但须保持 `scripts/git/credential-helper.mjs`、`.credentials/repositories/<凭证文件名>` 和 Agent 文档入口的相对关系，并分别验收。
