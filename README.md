# 番茄小说 CLI

通过 HTTP 接口把本地 Markdown / TXT 小说章节上传到番茄作家后台草稿箱。支持任意作品、正文目录和独立工作区。日常上传、回读与分卷管理无需启动 Chrome；浏览器只用于登录、刷新 HTTP 会话和手动诊断。

当前版本 **只存草稿，不提交审核或正式发布**。提供章节格式检查、上传预览、正文回读、防重复创建、跨卷冲突检查和中断恢复。使用网页内部 HTTP 接口，接口变化后可能需要更新工具。

## 安装

需要 Node.js 22+、npm。首次登录或刷新会话需要 Google Chrome。私有仓库需要相应 GitHub 访问权限。

```bash
npm install -g 'git+ssh://git@github.com/x1ah/fanqie-cli.git#v0.3.0'
fanqie --version
```

开发安装：`gh repo clone x1ah/fanqie-cli`，进入目录后运行 `npm ci`、`npm link`。不全局安装也可直接运行 `node /工具目录/bin/fanqie.js ...`。

使用 Playwright Chromium 时，将工作区配置的 `browser.channel` 改为空字符串，并在工具安装目录运行 `npx playwright install chromium`。

## 添加作品与登录

以下作品、目录、书名和地址均为示例：

```bash
mkdir -p 我的写作目录/新书/正文/第一卷
cd 我的写作目录
fanqie init
fanqie add 新书 --title '后台实际书名' --source './新书/正文'
fanqie login
fanqie bind 新书 \
  --url 'https://fanqienovel.com/main/writer/chapter-manage/实际数字ID&后台实际书名' \
  --volume 第一卷 --remote-volume '第一卷：后台实际卷名'
```

`login` 打开独立 Chrome，手动完成登录后回终端按回车，保存浏览器和 HTTP 会话。无需提供账号密码。旧工作区首次运行 HTTP 命令时自动复用原浏览器登录态导出会话，保留旧配置、选择器、状态和正文。

HTTP 会话失效时先运行 `fanqie auth-refresh`，复用现有浏览器会话；浏览器也已失效时再运行 `fanqie login`。不会在写入失败后反复登录或重试提交。

- `--source` 支持工作区相对路径和外部绝对路径。
- `--volume` 是正文目录下的相对分卷路径。正文直接放在根目录时使用 `.`。
- `--remote-volume` 是后台完整卷名，包含「第几卷：」前缀。
- 每卷单独绑定。同一后台作品 ID 在一个工作区内只绑定一个作品别名。
- `fanqie init --discover` 可读取子目录的 `作品信息.json` 发现作品；普通 init 不预设作品。

## 分卷管理

```bash
# 查询真实后台分卷及 ID
fanqie volumes 新书

# 在线查询预览，不写后台或更新绑定
fanqie volume-create 新书 --volume 第二卷 --remote-volume '第二卷：远行' --dry-run

# 新建并回读，成功后自动保存本地卷与真实后台卷 ID 的绑定
fanqie volume-create 新书 --volume 第二卷 --remote-volume '第二卷：远行'

# 改名并更新绑定；前缀序号保持不变
fanqie volume-rename 新书 --volume 第一卷 --remote-volume '第一卷：开篇'
```

新建前作品至少需要一个已有卷的绑定作为管理入口。本地目录名与后台卷名可以不同；命令不会创建正文目录、移动章节或删除分卷。新建的序号须与后台下一卷对应；卷名最多16字符，含前缀的完整名称最多20字符。

相同完整卷名已存在时核对并绑定，不重复新建。改名会保留其他分卷与顺序，回读成功后才更新本地配置。写入前记录 `.fanqie/volume-operations.json`；结果不明时以相同命令回读恢复，不盲目重复写入。`--dry-run` 会连接后台查询，但不提交修改。

## 章节格式

```text
新书/正文/第一卷/第001章_出发.md
新书/正文/第一卷/第001章 出发.txt
新书/正文/第一卷/001-出发.txt
```

文件内容：

```text
# 第001章 出发

第一段小说正文。

第二段小说正文。
```

TXT 首行可省略 `#`。文件名与首行章号、章名须一致。章号使用阿拉伯数字，全书连续编号，不按卷重置。正文含 Markdown 格式、作者笔记或空正文时拒绝上传，不静默清洗。

扫描跳过隐藏目录、`node_modules`、`归档`、说明文件和符号链接。本地字数是去空白字符数，平台计数以后台为准。

