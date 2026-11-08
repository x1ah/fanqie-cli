# Fanqie CLI

把本地 Markdown / TXT 小说章节保存到番茄作家后台，完成分卷管理、草稿核对和提交审核。支持多作品、任意正文目录和隔离工作区。日常操作使用 HTTP；浏览器仅用于登录、刷新会话和手动诊断。

**`upload` 保存草稿，`publish` 提交审核，`publish-status` 核对实际状态。提交审核成功不代表已经公开。**

这是独立社区工具，使用作家网页内部接口，与番茄官方无隶属关系；接口可能随网站变化。只用于你有权管理的作品，不提供账号注册、代登录或审核绕过功能。

## 功能

| 用途 | 命令 | 说明 |
| --- | --- | --- |
| 工作区与作品 | `init`、`add`、`books`、`bind` | 多作品、外部正文目录、逐卷绑定 |
| 登录与诊断 | `login`、`auth-refresh`、`inspect` | 手动登录，复用本地会话 |
| 本地检查 | `check`、`plan`、`status` | 格式、上传计划和本地历史记录 |
| 草稿上传 | `upload`、`reconcile` | 全书冲突检查、全文回读、中断恢复 |
| 草稿修订 | `revise`、`revise-status` | 校验旧摘要，备份并修改原 ID 同卷草稿 |
| 分卷管理 | `volumes`、`volume-create`、`volume-rename` | 查询、新建、改名并回读绑定 |
| 草稿移卷 | `move`、`move-status` | 将原 ID 草稿移到真实目标卷 |
| 提交审核 | `publish`、`publish-status` | 明确选择章节、真实 AI 使用声明、独立发布日志 |
| 简介同步 | `book-abstract`、`book-abstract-status` | 仅更新简介，核对其他作品资料不变 |

当前支持立即提交普通免费草稿；不支持定时发布、收费设置、作者有话说、已发布正文修订或已发布章节移卷。不会生成小说、更新创作台账或申请作品完结。

## 安装

需要 **Node.js 22+、npm**。默认登录浏览器为 Google Chrome，首次登录需要本机交互式终端。

从 GitHub 固定版本安装（当前功能版本 v0.5.3）：

```bash
npm install -g 'git+https://github.com/x1ah/fanqie-cli.git#v0.5.3'
fanqie --version
fanqie --help
```

仓库尚未公开时需要 GitHub 访问权限，也可用 SSH 地址安装。本项目尚未发布到 npm registry。

开发或使用最新主分支：

```bash
git clone https://github.com/x1ah/fanqie-cli.git
cd fanqie-cli
npm ci
npm link
```

没有 Chrome 时，在工具目录运行 `npx playwright install chromium`，将工作区 `.fanqie/config.json` 的 `browser.channel` 改为 `""`。

## 快速开始

先在番茄作家后台创建作品并确认已有分卷。以下书名、路径和 ID 都是示例，绑定时替换成自己后台的真实值。

```bash
mkdir -p 我的写作目录/新书/正文/第一卷
cd 我的写作目录
fanqie init
fanqie add 新书 --title '后台实际书名' --source './新书/正文'
fanqie login
fanqie bind 新书 \
  --url 'https://fanqienovel.com/main/writer/chapter-manage/123456789' \
  --volume 第一卷 --remote-volume '第一卷：开篇'
fanqie volumes 新书
```

`login` 打开独立浏览器，手动登录后回终端按回车。`bind` 保存本地绑定，在线操作时才核对后台实际作品和卷。请将整个 `.fanqie/` 加入写作目录的 `.gitignore`。

创建 `新书/正文/第一卷/第001章_出发.md`：

```text
# 第001章 出发

清晨，林舟背起行囊走出了院门。

渡口的船还没有来，他决定先去找船家。
```

文件名与首行的章号、章名须一致。全书使用连续阿拉伯数字章号，不按卷重置；正文使用纯文字段落，避免 Markdown 排版和工作笔记。示例只用于演示格式，实际章节长度须符合平台要求。

```bash
fanqie check 新书 --volume 第一卷 --chapters 1
fanqie plan 新书 --volume 第一卷 --chapters 1
fanqie upload 新书 --volume 第一卷 --chapters 1
```

上传后全文、标题、章号、真实卷和草稿状态一致才记录 `verified`。这表示草稿回读通过。`status` 读取本地记录，不是平台实时发布查询。

需要正式提交审核时，先预览再执行，按实际创作情况填写 `--use-ai yes` 或 `no`：

```bash
fanqie publish 新书 --volume 第一卷 --chapters 1 --use-ai yes --dry-run
fanqie publish 新书 --volume 第一卷 --chapters 1 --use-ai yes
fanqie publish-status 新书 --volume 第一卷 --chapters 1
```

`reviewing` 为审核中，只有回读确认为 `published` 才表示已发布。发布必须明确卷和章号，不接受 `--all`。

## 操作约定

- `--chapters` 支持 `1`、`1-3`、`1,3-5`。每批处理一个卷，正文直接放在根目录时使用 `--volume .`。
- `--workspace /写作目录`（简写 `-w`）指定工作区；默认向上查找 `.fanqie/config.json`。
- `check`、`plan`、`upload --dry-run` 仅本地检查。其他修改命令的 `--dry-run` 会在线预检，但不提交修改。
- 全书库存与分页 GET 默认最多4路并发，保留总数、重复 ID、跨卷及正文检查；POST 逐章执行。
- 普通 `upload` 不覆盖旧稿。修订使用 `revise`，移卷使用 `move`；均保留原章节 ID，只处理满足校验条件的草稿。
- 结果未知先运行对应恢复查询，不删除日志绕过冲突，不自动重发写请求。平台不提供原子条件写，操作期间避免在网页同时编辑该章。

## 文档

- [命令与工作区参考](docs/commands.md)：分卷、修订、移卷、简介与状态含义。
- [故障恢复](docs/troubleshooting.md)：登录失效、pending、冲突和锁。
- [参与开发](CONTRIBUTING.md)：源码结构、测试、提交和发布检查。
- [安全说明](SECURITY.md)：凭据、日志和漏洞报告。
- [变更记录](CHANGELOG.md) · [历史接口研究](docs/api-research.md)。

## 许可证

[MIT](LICENSE) © 2026 x1ah。