## 日常上传

```bash
# 本地检查和预览，不连接后台
fanqie check 新书 --volume 第一卷 --chapters 1-3
fanqie plan 新书 --volume 第一卷 --chapters 1-3
fanqie upload 新书 --volume 第一卷 --chapters 1-3 --dry-run

# HTTP 上传到指定已绑定卷的草稿箱
fanqie upload 新书 --volume 第一卷 --chapters 1-3
fanqie upload 新书 --volume 第二卷 --chapters 31-33
fanqie upload 新书 --volume 第一卷 --all
fanqie status 新书
```

`--chapters` 支持 `1`、`1-3`、`1,3-5`；与 `--all` 二选一。每批只处理一个卷。`--json` 输出 JSON；`--headless` 仅影响旧会话首次导出时的浏览器，不影响日常 HTTP 操作。

上传先确认作品及分卷，再遍历全书各卷的章节列表与全部草稿分页，整批核对重复章号、已发布或待发布冲突。已有草稿只回读匹配，不覆盖。新建之前再次检查整书冲突。

新章分配前记录 `pending`，分配后记录真实 `itemId`，再以固定 `publish_status=0`、`timer_status=0` 保存草稿。写接口不自动重试。成功响应后重新查询草稿并读取正文，比对章号、标题、分卷、状态和文字，全部一致才记录 `verified`。比较忽略空行、段落首尾空白和不换行空格差异。

**`verified` 只表示草稿内容一致，不代表提交审核、审核通过或已发布。** 工具不修改小说正文、连续性台账或创作进度。

## 中断恢复

```bash
fanqie reconcile 新书 --volume 第一卷 --chapters 1
```

`reconcile` 只核对已有草稿，不创建或覆盖。结果不明、正文不一致、跨卷冲突、分页重复或总数变化时停止。上传后本地正文或所在卷改变，普通 upload 会拒绝覆盖；手动修订后台并确认一致后再 reconcile。

如果仅分配了空草稿而保存未成功，状态中保留 `itemId`，需要人工检查该空稿；不会自动覆盖空稿或分配第二份。不要删除整个状态文件绕过错误。

## 工作区与凭据

```bash
fanqie -w /写作工作区 books
fanqie -w /写作工作区 volumes 新书
```

默认从当前目录向上查找 `.fanqie/config.json`，也可用 `--workspace` / `-w` 明确指定。会话和所有操作记录都保存在工作区，不写入工具安装目录。

```text
.fanqie/
  config.json             # 作品、正文路径和分卷绑定
  browser/                # 登录和刷新会话使用的浏览器资料
  http-auth.json          # Cookie、CSRF 等 HTTP 会话，权限 0600
  state.json              # 按作品 ID + 章号记录上传结果
  volume-operations.json  # 分卷写入和回读恢复记录
  run.lock                # HTTP、浏览器和配置操作共用进程锁
  diagnostics/            # 手动 inspect 导出的截图/控件信息
```

多个工作区的登录态隔离；同一工作区的所有作品共享账号。`.fanqie/` 含敏感凭据与未发布正文信息，必须加入工作区 `.gitignore`，不得提交或公开分享。

只有确认没有命令或自动化浏览器运行时，才可移除异常退出遗留的 `run.lock`。正常退出会自动释放锁。

## 手动诊断与验证

`fanqie inspect 新书 --volume 第一卷` 保留手动浏览器诊断。旧 `selectors` 配置仍保留，但不再影响 HTTP 上传。HTTP 错误只输出接口路径、状态或业务码，不打印 Cookie、CSRF、响应正文或小说内容。

```bash
npm ci
npm test
npm run test:browser
npm pack --dry-run
```

逻辑与本地 HTTP 模拟服务测试覆盖分页、跨卷冲突、转义、长 ID、登录/业务错误、草稿限定、重复执行和中断恢复；临时 Chrome 测试覆盖会话导出前拦截及原浏览器适配回归。所有自动化测试只用临时上下文和本地模拟数据，不向真实作品写测试章节。

浏览器测试默认 Chrome；安装 Chromium 后可运行 `FANQIE_TEST_CHANNEL=chromium npm run test:browser`。CI 在 Node.js 22/24 执行。

HTTP 查询及已有草稿回读已在真实账号验证；新草稿写入和分卷写入通过模拟服务验证，尚待实际业务操作验收。详见 [接口研究记录](docs/api-research.md)。
